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
  }

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.masterVolume : 0;
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.22;
    this.master.connect(this.limiter);
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
    subG.gain.value = 0.22;
    sub.connect(subG); subG.connect(out);
    sub.start();
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
    subG.gain.value = 0.5;
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.62;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.22;
    trem.connect(tremG); tremG.connect(subG.gain);
    sub.connect(subG); subG.connect(out);
    sub.start(); trem.start();

    const src = this._noiseSource(this.noiseBuf);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
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
    whooshG.gain.value = 0.85;
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
    lp.frequency.value = 260;
    lp.Q.value = 2.5;
    const rg = ctx.createGain();
    rg.gain.value = 0.34;
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
    subG.gain.value = 0.3;
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
    bg.gain.value = 0.10;
    const bam = ctx.createOscillator();
    bam.type = 'triangle';
    bam.frequency.value = 2.3;
    const bamG = ctx.createGain();
    bamG.gain.value = 0.06;
    bam.connect(bamG); bamG.connect(bg.gain);
    bs.connect(bp); bp.connect(bg); bg.connect(out);
    bam.start();
    this.lavaOut = out;
  }

  _crackleTick() {
    if (!this.ctx) return;
    const lvl = this.levels.lava;
    if (lvl > 0.05 && this.enabled) {
      const ctx = this.ctx;
      const t = ctx.currentTime;
      // short noise transient: rock settling / flame lick
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      src.playbackRate.value = 0.6 + Math.random() * 1.4;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 700 + Math.random() * 2600;
      bp.Q.value = 1.2 + Math.random() * 3;
      const g = ctx.createGain();
      const peak = 0.10 * lvl * (0.3 + Math.random() * 0.7);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + Math.random() * 0.22);
      src.connect(bp); bp.connect(g); g.connect(this.lavaOut);
      src.start(t);
      src.stop(t + 0.5);
      if (Math.random() > 0.72) this._lavaBlip(t, lvl);
    }
    this._crackleTimer = setTimeout(() => this._crackleTick(), 220 + Math.random() * 1100);
  }

  _lavaBlip(t, lvl) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90 + Math.random() * 60, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * lvl, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(this.lavaOut);
    o.start(t);
    o.stop(t + 0.5);
  }

  _startSchedulers() {
    this._shimmerTick();
    this._crackleTick();
  }

  // ---- E. impact one-shot ----
  impact(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = Math.min(1.4, Math.max(0.4, strength));

    // sharp crack transient
    {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.85 * s, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
      src.connect(hp); hp.connect(g); g.connect(this.master);
      src.start(t);
      src.stop(t + 0.3);
    }
    // low-frequency thud
    {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(24, t + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.05 * s, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 1.5);
      o.connect(g); g.connect(this.master);
      o.start(t);
      o.stop(t + 1.7);
    }
    // explosion crash body
    {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(4200, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 1.4);
      lp.Q.value = 1.1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.95 * s, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 2.2);
      src.connect(lp); lp.connect(g); g.connect(this.master);
      src.start(t);
      src.stop(t + 2.4);
    }
    // sub-bass shockwave
    {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(60, t);
      o.frequency.exponentialRampToValueAtTime(18, t + 2.0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8 * s, t + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6);
      o.connect(g); g.connect(this.master);
      o.start(t);
      o.stop(t + 2.8);
    }
    // debris rattles
    for (let i = 0; i < 7; i++) {
      const dt = t + 0.15 + Math.random() * 1.6;
      const src = ctx.createBufferSource();
      src.buffer = this.whiteBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 500 + Math.random() * 1800;
      bp.Q.value = 2 + Math.random() * 4;
      const g = ctx.createGain();
      const peak = 0.10 * s * (0.3 + Math.random() * 0.7);
      g.gain.setValueAtTime(0, dt);
      g.gain.linearRampToValueAtTime(peak, dt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, dt + 0.12 + Math.random() * 0.2);
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start(dt);
      src.stop(dt + 0.4);
    }
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
        this.setLayer('bed', 0.3, 0.5);
        this.setLayer('hum', 0, 0.5);
        this.setLayer('shimmer', 0, 0.4);
        this.setLayer('warning', 0.25, 0.8);
        this.setLayer('descent', 0.35, 0.5);
        this.setLayer('lava', 0.55, 1.2);
        break;
      case 'AFTERMATH':
        this.setLayer('bed', 0.16, 1.5);
        this.setLayer('warning', 0.05, 1.5);
        this.setLayer('descent', 0, 1.2);
        this.setLayer('lava', 0.85, 1.8);
        break;
      case 'DISSIPATE':
        this.setLayer('bed', 0.06, 2.5);
        this.setLayer('warning', 0, 2.0);
        this.setLayer('lava', 0.28, 3.0);
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
    this.setAll(0, 0.3);
  }

  dispose() {
    clearTimeout(this._crackleTimer);
    clearTimeout(this._shimmerTimer);
    if (this.ctx) this.ctx.close();
    this.ctx = null;
    this.started = false;
  }
}
