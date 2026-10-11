// Scene shell: gradient sky dome (reacts to the crimson warning), cold key light,
// ambient fill, exponential fog, scattered rocks and a thin drifting ground mist for IDLE.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

export class Environment {
  constructor(scene, textures) {
    this.scene = scene;
    this.redMix = 0;
    this.targetRed = 0;

    scene.fog = new THREE.FogExp2(0x0b0d13, 0.0052);

    const domeGeo = new THREE.SphereGeometry(420, 40, 26);
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRed: { value: 0 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uRed;
        varying vec3 vDir;
        ${GLSL_NOISE}
        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          float up = smoothstep(-0.05, 0.55, h);
          vec3 nightLow = vec3(0.045, 0.040, 0.055);
          vec3 nightHigh = vec3(0.012, 0.016, 0.032);
          vec3 calm = mix(nightLow, nightHigh, up);
          float band = fbm2(vec2(atan(vDir.z, vDir.x) * 1.4, h * 2.2 + uTime * 0.012));
          calm += vec3(0.012, 0.010, 0.016) * band;
          vec3 fireLow = vec3(0.34, 0.055, 0.018);
          vec3 fireHigh = vec3(0.10, 0.016, 0.030);
          vec3 angry = mix(fireLow, fireHigh, pow(up, 0.7));
          angry += vec3(0.10, 0.02, 0.006) * band * (1.0 - up);
          vec3 col = mix(calm, angry, uRed);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false
    });
    this.dome = new THREE.Mesh(domeGeo, this.domeMat);
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0x2b3550, 0x141008, 0.5);
    scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0x7f9ac8, 0.55);
    this.key.position.set(-40, 55, -30);
    scene.add(this.key);
    this.fill = new THREE.AmbientLight(0x1a1410, 0.6);
    scene.add(this.fill);

    // scattered rocks for scale
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2b241d, roughness: 0.95, metalness: 0.02 });
    const count = 46;
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 26 + Math.random() * 95;
      p.set(Math.cos(a) * r, 0.15 + Math.random() * 0.4, Math.sin(a) * r);
      e.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      q.setFromEuler(e);
      const sc = 0.5 + Math.random() * Math.random() * 3.2;
      s.set(sc * (0.7 + Math.random() * 0.6), sc * (0.5 + Math.random() * 0.5), sc * (0.7 + Math.random() * 0.6));
      m.compose(p, q, s);
      this.rocks.setMatrixAt(i, m);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    scene.add(this.rocks);

    // thin ground mist (IDLE ambience)
    this.mist = [];
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textures.smoke, color: 0x2b3040, transparent: true, opacity: 0.10, depthWrite: false
      }));
      const a = (i / 7) * Math.PI * 2 + Math.random();
      const r = 12 + Math.random() * 30;
      sp.position.set(Math.cos(a) * r, 1.2 + Math.random() * 2.2, Math.sin(a) * r);
      sp.scale.setScalar(18 + Math.random() * 22);
      sp.userData = { baseX: sp.position.x, baseZ: sp.position.z, phase: Math.random() * 6.28, speed: 0.15 + Math.random() * 0.25 };
      scene.add(sp);
      this.mist.push(sp);
    }
  }

  setRedMix(v) { this.targetRed = v; }

  update(dt, time) {
    this.redMix += (this.targetRed - this.redMix) * Math.min(1, dt * 0.9);
    this.domeMat.uniforms.uTime.value = time;
    this.domeMat.uniforms.uRed.value = this.redMix;
    this.hemi.color.setRGB(0.17 + this.redMix * 0.28, 0.21 - this.redMix * 0.11, 0.31 - this.redMix * 0.22);
    this.scene.fog.color.setRGB(
      0.043 + this.redMix * 0.10,
      0.051 - this.redMix * 0.018,
      0.075 - this.redMix * 0.045
    );
    for (const sp of this.mist) {
      const u = sp.userData;
      sp.position.x = u.baseX + Math.sin(time * u.speed + u.phase) * 4;
      sp.position.z = u.baseZ + Math.cos(time * u.speed * 0.8 + u.phase) * 4;
      sp.material.opacity = 0.10 * (1 - this.redMix * 0.55);
    }
  }

  dispose() {
    this.dome.geometry.dispose();
    this.domeMat.dispose();
    this.rocks.geometry.dispose();
    this.rocks.material.dispose();
    for (const sp of this.mist) { sp.material.dispose(); this.scene.remove(sp); }
    this.scene.remove(this.dome, this.rocks, this.hemi, this.key, this.fill);
  }
}
