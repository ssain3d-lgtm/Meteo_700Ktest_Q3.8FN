// Skill director: binds the state machine to every effect module, the camera director,
// the shake layer, the post chain and the audio score. This is where the choreography lives.
import * as THREE from 'three';

const IMPACT_POINT = new THREE.Vector3(0, 0, 0);
const METEOR_START = new THREE.Vector3(44, 168, -152);
const PARTICLE_KEYS = ['fire', 'embers', 'smoke', 'dust', 'debris'];

export class SkillDirector {
  constructor(deps) {
    this.camera = deps.camera;
    this.sm = deps.sm;
    this.postfx = deps.postfx;
    this.shake = deps.shake;
    this.director = deps.director;      // CameraDirector
    this.audio = deps.audio;
    this.env = deps.environment;
    this.circle = deps.magicCircle;
    this.sky = deps.skyWarning;
    this.meteor = deps.meteor;
    this.explosion = deps.explosion;
    this.shockwave = deps.shockwave;
    this.crater = deps.crater;
    this.lava = deps.lava;
    this.particles = deps.particles;
    this.params = deps.params;

    this.heat = 0;
    this.heatTarget = 0;
    this._ndc = new THREE.Vector3();
    this._ctx = { meteor: null };
    this.chargeValue = 0;
    this._suctionAcc = 0;
    this._dissipateK = 1;

    this.sm.onPhaseChange((phase) => this.onPhase(phase));
  }

  onPhase(phase) {
    const p = this.params;
    this.audio.setPhaseTargets(phase);

    // The meteor must exist before the camera director seeds its tracking gaze,
    // otherwise the rock enters the frame already off-screen.
    if (phase === 'DESCENT') {
      const speed0 = 62 * p.descentSpeed;
      const accel = 95 * p.descentSpeed;
      this.meteor.spawn(METEOR_START, IMPACT_POINT, speed0, accel, p.meteorSize);
      this._ctx.meteor = this.meteor;
    }

    this.director.setPhase(phase, this._ctx);

    switch (phase) {
      case 'IDLE':
        this.circle.hide();
        this.sky.hide();
        this.env.setRedMix(0);
        this.shake.setBase(0);
        this.heatTarget = 0;
        break;
      case 'SUMMON':
        this.circle.show();
        this.circle.setCharge(0);
        this.chargeValue = 0;
        this.env.setRedMix(0.12);
        this.shake.setBase(0.04);
        break;
      case 'CHARGE':
        this.env.setRedMix(0.28);
        this.shake.setBase(0.12);
        this.heatTarget = 0.25;
        this.particles.fire.attract = { center: new THREE.Vector3(0, 0.8, 0), strength: 55 };
        break;
      case 'SKY_WARNING':
        this.sky.show();
        this.env.setRedMix(0.8);
        this.shake.setBase(0.22);
        this.heatTarget = 0.35;
        break;
      case 'DESCENT': {
        this.sky.setLevel(1);
        this.env.setRedMix(1);
        this.shake.setBase(0.3);
        this.heatTarget = 0.5;
        break;
      }
      case 'IMPACT': {
        const s = p.impactStrength;
        this.meteor.despawn();
        this._ctx.meteor = null;
        this.particles.fire.attract = null;
        this.explosion.trigger(IMPACT_POINT, s, p.particleCount);
        this.shockwave.trigger(IMPACT_POINT, s, p.particleCount);
        this.crater.trigger(IMPACT_POINT, s);
        this.crater.setAutoGrow(true);
        this.lava.activate(IMPACT_POINT, this.crater.radius, s);
        this.postfx.triggerFlash(0.72 * s);
        this.shake.addImpulse(1.5 * s, 2.0);
        this.shake.setBase(0.35);
        this.audio.impact(s);
        this.sky.hide();
        this.circle.hide();
        this.env.setRedMix(0.55);
        this.heatTarget = 1.1;
        break;
      }
      case 'AFTERMATH':
        this.shake.setBase(0.10);
        this.env.setRedMix(0.42);
        this.heatTarget = 0.85;
        break;
      case 'DISSIPATE':
        this.shake.setBase(0.02);
        this.env.setRedMix(0.12);
        this.lava.deactivate();
        this.crater.setAutoGrow(false);
        this.heatTarget = 0.25;
        this._dissipateK = 1;
        break;
    }
  }

