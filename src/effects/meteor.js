// Meteor: rocky crust mesh (vertex-displaced silhouette) + molten cracks + additive
// fire aura + white-hot core + point light + fire trail ribbon + ember/smoke/debris
// emission. Not a cute fireball: a boss-scale destroying rock.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';
import { FireTrail } from './fireTrail.js';

export class Meteor {
  constructor(scene, textures, particles) {
    this.scene = scene;
    this.particles = particles;
    this.radius = 2.6;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    // --- rocky crust ---
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const d = 0.72 + 0.5 * fbmCpu(n.x * 2.4, n.y * 2.4, n.z * 2.4);
      v.multiplyScalar(d);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    this.crustGeo = geo;

    this.crustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCrust: { value: textures.crust },
        uHeat: { value: 1 }
      },
      vertexShader: /* glsl */ `
        varying vec3 vNrm;
        varying vec3 vView;
        void main() {
          vNrm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCrust;
        uniform float uTime;
        uniform float uHeat;
        varying vec3 vNrm;
        varying vec3 vView;
        ${GLSL_NOISE}
        void main() {
          vec3 nrm = normalize(vNrm);
          vec3 view = normalize(vView + vec3(0.0, 0.0, 1e-4));
          float fres = pow(1.0 - clamp(dot(nrm, view), 0.0, 1.0), 1.8);
          vec3 wp = normalize(vNrm) * 2.2;
          float crack = fbm3(wp + vec3(0.0, uTime * 0.05, 0.0));
          crack = smoothstep(0.34, 0.62, crack);
          vec3 rock = vec3(0.075, 0.055, 0.05);
          vec3 hot = vec3(1.0, 0.34, 0.07);
          vec3 col = mix(rock, hot, crack * 1.35);
          col += vec3(1.0, 0.85, 0.6) * pow(crack, 3.0) * 0.9;
          col += vec3(1.0, 0.5, 0.18) * fres * 0.9;
          col *= uHeat * 1.15;
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    this.crust = new THREE.Mesh(geo, this.crustMat);
    this.crust.scale.setScalar(this.radius);
    this.group.add(this.crust);

    // --- fire aura shell ---
    const auraGeo = new THREE.IcosahedronGeometry(1, 3);
    this.auraMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFire: { value: textures.fire },
        uIntensity: { value: 1 }
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vPos;
        ${GLSL_NOISE}
        void main() {
          float n = fbm3(normalize(position) * 2.6 + vec3(uTime * 0.9, uTime * 0.5, 0.0));
          vec3 p = position + normal * n * 0.38;
          vPos = normalize(position);
          vNrm = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFire;
        uniform float uTime;
        uniform float uIntensity;
        varying vec3 vNrm;
        varying vec3 vView;
        varying vec3 vPos;
        void main() {
          vec3 nrm = normalize(vNrm);
          vec3 view = normalize(vView + vec3(0.0, 0.0, 1e-4));
          float fres = pow(1.0 - clamp(dot(nrm, view), 0.0, 1.0), 1.35);
          vec2 uv = vec2(atan(vPos.z, vPos.x) * 0.15915494 + uTime * 0.12, vPos.y * 0.5 + 0.5 - uTime * 0.22);
          vec3 fire = texture2D(uFire, uv).rgb;
          float a = fres * uIntensity;
          gl_FragColor = vec4(fire * (1.3 + fres * 1.4) * uIntensity, a * 0.9);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.aura = new THREE.Mesh(auraGeo, this.auraMat);
    this.aura.scale.setScalar(this.radius * 1.9);
    this.group.add(this.aura);

    // --- white-hot core ---
    this.coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2d8 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.coreMat);
    this.core.scale.setScalar(this.radius * 0.72);
    this.group.add(this.core);

    this.light = new THREE.PointLight(0xff8a3a, 0, 220, 1.35);
    this.group.add(this.light);

    this.trail = new FireTrail(scene, textures, this.radius);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, -1, 0);
    this.active = false;
    this.landed = false;
    this.progress = 0;
    this._spinAxis = new THREE.Vector3(0.3, 0.8, 0.15).normalize();
    this._spinAngle = 0;
    this._emberAcc = 0;
    this._smokeAcc = 0;
    this._debrisAcc = 0;
    this._tmp = new THREE.Vector3();
  }

  setSizeScale(scale) {
    this.radius = 2.6 * scale;
    this.crust.scale.setScalar(this.radius);
    this.aura.scale.setScalar(this.radius * 1.9);
    this.core.scale.setScalar(this.radius * 0.72);
    this.trail.radius = this.radius;
  }

  spawn(start, target, speed0, accel, sizeScale) {
    this.setSizeScale(sizeScale);
    this.position.copy(start);
    this._start = start.clone();
    this._target = target.clone();
    this._speed0 = speed0;
    this._accel = accel;
    this._distTotal = start.distanceTo(target);
    this._distLeft = this._distTotal;
    this.velocity.copy(target).sub(start).normalize().multiplyScalar(speed0);
    this.dir.copy(this.velocity).normalize();
    this.active = true;
    this.landed = false;
    this.progress = 0;
    this.group.visible = true;
    this.group.position.copy(this.position);
    this.trail.reset();
    this.trail.pushPoint(this.position);
  }

  despawn() {
    this.active = false;
    this.group.visible = false;
    this.light.intensity = 0;
    this.trail.reset();
  }

  update(dt, time, params) {
    if (!this.active) return false;
    const speed = this._speed0 + this._accel * this.progress;
    this.velocity.copy(this.dir).multiplyScalar(speed);
    this._tmp.copy(this.dir).multiplyScalar(speed * dt);
    this.position.add(this._tmp);
    this._distLeft -= speed * dt;
    this.progress = THREE.MathUtils.clamp(1 - this._distLeft / this._distTotal, 0, 1);
    this.group.position.copy(this.position);

    this._spinAngle += dt * 1.4;
    this.crust.rotation.set(this._spinAngle * 0.7, this._spinAngle, this._spinAngle * 0.35);
    this.aura.rotation.y = this._spinAngle * 0.4;

    const closeness = THREE.MathUtils.clamp(1 - this.position.y / 45, 0, 1);
    const heat = 1 + closeness * 1.3;
    this.crustMat.uniforms.uTime.value = time;
    this.crustMat.uniforms.uHeat.value = heat;
    this.auraMat.uniforms.uTime.value = time;
    this.auraMat.uniforms.uIntensity.value = 0.8 + closeness * 0.9;
    this.coreMat.color.setRGB(1, 0.95 - closeness * 0.08, 0.85 - closeness * 0.25);
    this.light.intensity = (150 + closeness * 260) * params.impactStrength;
    this.light.color.setRGB(1, 0.55 - closeness * 0.12, 0.22);

    this.trail.pushPoint(this.position);
    this.dir.copy(this.velocity).normalize();
    this.trail.update(time, this.position, this.dir, this.radius * 1.15, 1, heat * 0.9);

    // emissions (sizes are world-space diameters)
    const pc = params.particleCount;
    const P = this.particles;
    this._emberAcc += dt * 160 * pc;
    while (this._emberAcc >= 1) {
      this._emberAcc -= 1;
      const back = this._tmp.copy(this.dir).multiplyScalar(-this.radius * (0.8 + Math.random() * 2.5));
      P.embers.spawn({
        x: this.position.x + back.x + (Math.random() - 0.5) * this.radius * 2,
        y: this.position.y + back.y + (Math.random() - 0.5) * this.radius * 2,
        z: this.position.z + back.z + (Math.random() - 0.5) * this.radius * 2,
        vx: this.velocity.x * 0.25 + (Math.random() - 0.5) * 6,
        vy: this.velocity.y * 0.25 + (Math.random() - 0.5) * 6,
        vz: this.velocity.z * 0.25 + (Math.random() - 0.5) * 6,
        life: 0.9 + Math.random() * 1.2,
        size: 0.14 + Math.random() * 0.42
      });
    }
    this._smokeAcc += dt * 34 * pc;
    while (this._smokeAcc >= 1) {
      this._smokeAcc -= 1;
      const back = this._tmp.copy(this.dir).multiplyScalar(-this.radius * (1.5 + Math.random() * 6));
      P.smoke.spawn({
        x: this.position.x + back.x + (Math.random() - 0.5) * this.radius * 3,
        y: this.position.y + back.y + (Math.random() - 0.5) * this.radius * 3,
        z: this.position.z + back.z + (Math.random() - 0.5) * this.radius * 3,
        vx: this.velocity.x * 0.12 + (Math.random() - 0.5) * 3,
        vy: this.velocity.y * 0.12 + Math.random() * 2,
        vz: this.velocity.z * 0.12 + (Math.random() - 0.5) * 3,
        life: 2.2 + Math.random() * 2.2,
        size: 1.4 + Math.random() * 3.4
      });
    }
    this._debrisAcc += dt * 22 * pc;
    while (this._debrisAcc >= 1) {
      this._debrisAcc -= 1;
      P.debris.spawn({
        x: this.position.x + (Math.random() - 0.5) * this.radius * 2,
        y: this.position.y + (Math.random() - 0.5) * this.radius * 2,
        z: this.position.z + (Math.random() - 0.5) * this.radius * 2,
        vx: this.velocity.x * (0.35 + Math.random() * 0.3) + (Math.random() - 0.5) * 10,
        vy: this.velocity.y * (0.35 + Math.random() * 0.3) + (Math.random() - 0.5) * 10,
        vz: this.velocity.z * (0.35 + Math.random() * 0.3) + (Math.random() - 0.5) * 10,
        life: 1.2 + Math.random() * 1.8,
        size: 0.25 + Math.random() * 0.8
      });
    }

    if (this.position.y <= this.radius * 0.9 || this.progress >= 1) {
      this.landed = true;
      return true;
    }
    return false;
  }

  dispose() {
    this.trail.dispose();
    this.crustGeo.dispose();
    this.crustMat.dispose();
    this.aura.geometry.dispose();
    this.auraMat.dispose();
    this.core.geometry.dispose();
    this.coreMat.dispose();
    this.scene.remove(this.group);
  }
}

// CPU-side fbm used once at construction for the silhouette displacement.
function fbmCpu(x, y, z) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += a * noise3(x, y, z);
    x = x * 2 + 13.7; y = y * 2 + 7.1; z = z * 2 + 3.3;
    a *= 0.5;
  }
  return v;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const h = (a, b, c) => {
    const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const c000 = h(xi, yi, zi), c100 = h(xi + 1, yi, zi), c010 = h(xi, yi + 1, zi), c110 = h(xi + 1, yi + 1, zi);
  const c001 = h(xi, yi, zi + 1), c101 = h(xi + 1, yi, zi + 1), c011 = h(xi, yi + 1, zi + 1), c111 = h(xi + 1, yi + 1, zi + 1);
  const x00 = c000 + (c100 - c000) * sx;
  const x10 = c010 + (c110 - c010) * sx;
  const x01 = c001 + (c101 - c001) * sx;
  const x11 = c011 + (c111 - c011) * sx;
  const y0 = x00 + (x10 - x00) * sy;
  const y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}
