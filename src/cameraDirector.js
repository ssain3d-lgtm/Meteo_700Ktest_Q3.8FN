// Camera director: cinematic pose transitions per phase + a tracking mode that follows
// the falling meteor during DESCENT, then whips to a wide pose at IMPACT.
// Shake is applied as a final layer on top of the directed pose.
import * as THREE from 'three';

const POSES = {
  IDLE:        { pos: [15.5, 7.0, 21.0], look: [0, 1.6, 0], fov: 52, time: 2.5 },
  SUMMON:      { pos: [13.0, 5.6, 17.5], look: [0, 1.4, 0], fov: 53, time: 2.2 },
  CHARGE:      { pos: [9.6, 3.6, 12.8],  look: [0, 1.8, 0], fov: 55, time: 2.6 },
  SKY_WARNING: { pos: [10.8, 3.0, 14.6],  look: [4.0, 26.0, -34.0], fov: 60, time: 1.5 },
  DESCENT:     { pos: [13.5, 4.2, 16.5],  look: [2, 24.0, -34.0], fov: 58, time: 1.2 },
  IMPACT:      { pos: [22.5, 8.5, 31.0], look: [0, 3.6, 0], fov: 62, time: 0.4 },
  AFTERMATH:   { pos: [12.0, 4.4, 15.5],  look: [0, 0.4, 0], fov: 55, time: 2.2 },
  DISSIPATE:   { pos: [14.5, 6.0, 19.0],  look: [0, 1.0, 0], fov: 53, time: 4.0 }
};

function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class CameraDirector {
  constructor(camera, shake) {
    this.camera = camera;
    this.shake = shake;
    this.from = { pos: new THREE.Vector3(...POSES.IDLE.pos), look: new THREE.Vector3(...POSES.IDLE.look), fov: POSES.IDLE.fov };
    this.to = { pos: new THREE.Vector3(...POSES.IDLE.pos), look: new THREE.Vector3(...POSES.IDLE.look), fov: POSES.IDLE.fov };
    this.duration = 1;
    this.elapsed = 1;
    this.curPos = this.from.pos.clone();
    this.curLook = this.from.look.clone();
    this.curFov = this.from.fov;
    this.tracking = false;
    this.trackBlend = 0;
    this._tmpLook = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();
    this._tmpGoal = new THREE.Vector3();
    this._gazeFollow = new THREE.Vector3();
    this._roll = 0;
    this._rollTarget = 0;
    this.camera.position.copy(this.curPos);
    this.camera.lookAt(this.curLook);
    this.camera.fov = this.curFov;
    this.camera.updateProjectionMatrix();
  }

  setPhase(phase, ctx) {
    const p = POSES[phase] ?? POSES.IDLE;
    this.from.pos.copy(this.curPos);
    this.from.look.copy(this.curLook);
    this.from.fov = this.curFov;
    this.to.pos.set(p.pos[0], p.pos[1], p.pos[2]);
    this.to.look.set(p.look[0], p.look[1], p.look[2]);
    this.to.fov = p.fov;
    this.duration = p.time;
    this.elapsed = 0;
    this.tracking = phase === 'DESCENT';
    this.trackBlend = this.tracking ? 0 : 1; // blend weight of the tracked look
    if (this.tracking) {
      // Seed the lagging gaze part-way toward the rock so it enters near the top of
      // the frame instead of starting off-screen.
      this._gazeFollow.copy(this.from.look);
      if (ctx && ctx.meteor) this._gazeFollow.lerp(ctx.meteor.position, 0.3);
    }
  }

  update(dt, ctx) {
    this.elapsed += dt;
    const k = smoothstep(this.elapsed / this.duration);
    const basePos = this._tmpPos.lerpVectors(this.from.pos, this.to.pos, k);
    const baseLook = this._tmpLook.lerpVectors(this.from.look, this.to.look, k);
    let fov = this.from.fov + (this.to.fov - this.from.fov) * k;
    let posX = basePos.x, posY = basePos.y, posZ = basePos.z;
    let lookX = baseLook.x, lookY = baseLook.y, lookZ = baseLook.z;

    if (this.tracking && ctx.meteor) {
      const mp = ctx.meteor.position;
      const distXZ = Math.hypot(mp.x, mp.z) || 1e-4;
      // closeness: 0 far away -> 1 at the ground
      const closeness = THREE.MathUtils.clamp(1 - mp.y / 45, 0, 1);
      const blend = smoothstep(this.elapsed / 1.0) * (0.55 + 0.45 * closeness);

      // swing to a low hero pose on the far side of the impact point, arcing around it
      // while the meteor falls so the background keeps moving.
      const baseAngle = Math.atan2(-mp.z, -mp.x);
      const sweep = baseAngle + 0.42 * Math.min(2.5, this.elapsed);
      const radius = 15.5 + 6.5 * closeness;
      const heroX = Math.cos(sweep) * radius;
      const heroZ = Math.sin(sweep) * radius;
      const heroY = 3.4 + 3.2 * (1 - closeness);
      posX = basePos.x + (heroX - basePos.x) * blend;
      posY = basePos.y + (heroY - basePos.y) * blend;
      posZ = basePos.z + (heroZ - basePos.z) * blend;

      // gaze: a human operator would LAG the falling rock, so the meteor visibly
      // travels through the frame instead of being pinned to its centre.
      const lead = Math.min(5, mp.length() * 0.06);
      this._gazeFollow.lerp(this._tmpGoal.set(mp.x * 0.82, mp.y - lead, mp.z * 0.82), 1 - Math.exp(-dt * 1.05));
      const gazeBlend = 1 - closeness * closeness;
      lookX = baseLook.x + (this._gazeFollow.x - baseLook.x) * gazeBlend;
      lookY = baseLook.y + (this._gazeFollow.y - baseLook.y) * gazeBlend;
      lookZ = baseLook.z + (this._gazeFollow.z - baseLook.z) * gazeBlend;

      // pressure: frame tightens as it approaches
      fov += closeness * closeness * 5.0;

      // slight dutch roll aligned with the fall direction
      this._rollTarget = Math.atan2(mp.x / distXZ, mp.z / distXZ) * 0.10 * blend;
    } else {
      this._rollTarget = 0;
    }
    this._roll += (this._rollTarget - this._roll) * Math.min(1, dt * 3);

    this.camera.position.set(posX + this.shake.position.x, posY + this.shake.position.y, posZ + this.shake.position.z);
    this.camera.up.set(Math.sin(this._roll), Math.cos(this._roll), 0);
    this.camera.lookAt(lookX, lookY, lookZ);
    this.camera.rotateX(this.shake.rotation.x);
    this.camera.rotateY(this.shake.rotation.y);
    this.camera.rotateZ(this.shake.rotation.z);
    const fovClamped = Math.min(90, Math.max(30, fov + this.shake.fovKick));
    if (Math.abs(this.camera.fov - fovClamped) > 1e-4) {
      this.camera.fov = fovClamped;
      this.camera.updateProjectionMatrix();
    }
  }

  pin() {
    this.duration = 0;
    this.elapsed = 0;
  }
}