  update(dt, time) {
    const p = this.params;
    const phase = this.sm.phase;

    // CHARGE: draw flame particles into the circle core.
    if (phase === 'CHARGE') {
      this.chargeValue = Math.min(1, this.chargeValue + dt / 2.2);
      this.circle.setCharge(this.chargeValue);
      this._suctionAcc += dt * 90 * p.particleCount * (0.4 + this.chargeValue);
      while (this._suctionAcc >= 1) {
        this._suctionAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = this.circle.radius * (0.85 + Math.random() * 0.5);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const tang = 6 + Math.random() * 8;
        this.particles.fire.spawn({
          x, y: 0.2 + Math.random() * 1.2, z,
          vx: -Math.cos(a) * (10 + Math.random() * 14) - Math.sin(a) * tang,
          vy: 0.5 + Math.random() * 2.5,
          vz: -Math.sin(a) * (10 + Math.random() * 14) + Math.cos(a) * tang,
          life: 0.7 + Math.random() * 0.9,
          size: 0.3 + Math.random() * 0.85
        });
      }
      // occasional sparks off the runes
      if (Math.random() < dt * 22 * p.particleCount) {
        const a = Math.random() * Math.PI * 2;
        const r = this.circle.radius * (0.5 + Math.random() * 0.5);
        this.particles.embers.spawn({
          x: Math.cos(a) * r, y: 0.3 + Math.random() * 2, z: Math.sin(a) * r,
          vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 4,
          life: 0.8 + Math.random() * 1.2, size: 0.12 + Math.random() * 0.35
        });
      }
    } else if (phase === 'SUMMON') {
      this.chargeValue = Math.min(0.25, this.chargeValue + dt * 0.1);
      this.circle.setCharge(this.chargeValue);
    }

    // DESCENT: drive the meteor; landing advances the state machine.
    if (phase === 'DESCENT') {
      const landed = this.meteor.update(dt, time, p);
      this.audio.updateDescent(this.meteor.progress);
      this.shake.setBase(0.22 + this.meteor.progress * this.meteor.progress * 0.55);
      if (landed) {
        this.sm.requestNext();
        return;
      }
    }

    this.circle.update(dt, time);
    this.sky.update(dt, time);
    this.explosion.update(dt, time);
    this.shockwave.update(dt, time);
    this.crater.update(dt, time, p.lavaIntensity * (phase === 'DISSIPATE' ? this._dissipateK : 1));
    this.lava.update(dt, time, p.lavaIntensity * (phase === 'DISSIPATE' ? this._dissipateK : 1));

    if (phase === 'DISSIPATE') {
      const t = this.sm.timeInPhase;
      this._dissipateK = Math.max(0, 1 - t / Math.max(0.001, 4.5));
      this.env.setRedMix(0.12 * this._dissipateK);
      this.heatTarget = 0.25 * this._dissipateK;
      this.crater.fadeOut(0.6 * this._dissipateK);
      // the terrain itself closes over so IDLE returns to an intact floor
      if (t > 1.6) this.crater.setProgress(Math.max(0, 1 - (t - 1.6) / 2.6));
    }

    for (const key of PARTICLE_KEYS) {
      this.particles[key].update(dt, time);
    }

    // heat distortion follows the action in screen space
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * 1.6);
    let focus = null;
    if (phase === 'DESCENT' && this.meteor.active) {
      this._ndc.copy(this.meteor.position).project(this.camera);
      focus = { x: this._ndc.x, y: this._ndc.y };
      this.postfx.setHeat(this.heat * p.heatDistortion * 0.8, focus, 0.42);
    } else if (phase === 'IMPACT' || phase === 'AFTERMATH' || phase === 'DISSIPATE') {
      this._ndc.copy(IMPACT_POINT).project(this.camera);
      focus = { x: this._ndc.x, y: this._ndc.y };
      const amp = phase === 'IMPACT' ? 1.4 : 0.9 * Math.max(0.15, this.lava.intensity);
      this.postfx.setHeat(this.heat * p.heatDistortion * amp, focus, 0.55);
    } else {
      this.postfx.setHeat(0, { x: 0, y: 0 }, 0.5);
    }

    this.env.update(dt, time);
    this.postfx.update(dt, time);
  }

  resetAll() {
    this.meteor.despawn();
    this.explosion.reset();
    this.shockwave.reset();
    this.lava.reset();
    this.crater.reset();
    this.circle.hide();
    this.sky.reset();
    this.env.setRedMix(0);
    this.particles.fire.attract = null;
    for (const key of PARTICLE_KEYS) this.particles[key].clear();
    this.chargeValue = 0;
    this.heat = 0;
    this.heatTarget = 0;
    this.shake.setBase(0);
    this.shake.impulse = 0;
    this.postfx.flash = 0;
    this.postfx.setHeat(0, { x: 0, y: 0 }, 0.5);
  }
}
