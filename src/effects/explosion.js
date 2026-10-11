// IMPACT burst: expanding fireball, vertical fire pillar, ground flash disc,
// pooled 3D debris rocks with bounce physics, and particle bursts.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';
import { mulberry32 } from '../assets/proceduralTextures.js';

export class Explosion {
  constructor(scene, textures, particles) {
    this.scene = scene;
    this.particles = particles;
    this.time = 0;
    this.duration = 2.6;
    this.active = false;

    // --- fireball ---
    const fbGeo = new THREE.IcosahedronGeometry(1, 4);
    this.fbMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uProgress: { value: 0 },
        uFire: { value: textures.fire },
        uRadius: { value: 1 },
        uFade: { value: 0 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uRadius;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vPos;
        ${GLSL_NOISE}
        void main() {
          vec3 n = normalize(position);
          float bump = fbm3(n * 3.0 + vec3(0.0, uTime * 0.6, uTime * 0.2));
          vec3 p = position * (1.0 + bump * 0.45) * uRadius;
          vPos = n;
          vNrm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFire;
        uniform float uTime;
        uniform float uProgress;
        uniform float uFade;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vPos;
        void main() {
          vec3 nrm = normalize(vNrm);
          vec3 view = normalize(vView + vec3(0.0, 0.0, 1e-4));
          float fres = pow(1.0 - clamp(dot(nrm, view), 0.0, 1.0), 1.5);
          vec2 uv = vec2(atan(vPos.z, vPos.x) * 0.15915494 + uTime * 0.05, vPos.y * 0.5 + 0.5 - uTime * 0.3);
          vec3 fire = texture2D(uFire, uv).rgb;
          float core = pow(1.0 - fres, 2.2);
          vec3 col = fire * (0.35 + core * 1.35);
          col += vec3(1.0, 0.95, 0.85) * core * 0.9;
          float a = uFade * (0.3 + 0.7 * core);
          gl_FragColor = vec4(col * (0.7 + core * 0.7), a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.fireball = new THREE.Mesh(fbGeo, this.fbMat);
    this.fireball.visible = false;
    this.fireball.renderOrder = 8;
    scene.add(this.fireball);

    // --- fire pillar ---
    const pilGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 24, true);
    pilGeo.translate(0, 0.5, 0);
    this.pilMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFire: { value: textures.fire },
        uProgress: { value: 0 },
        uHeight: { value: 1 },
        uRadius: { value: 1 },
        uFade: { value: 0 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uHeight;
        uniform float uRadius;
        varying vec3 vPos;
        varying vec3 vNrm;
        varying vec3 vView;
        ${GLSL_NOISE}
        void main() {
          vec3 p = position;
          p.y *= uHeight;
          float h = clamp(position.y, 0.0, 1.0);
          float taper = mix(1.0, 0.45, h);
          p.x *= uRadius * taper;
          p.z *= uRadius * taper;
          float n = fbm3(vec3(p.x * 1.6, p.y * 1.1 - uTime * 2.2, p.z * 1.6));
          p += normalize(vec3(p.x, 0.0, p.z) + vec3(1e-4, 0.0, 0.0)) * n * 0.5 * taper * uRadius;
          vPos = position;
          vNrm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFire;
        uniform float uTime;
        uniform float uProgress;
        uniform float uFade;
        varying vec3 vPos;
        varying vec3 vNrm;
        varying vec3 vView;
        void main() {
          float h = clamp(vPos.y, 0.0, 1.0);
          vec3 nrm = normalize(vNrm);
          vec3 view = normalize(vView + vec3(0.0, 0.0, 1e-4));
          float fres = pow(1.0 - clamp(dot(nrm, view), 0.0, 1.0), 1.2);
          vec2 uv = vec2(atan(vPos.z, vPos.x) * 0.15915494, h * 1.4 - uTime * 1.1);
          vec3 fire = texture2D(uFire, uv).rgb;
          float core = pow(1.0 - fres, 2.0);
          vec3 col = fire * (0.6 + core * 2.2);
          col += vec3(1.0, 0.96, 0.88) * core * 1.5 * (1.0 - h);
          float a = uFade * (1.0 - h) * (0.3 + 0.7 * core);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    this.pillar = new THREE.Mesh(pilGeo, this.pilMat);
    this.pillar.visible = false;
    this.pillar.renderOrder = 8;
    scene.add(this.pillar);

    // --- ground flash disc ---
    this.flashDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.flashDisc.rotation.x = -Math.PI / 2;
    this.flashDisc.position.y = 0.12;
    this.flashDisc.visible = false;
    this.flashDisc.renderOrder = 9;
    scene.add(this.flashDisc);

    // --- explosion light ---
    this.light = new THREE.PointLight(0xffa050, 0, 300, 1.3);
    this.light.position.set(0, 4, 0);
    scene.add(this.light);

    // --- pooled debris rocks ---
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95, metalness: 0.02, emissive: 0x500d02, emissiveIntensity: 0.5 });
    this.debrisCount = 140;
    this.debris = new THREE.InstancedMesh(rockGeo, rockMat, this.debrisCount);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.visible = false;
    this.debris.frustumCulled = false;
    scene.add(this.debris);
    this.dPos = new Float32Array(this.debrisCount * 3);
    this.dVel = new Float32Array(this.debrisCount * 3);
    this.dRot = new Float32Array(this.debrisCount * 3);
    this.dRotVel = new Float32Array(this.debrisCount * 3);
    this.dSize = new Float32Array(this.debrisCount);
    this.dLife = new Float32Array(this.debrisCount);
    this.dMaxLife = new Float32Array(this.debrisCount);
    this.dActive = 0;
    this._mat4 = new THREE.Matrix4();
    this._quat = new THREE.Quaternion();
    this._euler = new THREE.Euler();
    this._scaleV = new THREE.Vector3();
    this._posV = new THREE.Vector3();
  }

  trigger(center, strength, particleCountMult) {
    this.active = true;
    this.time = 0;
    this.strength = strength;
    this.center = center.clone();
    const rnd = mulberry32((Date.now() & 0xffff) | 1);

    // spawn debris
    const n = Math.floor(this.debrisCount * Math.min(1, 0.45 + 0.55 * strength));
    this.dActive = n;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const elev = 0.25 + rnd() * 1.05;
      const sp = (14 + rnd() * 34) * strength;
      const i3 = i * 3;
      this.dPos[i3] = center.x + Math.cos(a) * 2;
      this.dPos[i3 + 1] = 1.5 + rnd() * 3;
      this.dPos[i3 + 2] = center.z + Math.sin(a) * 2;
      this.dVel[i3] = Math.cos(a) * sp * Math.cos(elev);
      this.dVel[i3 + 1] = sp * Math.sin(elev) + 8;
      this.dVel[i3 + 2] = Math.sin(a) * sp * Math.cos(elev);
      this.dRot[i3] = rnd() * 6.28; this.dRot[i3 + 1] = rnd() * 6.28; this.dRot[i3 + 2] = rnd() * 6.28;
      this.dRotVel[i3] = (rnd() - 0.5) * 12; this.dRotVel[i3 + 1] = (rnd() - 0.5) * 12; this.dRotVel[i3 + 2] = (rnd() - 0.5) * 12;
      this.dSize[i] = 0.25 + rnd() * rnd() * 1.5;
      this.dMaxLife[i] = 2.5 + rnd() * 3.5;
      this.dLife[i] = this.dMaxLife[i];
    }
    this.debris.visible = true;

    // particle bursts
    const P = this.particles;
    const pc = particleCountMult;
    const fireN = Math.floor(900 * strength * pc);
    for (let i = 0; i < fireN; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = Math.random() * Math.PI * 0.55;
      const sp = 8 + Math.random() * 42 * strength;
      P.fire.spawn({
        x: center.x + Math.cos(a) * Math.cos(elev) * 2,
        y: 1 + Math.sin(elev) * 3,
        z: center.z + Math.sin(a) * Math.cos(elev) * 2,
        vx: Math.cos(a) * Math.cos(elev) * sp,
        vy: Math.sin(elev) * sp * 1.2,
        vz: Math.sin(a) * Math.cos(elev) * sp,
        life: 0.7 + Math.random() * 1.4,
        size: 0.5 + Math.random() * 1.9
      });
    }
    const emberN = Math.floor(700 * strength * pc);
    for (let i = 0; i < emberN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 30 * strength;
      P.embers.spawn({
        x: center.x + Math.cos(a) * 3, y: 1 + Math.random() * 4, z: center.z + Math.sin(a) * 3,
        vx: Math.cos(a) * sp, vy: 8 + Math.random() * 26 * strength, vz: Math.sin(a) * sp,
        life: 1.6 + Math.random() * 2.4, size: 0.12 + Math.random() * 0.45
      });
    }
    const smokeN = Math.floor(260 * strength * pc);
    for (let i = 0; i < smokeN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 18 * strength;
      P.smoke.spawn({
        x: center.x + Math.cos(a) * 4, y: 2 + Math.random() * 6, z: center.z + Math.sin(a) * 4,
        vx: Math.cos(a) * sp, vy: 4 + Math.random() * 9, vz: Math.sin(a) * sp,
        life: 3 + Math.random() * 3.5, size: 2.2 + Math.random() * 4.6
      });
    }
    const dustN = Math.floor(320 * strength * pc);
    for (let i = 0; i < dustN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 10 + Math.random() * 34 * strength;
      P.dust.spawn({
        x: center.x + Math.cos(a) * 3, y: 0.6 + Math.random() * 2, z: center.z + Math.sin(a) * 3,
        vx: Math.cos(a) * sp, vy: 1 + Math.random() * 5, vz: Math.sin(a) * sp,
        life: 2.2 + Math.random() * 2.6, size: 1.8 + Math.random() * 4.2
      });
    }
  }

  update(dt, time) {
    if (!this.active) return;
    this.time += dt;
    const t = this.time;
    const s = this.strength;

    const fbDur = 0.85;
    if (t < fbDur + 0.55) {
      const p = Math.min(1, t / fbDur);
      // expansion is fast then decelerates; brightness falls off as the volume grows,
      // otherwise a 40+ unit fireball whites out the entire frame.
      const r = 3 + 13 * s * (1 - Math.pow(1 - p, 2.4));
      const fade = p < 1 ? Math.pow(1 - p * 0.55, 1.6) : Math.max(0, 1 - (t - fbDur) / 0.55);
      this.fbMat.uniforms.uTime.value = time;
      this.fbMat.uniforms.uProgress.value = p;
      this.fbMat.uniforms.uRadius.value = r;
      this.fbMat.uniforms.uFade.value = fade;
      this.fireball.position.copy(this.center).setY(this.center.y + 2.5);
      this.fireball.visible = fade > 0.02;
    } else {
      this.fireball.visible = false;
    }

    const pilDur = 1.7;
    if (t < pilDur) {
      const p = t / pilDur;
      const h = (26 + 34 * s) * Math.min(1, p * 2.2) * (1 - p * 0.35);
      this.pilMat.uniforms.uTime.value = time;
      this.pilMat.uniforms.uProgress.value = p;
      this.pilMat.uniforms.uHeight.value = h;
      this.pilMat.uniforms.uRadius.value = (4.5 + 5 * s) * (1 - p * 0.4);
      this.pilMat.uniforms.uFade.value = Math.pow(1 - p, 1.4);
      this.pillar.position.copy(this.center).setY(0.3);
      this.pillar.visible = true;
    } else {
      this.pillar.visible = false;
    }

    const flashDur = 0.55;
    if (t < flashDur) {
      const p = t / flashDur;
      this.flashDisc.material.opacity = Math.pow(1 - p, 1.6) * 0.45;
      this.flashDisc.scale.setScalar((4 + 14 * s) * (0.4 + p));
      this.flashDisc.visible = true;
    } else {
      this.flashDisc.visible = false;
      this.flashDisc.material.opacity = 0;
    }

    this.light.intensity = Math.max(0, Math.pow(1 - Math.min(1, t / 1.9), 1.8)) * (520 + 620 * s);
    this.light.color.setRGB(1, 0.62 - Math.min(0.3, t * 0.16), 0.28);

    // debris physics
    if (this.dActive > 0) {
      let anyAlive = false;
      for (let i = 0; i < this.dActive; i++) {
        const i3 = i * 3;
        this.dLife[i] -= dt;
        if (this.dLife[i] <= 0) {
          this._mat4.makeScale(0, 0, 0);
          this.debris.setMatrixAt(i, this._mat4);
          continue;
        }
        anyAlive = true;
        this.dVel[i3 + 1] -= 38 * dt;
        this.dPos[i3] += this.dVel[i3] * dt;
        this.dPos[i3 + 1] += this.dVel[i3 + 1] * dt;
        this.dPos[i3 + 2] += this.dVel[i3 + 2] * dt;
        if (this.dPos[i3 + 1] < 0.2) {
          this.dPos[i3 + 1] = 0.2;
          this.dVel[i3 + 1] *= -0.35;
          this.dVel[i3] *= 0.6; this.dVel[i3 + 2] *= 0.6;
          this.dLife[i] = Math.min(this.dLife[i], 0.9);
        }
        this.dRot[i3] += this.dRotVel[i3] * dt;
        this.dRot[i3 + 1] += this.dRotVel[i3 + 1] * dt;
        this.dRot[i3 + 2] += this.dRotVel[i3 + 2] * dt;
        const shrink = Math.min(1, this.dLife[i] / 0.8);
        const sz = this.dSize[i] * shrink;
        this._posV.set(this.dPos[i3], this.dPos[i3 + 1], this.dPos[i3 + 2]);
        this._euler.set(this.dRot[i3], this.dRot[i3 + 1], this.dRot[i3 + 2]);
        this._quat.setFromEuler(this._euler);
        this._scaleV.setScalar(sz);
        this._mat4.compose(this._posV, this._quat, this._scaleV);
        this.debris.setMatrixAt(i, this._mat4);
      }
      this.debris.instanceMatrix.needsUpdate = true;
      this.debris.visible = anyAlive;
      if (!anyAlive) this.dActive = 0;
    }

    if (t > this.duration && this.dActive === 0) {
      this.active = false;
      this.light.intensity = 0;
    }
  }

  reset() {
    this.active = false;
    this.dActive = 0;
    this.fireball.visible = false;
    this.pillar.visible = false;
    this.flashDisc.visible = false;
    this.debris.visible = false;
    this.light.intensity = 0;
  }

  dispose() {
    this.fireball.geometry.dispose();
    this.fbMat.dispose();
    this.pillar.geometry.dispose();
    this.pilMat.dispose();
    this.flashDisc.geometry.dispose();
    this.flashDisc.material.dispose();
    this.debris.geometry.dispose();
    this.debris.material.dispose();
    this.scene.remove(this.fireball, this.pillar, this.flashDisc, this.light, this.debris);
  }
}
