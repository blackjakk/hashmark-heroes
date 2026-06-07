// ─── Visual FX layer ──────────────────────────────────────────────────────
// Particle effects + screen shake on top of the existing canvas renderer.
// Pure canvas2D for now — no PIXI dependency. Designed so the API can be
// re-pointed to a PIXI ParticleContainer later without touching callers.
//
// API:
//   GCFx.dust(x, y, dir)            — kick-up dust at a player position
//                                     (x,y in #field-uprights canvas coords)
//   GCFx.hitBurst(x, y, color)      — collision debris on big hits
//   GCFx.confetti(x, y, color, n)   — touchdown confetti burst
//   GCFx.shake(strength=10, ms=400) — broadcast-wrap screen shake
//   GCFx.tick(dtMs)                 — advance particles each frame
//   GCFx.draw(ctx)                  — render to a 2D context
//
// Called from play-animation.js' tick loop (after _frameStartBroadcast and
// before _frameEndBroadcast) so particles render on the upright overlay
// canvas with the rest of the broadcast-cam sprites.

const GCFx = (() => {
  const particles = [];
  const MAX = 600;             // particle cap — drop newest if exceeded
  let shakeStart = 0;
  let shakeDur   = 0;
  let shakeAmp   = 0;
  let shakeTarget = null;

  // ── PIXI WebGL renderer (Phase 1) ─────────────────────────────────────
  // When PIXI is available we render particles via WebGL Graphics + a
  // BlurFilter "bloom-lite" pass. Particle data + update logic stay in
  // canvas2D so the caller API is unchanged; only the draw step swaps.
  // PIXI canvas gets attached as a child of the field-wrap once and
  // re-attached on wrap rebuilds (renderGameLayout reassembles innerHTML).
  let _pxApp = null;            // PIXI.Application
  let _pxParticles = null;      // PIXI.Container holding particle Graphics
  let _pxPool = [];             // recycled Graphics instances
  let _pxAttachedTo = null;     // wrap element we attached to (for invalidation)
  let _pxVignetteSprite = null; // PIXI.Sprite displaying a pre-rendered vignette texture
  let _pxLightBeams = null;     // PIXI.Container holding animated stadium-light rays
  let _pxFlashSprite = null;    // PIXI.Sprite (Texture.WHITE) for tinted full-screen flash
  let _flashStart = 0;
  let _flashDur = 0;
  let _flashColor = 0xffffff;
  let _flashPeak = 0;
  let _pxGrainSprite = null;    // PIXI.Sprite displaying a noise texture (replay film grain)
  let _pxLedContainer = null;   // PIXI.Container holding animated LED ad panels
  let _pxLensFlare = null;      // PIXI.Sprite (radial star) shown briefly on score
  let _flareStart = 0;
  let _flareDur   = 0;
  let _pxScanlines = null;      // PIXI.TilingSprite scanline overlay (replay)
  let _pxReplayBadge = null;    // PIXI.Text "INSTANT REPLAY" badge (replay)
  let _pxLiveBadge = null;      // PIXI.Container LIVE indicator (always-on)
  let _pxLiveDot   = null;      // PIXI.Graphics blinking red dot
  let _pxBigText   = null;      // PIXI.Text big celebration text ("TOUCHDOWN!" etc.)
  let _bigTextStart = 0;
  let _bigTextDur   = 0;
  let _pxChyron    = null;      // PIXI.Container player-highlight chyron
  let _chyronBg    = null;      // PIXI.Graphics chyron background bar
  let _chyronTitle = null;      // PIXI.Text big name
  let _chyronSub   = null;      // PIXI.Text subtitle
  let _chyronStart = 0;
  let _chyronDur   = 0;
  function _pixiAvailable() {
    return typeof PIXI !== "undefined" && typeof PIXI.Application === "function";
  }
  function _ensurePixiOverlay() {
    if (!_pixiAvailable()) return false;
    const wrap = document.querySelector(".bspnlive-field-wrap.broadcast-cam")
              || document.querySelector(".bspnlive-field-wrap")
              || document.querySelector(".field-wrap");
    if (!wrap) return false;
    // Wrap was rebuilt — our canvas got detached. Destroy and recreate.
    if (_pxApp && _pxAttachedTo !== wrap) {
      try { _pxApp.destroy(true, { children: true, texture: true }); } catch (_) {}
      _pxApp = null; _pxParticles = null; _pxPool.length = 0;
    }
    if (_pxApp) return true;
    try {
      _pxApp = new PIXI.Application({
        width: 1700, height: 720,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,            // we drive renders from the game tick
        preserveDrawingBuffer: true, // lets headless screenshots capture WebGL
      });
      const view = _pxApp.view;
      view.className = "gc-pixi-fx";
      view.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;" +
        "pointer-events:none;z-index:4;";
      wrap.appendChild(view);
      _pxAttachedTo = wrap;
      // ── Vignette + atmospheric haze REMOVED — they were flattening the
      // field's vibrant green into a washed-out dim look. Broadcast
      // atmosphere now comes from the LED ribbon, stadium light beams,
      // particle bloom, and the bigger event graphics (banners, chyrons,
      // lens flare). If we want corner framing back, do it via a single
      // CSS box-shadow on the wrap (easier to dial, no compositing tax).
      try {
        _pxLightBeams = new PIXI.Container();
        _pxLightBeams.blendMode = PIXI.BLEND_MODES.ADD;
        const beamTex = PIXI.RenderTexture.create({ width: 180, height: 720 });
        const beamG = new PIXI.Graphics();
        // Soft conical beam — bright at top, fading to transparent.
        for (let i = 0; i < 22; i++) {
          const t = i / 21;
          const halfW = 14 + t * 70;
          const yTop = t * 720 * 0.6;
          const a = (1 - t) * 0.06;
          beamG.beginFill(0xfff0c8, a);
          beamG.drawRect(90 - halfW, yTop, halfW * 2, 12);
          beamG.endFill();
        }
        _pxApp.renderer.render(beamG, { renderTexture: beamTex });
        beamG.destroy();
        const beamPositions = [0.10, 0.32, 0.50, 0.68, 0.90];
        for (const px of beamPositions) {
          const s = new PIXI.Sprite(beamTex);
          s.anchor.set(0.5, 0);
          s.position.set(px * 1700, 8);
          s.alpha = 0.55;
          _pxLightBeams.addChild(s);
        }
        _pxApp.stage.addChild(_pxLightBeams);
      } catch (e) {
        console.warn("PIXI light beams failed:", e);
        _pxLightBeams = null;
      }
      // ── Animated LED ad ribbon (Phase 2 port from CSS) — sits on the
      // stadium wall band where the static CSS ribbon was. Each panel
      // gets a per-frame color from a cycling palette, with a slight
      // bloom blur so the ribbon glows like a real LED display.
      try {
        _pxLedContainer = new PIXI.Container();
        const ledBlur = new PIXI.BlurFilter();
        ledBlur.blur = 1.6;
        ledBlur.quality = 1;
        _pxLedContainer.filters = [ledBlur];
        const panelW = 38;
        const gap    = 2;
        const stride = panelW + gap;
        const yPos   = 720 * 0.184;     // anchor to wall band
        const height = 13;
        // Pre-build panels — we mutate their colors per frame in _drawPixi.
        const totalPanels = Math.ceil(1700 / stride);
        for (let i = 0; i < totalPanels; i++) {
          const g = new PIXI.Graphics();
          g.beginFill(0xffffff, 1);     // placeholder; tinted per frame
          g.drawRect(0, 0, panelW, height);
          g.endFill();
          g.position.set(i * stride, yPos);
          _pxLedContainer.addChild(g);
        }
        _pxApp.stage.addChild(_pxLedContainer);
      } catch (e) {
        console.warn("PIXI LED ribbon failed:", e);
        _pxLedContainer = null;
      }
      // ── Particle layer with bloom-lite blur ──
      _pxParticles = new PIXI.Container();
      const blur = new PIXI.BlurFilter();
      blur.blur = 2.4;
      blur.quality = 2;
      _pxParticles.filters = [blur];
      _pxApp.stage.addChild(_pxParticles);
      // ── Film grain noise overlay (replay mode only) — generated on a
      // canvas2D ImageData (fast, ~1ms) and loaded as a PIXI texture,
      // then tiled across the FX canvas. Visible only when
      // window._replayMode === true; jittered each frame for motion.
      try {
        const noiseCanvas = document.createElement("canvas");
        noiseCanvas.width = noiseCanvas.height = 256;
        const nctx = noiseCanvas.getContext("2d");
        const img = nctx.createImageData(256, 256);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.random();
          const lum = v > 0.93 ? 255 : v < 0.07 ? 0 : 128;
          const a   = (v > 0.93 || v < 0.07) ? 70 : 0;
          data[i]   = lum;
          data[i+1] = lum;
          data[i+2] = lum;
          data[i+3] = a;
        }
        nctx.putImageData(img, 0, 0);
        const grainTex = PIXI.Texture.from(noiseCanvas);
        const tile = new PIXI.TilingSprite(grainTex, 1700, 720);
        tile.alpha = 0;
        _pxGrainSprite = tile;
        _pxApp.stage.addChild(_pxGrainSprite);
      } catch (e) {
        console.warn("PIXI grain failed:", e);
        _pxGrainSprite = null;
      }
      // ── Lens flare — bright radial star sprite at midfield that fires
      // briefly on score events. Pre-rendered to a RenderTexture so the
      // per-frame cost is just adjusting position + alpha.
      try {
        const flareTex = PIXI.RenderTexture.create({ width: 360, height: 360 });
        const flareG = new PIXI.Graphics();
        // Soft radial halo via concentric rings
        for (let r = 22; r > 0; r--) {
          const t = r / 22;
          const a = Math.pow(t, 1.6) * 0.045;
          flareG.beginFill(0xfff4d0, a);
          flareG.drawCircle(180, 180, r * 8);
          flareG.endFill();
        }
        // 4-pointed star streaks (horizontal + vertical bright bars)
        flareG.beginFill(0xffffe0, 0.85);
        flareG.drawRect(40, 178, 280, 4);
        flareG.drawRect(178, 40, 4, 280);
        flareG.endFill();
        // 4-pointed star secondary streaks (45°-rotated diagonals via thin rects)
        flareG.beginFill(0xffe8b0, 0.35);
        flareG.drawRect(80, 178, 200, 4);
        flareG.endFill();
        _pxApp.renderer.render(flareG, { renderTexture: flareTex });
        flareG.destroy();
        _pxLensFlare = new PIXI.Sprite(flareTex);
        _pxLensFlare.anchor.set(0.5);
        _pxLensFlare.position.set(850, 360);
        _pxLensFlare.alpha = 0;
        _pxLensFlare.blendMode = PIXI.BLEND_MODES.ADD;
        _pxApp.stage.addChild(_pxLensFlare);
      } catch (e) {
        console.warn("PIXI lens flare failed:", e);
        _pxLensFlare = null;
      }
      // ── Replay scanlines — horizontal lines tile pattern that overlays
      // the field in replay mode. Sits under the LED ribbon so the ads
      // stay crisp. Visible only when window._replayMode === true.
      try {
        const slineCanvas = document.createElement("canvas");
        slineCanvas.width = 2; slineCanvas.height = 4;
        const sctx = slineCanvas.getContext("2d");
        sctx.fillStyle = "rgba(0,0,0,0.42)";
        sctx.fillRect(0, 0, 2, 1);
        sctx.fillStyle = "rgba(0,0,0,0.20)";
        sctx.fillRect(0, 1, 2, 1);
        const slineTex = PIXI.Texture.from(slineCanvas);
        _pxScanlines = new PIXI.TilingSprite(slineTex, 1700, 720);
        _pxScanlines.alpha = 0;
        _pxApp.stage.addChild(_pxScanlines);
      } catch (e) {
        console.warn("PIXI scanlines failed:", e);
        _pxScanlines = null;
      }
      // ── LIVE broadcast indicator — red blinking dot + "LIVE" text in a
      // translucent backplate pill in the upper-left of the field-wrap.
      // Always visible during gameplay, hidden during replay (the INSTANT
      // REPLAY badge takes its place).
      try {
        _pxLiveBadge = new PIXI.Container();
        _pxLiveBadge.position.set(36, 36);
        const plate = new PIXI.Graphics();
        plate.beginFill(0x000000, 0.55);
        plate.lineStyle(1.5, 0xff3030, 0.7);
        plate.drawRoundedRect(0, 0, 108, 38, 6);
        plate.endFill();
        _pxLiveBadge.addChild(plate);
        _pxLiveDot = new PIXI.Graphics();
        _pxLiveDot.beginFill(0xff3030, 1);
        _pxLiveDot.drawCircle(16, 19, 7);
        _pxLiveDot.endFill();
        _pxLiveBadge.addChild(_pxLiveDot);
        const liveText = new PIXI.Text("LIVE", {
          fontFamily: "Impact, Arial Black, sans-serif",
          fontSize: 24,
          fill: 0xffffff,
          letterSpacing: 2,
        });
        liveText.position.set(34, 7);
        _pxLiveBadge.addChild(liveText);
        _pxApp.stage.addChild(_pxLiveBadge);
      } catch (e) {
        console.warn("PIXI live badge failed:", e);
        _pxLiveBadge = null;
      }
      // ── INSTANT REPLAY badge — visible only when window._replayMode is
      // true. Pulsing alpha + slight red tint.
      try {
        _pxReplayBadge = new PIXI.Text("● INSTANT REPLAY", {
          fontFamily: "Impact, Arial Black, sans-serif",
          fontSize: 38,
          fill: 0xff3030,
          stroke: 0x000000,
          strokeThickness: 5,
          letterSpacing: 2,
        });
        _pxReplayBadge.anchor.set(1, 0);                 // right-top aligned
        _pxReplayBadge.position.set(1700 - 28, 24);
        _pxReplayBadge.alpha = 0;
        _pxApp.stage.addChild(_pxReplayBadge);
      } catch (e) {
        console.warn("PIXI replay badge failed:", e);
        _pxReplayBadge = null;
      }
      // ── Big celebration text — drawn near the top so the TOUCHDOWN!
      // banner reads above the field action. Scale and alpha animated
      // per-fire via GCFx.bigText(text, color, durMs).
      try {
        _pxBigText = new PIXI.Text("", {
          fontFamily: "Impact, Arial Black, sans-serif",
          fontSize: 110,
          fill: 0xffffff,
          stroke: 0x000000,
          strokeThickness: 9,
          letterSpacing: 6,
          dropShadow: true,
          dropShadowAlpha: 0.85,
          dropShadowBlur: 6,
          dropShadowAngle: Math.PI / 2,
          dropShadowDistance: 8,
        });
        _pxBigText.anchor.set(0.5);
        _pxBigText.position.set(850, 220);
        _pxBigText.alpha = 0;
        _pxApp.stage.addChild(_pxBigText);
      } catch (e) {
        console.warn("PIXI big text failed:", e);
        _pxBigText = null;
      }
      // ── Player-highlight chyron — Bloomberg-style lower-left banner
      // that slides in showing a key player's name + stat blurb. Hidden
      // by default; triggered via GCFx.chyron(name, subtitle, color).
      try {
        _pxChyron = new PIXI.Container();
        _pxChyron.position.set(28, 560);    // bottom-left of the wrap
        _chyronBg = new PIXI.Graphics();
        _chyronBg.beginFill(0x0a0a14, 0.88);
        _chyronBg.drawRect(0, 0, 540, 100);
        _chyronBg.endFill();
        _chyronBg.beginFill(0xf5c542, 1);  // accent stripe
        _chyronBg.drawRect(0, 0, 8, 100);
        _chyronBg.endFill();
        _pxChyron.addChild(_chyronBg);
        _chyronTitle = new PIXI.Text("", {
          fontFamily: "Impact, Arial Black, sans-serif",
          fontSize: 42,
          fill: 0xffffff,
          letterSpacing: 1.5,
        });
        _chyronTitle.position.set(24, 12);
        _pxChyron.addChild(_chyronTitle);
        _chyronSub = new PIXI.Text("", {
          fontFamily: "Impact, Arial Black, sans-serif",
          fontSize: 22,
          fill: 0xf5c542,
          letterSpacing: 2,
        });
        _chyronSub.position.set(24, 60);
        _pxChyron.addChild(_chyronSub);
        _pxChyron.alpha = 0;
        _pxApp.stage.addChild(_pxChyron);
      } catch (e) {
        console.warn("PIXI chyron failed:", e);
        _pxChyron = null;
      }
      // ── Flash layer on top — full-screen Sprite with PIXI.Texture.WHITE
      // tinted to the flash color. Sprite-tinting bypasses the Graphics
      // path that produced the gray-composite issue in Phase 1.5.
      try {
        _pxFlashSprite = new PIXI.Sprite(PIXI.Texture.WHITE);
        _pxFlashSprite.width  = 1700;
        _pxFlashSprite.height = 720;
        _pxFlashSprite.alpha  = 0;
        _pxApp.stage.addChild(_pxFlashSprite);
      } catch (e) {
        console.warn("PIXI flash sprite failed:", e);
        _pxFlashSprite = null;
      }
      return true;
    } catch (e) {
      console.warn("PIXI FX init failed, falling back to canvas2D:", e);
      _pxApp = null;
      return false;
    }
  }
  function _hexFromRgba(rgbaPrefix) {
    // "rgba(255,180,80,"  →  0xFFB450
    const m = /rgba\((\d+),(\d+),(\d+),/.exec(rgbaPrefix);
    if (!m) return 0xffffff;
    return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
  }
  function _hexFromCss(c) {
    if (!c) return 0xffffff;
    if (c[0] === "#") {
      if (c.length === 4) {
        return (parseInt(c[1], 16) * 17) << 16 |
               (parseInt(c[2], 16) * 17) << 8 |
                parseInt(c[3], 16) * 17;
      }
      return parseInt(c.slice(1), 16);
    }
    return _hexFromRgba(c.startsWith("rgba") ? c : "rgba(" + c.slice(4));
  }
  function flash(color, durMs, peak) {
    _flashStart = performance.now();
    _flashDur   = durMs || 240;
    _flashColor = (typeof color === "string") ? _hexFromCss(color) : (color || 0xffffff);
    _flashPeak  = peak != null ? peak : 0.45;
    if (_pxFlashSprite && _pxApp) {
      // Bake the color into a fresh RenderTexture so we never depend on
      // sprite tint (PIXI 7 tint behavior is unreliable on the headless
      // software-WebGL renderer we use in CI).
      try {
        const tex = PIXI.RenderTexture.create({ width: 1700, height: 720 });
        const g = new PIXI.Graphics();
        g.beginFill(_flashColor, 1);
        g.drawRect(0, 0, 1700, 720);
        g.endFill();
        _pxApp.renderer.render(g, { renderTexture: tex });
        g.destroy();
        if (_pxFlashSprite.texture && _pxFlashSprite.texture !== PIXI.Texture.WHITE) {
          _pxFlashSprite.texture.destroy(true);
        }
        _pxFlashSprite.texture = tex;
        _pxFlashSprite.width = 1700;
        _pxFlashSprite.height = 720;
      } catch (e) { console.warn("flash texture rebuild failed:", e); }
    }
  }
  function _updateFlash() {
    if (!_pxFlashSprite) return;
    if (!_flashDur) { _pxFlashSprite.alpha = 0; return; }
    const elapsed = performance.now() - _flashStart;
    if (elapsed >= _flashDur) {
      _pxFlashSprite.alpha = 0;
      _flashDur = 0;
      return;
    }
    const k = elapsed / _flashDur;
    // Fast rise to peak in the first 25%, then exponential decay.
    const env = k < 0.25 ? (k / 0.25) : Math.exp(-(k - 0.25) * 6);
    _pxFlashSprite.alpha = env * _flashPeak;
  }
  function _drawPixi() {
    if (!_ensurePixiOverlay()) return false;
    // Stadium-wall chrome (LED ad ribbon, light beams, vignette) is anchored
    // to the broadcast-cam perspective wall — it has no meaning in the flat
    // top-down view, where it was floating as a stray horizontal strip over
    // the field. Hide it when not in broadcast; particles still render.
    const _isBroadcast = (typeof cameraMode === "undefined") || cameraMode === "broadcast";
    if (_pxLedContainer) _pxLedContainer.visible = _isBroadcast;
    if (_pxLightBeams)   _pxLightBeams.visible   = _isBroadcast;
    if (_pxVignetteSprite) _pxVignetteSprite.visible = _isBroadcast;
    // Pool: reuse Graphics across frames; index into _pxPool.
    let i = 0;
    for (const p of particles) {
      const alpha = Math.max(0, 1 - p.life / p.ttl);
      let g = _pxPool[i];
      if (!g) {
        g = new PIXI.Graphics();
        _pxPool[i] = g;
        _pxParticles.addChild(g);
      }
      g.visible = true;
      g.clear();
      const tint = _hexFromRgba(p.col);
      if (p.type === "confetti" && p.rot != null) {
        g.beginFill(tint, alpha);
        g.drawRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
        g.endFill();
        g.position.set(p.x, p.y);
        g.rotation = p.rot;
      } else {
        g.beginFill(tint, alpha);
        g.drawCircle(0, 0, Math.max(0.5, p.r));
        g.endFill();
        g.position.set(p.x, p.y);
        g.rotation = 0;
      }
      i++;
    }
    // Hide any extra pooled Graphics from a previous (larger) frame.
    for (; i < _pxPool.length; i++) _pxPool[i].visible = false;
    // Stadium light beams — slow per-beam pulse so the lighting feels
    // alive instead of static. Phase offset per beam keeps them out of
    // sync.
    if (_pxLightBeams) {
      const now = performance.now() / 1000;
      const beams = _pxLightBeams.children;
      for (let bi = 0; bi < beams.length; bi++) {
        const pulse = 0.4 + 0.18 * Math.sin(now * 0.6 + bi * 1.7);
        beams[bi].alpha = pulse;
      }
    }
    // Animated LED ad ribbon — each panel scrolls through a palette of
    // warm amber / cyan / white at staggered phases so the ribbon reads
    // as a moving message board rather than a static stripe. Every ~5
    // seconds the WHOLE ribbon flashes a rotating broadcast slogan.
    if (_pxLedContainer) {
      const t = performance.now() * 0.0015;
      const palette = [0xffb450, 0x50c8ff, 0xf0f0f0, 0xffb450, 0x80e0c0];
      const panels = _pxLedContainer.children;
      // Slogan flash — once every ~5s, the whole ribbon goes solid amber
      // for ~700ms to suggest a sponsor message scrolling past.
      const sloganPhase = (performance.now() % 5000) / 5000;
      const inSlogan = sloganPhase < 0.14;
      for (let pi = 0; pi < panels.length; pi++) {
        const g = panels[pi];
        g.clear();
        let col;
        if (inSlogan) {
          // Uniform amber wave with a brighter "scan" sweep through it.
          const scan = (pi / panels.length - sloganPhase * 8) % 1;
          col = (scan > 0 && scan < 0.18) ? 0xffffff : 0xff9028;
        } else {
          const idx = Math.floor((t + pi * 0.18)) % palette.length;
          col = palette[(idx + palette.length) % palette.length];
        }
        g.beginFill(col, 0.88);
        g.drawRect(0, 0, 38, 13);
        g.endFill();
        // Dark divider strip on the right edge of each panel.
        g.beginFill(0x080b12, 0.95);
        g.drawRect(38, 0, 2, 13);
        g.endFill();
      }
    }
    _updateFlash();
    // Lens flare — fast rise to peak (~15% of dur), then exp decay.
    // Rotates slightly while fading for "broadcast camera" lens feel.
    if (_pxLensFlare && _flareDur) {
      const elapsed = performance.now() - _flareStart;
      if (elapsed >= _flareDur) {
        _pxLensFlare.alpha = 0;
        _flareDur = 0;
      } else {
        const k = elapsed / _flareDur;
        const env = k < 0.15 ? (k / 0.15) : Math.exp(-(k - 0.15) * 4.5);
        _pxLensFlare.alpha = env * 0.85;
        _pxLensFlare.rotation = k * 0.3;
        _pxLensFlare.scale.set(0.7 + env * 0.45);
      }
    }
    // Film grain — visible only in replay mode. Jitter tile position
    // each frame so the grain has motion.
    if (_pxGrainSprite) {
      if (window._replayMode) {
        _pxGrainSprite.alpha = 0.28;
        _pxGrainSprite.tilePosition.x = (Math.random() - 0.5) * 256;
        _pxGrainSprite.tilePosition.y = (Math.random() - 0.5) * 256;
      } else if (_pxGrainSprite.alpha !== 0) {
        _pxGrainSprite.alpha = 0;
      }
    }
    // VHS scanlines — visible only in replay mode. Slight downward
    // drift so the scanlines feel like an old broadcast tube.
    if (_pxScanlines) {
      if (window._replayMode) {
        _pxScanlines.alpha = 0.35;
        _pxScanlines.tilePosition.y = (performance.now() * 0.012) % 4;
      } else if (_pxScanlines.alpha !== 0) {
        _pxScanlines.alpha = 0;
      }
    }
    // INSTANT REPLAY badge — visible only in replay mode, with a slow
    // alpha pulse that mimics a recording indicator.
    if (_pxReplayBadge) {
      if (window._replayMode) {
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() * 0.005);
        _pxReplayBadge.alpha = pulse;
      } else if (_pxReplayBadge.alpha !== 0) {
        _pxReplayBadge.alpha = 0;
      }
    }
    // Player chyron — slides in from the left, holds, slides out.
    if (_pxChyron && _chyronDur) {
      const elapsed = performance.now() - _chyronStart;
      if (elapsed >= _chyronDur) {
        _pxChyron.alpha = 0;
        _pxChyron.position.x = 28;
        _chyronDur = 0;
      } else {
        const k = elapsed / _chyronDur;
        let xOff, alpha;
        if (k < 0.12) {
          // Slide in from off-screen left
          const p = k / 0.12;
          xOff = -540 * (1 - p);
          alpha = p;
        } else if (k < 0.85) {
          // Hold
          xOff = 0;
          alpha = 1;
        } else {
          // Slide out left while fading
          const p = (k - 0.85) / 0.15;
          xOff = -160 * p;
          alpha = 1 - p;
        }
        _pxChyron.position.x = 28 + xOff;
        _pxChyron.alpha = alpha;
      }
    }
    // Big celebration text — pops in fast, holds, fades out. Slight
    // overshoot scale on the pop for a "banner slam-in" feel.
    if (_pxBigText && _bigTextDur) {
      const elapsed = performance.now() - _bigTextStart;
      if (elapsed >= _bigTextDur) {
        _pxBigText.alpha = 0;
        _bigTextDur = 0;
      } else {
        const k = elapsed / _bigTextDur;
        let env, scale;
        if (k < 0.10) {
          // Pop-in with overshoot
          const p = k / 0.10;
          env = p;
          scale = 1.18 - 0.18 * (1 - p);
        } else if (k < 0.18) {
          // Settle from overshoot
          const p = (k - 0.10) / 0.08;
          env = 1;
          scale = 1.18 - 0.18 * p;
        } else if (k < 0.72) {
          // Hold
          env = 1;
          scale = 1.0;
        } else {
          // Fade out
          const p = (k - 0.72) / 0.28;
          env = 1 - p;
          scale = 1.0 + 0.05 * p;
        }
        _pxBigText.alpha = env;
        _pxBigText.scale.set(scale);
      }
    }
    // LIVE badge — hidden during replay (replaced by INSTANT REPLAY).
    // Otherwise the red dot blinks every ~1.4s like a real LIVE feed.
    if (_pxLiveBadge && _pxLiveDot) {
      if (window._replayMode) {
        _pxLiveBadge.alpha = 0;
      } else {
        _pxLiveBadge.alpha = 1;
        const blink = (performance.now() % 1400) < 800 ? 1 : 0.25;
        _pxLiveDot.alpha = blink;
      }
    }
    _pxApp.renderer.render(_pxApp.stage);
    return true;
  }

  function _push(p) {
    if (particles.length >= MAX) return;
    particles.push(p);
  }

  function dust(x, y, dir) {
    // Light tan puff scattered from a foot strike. Drifts opposite to the
    // player's direction so it looks left behind.
    const d = (dir || 0);
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4 - d * 0.4;
      const sp = 0.8 + Math.random() * 1.0;
      _push({
        type: "dust",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, ttl: 380 + Math.random() * 220,
        r: 6 + Math.random() * 4,
        rg: 0.04,
        col: "rgba(195,178,142,",
        gravity: 0.0010,
      });
    }
  }

  function hitBurst(x, y, color) {
    // Sharp short-lived debris on collisions. Bigger spray, faster, mixes
    // tan dust with team-colored chips. Sized for visibility on the 1700×
    // 720 upright canvas where player sprites are ~30px tall.
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.4 + Math.random() * 4.0;
      const isChip = i % 3 === 0;
      _push({
        type: "hit",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: 0, ttl: 380 + Math.random() * 320,
        r: isChip ? (4 + Math.random() * 3) : (7 + Math.random() * 5),
        rg: -0.008,
        col: isChip ? (color || "rgba(40,40,55,") : "rgba(165,150,115,",
        gravity: 0.0035,
        drag: 0.985,
      });
    }
  }

  function confetti(x, y, color, n) {
    const count = n || 28;
    const cols = [
      color || "rgba(245,197,66,",
      "rgba(245,245,240,",
      "rgba(80,200,255,",
      "rgba(255,120,80,",
    ];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      const sp = 3.2 + Math.random() * 4.0;
      _push({
        type: "confetti",
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0, ttl: 1500 + Math.random() * 800,
        r: 6 + Math.random() * 5,
        rg: 0,
        col: cols[i % cols.length],
        gravity: 0.0020,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.018,
      });
    }
  }

  // Trigger a screen shake on the field-wrap element via CSS transform.
  // The wrap is the parent of the canvas; shaking it preserves the broadcast
  // cam perspective intact.
  function shake(strength, ms) {
    shakeStart = performance.now();
    shakeDur   = ms || 400;
    shakeAmp   = (strength != null) ? strength : 8;
    if (!shakeTarget) {
      shakeTarget = document.querySelector(".bspnlive-field-wrap")
                 || document.querySelector(".field-wrap");
    }
  }

  // ── Score-celebration cinematic ──────────────────────────────────────
  // Adds a brief slow-zoom pulse + extended confetti shower on touchdowns
  // and big scoring plays. Called from the engine event hooks alongside
  // confetti+flash+shake; layers on top so the cumulative effect feels
  // like a real broadcast TD celebration.
  let celebrationStart = 0;
  let celebrationDur   = 0;
  function chyron(name, subtitle, color, durMs) {
    if (!_pxChyron || !_chyronTitle || !_chyronSub || !_chyronBg) return;
    _chyronTitle.text = String(name || "").toUpperCase();
    _chyronSub.text   = String(subtitle || "");
    // Accent stripe in the team color (or gold if missing).
    const accent = (color != null)
      ? ((typeof color === "string") ? _hexFromCss(color) : color)
      : 0xf5c542;
    _chyronBg.clear();
    _chyronBg.beginFill(0x0a0a14, 0.88);
    _chyronBg.drawRect(0, 0, 540, 100);
    _chyronBg.endFill();
    _chyronBg.beginFill(accent, 1);
    _chyronBg.drawRect(0, 0, 8, 100);
    _chyronBg.endFill();
    _chyronStart = performance.now();
    _chyronDur   = durMs || 3200;
  }
  function bigText(text, color, durMs) {
    if (!_pxBigText) return;
    _pxBigText.text = String(text || "").toUpperCase();
    if (color != null) {
      _pxBigText.style.fill = (typeof color === "string") ? _hexFromCss(color) : color;
    } else {
      _pxBigText.style.fill = 0xffffff;
    }
    _bigTextStart = performance.now();
    _bigTextDur   = durMs || 1600;
  }
  function lensFlare(durMs, x, y) {
    _flareStart = performance.now();
    _flareDur   = durMs || 700;
    if (_pxLensFlare) {
      _pxLensFlare.position.set(x != null ? x : 850, y != null ? y : 360);
    }
  }
  function celebration(durMs) {
    celebrationStart = performance.now();
    celebrationDur   = durMs || 1400;
    if (!shakeTarget) {
      shakeTarget = document.querySelector(".bspnlive-field-wrap")
                 || document.querySelector(".field-wrap");
    }
  }
  function _updateCelebration() {
    if (!shakeTarget || !celebrationDur) return;
    const elapsed = performance.now() - celebrationStart;
    if (elapsed >= celebrationDur) {
      celebrationDur = 0;
      // Reset the wrap transform — but only if shake isn't also active.
      const shakeStillOn = (performance.now() - shakeStart) < shakeDur;
      if (!shakeStillOn) shakeTarget.style.transform = "";
      return;
    }
    const k = elapsed / celebrationDur;
    // Brief slow-zoom in then back out — peaks at ~30% in, returns to
    // 1.0 by the end. Subtle (3% max scale) so it doesn't fight shake.
    const env = Math.sin(k * Math.PI);             // 0 → 1 → 0
    const scale = 1 + 0.03 * env;
    // Apply a single transform that combines any active shake offset
    // with the celebration scale. shake is updated separately in tick();
    // we only set scale here, then shake re-adds its translate.
    if (!shakeTarget.dataset.celebScale) {
      shakeTarget.dataset.celebScale = "active";
    }
    shakeTarget.style.transform = `scale(${scale.toFixed(4)})`;
  }

  // Advance particle state, shake, and celebration zoom.
  function tick(dtMs) {
    const dt = dtMs || 16.7;
    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.ttl) { particles.splice(i, 1); continue; }
      p.vy += (p.gravity || 0) * dt;
      if (p.drag) { p.vx *= Math.pow(p.drag, dt / 16.7); p.vy *= Math.pow(p.drag, dt / 16.7); }
      p.x += p.vx;
      p.y += p.vy;
      p.r += (p.rg || 0) * dt;
      if (p.rotV) p.rot += p.rotV * dt;
    }
    // Shake + celebration zoom — combined into a single CSS transform.
    if (shakeTarget) {
      const sNow = performance.now();
      const shakeOn = (sNow - shakeStart) < shakeDur;
      const celebOn = celebrationDur && (sNow - celebrationStart) < celebrationDur;
      if (!shakeOn && !celebOn) {
        if (shakeTarget.style.transform) shakeTarget.style.transform = "";
      } else {
        let dx = 0, dy = 0, scale = 1;
        if (shakeOn) {
          const decay = 1 - (sNow - shakeStart) / shakeDur;
          dx = (Math.random() - 0.5) * 2 * shakeAmp * decay;
          dy = (Math.random() - 0.5) * 2 * shakeAmp * decay;
        }
        if (celebOn) {
          const k = (sNow - celebrationStart) / celebrationDur;
          const env = Math.sin(k * Math.PI);
          scale = 1 + 0.03 * env;
        } else if (!shakeOn) {
          celebrationDur = 0;
        }
        shakeTarget.style.transform =
          `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)})`;
      }
    }
  }

  function draw(ctx) {
    // Prefer PIXI WebGL rendering with bloom; transparent fallback to
    // canvas2D if PIXI failed to init or isn't attached yet.
    if (_drawPixi()) return;
    if (!particles.length) return;
    ctx.save();
    for (const p of particles) {
      const alpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = p.col + alpha.toFixed(2) + ")";
      if (p.type === "confetti" && p.rot != null) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * 0.35, p.r * 2, p.r * 0.7);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.r), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function clear() { particles.length = 0; }

  // Toggle the stadium-wall chrome (LED ribbon / beams / vignette) and
  // re-render once, so a camera-mode switch while the game is PAUSED takes
  // effect immediately instead of waiting for the next play's tick.
  function setStadiumChrome(on) {
    if (_pxLedContainer)   _pxLedContainer.visible   = on;
    if (_pxLightBeams)     _pxLightBeams.visible     = on;
    if (_pxVignetteSprite) _pxVignetteSprite.visible = on;
    if (_pxApp) { try { _pxApp.renderer.render(_pxApp.stage); } catch (_) {} }
  }

  return { dust, hitBurst, confetti, shake, flash, celebration, lensFlare, bigText, chyron, tick, draw, clear, setStadiumChrome };
})();
