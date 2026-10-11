// Layered camera shake: persistent per-phase base level + decaying impulse bursts.
// fbm-style summed sines at incommensurate rates (cheap, smooth, non-repeating).
export class CameraShake {
  constructor() {
    this.base = 0;
    this.impulse = 0;
    this.decay = 2.2;
    this.time = 0;
    this.rotation = { x: 0, y: 0, z: 0 };
    this.position = { x: 0, y: 0, z: 0 };
    this.fovKick = 0;
  }

  setBase(level) { this.base = level; }

  addImpulse(v, decay = 2.2) {
    this.impulse = Math.max(this.impulse, v);
    this.decay = decay;
  }

  update(dt, strengthMult) {
    this.time += dt;
    this.impulse *= Math.exp(-this.decay * dt);
    if (this.impulse < 0.0005) this.impulse = 0;
    const amp = (this.base + this.impulse) * strengthMult;
    const t = this.time;
    if (amp < 1e-5) {
      this.rotation.x = this.rotation.y = this.rotation.z = 0;
      this.position.x = this.position.y = this.position.z = 0;
      this.fovKick = 0;
      return;
    }
    const r1 = Math.sin(t * 21.7) * 0.5 + Math.sin(t * 37.31 + 1.3) * 0.3 + Math.sin(t * 63.97 + 4.1) * 0.2;
    const r2 = Math.sin(t * 19.3 + 2.2) * 0.5 + Math.sin(t * 43.13 + 0.7) * 0.3 + Math.sin(t * 71.51 + 2.9) * 0.2;
    const r3 = Math.sin(t * 17.11 + 5.0) * 0.5 + Math.sin(t * 29.7 + 1.9) * 0.35 + Math.sin(t * 57.3 + 0.4) * 0.15;
    const p1 = Math.sin(t * 13.37 + 0.5) * 0.6 + Math.sin(t * 27.11 + 2.7) * 0.4;
    const p2 = Math.sin(t * 11.9 + 4.4) * 0.6 + Math.sin(t * 31.7 + 1.1) * 0.4;
    const p3 = Math.sin(t * 9.7 + 3.3) * 0.7 + Math.sin(t * 23.3 + 5.2) * 0.3;
    this.rotation.x = r1 * 0.02 * amp;
    this.rotation.y = r2 * 0.02 * amp;
    this.rotation.z = r3 * 0.012 * amp;
    this.position.x = p1 * 0.35 * amp;
    this.position.y = p2 * 0.28 * amp;
    this.position.z = p3 * 0.35 * amp;
    this.fovKick = (Math.sin(t * 33.7) * 0.6 + Math.sin(t * 51.1 + 2.0) * 0.4) * 1.6 * this.impulse;
  }
}
