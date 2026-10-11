// Shockwaves: ground-hugging expanding rings (primary + secondary), a low heat wave
// skirt, and a rising dust ring. Pooled meshes, uniform-driven animation.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const RING_FRAG = /* glsl */ `
uniform sampler2D uRing;
uniform vec3 uColor;
uniform float uFade;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float ang = atan(p.y, p.x);
  vec4 tex = texture2D(uRing, vUv);
  float wob = 1.0 + 0.18 * fbm2(vec2(ang * 1.6, uTime * 0.6));
  float a = tex.a * uFade * wob;
  vec3 col = uColor * (1.0 + 0.6 * tex.r) * uIntensity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function makeRing(tex, color) {
  const geo = new THREE.PlaneGeometry(2, 2, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uRing: { value: tex },
      uColor: { value: new THREE.Color(color) },
      uFade: { value: 0 },
      uIntensity: { value: 1 },
      uTime: { value: 0 }
    },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return mesh;
}

export class Shockwave {
  constructor(scene, textures, particles) {
    this.scene = scene;
    this.particles = particles;
    this.rings = [
      { mesh: makeRing(textures.shockRing, 0xffd9a0), speed: 46, life: 1.5, size: 120, y: 0.9, intensity: 1.6 },
      { mesh: makeRing(textures.shockRing, 0xff8a3a), speed: 30, life: 2.1, size: 90, y: 0.55, intensity: 1.1 },
      { mesh: makeRing(textures.shockRing, 0x8d2f12), speed: 18, life: 2.8, size: 70, y: 0.28, intensity: 0.7 }
    ];
    for (const r of this.rings) {
      r.mesh.renderOrder = 10;
      scene.add(r.mesh);
    }

    // heat wave skirt: a thin torus that expands along the ground
    const torusGeo = new THREE.TorusGeometry(1, 0.16, 10, 96);
    torusGeo.rotateX(-Math.PI / 2);
    this.skirtMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vPos;
        void main() {
          vPos = position;
          vec3 p = position;
          p.y += sin(atan(position.z, position.x) * 9.0 + uTime * 5.0) * 0.08;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade;
        uniform float uTime;
        varying vec3 vPos;
        void main() {
          float shimmer = 0.6 + 0.4 * sin(atan(vPos.z, vPos.x) * 14.0 + uTime * 9.0);
          vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.85, 0.6), shimmer);
          gl_FragColor = vec4(col * 1.4 * uFade, uFade * 0.55 * shimmer);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.skirt = new THREE.Mesh(torusGeo, this.skirtMat);
    this.skirt.visible = false;
    this.skirt.renderOrder = 11;
    scene.add(this.skirt);

    this.active = false;
    this.time = 0;
  }

  trigger(center, strength, particleCountMult) {
    this.active = true;
    this.time = 0;
    this.strength = strength;
    this.center = center.clone();
    for (const r of this.rings) {
      r.mesh.position.set(center.x, r.y, center.z);
      r.mesh.scale.setScalar(0.5);
    }
    this.skirt.position.set(center.x, 0.5, center.z);
    this.skirt.scale.setScalar(1);

    // radial dust sheet along the ground
    const P = this.particles;
    const n = Math.floor(260 * strength * particleCountMult);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (22 + Math.random() * 26) * strength;
      P.dust.spawn({
        x: center.x + Math.cos(a) * 4, y: 0.3 + Math.random() * 1.2, z: center.z + Math.sin(a) * 4,
        vx: Math.cos(a) * sp, vy: 0.5 + Math.random() * 2.5, vz: Math.sin(a) * sp,
        life: 1.8 + Math.random() * 2.2, size: 2.2 + Math.random() * 4.6
      });
    }
  }

  update(dt, time) {
    if (!this.active) return;
    this.time += dt;
    const t = this.time;
    let anyVisible = false;
    for (const r of this.rings) {
      const p = t / r.life;
      if (p >= 1) { r.mesh.visible = false; continue; }
      const grow = 1 - Math.pow(1 - p, 1.9);
      const scale = 0.5 + grow * r.size * 0.5 * this.strength;
      r.mesh.scale.setScalar(scale);
      r.mesh.material.uniforms.uFade.value = Math.pow(1 - p, 1.5);
      r.mesh.material.uniforms.uTime.value = time;
      r.mesh.material.uniforms.uIntensity.value = r.intensity * (1 + this.strength * 0.4);
      r.mesh.visible = true;
      anyVisible = true;
    }
    const skirtLife = 2.4;
    if (t < skirtLife) {
      const p = t / skirtLife;
      const scale = 4 + (1 - Math.pow(1 - p, 1.7)) * 60 * this.strength;
      this.skirt.scale.set(scale, 1 + p * 1.6, scale);
      this.skirtMat.uniforms.uFade.value = Math.pow(1 - p, 1.6);
      this.skirtMat.uniforms.uTime.value = time;
      this.skirt.visible = true;
      anyVisible = true;
    } else {
      this.skirt.visible = false;
    }
    if (!anyVisible) this.active = false;
  }

  reset() {
    this.active = false;
    for (const r of this.rings) r.mesh.visible = false;
    this.skirt.visible = false;
  }

  dispose() {
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      this.scene.remove(r.mesh);
    }
    this.skirt.geometry.dispose();
    this.skirtMat.dispose();
    this.scene.remove(this.skirt);
  }
}
