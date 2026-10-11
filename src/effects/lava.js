// AFTERMATH residual field: molten lava pool filling the crater floor, pulsing lava
// light, ember loop, smoke wisps and hot fissure glow. Kept alive for many seconds.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const LAVA_CLEARANCE = 0.25;

function makeDiscGeometry(rings = 20, segments = 72) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r <= rings; r++) {
    const radius = r / rings;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      positions.push(x, 0, z);
      uvs.push((x + 1) / 2, (z + 1) / 2);
    }
  }
  const rowLen = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * rowLen + s, b = a + 1, c = a + rowLen, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export class Lava {
  constructor(scene, textures, particles, crater) {
    this.scene = scene;
    this.crater = crater;
    this.particles = particles;
    this.active = false;
    this.intensity = 0;
    this.target = 0;
    this.time = 0;
    this._emberAcc = 0;
    this._wispAcc = 0;

    const geo = makeDiscGeometry();
    this.basePos = Float32Array.from(geo.attributes.position.array);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uLava: { value: textures.lavaTile },
        uIntensity: { value: 0 },
        uFade: { value: 0 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vWorld;
        ${GLSL_NOISE}
        void main() {
          vUv = uv;
          vec3 p = position;
          p.y += fbm2(vec2(p.x * 2.0 + uTime * 0.15, p.z * 2.0 - uTime * 0.1)) * 0.12;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uLava;
        uniform float uTime;
        uniform float uIntensity;
        uniform float uFade;
        varying vec2 vUv;
        varying vec3 vWorld;
        ${GLSL_NOISE}
        void main() {
          vec2 p = vWorld.xz;
          float warp = fbm2(p * 0.22 + vec2(uTime * 0.035, -uTime * 0.02));
          float crust = fbm2(p * 0.5 + warp * 1.8 + vec2(3.7, 9.1));
          crust = smoothstep(0.34, 0.66, crust);
          vec3 base = texture2D(uLava, vUv + vec2(uTime * 0.012, uTime * 0.008)).rgb;
          float vein = pow(1.0 - crust, 1.6);
          vec3 hot = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.86, 0.45), vein);
          vec3 col = mix(hot * 1.5, base * 0.35 + vec3(0.02, 0.005, 0.002), crust * 0.75);
          float breathe = 0.82 + 0.18 * sin(uTime * 0.9 + crust * 5.0);
          col *= uIntensity * breathe;
          float edge = smoothstep(1.0, 0.72, length(vUv - 0.5) * 2.0);
          float a = uFade * edge;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col, a);
        }
      `,
      transparent: true,
      depthWrite: true
    });
    this.pool = new THREE.Mesh(geo, this.material);
    this.pool.renderOrder = 12;
    this.pool.visible = false;
    scene.add(this.pool);

    this.light = new THREE.PointLight(0xff5518, 0, 90, 1.5);
    scene.add(this.light);

    // rim glow ring where lava meets rock
    this.rim = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.09, 8, 72),
      new THREE.MeshBasicMaterial({ color: 0xff6a22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.rim.rotation.x = -Math.PI / 2;
    this.rim.renderOrder = 15;
    this.rim.visible = false;
    scene.add(this.rim);
  }

  activate(center, radius, strength) {
    this.active = true;
    this.center = center.clone();
    this.poolRadius = radius * 0.82;
    this.pool.scale.setScalar(this.poolRadius);
    this.strength = strength;
    this.target = 1;
    this._conform();
    this.rim.scale.set(this.poolRadius, 1, this.poolRadius);
    this.rim.position.set(center.x, this.crater.heightAt(center.x, center.z) + LAVA_CLEARANCE + 0.05, center.z);
  }

  _conform() {
    const arr = this.pool.geometry.attributes.position.array;
    const base = this.basePos;
    const s = this.pool.scale.x;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i], bz = base[i + 2];
      arr[i] = bx;
      arr[i + 1] = this.crater.heightAt(bx * s + this.center.x, bz * s + this.center.z) + LAVA_CLEARANCE;
      arr[i + 2] = bz;
    }
    this.pool.geometry.attributes.position.needsUpdate = true;
    this.pool.geometry.computeBoundingSphere();
    this.pool.position.set(this.center.x, 0, this.center.z);
  }

  deactivate() {
    this.target = 0;
  }

  update(dt, time, lavaIntensity) {
    if (!this.active) return;
    this.time += dt;
    this.intensity += (this.target * lavaIntensity - this.intensity) * Math.min(1, dt * 1.2);
    if (this.intensity < 0.01 && this.target < 0.5) {
      this.active = false;
      this.pool.visible = false;
      this.rim.visible = false;
      this.light.intensity = 0;
      return;
    }
    this.pool.visible = true;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uIntensity.value = this.intensity;
    this.material.uniforms.uFade.value = Math.min(1, this.intensity * 1.4);

    const pulse = 0.8 + 0.2 * Math.sin(time * 1.1) + 0.1 * Math.sin(time * 2.7 + 0.6);
    this.light.intensity = 95 * this.intensity * pulse;
    this.light.position.set(this.center.x, this.crater.heightAt(this.center.x, this.center.z) + 2.2, this.center.z);
    this.light.color.setRGB(1, 0.34 + 0.1 * pulse, 0.08);
    this.rim.visible = this.intensity > 0.15;
    this.rim.material.opacity = this.intensity * 0.5 * pulse;

    // ember loop rising off the molten floor
    const P = this.particles;
    this._emberAcc += dt * 42 * this.intensity;
    while (this._emberAcc >= 1) {
      this._emberAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.poolRadius;
      const x = this.center.x + Math.cos(a) * r;
      const z = this.center.z + Math.sin(a) * r;
      P.embers.spawn({
        x, y: this.crater.heightAt(x, z) + LAVA_CLEARANCE + 0.2,
        z,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2.5 + Math.random() * 6,
        vz: (Math.random() - 0.5) * 2.2,
        life: 1.4 + Math.random() * 2.2,
        size: 0.1 + Math.random() * 0.38
      });
    }
    // slow smoke wisps
    this._wispAcc += dt * 9 * this.intensity;
    while (this._wispAcc >= 1) {
      this._wispAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * this.poolRadius * 1.15;
      const x = this.center.x + Math.cos(a) * r;
      const z = this.center.z + Math.sin(a) * r;
      P.smoke.spawn({
        x, y: this.crater.heightAt(x, z) + 0.6, z,
        vx: (Math.random() - 0.5) * 1.4, vy: 1.6 + Math.random() * 2.4, vz: (Math.random() - 0.5) * 1.4,
        life: 3.5 + Math.random() * 3, size: 1.5 + Math.random() * 3.4
      });
    }
  }

  reset() {
    this.active = false;
    this.intensity = 0;
    this.target = 0;
    this.pool.visible = false;
    this.rim.visible = false;
    this.light.intensity = 0;
  }

  dispose() {
    this.pool.geometry.dispose();
    this.material.dispose();
    this.rim.geometry.dispose();
    this.rim.material.dispose();
    this.scene.remove(this.pool, this.rim, this.light);
  }
}
