// ─── PIXI player renderer (Phase 3.2) ────────────────────────────────────
// Sprite-atlas player system. Each unique (color, secondary, label, pose,
// facing, frame-bucket) gets a lazily-rendered PIXI.Texture sourced from
// an offscreen canvas2D _drawPlayerImpl call. Per-frame, the broadcast-
// cam draw queue swaps from "canvas2D _spriteQueue closure" to a PIXI
// Sprite update — one sprite per player, identified by (color|label).
//
// Why a sprite atlas instead of a 1:1 Graphics rewrite of _drawPlayerImpl?
//   - _drawPlayerImpl is ~1000 lines of canvas2D paths/fills with team-
//     color shading, AO, rim light, equipment variations, pose math.
//   - Rewriting that in PIXI Graphics is 3-5 sessions of risky regression.
//   - Pre-rendering once per pose-state and reusing the texture gives an
//     immediate perf win + 100% visual parity with the existing art.
//   - This is how AAA sports games (Madden / 2K) actually work — sprite
//     sheets, not per-frame paint.
//
// Feature flag — window._usePlayerPixi. Default false until Phase 3.2.2
// wires it into drawPlayer; toggle to true to test in devtools.

window._usePlayerPixi = (window._usePlayerPixi != null) ? window._usePlayerPixi : true;

