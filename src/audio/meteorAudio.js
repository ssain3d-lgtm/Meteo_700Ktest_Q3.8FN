// Fully procedural Web Audio score for the ultimate.
// Layers: bed rumble, magic hum + shimmer, sky pressure, descent whoosh/roar,
// one-shot impact (crack + thud + crash + debris), lava ambience (magma rumble,
// bubbling, random crackles). Master gain -> limiter -> destination.
const LAYER_NAMES = ['bed', 'hum', 'shimmer', 'warning', 'descent', 'lava'];

export class MeteorAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.masterVolume = 0.8;
    this.levels = { bed: 0, hum: 0, shimmer: 0, warning: 0, descent: 0, lava: 0 };
    this._crackleTimer = null;
    this._shimmerTimer = null;
    this._rainTimer = null;
    this._rainBus = null;
  }

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.masterVolume : 0;
    // Sub-30 Hz content is inaudible on laptop/monitor speakers but was driving the
    // bus into full-scale and making the limiter squash everything audible.
    this.tilt = this.ctx.createBiquadFilter();
    this.tilt.type = 'highpass';
    this.tilt.frequency.value = 30;
    this.tilt.Q.value = 0.7;
    this.master.connect(this.tilt);
    // Gentle glue only: a hard limiter (threshold -10, ratio 14) was squashing the
    // impact transient flat, which is what made the hit feel weak.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 8;
    this.limiter.ratio.value = 4;
    this.limiter.attack.value = 0.006;
    this.limiter.release.value = 0.25;
    this.tilt.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    this.noiseBuf = this._makeNoiseBuffer(4, 'brown');
    this.whiteBuf = this._makeNoiseBuffer(2, 'white');

    this._buildBed();
    this._buildHum();
    this._buildWarning();
    this._buildDescent();
    this._buildLava();
    this._startSchedulers();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  // Called from a user gesture (button click) so the AudioContext can start.
  unlock() {
    if (!this.started) {
      this.init();
      this.setEnabled(this.enabled);
    } else {
      this.resume();
    }
  }

  _makeNoiseBuffer(seconds, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  _noiseSource(buffer, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    s.start();
    return s;
  }

  _layer(name) {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    this.levels[name] = 0;
    return g;
  }

  // ---- A. background tension rumble ----
  _buildBed() {
    const out = this._layer('bed');
    const src = this._noiseSource(this.noiseBuf);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 78;
    lp.Q.value = 0.7;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 14;
    const g = this.ctx.createGain();
    g.gain.value = 0.9;
    src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out);

    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.28;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    lfo.start();

    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 31;
    const subG = this.ctx.createGain();
    subG.gain.value = 0.1;
    sub.connect(subG); subG.connect(out);
    sub.start();

    // Audible band: laptop/monitor speakers roll off below ~80 Hz, so a rumble made
    // only of 31 Hz content is effectively silent. This mid band carries the tension.
    const midSrc = this._noiseSource(this.noiseBuf);
    const midBp = this.ctx.createBiquadFilter();
    midBp.type = 'bandpass';
    midBp.frequency.value = 105;
    midBp.Q.value = 1.1;
    const midG = this.ctx.createGain();
    midG.gain.value = 0.8;
    midSrc.connect(midBp); midBp.connect(midG); midG.connect(out);
    const midLfo = this.ctx.createOscillator();
    midLfo.frequency.value = 0.13;
    const midLfoG = this.ctx.createGain();
    midLfoG.gain.value = 22;
    midLfo.connect(midLfoG); midLfoG.connect(midBp.frequency);
    midLfo.start();
    this.bedNodes = { out };
  }

  // ---- B. charge / magic hum ----
  _buildHum() {
    const out = this._layer('hum');
    const freqs = [55, 82.5, 110, 164.8];
    this.humOscs = [];
    for (const f of freqs) {
      const o = this.ctx.createOscillator();
      o.type = f > 120 ? 'triangle' : 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.6;
      bp.Q.value = 3.2;
      const g = this.ctx.createGain();
      g.gain.value = 0.22;
      o.connect(bp); bp.connect(g); g.connect(out);
      o.start();
      this.humOscs.push({ o, g, base: g.gain.value });
    }
    const am = this.ctx.createOscillator();
    am.frequency.value = 5.4;
    const amG = this.ctx.createGain();
    amG.gain.value = 0.10;
    am.connect(amG); amG.connect(out.gain);
    am.start();
    this.humOut = out;

    // shimmer layer (scheduled magical blips) - separate gain so it can be muted alone
    this.shimmerOut = this._layer('shimmer');
  }

  _shimmerTick() {
    if (!this.ctx) return;
    const lvl = this.levels.shimmer;
    if (lvl > 0.02 && this.enabled) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = Math.random() > 0.5 ? 'sine' : 'triangle';
      const base = 900 + Math.random() * 2200;
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.4 + Math.random()), t + 0.12);
      const g = ctx.createGain();
      const peak = 0.05 * lvl * (0.4 + Math.random() * 0.6);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + Math.random() * 0.25);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = base;
      bp.Q.value = 6;
      o.connect(bp); bp.connect(g); g.connect(this.shimmerOut);
      o.start(t);
      o.stop(t + 0.6);
    }
    this._shimmerTimer = setTimeout(() => this._shimmerTick(), 90 + Math.random() * 260);
  }

  // ---- C. sky warning pressure ----
  _buildWarning() {
    const out = this._layer('warning');
    const ctx = this.ctx;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 27;
    const subG = ctx.createGain();
    subG.gain.value = 0.22;
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.62;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.1;
    trem.connect(tremG); tremG.connect(subG.gain);
    sub.connect(subG); subG.connect(out);
    sub.start(); trem.start();

    const src = this._noiseSource(this.noiseBuf);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 190;
    const swell = ctx.createGain();
    swell.gain.value = 0.62;
    src.connect(lp); lp.connect(swell); swell.connect(out);

    // distant crackling heat
    const hs = this._noiseSource(this.whiteBuf);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.4;
    const hg = ctx.createGain();
    hg.gain.value = 0.05;
    hs.connect(bp); bp.connect(hg); hg.connect(out);
    this.warningOut = out;
  }

  // ---- D. meteor descent: whoosh + roar ----
  _buildDescent() {
    const out = this._layer('descent');
    const ctx = this.ctx;
    const src = this._noiseSource(this.whiteBuf);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const whooshG = ctx.createGain();
    whooshG.gain.value = 1.0;
    src.connect(bp); bp.connect(whooshG); whooshG.connect(out);
    this.descentBP = bp;

    const roar = ctx.createOscillator();
    roar.type = 'sawtooth';
    roar.frequency.value = 48;
    const roar2 = ctx.createOscillator();
    roar2.type = 'sawtooth';
    roar2.frequency.value = 51.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    lp.Q.value = 2.5;
    const rg = ctx.createGain();
    rg.gain.value = 0.22;
    roar.connect(lp); roar2.connect(lp); lp.connect(rg); rg.connect(out);
    roar.start(); roar2.start();
    this.descentOut = out;
  }

  // ---- F. aftermath lava ambience ----
  _buildLava() {
    const out = this._layer('lava');
    const ctx = this.ctx;
    const src = this._noiseSource(this.noiseBuf);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 95;
    const g = ctx.createGain();
    g.gain.value = 0.95;
    src.connect(lp); lp.connect(g); g.connect(out);
    const throb = ctx.createOscillator();
    throb.frequency.value = 0.31;
    const throbG = ctx.createGain();
    throbG.gain.value = 0.3;
    throb.connect(throbG); throbG.connect(g.gain);
    throb.start();

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 38;
    const subG = ctx.createGain();
    subG.gain.value = 0.14;
    const subLfo = ctx.createOscillator();
    subLfo.frequency.value = 0.17;
    const subLfoG = ctx.createGain();
    subLfoG.gain.value = 5.5;
    subLfo.connect(subLfoG); subLfoG.connect(sub.frequency);
    sub.connect(subG); subG.connect(out);
    sub.start(); subLfo.start();

    // bubbling: filtered noise with slow random-ish AM
    const bs = this._noiseSource(this.whiteBuf);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 2.2;
    const bg = ctx.createGain();
    bg.gain.value = 0.26;
    const bam = ctx.createOscillator();
    bam.type = 'triangle';
    bam.frequency.value = 2.3;
    const bamG = ctx.createGain();
    bamG.gain.value = 0.16;
    bam.connect(bamG); bamG.connect(bg.gain);
    bs.connect(bp); bp.connect(bg); bg.connect(out);
    bam.start();

    // Molten gurgle in the AUDIBLE band: a small boiling magma pot is mostly
    // 100-400 Hz content, not sub-bass. Frequency wanders so it never sounds looped.
    const gs = this._noiseSource(this.noiseBuf);
    const gp1 = ctx.createBiquadFilter();
    gp1.type = 'lowpass';
    gp1.frequency.value = 320;
    const gp2 = ctx.createBiquadFilter();
    gp2.type = 'highpass';
    gp2.frequency.value = 110;
    const gg = ctx.createGain();
    gg.gain.value = 0.9;
    const surge = ctx.createOscillator();
    surge.type = 'sine';
    surge.frequency.value = 0.21;
    const surgeG = ctx.createGain();
    surgeG.gain.value = 0.35;
    surge.connect(surgeG); surgeG.connect(gg.gain);
    surge.start();
    const wander = ctx.createOscillator();
    wander.type = 'triangle';
    wander.frequency.value = 0.07;
    const wanderG = ctx.createGain();
    wanderG.gain.value = 90;
    wander.connect(wanderG); wanderG.connect(gp1.frequency);
    wander.start();
    gs.connect(gp1); gp1.connect(gp2); gp2.connect(gg); gg.connect(out);

    // Fumarole hiss: escaping gas, keeps the field alive between crackles
    const hs = this._noiseSource(this.whiteBuf);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const hg = ctx.createGain();
    hg.gain.value = 0.07;
    hs.connect(hp); hp.connect(hg); hg.connect(out);

    this.lavaOut = out;
  }

  _crackleTick() {
    if (!this.ctx) return;
    const lvl = this.levels.lava;
    if (lvl > 0.05 && this.enabled) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const kind = Math.random();
      if (kind < 0.55) {
        // sharp crackle: flame licking rock
        const src = ctx.createBufferSource();
        src.buffer = this.whiteBuf;
        src.playbackRate.value = 0.6 + Math.random() * 1.4;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900 + Math.random() * 2800;
        bp.Q.value = 1.2 + Math.random() * 3;
        const g = ctx.createGain();
        const peak = 0.26 * lvl * (0.35 + Math.random() * 0.65);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08 + Math.random() * 0.22);
        src.connect(bp); bp.connect(g); g.connect(this.lavaOut);
        src.start(t);
        src.stop(t + 0.5);
      } else if (kind < 0.85) {
        // rock tumble / gravel skitter settling into the pit
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        src.playbackRate.value = 0.4 + Math.random() * 0.6;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(700 + Math.random() * 700, t);
        bp.frequency.exponentialRampToValueAtTime(160 + Math.random() * 120, t + 0.5);
        bp.Q.value = 1.6;
        const g = ctx.createGain();
        const peak = 0.22 * lvl * (0.4 + Math.random() * 0.6);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45 + Math.random() * 0.5);
        src.connect(bp); bp.connect(g); g.connect(this.lavaOut);
        src.start(t);
        src.stop(t + 1.1);
      } else {
        // lava blorp: molten bubble bursting
        const o = ctx.createOscillator();
        o.type = 'sine';
        const f0 = 120 + Math.random() * 130;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.3);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.2 * lvl, t + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(this.lavaOut);
        o.start(t);
        o.stop(t + 0.6);
      }
    }
    this._crackleTimer = setTimeout(() => this._crackleTick(), 130 + Math.random() * 700);
  }

  _startSchedulers() {
    this._shimmerTick();
    this._crackleTick();
  }

  // ---- E. impact one-shot ----
  _distortionCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(amount * x);
    }
    return curve;
  }

  // One rock landing on the ground. Noise-based, never an oscillator sweep: a swept
  // sine is what made the previous impact read as a cartoon "boing".
  _rockHit(at, level, big) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = big ? this.noiseBuf : this.whiteBuf;
    src.playbackRate.value = 0.5 + Math.random() * 1.6;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const f = big ? 120 + Math.random() * 220 : 300 + Math.random() * 2200;
    bp.frequency.setValueAtTime(f * (big ? 1.8 : 1.4), at);
    bp.frequency.exponentialRampToValueAtTime(f, at + 0.09);
    bp.Q.value = big ? 0.9 : 1.5 + Math.random() * 4;
    const g = ctx.createGain();
    const peak = level * (big ? 0.46 : 0.22) * (0.45 + Math.random() * 0.55);
    const dec = big ? 0.22 + Math.random() * 0.2 : 0.04 + Math.random() * 0.13;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + (big ? 0.006 : 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dec);
    src.connect(bp); bp.connect(g); g.connect(this._rainBus);
    src.start(at);
    src.stop(at + dec + 0.35);
  }

  // Sustained debris: rocks big and small raining onto the crater floor for seconds.
  _startDebrisRain(strength, duration) {
    clearTimeout(this._rainTimer);
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.master);
    this._rainBus = bus;
    const start = ctx.currentTime;
    const end = start + duration;
    const step = () => {
      if (!this.ctx || !this.enabled) { this._rainBus = null; return; }
      const now = ctx.currentTime;
      if (now >= end) {
        const t2 = ctx.currentTime;
        bus.gain.cancelScheduledValues(t2);
        bus.gain.setValueAtTime(bus.gain.value, t2);
        bus.gain.linearRampToValueAtTime(0, t2 + 0.4);
        this._rainBus = null;
        return;
      }
      const progress = (now - start) / duration;
      const level = strength * (1 - progress * 0.7);
      const hits = Math.max(1, Math.round(7 - progress * 5));
      for (let i = 0; i < hits; i++) {
        this._rockHit(now + Math.random() * 0.16, level, Math.random() > 0.78);
      }
      this._rainTimer = setTimeout(step, 110 + Math.random() * 190);
    };
    step();
  }

  impact(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1.4, Math.max(0.4, strength));

    const bus = ctx.createGain();
    bus.gain.value = 0.72;
    bus.connect(this.master);

    // 1) the slam: broadband noise, near-instant attack
    {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(700, t + 0.18);
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.95 * s, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
      src.connect(bp); bp.connect(g); g.connect(bus);
      src.start(t);
      src.stop(t + 0.5);
    }
    // 2) rock body: the low thud - low-mid noise, no pitch sweep
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.8;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t);
      lp.frequency.exponentialRampToValueAtTime(130, t + 0.5);
      lp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.0 * s, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.75);
      src.connect(lp); lp.connect(g); g.connect(bus);
      src.start(t);
      src.stop(t + 1.0);
    }
    // 3) slab fracture snaps right behind the slam
    for (let i = 0; i < 3; i++) {
      const at = t + 0.02 + i * 0.045 + Math.random() * 0.03;
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      src.playbackRate.value = 1.2 + Math.random();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2200 + Math.random() * 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.3 * s, at + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06 + Math.random() * 0.05);
      src.connect(hp); hp.connect(g); g.connect(bus);
      src.start(at);
      src.stop(at + 0.25);
    }
    // 4) fireball roar: distorted noise swell behind the transient
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3000, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 1.8);
      const shaper = ctx.createWaveShaper();
      shaper.curve = this._distortionCurve(4);
      shaper.oversample = '2x';
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.62 * s, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 2.4);
      src.connect(lp); lp.connect(shaper); shaper.connect(g); g.connect(bus);
      src.start(t);
      src.stop(t + 2.6);
    }
    // 5) modest sub weight only - it must not eat the headroom like before
    {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(70, t);
      o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.24 * s, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.8);
      o.connect(g); g.connect(bus);
      o.start(t);
      o.stop(t + 2.0);
    }
    // 6) ground roll: the earth still moving after the hit
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 160;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + 0.1);
      g.gain.linearRampToValueAtTime(0.42 * s, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 4.6);
      src.connect(lp); lp.connect(g); g.connect(bus);
      src.start(t);
      src.stop(t + 4.8);
    }
    bus.gain.setValueAtTime(0.72, t);
    bus.gain.linearRampToValueAtTime(0.72, t + 1.4);
    bus.gain.linearRampToValueAtTime(0.0, t + 5.0);

    // 7) the debris rain the single hit was missing entirely
    this._startDebrisRain(s, 5.5);
  }

  setLayer(name, value, ramp = 0.4) {
    if (!this.started) return;
    const out = this._outFor(name);
    if (!out) return;
    this.levels[name] = value;
    const t = this.ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(value, t + ramp);
  }

  _outFor(name) {
    if (name === 'bed') return this.bedNodes?.out;
    if (name === 'hum') return this.humOut;
    if (name === 'shimmer') return this.shimmerOut;
    if (name === 'warning') return this.warningOut;
    if (name === 'descent') return this.descentOut;
    if (name === 'lava') return this.lavaOut;
    return null;
  }

  setPhaseTargets(phase, progress = 0) {
    if (!this.started) return;
    switch (phase) {
      case 'IDLE':
        this.setAll(0, 0.6);
        break;
      case 'SUMMON':
        this.setLayer('bed', 0.22, 1.2);
        this.setLayer('hum', 0.28, 1.0);
        this.setLayer('shimmer', 0.35, 1.0);
        this.setLayer('warning', 0, 1.0);
        this.setLayer('descent', 0, 0.6);
        this.setLayer('lava', 0, 1.2);
        break;
      case 'CHARGE':
        this.setLayer('bed', 0.42, 1.4);
        this.setLayer('hum', 0.62, 1.2);
        this.setLayer('shimmer', 0.8, 1.0);
        this.setLayer('warning', 0.12, 1.4);
        break;
      case 'SKY_WARNING':
        this.setLayer('bed', 0.5, 1.0);
        this.setLayer('hum', 0.5, 1.2);
        this.setLayer('shimmer', 0.5, 1.0);
        this.setLayer('warning', 0.75, 1.6);
        this.setLayer('descent', 0.10, 1.6);
        break;
      case 'DESCENT':
        this.setLayer('bed', 0.45, 0.6);
        this.setLayer('hum', 0.3, 0.8);
        this.setLayer('shimmer', 0.2, 0.6);
        this.setLayer('warning', 0.6, 0.8);
        break;
      case 'IMPACT':
        // Duck everything else fast so the hit cuts through instead of adding to it.
        this.setLayer('bed', 0.14, 0.15);
        this.setLayer('hum', 0, 0.15);
        this.setLayer('shimmer', 0, 0.15);
        this.setLayer('warning', 0.08, 0.15);
        this.setLayer('descent', 0.12, 0.15);
        this.setLayer('lava', 0.45, 1.2);
        break;
      case 'AFTERMATH':
        this.setLayer('bed', 0.18, 1.5);
        this.setLayer('warning', 0.05, 1.5);
        this.setLayer('descent', 0, 1.2);
        this.setLayer('lava', 0.72, 1.8);
        break;
      case 'DISSIPATE':
        this.setLayer('bed', 0.08, 2.5);
        this.setLayer('warning', 0, 2.0);
        this.setLayer('lava', 0.3, 3.0);
        break;
    }
  }

  // continuous descent intensity from meteor proximity (0..1)
  updateDescent(progress) {
    if (!this.started) return;
    const v = 0.18 + progress * progress * 0.85;
    const out = this.descentOut;
    if (out) {
      const t = this.ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setTargetAtTime(v, t, 0.12);
      this.levels.descent = v;
    }
    if (this.descentBP) {
      const t = this.ctx.currentTime;
      this.descentBP.frequency.setTargetAtTime(1400 - progress * 900, t, 0.2);
    }
  }

  setAll(v, ramp = 0.5) {
    for (const n of LAYER_NAMES) this.setLayer(n, v, ramp);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.started) { if (on) this.init(); return; }
    this.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(on ? this.masterVolume : 0, t + 0.25);
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(this.enabled ? v : 0, t + 0.15);
  }

  reset() {
    if (!this.started) return;
    clearTimeout(this._rainTimer);
    this._rainBus = null;
    this.setAll(0, 0.3);
  }

  dispose() {
    clearTimeout(this._crackleTimer);
    clearTimeout(this._shimmerTimer);
    clearTimeout(this._rainTimer);
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}
