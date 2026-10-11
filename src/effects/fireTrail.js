// Meteor fire trail: a ribbon rebuilt each frame from the meteor's path history
// (fixed-size buffers, no per-frame allocation) + velocity-aligned motion streaks.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const RIBBON = 14; // cross-section vertices around the tube
const SEGMENTS = 48;

export class FireTrail {
  constructor(scene, textures, radius) {
    this.scene = scene;
    this.radius = radius;
    this.points = [];

    const vertCount = (SEGMENTS + 1) * RIBBON;
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices = [];
    for (let s = 0; s < SEGMENTS; s++) {
      for (let r = 0; r < RIBBON; r++) {
        const a = s * RIBBON + r;
        const b = s * RIBBON + ((r + 1) % RIBBON);
        const c = (s + 1) * RIBBON + r;
        const d = (s + 1) * RIBBON + ((r + 1) % RIBBON);
        indices.push(a, c, b, b, c, d);
      }
    }
    for (let s = 0; s <= SEGMENTS; s++) {
      const v = s / SEGMENTS;
      for (let r = 0; r < RIBBON; r++) {
        const i = (s * RIBBON + r) * 2;
        uvs[i] = r / RIBBON;
        uvs[i + 1] = v;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFire: { value: textures.fire },
        uFade: { value: 1 },
        uWidth: { value: radius },
        uHot: { value: 1 }
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFire;
        uniform float uTime;
        uniform float uFade;
        uniform float uWidth;
        uniform float uHot;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main() {
          float along = clamp(vUv.y, 0.0, 1.0);
          float tail = pow(1.0 - along, 1.7);
          float ang = vUv.x * 6.2831853;
          vec2 flow = vec2(ang * 0.4, along * 2.2 + uTime * 2.6);
          float n1 = fbm2(flow);
          float n2 = fbm2(flow * 2.1 + vec2(3.1, 7.7) + uTime * 0.7);
          float body = smoothstep(0.10, 0.86, n1 * 0.65 + n2 * 0.45);
          vec3 col = mix(vec3(0.55, 0.10, 0.02), vec3(1.0, 0.78, 0.38), body);
          col = mix(col, vec3(1.0, 0.98, 0.9), pow(body, 3.0) * 0.55 * uHot);
          col *= 1.6 * uHot;
          float a = tail * (0.22 + 0.78 * body) * uFade;
          a *= smoothstep(0.0, 0.12, along);
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    // motion streaks: two crossed additive quads stretched along the velocity
    const streakGeo = new THREE.PlaneGeometry(1, 1);
    this.streakMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 0 }, uHot: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade; uniform float uHot;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv - 0.5;
          float across = smoothstep(0.5, 0.0, abs(p.x));
          float along = smoothstep(0.0, 0.25, p.y + 0.5) * smoothstep(1.0, 0.55, p.y + 0.5);
          float a = across * along * uFade * 0.5;
          vec3 col = mix(vec3(1.0, 0.4, 0.1), vec3(1.0, 0.95, 0.8), along * 0.7);
          gl_FragColor = vec4(col * uHot * 1.4, a);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    this.streaks = [];
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(streakGeo, this.streakMat);
      m.visible = false;
      m.renderOrder = 7;
      scene.add(m);
      this.streaks.push(m);
    }
    this._lastDir = new THREE.Vector3(0, -1, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._side = new THREE.Vector3();
    this._normal = new THREE.Vector3();
  }

  pushPoint(p) {
    this.points.push(p.x, p.y, p.z);
    const max = (SEGMENTS + 1) * 3;
    if (this.points.length > max) this.points.splice(0, this.points.length - max);
  }

  reset() {
    this.points.length = 0;
    this.mesh.visible = false;
    for (const s of this.streaks) s.visible = false;
  }

  update(time, head, dir, width, fade, hot) {
    if (!head) return;
    const pts = this.points;
    const n = Math.min(SEGMENTS + 1, Math.max(2, Math.floor(pts.length / 3)));
    const posAttr = this.geometry.attributes.position;
    const P = posAttr.array;
    const side = this._side.crossVectors(dir, this._up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const normal = this._normal.crossVectors(dir, side).normalize();
    for (let s = 0; s < SEGMENTS + 1; s++) {
      // map segment -> available history (stretch the tail if short)
      const t = s / SEGMENTS;
      const idx = Math.min(n - 1, Math.floor(t * (n - 1)));
      const px = pts[idx * 3], py = pts[idx * 3 + 1], pz = pts[idx * 3 + 2];
      // widen toward the head, taper at the tail
      const w = width * (0.35 + 0.65 * (1 - t)) * (0.6 + 0.4 * Math.sin(t * 9 + time * 6) * 0.5 + 0.2);
      for (let r = 0; r < RIBBON; r++) {
        const ang = (r / RIBBON) * Math.PI * 2;
        const ci = (s * RIBBON + r) * 3;
        const cx = Math.cos(ang) * w, cy = Math.sin(ang) * w;
        P[ci] = px + side.x * cx + normal.x * cy;
        P[ci + 1] = py + side.y * cx + normal.y * cy;
        P[ci + 2] = pz + side.z * cx + normal.z * cy;
      }
    }
    posAttr.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uFade.value = fade;
    this.material.uniforms.uHot.value = hot;
    this.mesh.visible = fade > 0.02;

    // streaks aligned to velocity
    this._lastDir.copy(dir);
    const len = width * 9;
    for (let i = 0; i < this.streaks.length; i++) {
      const m = this.streaks[i];
      m.position.copy(head).addScaledVector(dir, -len * 0.35);
      m.scale.set(width * 1.6, len, 1);
      m.quaternion.setFromUnitVectors(this._up, dir);
      if (i === 1) m.rotateOnAxis(dir, Math.PI / 2);
      m.visible = fade > 0.05;
    }
    this.streakMat.uniforms.uFade.value = fade;
    this.streakMat.uniforms.uHot.value = hot;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    for (const s of this.streaks) this.scene.remove(s);
    this.streakMat.dispose();
  }
}
