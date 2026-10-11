// Pooled GPU particle systems. Buffers are allocated once and reused;
// dead particles are compacted to the front each frame so draw range stays minimal.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const VERT = /* glsl */ `
uniform float uProjScale;
uniform sampler2D uRamp;
uniform float uSizeScale;
attribute float aLife;
attribute float aSize;
attribute float aSeed;
attribute float aRot;
varying vec4 vColor;
varying float vRot;
void main() {
  float alive = step(0.0001, aLife);
  float age = 1.0 - aLife;
  vec4 texel = texture2D(uRamp, vec2(clamp(age, 0.0, 1.0), clamp(aSeed, 0.0, 1.0)));
  vColor = texel;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is a WORLD-space diameter; uProjScale converts it to device pixels.
  float s = aSize * uSizeScale * mix(0.35, 1.0, alive);
  gl_PointSize = clamp(s * uProjScale / max(1.0, -mv.z), 1.0, 420.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uSprite;
uniform float uOpacity;
varying vec4 vColor;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) + 0.5;
  vec4 sprite = texture2D(uSprite, clamp(q, 0.0, 1.0));
  float a = vColor.a * sprite.a * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * sprite.r, a);
}
`;

function makeRamp(stops) {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 8;
  const ctx = c.getContext('2d');
  for (let row = 0; row < 8; row++) {
    const grad = ctx.createLinearGradient(0, 0, 16, 0);
    const jitter = (row / 8) * 0.12;
    for (const s of stops) {
      grad.addColorStop(s[0], s[1](row, jitter));
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, row, 16, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const FIRE_STOPS = [
  [0.0, (r, j) => 'rgba(255,255,240,1)'],
  [0.25, (r, j) => `rgba(255,${215 - r * 8},90,1)`],
  [0.6, (r, j) => `rgba(255,${95 - r * 4},25,1)`],
  [1.0, (r, j) => 'rgba(70,15,8,0)']
];
const EMBER_STOPS = [
  [0.0, (r) => 'rgba(255,240,200,1)'],
  [0.4, (r) => `rgba(255,${150 - r * 6},50,1)`],
  [1.0, (r) => 'rgba(120,30,10,0)']
];
const SMOKE_STOPS = [
  [0.0, (r) => `rgba(${95 + r * 12},${88 + r * 10},${84 + r * 8},0.55)`],
  [0.5, (r) => `rgba(${60 + r * 8},${55 + r * 8},${52 + r * 6},0.35)`],
  [1.0, (r) => 'rgba(35,32,30,0)']
];
const DUST_STOPS = [
  [0.0, (r) => 'rgba(215,195,170,0.8)'],
  [1.0, (r) => 'rgba(120,105,90,0)']
];
const DEBRIS_STOPS = [
  [0.0, (r) => 'rgba(255,196,110,1)'],
  [0.35, (r) => `rgba(232,${92 - r * 4},32,1)`],
  [0.7, (r) => 'rgba(126,42,18,0.8)'],
  [1.0, (r) => 'rgba(42,22,15,0)']
];

export class ParticleSystem {
  constructor(cfg) {
    this.capacity = cfg.capacity;
    this.cfg = cfg;
    const n = cfg.capacity;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.sizes = new Float32Array(n);
    this.seeds = new Float32Array(n);
    this.rots = new Float32Array(n);
    this.rotVel = new Float32Array(n);
    this.count = 0;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.geometry.setAttribute('aRot', new THREE.BufferAttribute(this.rots, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uSprite: { value: cfg.sprite },
        uRamp: { value: cfg.ramp },
        uProjScale: { value: 1200 },
        uSizeScale: { value: cfg.sizeScale ?? 1 },
        uOpacity: { value: 1 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: cfg.blending ?? THREE.AdditiveBlending
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;

    this.attract = null; // { center: Vector3, strength } set by suction emitters
  }

  spawn(o) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx; this.vel[i3 + 1] = o.vy; this.vel[i3 + 2] = o.vz;
    const ml = o.life * (0.75 + Math.random() * 0.5);
    this.life[i] = 1;
    this.maxLife[i] = ml;
    this.sizes[i] = o.size * (0.7 + Math.random() * 0.6);
    this.seeds[i] = Math.random();
    this.rots[i] = Math.random() * Math.PI * 2;
    this.rotVel[i] = (Math.random() - 0.5) * (this.cfg.spin ?? 1.5);
  }

  update(dt, time) {
    const c = this.cfg;
    const g = c.gravity ?? 0;
    const drag = c.drag ?? 0;
    const buoy = c.buoyancy ?? 0;
    const turb = c.turbulence ?? 0;
    const attract = this.attract;
    let n = this.count;
    let i = 0;
    while (i < n) {
      this.life[i] -= dt / this.maxLife[i];
      if (this.life[i] <= 0) {
        n--;
        const i3 = i * 3, n3 = n * 3;
        this.pos[i3] = this.pos[n3]; this.pos[i3 + 1] = this.pos[n3 + 1]; this.pos[i3 + 2] = this.pos[n3 + 2];
        this.vel[i3] = this.vel[n3]; this.vel[i3 + 1] = this.vel[n3 + 1]; this.vel[i3 + 2] = this.vel[n3 + 2];
        this.life[i] = this.life[n]; this.maxLife[i] = this.maxLife[n];
        this.sizes[i] = this.sizes[n]; this.seeds[i] = this.seeds[n];
        this.rots[i] = this.rots[n]; this.rotVel[i] = this.rotVel[n];
        continue;
      }
      const i3 = i * 3;
      let vx = this.vel[i3], vy = this.vel[i3 + 1], vz = this.vel[i3 + 2];
      vy += (g + buoy) * dt;
      if (turb > 0) {
        const x = this.pos[i3], y = this.pos[i3 + 1], z = this.pos[i3 + 2];
        vx += Math.sin(y * 0.9 + z * 0.6 + time * 1.7 + i * 0.13) * turb * dt;
        vz += Math.cos(x * 0.7 - y * 0.5 + time * 1.3 + i * 0.29) * turb * dt;
        vy += Math.sin(x * 0.5 + z * 0.8 + time * 0.9 + i * 0.07) * turb * 0.5 * dt;
      }
      if (attract) {
        const dx = attract.center.x - this.pos[i3];
        const dy = attract.center.y - this.pos[i3 + 1];
        const dz = attract.center.z - this.pos[i3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
        const inv = attract.strength * dt / Math.sqrt(d2);
        vx += dx * inv; vy += dy * inv; vz += dz * inv;
      }
      const d = Math.max(0, 1 - drag * dt);
      vx *= d; vy *= d; vz *= d;
      this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
      this.pos[i3] += vx * dt; this.pos[i3 + 1] += vy * dt; this.pos[i3 + 2] += vz * dt;
      if (this.cfg.groundPlane !== undefined && this.pos[i3 + 1] < this.cfg.groundPlane) {
        this.pos[i3 + 1] = this.cfg.groundPlane;
        this.vel[i3 + 1] *= -0.3;
        this.vel[i3] *= 0.7; this.vel[i3 + 2] *= 0.7;
      }
      this.rots[i] += this.rotVel[i] * dt;
      i++;
    }
    this.count = n;
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aLife.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aSeed.needsUpdate = true;
    this.geometry.attributes.aRot.needsUpdate = true;
    this.points.visible = n > 0;
  }

  setViewport(drawingBufferHeight, fovDeg) {
    this.material.uniforms.uProjScale.value =
      (drawingBufferHeight * 0.5) / Math.tan(THREE.MathUtils.degToRad(fovDeg) * 0.5);
  }
  clear() { this.count = 0; this.geometry.setDrawRange(0, 0); this.points.visible = false; }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.rampTex?.dispose();
  }
}

export function createFireSystem(sprite, capacity) {
  const ramp = makeRamp(FIRE_STOPS);
  const ps = new ParticleSystem({ capacity, sprite, ramp, blending: THREE.AdditiveBlending, drag: 1.2, buoyancy: 2.5, turbulence: 1.5, spin: 2.5 });
  ps.rampTex = ramp;
  return ps;
}

export function createEmberSystem(sprite, capacity) {
  const ramp = makeRamp(EMBER_STOPS);
  const ps = new ParticleSystem({ capacity, sprite, ramp, blending: THREE.AdditiveBlending, gravity: -14, drag: 0.35, turbulence: 0.8, spin: 4, groundPlane: 0.05 });
  ps.rampTex = ramp;
  return ps;
}

export function createSmokeSystem(sprite, capacity) {
  const ramp = makeRamp(SMOKE_STOPS);
  const ps = new ParticleSystem({ capacity, sprite, ramp, blending: THREE.NormalBlending, buoyancy: 2.2, drag: 0.9, turbulence: 1.1, spin: 0.7 });
  ps.rampTex = ramp;
  return ps;
}

export function createDustSystem(sprite, capacity) {
  const ramp = makeRamp(DUST_STOPS);
  const ps = new ParticleSystem({ capacity, sprite, ramp, blending: THREE.NormalBlending, drag: 1.6, turbulence: 0.6, spin: 1.2, groundPlane: 0.1 });
  ps.rampTex = ramp;
  return ps;
}

// Glowing rock fragments shed by the falling meteor (hot -> ash).
export function createDebrisSystem(sprite, capacity) {
  const ramp = makeRamp(DEBRIS_STOPS);
  const ps = new ParticleSystem({ capacity, sprite, ramp, blending: THREE.AdditiveBlending, gravity: -26, drag: 0.25, turbulence: 0.5, spin: 6, groundPlane: 0.12 });
  ps.rampTex = ramp;
  return ps;
}