const GCPlayer = (() => {
  let _app = null;              // PIXI.Application bound to #player-pixi
  let _stage = null;            // PIXI.Container, sortable by zIndex
  let _attachedTo = null;
  // Texture cache: key → PIXI.Texture. Lazily populated on first request.
  const _texCache = new Map();
  // Sprite cache: playerKey → PIXI.Sprite. Stable per-game so PIXI can
  // reuse the WebGL render state.
  const _spriteCache = new Map();
  let _frameMarker = 0;          // ticks each frameStart; sprites not
                                 // refreshed by frame end are hidden.
  let _frameIdx = 0;             // reset to 0 in frameStart; incremented
                                 // by every render() call so each draw
                                 // gets its own sprite slot regardless
                                 // of label collisions.
  // Sprite-atlas load tracking. Textures cached BEFORE a sprite finished
  // loading were drawn via the procedural fallback; once the atlas is
  // fully loaded we evict ONCE so subsequent renders use the now-loaded
  // sprites. Without this, the first few plays of a session can pin an
  // OL in a procedural upright pose forever because the sprite landed
  // AFTER the cache entry was created.
  let _atlasEvictionDone = false;

  function _pixiAvailable() {
    return typeof PIXI !== "undefined" && typeof PIXI.Application === "function";
  }
  function _drawAvailable() {
    return typeof _drawPlayerImpl === "function";
  }

  // Idempotent — wires PIXI onto a new flat overlay canvas inside the
  // field-wrap. Hidden by default (alpha controlled by window flag).
  function ensure() {
    if (!_pixiAvailable() || !_drawAvailable() || !window._usePlayerPixi) return false;
    // The wrap exists in either topdown or broadcast — find it.
    const wrap = document.querySelector(".bspnlive-field-wrap.broadcast-cam")
              || document.querySelector(".bspnlive-field-wrap")
              || document.querySelector(".field-wrap");
    if (!wrap) return false;
    if (_app && _attachedTo === wrap) return true;
    // Wrap rebuild — destroy + re-create (mirrors play-fx.js pattern).
    if (_app && _attachedTo !== wrap) {
      try { _app.destroy(true, { children: true, texture: false }); } catch (_) {}
      _app = null; _stage = null;
      _spriteCache.clear();
      // Textures stay cached across wrap rebuilds (they're not bound
      // to the destroyed Application's renderer in PIXI 7).
    }
    try {
      // Create the canvas first so we can position it correctly.
      const cv = document.createElement("canvas");
      cv.className = "gc-player-pixi";
      cv.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;" +
        "pointer-events:none;z-index:3;";
      // Insert above #field-uprights so PIXI players occlude the
      // billboarded canvas2D sprite layer when both are present.
      const upr = wrap.querySelector("#field-uprights");
      if (upr && upr.nextSibling) wrap.insertBefore(cv, upr.nextSibling);
      else wrap.appendChild(cv);
      _app = new PIXI.Application({
        view: cv,
        width: FIELD.W, height: FIELD.H,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,
        preserveDrawingBuffer: true,
      });
      _stage = new PIXI.Container();
      _stage.sortableChildren = true;   // depth sort via child.zIndex
      _app.stage.addChild(_stage);
      _attachedTo = wrap;
      return true;
    } catch (e) {
      console.warn("PIXI player init failed:", e);
      _app = null;
      return false;
    }
  }

  // Renders the canvas2D player to an offscreen canvas at a fixed
  // texture size, then wraps it as a PIXI.Texture. Suppresses the PIXI
  // shadow hook so the shadow is drawn IN the texture (not on the
  // global PIXI field).
  const TEX_W = 96;
  const TEX_H = 192;
  // Foot position inside the texture — body extends UP from here.
  // 18% margin at the bottom gives room for the shadow + foot dust.
  const TEX_FOOT_FX = 0.5;
  const TEX_FOOT_FY = 0.82;
  function _renderPoseToTexture(color, secondary, label, pose, t, facing, style, vx, vy) {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const offCtx = canvas.getContext("2d");
    // Inhibit the PIXI-shadow side-effect so the shadow paints onto
    // this offscreen canvas in canvas2D (where it belongs in the
    // texture).
    const prev = window._useFieldPixi;
    window._useFieldPixi = false;
    const fx = TEX_W * TEX_FOOT_FX;
    const fy = TEX_H * TEX_FOOT_FY;
    try {
      // Try PixelLab sprite first — same hook used in topdown. If the
      // pose/dir combo has a loaded sprite, draw it into this offscreen
      // canvas (which becomes the PIXI texture). Otherwise fall back to
      // the canvas2D procedural pose math.
      let drewSprite = false;
      if (typeof drawPlayerSprite === "function") {
        offCtx.save();
        offCtx.translate(fx, fy);
        // drawPlayerSprite now also stamps the jersey number at the
        // image-derived back-of-jersey position (per-frame).
        drewSprite = drawPlayerSprite(offCtx, pose, t, vx || 0, vy || 0, color, facing, label, secondary, style);
        offCtx.restore();
      }
      if (!drewSprite) {
        _drawPlayerImpl(
          offCtx,
          fx, fy,
          color, secondary, label, pose, t, facing, style || {}
        );
      }
    } catch (e) {
      console.warn("offscreen player render failed:", e);
    } finally {
      window._useFieldPixi = prev;
    }
    return PIXI.Texture.from(canvas);
  }

  // Quantize t to a finite set of frames per pose. 12 frames per pose
  // gives a noticeably smoother run / throw / tackle cycle than 6 —
  // legs/arms read as fluid motion instead of stepping through 6 stop-
  // frames. Sprite cache roughly doubles but stays well within budget
  // (each texture is ~72KB; 12 buckets × ~50 active pose-color combos =
  // ~40MB worst case).
  const T_BUCKETS = 12;
  // Coarse velocity → 8-direction bucket so PixelLab sprite direction
  // becomes part of the texture cache key. Without this, the cached
  // texture for "run pose, t=0.3" would always show whichever direction
  // happened to be first-rendered, ignoring the player's actual heading.
  function _dirBucket(vx, vy, facing) {
    if (Math.abs(vx || 0) < 0.05 && Math.abs(vy || 0) < 0.05) {
      return (facing == null || facing >= 0) ? "E" : "W";
    }
    const ang = Math.atan2(-vy, vx);
    const idx = ((Math.round((ang / (Math.PI / 4)) + 8)) % 8);
    return ["E","NE","N","NW","W","SW","S","SE"][idx];
  }
  function _texKey(color, secondary, label, pose, t, facing, style, vx, vy) {
    const tBucket = Math.max(0, Math.min(T_BUCKETS - 1, Math.floor(t * T_BUCKETS)));
    // style flags that affect rendering go into the key; ignore style
    // params that are equivalent for the same player.
    const sk = style ? `${style.longSleeves ? 1 : 0}${style.glove ? 1 : 0}${style.brace ? 1 : 0}` : "0";
    // Archetype variants drive the "engage" pose stance — must be in
    // the key or all linemen render the same cached texture regardless
    // of archetype.
    const ak = style && style.archetype ? style.archetype : "";
    // Name in the key so each player's skin tone gets its own texture.
    // Without this, two players with the same (color, label, pose) but
    // different skin tones share a cached texture and the rendered skin
    // FLICKERS between them as the cache resolves first-write-wins.
    const nm = style && style.name ? style.name : "";
    const dir = _dirBucket(vx, vy, facing);
    return `${color}|${secondary}|${label}|${pose}|${facing}|${dir}|${tBucket}|${sk}|${ak}|${nm}`;
  }
  function _getTexture(color, secondary, label, pose, t, facing, style, vx, vy) {
    const key = _texKey(color, secondary, label, pose, t, facing, style, vx, vy);
    let tex = _texCache.get(key);
    if (!tex) {
      const tBucket = Math.max(0, Math.min(T_BUCKETS - 1, Math.floor(t * T_BUCKETS)));
      const tRender = (tBucket + 0.5) / T_BUCKETS;
      tex = _renderPoseToTexture(color, secondary, label, pose, tRender, facing, style, vx, vy);
      _texCache.set(key, tex);
    }
    return tex;
  }

  // Public — call once at the start of every animation frame BEFORE any
  // GCPlayer.render() calls. Bumps the frame marker so sprites not
  // refreshed this frame can be hidden in frameEnd.
  function frameStart() {
    if (!ensure()) return;
    _frameMarker++;
    _frameIdx = 0;
    // One-shot cache eviction when the sprite atlas finishes loading.
    // Any texture cached during the load window was drawn via the
    // procedural fallback; once sprites are available we want fresh
    // renders that actually use them.
    if (!_atlasEvictionDone && typeof SpriteAtlas !== "undefined") {
      const s = SpriteAtlas.stats();
      if (s.loaded > 0 && s.loading === 0) {
        _texCache.clear();
        _atlasEvictionDone = true;
      }
    }
  }

  // Public — call per player per frame. We use a per-frame call-order
  // index as the sprite slot since labels can collide (many drawPlayer
  // calls pass label=""). Each render() gets its own sprite; sprites
  // are pooled across frames so the PIXI render state stays warm.
  // playerKey arg kept in signature for callers but no longer used for
  // sprite identity (logged for future use).
  function render(playerKey, screenX, screenY, scale, color, secondary, label, pose, t, facing, style, vx, vy) {
    if (!ensure()) return;
    const slot = _frameIdx++;
    let sprite = _spriteCache.get(slot);
    if (!sprite) {
      sprite = new PIXI.Sprite();
      sprite.anchor.set(TEX_FOOT_FX, TEX_FOOT_FY);
      _stage.addChild(sprite);
      _spriteCache.set(slot, sprite);
    }
    const tex = _getTexture(color, secondary, label, pose, t || 0, facing, style, vx, vy);
    sprite.texture = tex;
    sprite.position.set(screenX, screenY);
    sprite.scale.set(scale, scale);
    sprite.zIndex = screenY;        // depth sort: lower-on-screen = closer = on top
    sprite.visible = true;
    sprite._lastFrame = _frameMarker;
  }

  // Public — call once at the end of every animation frame to hide
  // sprites not refreshed (player went out of play / off screen).
  function frameEnd() {
    if (!_app || !_stage) return;
    for (const [key, sprite] of _spriteCache) {
      if (sprite._lastFrame !== _frameMarker) sprite.visible = false;
    }
    frameEndBall();
    _app.renderer.render(_app.stage);
  }

  // ── Ball renderer (Phase 3.3) ─────────────────────────────────────
  // Same sprite-atlas pattern for the football. One base texture per
  // glow-vs-no-glow variant; rotation handled via sprite.rotation
  // (continuous, not cached). Sprite lives in the same _stage as
  // players so depth sorting via zIndex is unified.
  const BALL_TEX_W = 48, BALL_TEX_H = 48;
  function _renderBallToTexture(glow) {
    if (typeof _drawBallImpl !== "function") return null;
    const canvas = document.createElement("canvas");
    canvas.width = BALL_TEX_W;
    canvas.height = BALL_TEX_H;
    const offCtx = canvas.getContext("2d");
    try {
      _drawBallImpl(offCtx, BALL_TEX_W / 2, BALL_TEX_H / 2, 1, { glow, angle: 0 });
    } catch (e) {
      console.warn("offscreen ball render failed:", e);
    }
    return PIXI.Texture.from(canvas);
  }
  let _ballSprite = null;
  let _ballTexGlow = null, _ballTexPlain = null;
  function renderBall(screenX, screenY, scale, angle, opts) {
    if (!ensure()) return;
    const glow = opts ? opts.glow !== false : true;
    if (glow && !_ballTexGlow)  _ballTexGlow  = _renderBallToTexture(true);
    if (!glow && !_ballTexPlain) _ballTexPlain = _renderBallToTexture(false);
    const tex = glow ? _ballTexGlow : _ballTexPlain;
    if (!tex) return;
    if (!_ballSprite) {
      _ballSprite = new PIXI.Sprite();
      _ballSprite.anchor.set(0.5);
      _stage.addChild(_ballSprite);
    }
    _ballSprite.texture = tex;
    _ballSprite.position.set(screenX, screenY);
    _ballSprite.scale.set(scale, scale);
    _ballSprite.rotation = angle || 0;
    _ballSprite.zIndex = screenY + 0.5;   // slight bias so ball renders
                                          // just above same-y players
    _ballSprite.visible = true;
    _ballSprite._lastFrame = _frameMarker;
  }

  function active() {
    if (!_pixiAvailable() || !window._usePlayerPixi) return false;
    if (!_app) ensure();
    return !!_app;
  }

  function _stats() {
    return {
      textures: _texCache.size,
      sprites: _spriteCache.size,
      active: active(),
    };
  }

  function frameEndBall() {
    // If ball wasn't rendered this frame, hide it
    if (_ballSprite && _ballSprite._lastFrame !== _frameMarker) {
      _ballSprite.visible = false;
    }
  }

  return { ensure, frameStart, render, renderBall, frameEnd, frameEndBall, active, _stats };
})();
