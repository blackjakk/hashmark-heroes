// ─── Audio system (Web Audio API, synth-based SFX) ─────────────────────────
// Procedurally-synthesized stadium sound effects. No external audio files —
// keeps the vanilla-script-tag architecture intact. Browsers require a user
// gesture to start the AudioContext, so we lazy-init on the first call.
//
// API:
//   GCAudio.play("snap")     — short click cue at play start
//   GCAudio.play("whistle")  — referee whistle at play end / score
//   GCAudio.play("hit")      — low-frequency thud on big collisions
//   GCAudio.play("cheer")    — crowd roar swell on touchdowns / big plays
//   GCAudio.crowd.start()    — begin the ambient crowd hum loop
//   GCAudio.crowd.stop()
//   GCAudio.setEnabled(false) — global mute
//
// Each SFX uses Web Audio nodes (oscillators, noise buffers, filters,
// envelopes) tuned to sound like its stadium counterpart without sampling.

const GCAudio = (() => {
  let ctx = null;
  let masterGain = null;
  let crowdNode = null;
  let crowdGain = null;
  let enabled = true;

  function _ensureCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.55;
    masterGain.connect(ctx.destination);
    return ctx;
  }

  // Resume on first user gesture (autoplay policy). One-shot listener.
  function _attachUnlock() {
    const unlock = () => {
      const c = _ensureCtx();
      if (c && c.state === "suspended") c.resume().catch(() => {});
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown",     unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown",     unlock, { once: true });
  }
  if (typeof window !== "undefined") _attachUnlock();

  // Reusable noise buffer (1 second of white noise) — sliced by individual
  // SFX via BufferSource start/stop timing.
  let _noiseBuf = null;
  function _noiseBuffer() {
    if (_noiseBuf) return _noiseBuf;
    const c = _ensureCtx();
    if (!c) return null;
    _noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return _noiseBuf;
  }

  // ── SFX synthesizers ──────────────────────────────────────────────────
  function _playSnap() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Short, sharp tonal click with body — like a snap impact + helmet thunk.
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.07);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    osc.connect(gain).connect(masterGain);
    osc.start(t); osc.stop(t + 0.1);
  }

  function _playWhistle() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Tweet-tweet referee whistle — narrow-band high-pitched chirp w/ vibrato.
    const osc = c.createOscillator();
    const gain = c.createGain();
    const lfo = c.createOscillator();
    const lfoGain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = 2400;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.20, t + 0.02);
    gain.gain.setValueAtTime(0.20, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(gain).connect(masterGain);
    osc.start(t); lfo.start(t);
    osc.stop(t + 0.32); lfo.stop(t + 0.32);
  }

  function _playHit() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Heavy low-frequency thud — band-passed noise burst + sub-tone tail.
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 180;
    filt.Q.value = 1.2;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 0.25);
    // Sub-tone tail for extra weight
    const sub = c.createOscillator();
    const subG = c.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(75, t);
    sub.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    subG.gain.setValueAtTime(0.35, t);
    subG.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    sub.connect(subG).connect(masterGain);
    sub.start(t); sub.stop(t + 0.22);
  }

  function _playCheer() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Crowd roar — band-passed noise with a swelling envelope. 1.6s wide,
    // peaks around 0.6s in.
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 900;
    filt.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.42, t + 0.6);
    gain.gain.linearRampToValueAtTime(0.0001, t + 1.6);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 1.7);
  }

  function _playGroan() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Crowd groan — low-passed noise with a descending pitch via filter
    // freq sweep. Reads as disappointment (incomplete pass, missed FG).
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.exponentialRampToValueAtTime(220, t + 0.9);
    filt.Q.value = 0.7;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.28, t + 0.25);
    gain.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 1.1);
  }

  // Vocal "HIKE!" — synthesized two-formant burst that reads as a male
  // shout. Two oscillator pairs at vowel formant centers (F1 ~700, F2
  // ~1100 for /aɪ/; then sweep to F1 ~500, F2 ~900 for /k/ tail) over
  // a noise burst tail to suggest the consonant.
  function _playHike() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    const fundamental = 145;  // adult male vocal fundamental
    const dur = 0.34;
    // Two formant oscillators driven by the fundamental for vowel body.
    function _formant(freqAt0, freqAtEnd, gainAt0, gainPeak) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freqAt0, t);
      o.frequency.exponentialRampToValueAtTime(freqAtEnd, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gainPeak, t + 0.05);
      g.gain.exponentialRampToValueAtTime(gainAt0, t + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      // Bandpass at the formant center to shape it as a vowel.
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(freqAt0, t);
      bp.frequency.exponentialRampToValueAtTime(freqAtEnd, t + dur);
      bp.Q.value = 6;
      o.connect(g).connect(bp).connect(masterGain);
      o.start(t); o.stop(t + dur + 0.02);
    }
    _formant(720, 540, 0.04, 0.18);   // F1 sweep (vowel body)
    _formant(1180, 920, 0.03, 0.14);  // F2 sweep
    // Fundamental sub for chest body.
    const sub = c.createOscillator();
    const subG = c.createGain();
    sub.type = "triangle";
    sub.frequency.setValueAtTime(fundamental, t);
    subG.gain.setValueAtTime(0.0001, t);
    subG.gain.exponentialRampToValueAtTime(0.10, t + 0.06);
    subG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    sub.connect(subG).connect(masterGain);
    sub.start(t); sub.stop(t + dur + 0.02);
    // Brief noise burst at the tail to suggest /k/ stop release.
    const buf = _noiseBuffer();
    if (buf) {
      const ns = c.createBufferSource();
      ns.buffer = buf;
      const nf = c.createBiquadFilter();
      nf.type = "highpass";
      nf.frequency.value = 1800;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.0001, t + dur - 0.06);
      ng.gain.exponentialRampToValueAtTime(0.10, t + dur - 0.04);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      ns.connect(nf).connect(ng).connect(masterGain);
      ns.start(t + dur - 0.06); ns.stop(t + dur + 0.02);
    }
  }

  // Tackle grunt — short, low formant burst for "uhh" with pitch falling.
  // Slight pitch randomization so back-to-back grunts don't sound identical.
  function _playGrunt() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    const dur = 0.22;
    const pitchVar = 1 + (Math.random() - 0.5) * 0.18;   // ±9%
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(190 * pitchVar, t);
    o.frequency.exponentialRampToValueAtTime(110 * pitchVar, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 560;
    bp.Q.value = 4;
    o.connect(g).connect(bp).connect(masterGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Boost the crowd loop gain for a moment — used on big plays / scores
  // so the ambient bed swells along with the cheer SFX. Auto-decays.
  function _crowdSwell(amount = 0.25, holdMs = 1200, fallMs = 1500) {
    if (!crowdGain || !ctx) return;
    const t = ctx.currentTime;
    const baseG = 0.06;
    const peak  = Math.min(0.45, baseG + amount);
    crowdGain.gain.cancelScheduledValues(t);
    crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
    crowdGain.gain.exponentialRampToValueAtTime(peak, t + 0.25);
    crowdGain.gain.setValueAtTime(peak, t + 0.25 + holdMs / 1000);
    crowdGain.gain.exponentialRampToValueAtTime(baseG, t + 0.25 + (holdMs + fallMs) / 1000);
  }

  function _playBigPlay() {
    const c = _ensureCtx(); if (!c) return;
    const t = c.currentTime;
    // Big-play swell — quick rising band-pass noise. Reads as "ohhh!"
    // when something significant but not yet a score happens (long run,
    // big completion, sack, INT).
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.setValueAtTime(600, t);
    filt.frequency.exponentialRampToValueAtTime(1200, t + 0.5);
    filt.Q.value = 0.6;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.32, t + 0.35);
    gain.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    src.connect(filt).connect(gain).connect(masterGain);
    src.start(t); src.stop(t + 1.1);
  }

  // ── Ambient crowd hum (looping low-level murmur) ──────────────────────
  function _crowdStart() {
    const c = _ensureCtx(); if (!c) return;
    if (crowdNode) return; // already running
    const buf = _noiseBuffer(); if (!buf) return;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 700;
    filt.Q.value = 0.5;
    const g = c.createGain();
    g.gain.value = 0.06;
    src.connect(filt).connect(g).connect(masterGain);
    src.start();
    crowdNode = src;
    crowdGain = g;
  }
  function _crowdStop() {
    if (!crowdNode) return;
    const c = ctx;
    if (c && crowdGain) {
      const t = c.currentTime;
      crowdGain.gain.cancelScheduledValues(t);
      crowdGain.gain.setValueAtTime(crowdGain.gain.value, t);
      crowdGain.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      try { crowdNode.stop(t + 0.55); } catch (_) {}
    } else {
      try { crowdNode.stop(); } catch (_) {}
    }
    crowdNode = null;
    crowdGain = null;
  }

  function play(name) {
    if (!enabled) return;
    if (!_ensureCtx()) return;
    if (ctx.state === "suspended") return; // wait for user gesture
    try {
      if (name === "snap")    _playSnap();
      else if (name === "whistle") _playWhistle();
      else if (name === "hit")     _playHit();
      else if (name === "cheer")   _playCheer();
      else if (name === "groan")   _playGroan();
      else if (name === "bigplay") _playBigPlay();
      else if (name === "hike")    _playHike();
      else if (name === "grunt")   _playGrunt();
    } catch (_) {}
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) _crowdStop();
  }
  function isEnabled() { return enabled; }

  return {
    play,
    crowd: { start: _crowdStart, stop: _crowdStop, swell: _crowdSwell },
    setEnabled,
    isEnabled,
  };
})();
