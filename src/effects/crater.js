// Ground + crater: the plane is deformed into a bowl with a raised rim after impact.
// Height is a single analytic function (smooth, low-frequency) shared by BOTH the ground
// mesh and the decal meshes, and the decals are ring-subdivided grids conformed to that
// function at DECAL_CLEARANCE above it. That guarantees no coplanar z-fighting and no
// black patches, regardless of crater size.
import * as THREE from 'three';

const GROUND_SIZE = 240;
const GROUND_SEG = 180;
export const DECAL_CLEARANCE = 0.42;
const NOISE_CELL = 10;

// Continuous, deterministic value noise (lattice cell = NOISE_CELL world units).
function smoothNoise(x, z) {
  const cx = Math.floor(x / NOISE_CELL), cz = Math.floor(z / NOISE_CELL);
  const h = (a, b) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  let fx = x / NOISE_CELL - cx, fz = z / NOISE_CELL - cz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = h(cx, cz), b = h(cx + 1, cz), c = h(cx, cz + 1), d = h(cx + 1, cz + 1);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}

function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Unit disc with radial rings so it can follow terrain without cutting through it.
function makeDiscGeometry(rings = 60, segments = 96) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let r = 0; r <= rings; r++) {
    const radius = r / rings;
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      uvs.push((Math.cos(a) * radius + 1) / 2, (Math.sin(a) * radius + 1) / 2);
    }
  }
  const rowLen = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * rowLen + s;
      const b = a + 1;
      const c = a + rowLen;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export class Crater {
  constructor(scene, textures) {
    this.scene = scene;
    this.radius = 15;
    this.depth = 5.0;
    this.progress = 0;   // 0 = intact ground, 1 = fully formed crater
    this.autoGrow = true;
    this.center = new THREE.Vector3(0, 0, 0);
    this.scorchFade = 0;
    this.fissurePulse = 0;

    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEG, GROUND_SEG);
    geo.rotateX(-Math.PI / 2);
    this.basePositions = Float32Array.from(geo.attributes.position.array);

    const mat = new THREE.MeshStandardMaterial({
      map: textures.groundDiffuse,
      bumpMap: textures.groundBump,
      bumpScale: 0.55,
      roughness: 0.94,
      metalness: 0.03,
      color: 0x8f8578
    });
    this.ground = new THREE.Mesh(geo, mat);
    scene.add(this.ground);

    const discGeo = makeDiscGeometry();
    this.scorch = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      map: textures.scorch, transparent: true, opacity: 0, depthWrite: false, color: 0x120c09
    }));
    this.scorch.renderOrder = 13;
    this.scorch.visible = false;
    scene.add(this.scorch);

    this.fissure = new THREE.Mesh(discGeo.clone(), new THREE.MeshBasicMaterial({
      map: textures.fissures, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffffff
    }));
    this.fissure.renderOrder = 14;
    this.fissure.visible = false;
    scene.add(this.fissure);

    this._decalBase = Float32Array.from(discGeo.attributes.position.array);

    // Ejected rubble that stays on the crater floor and rim: without it the pit reads
    // as a clean geometric dimple instead of an explosion site.
    this.rubbleCount = 130;
    const rubbleGeo = new THREE.IcosahedronGeometry(1, 0);
    const rubbleMat = new THREE.MeshStandardMaterial({
      color: 0x2e241c, roughness: 0.96, metalness: 0.02,
      emissive: 0x3a0a02, emissiveIntensity: 0.55
    });
    this.rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, this.rubbleCount);
    this.rubble.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rubble.castShadow = false;
    this.rubble.visible = false;
    this.rubble.frustumCulled = false;
    scene.add(this.rubble);
    this.rubAngle = new Float32Array(this.rubbleCount);
    this.rubRadius = new Float32Array(this.rubbleCount);
    this.rubSize = new Float32Array(this.rubbleCount);
    this.rubRot = new Float32Array(this.rubbleCount * 3);
    this._rubMat4 = new THREE.Matrix4();
    this._rubQuat = new THREE.Quaternion();
    this._rubEuler = new THREE.Euler();
    this._rubPos = new THREE.Vector3();
    this._rubScale = new THREE.Vector3();
    this.rubbleK = 0;
  }

  _scatterRubble(strength) {
    for (let i = 0; i < this.rubbleCount; i++) {
      this.rubAngle[i] = Math.random() * Math.PI * 2;
      // densest on the rim and just outside it, some inside the bowl
      const u = Math.random();
      this.rubRadius[i] = u < 0.35 ? Math.random() * 0.75 : 0.9 + Math.random() * 0.85;
      const s = (0.45 + Math.random() * Math.random() * 2.1) * (0.7 + strength * 0.5);
      this.rubSize[i] = s;
      const i3 = i * 3;
      this.rubRot[i3] = Math.random() * 6.28;
      this.rubRot[i3 + 1] = Math.random() * 6.28;
      this.rubRot[i3 + 2] = Math.random() * 6.28;
    }
    this.rubbleK = 1;
    this.rubble.visible = true;
    this._conformRubble();
  }

  _conformRubble() {
    if (!this.rubble.visible) return;
    for (let i = 0; i < this.rubbleCount; i++) {
      const i3 = i * 3;
      const r = this.rubRadius[i] * this.radius;
      const x = this.center.x + Math.cos(this.rubAngle[i]) * r;
      const z = this.center.z + Math.sin(this.rubAngle[i]) * r;
      const size = this.rubSize[i] * this.rubbleK;
      this._rubPos.set(x, this.heightAt(x, z) + size * 0.32, z);
      this._rubEuler.set(this.rubRot[i3], this.rubRot[i3 + 1], this.rubRot[i3 + 2]);
      this._rubQuat.setFromEuler(this._rubEuler);
      this._rubScale.set(size, size * 0.72, size * (0.8 + (i % 5) * 0.08));
      this._rubMat4.compose(this._rubPos, this._rubQuat, this._rubScale);
      this.rubble.setMatrixAt(i, this._rubMat4);
    }
    this.rubble.instanceMatrix.needsUpdate = true;
    this.rubble.computeBoundingSphere();
  }

  // Analytic terrain height. Identical for ground, decals and rubble.
  // Every term is blended with smoothstep so the profile is C1: a slope kink makes the
  // coarser ground mesh and the finer decal mesh interpolate differently, and the decal
  // dips into the terrain (gate D1 caught exactly that at the rim edge).
  heightAt(x, z) {
    if (this.progress <= 0) return 0;
    const dx = x - this.center.x, dz = z - this.center.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const R = this.radius;
    const p = this.progress;
    const t = r / R;

    const bowlMask = 1 - sstep(0.8, 1.4, t);
    const bowl = -this.depth * (1 - Math.pow(Math.min(t, 1), 3)) * bowlMask;

    const rimMask = sstep(0.75, 1.05, t) * (1 - sstep(1.2, 1.65, t));
    const rim = this.depth * 0.42 * rimMask;

    const jag =
      smoothNoise(x, z) * 0.7 * (1 - 0.5 * Math.min(t, 1)) * bowlMask +
      smoothNoise(x + 53.1, z - 27.7) * 0.5 * rimMask;

    return (bowl + rim + jag) * p;
  }

  trigger(center, strength) {
    this.center.copy(center);
    this.radius = 14 * strength + 7;
    this.depth = 5.2 * strength + 3.0;
    const worldRadius = this.radius * 2.4;
    this.scorch.scale.setScalar(worldRadius);
    this.fissure.scale.setScalar(worldRadius);
    this.scorchFade = 1;
    this.progress = 0;
    this._scatterRubble(strength);
  }

  setProgress(p) {
    this.progress = THREE.MathUtils.clamp(p, 0, 1);
    const pos = this.ground.geometry.attributes.position;
    const base = this.basePositions;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const i3 = i * 3;
      arr[i3 + 1] = this.heightAt(base[i3], base[i3 + 2]);
    }
    pos.needsUpdate = true;
    this.ground.geometry.computeBoundingSphere();
    this._conformDecal(this.scorch);
    this._conformDecal(this.fissure);
    this._conformRubble();
  }

  _conformDecal(mesh) {
    const arr = mesh.geometry.attributes.position.array;
    const base = this._decalBase;
    const s = mesh.scale.x;
    for (let i = 0; i < arr.length; i += 3) {
      const bx = base[i], bz = base[i + 2];
      arr[i] = bx;
      arr[i + 1] = this.heightAt(bx * s + this.center.x, bz * s + this.center.z) + DECAL_CLEARANCE;
      arr[i + 2] = bz;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
    mesh.position.set(this.center.x, 0, this.center.z);
  }

  update(dt, time, lavaIntensity) {
    if (this.scorchFade <= 0) return;
    if (this.autoGrow && this.progress < 1) this.setProgress(Math.min(1, this.progress + dt * 2.0));
    this.scorch.visible = true;
    this.scorch.material.opacity = Math.min(0.9, this.scorchFade) * 0.9;
    this.fissure.visible = true;
    this.fissurePulse += dt;
    const pulse = 0.7 + 0.22 * Math.sin(this.fissurePulse * 1.15) + 0.08 * Math.sin(this.fissurePulse * 2.93 + 1.1);
    const k = Math.max(0, lavaIntensity) * pulse;
    this.fissure.material.opacity = Math.min(1, k);
    this.fissure.material.color.setRGB(Math.min(1.6, k * 1.6), k * 0.55, k * 0.16);
  }

  setAutoGrow(v) {
    this.autoGrow = v;
  }

  fadeOut(k) {
    this.scorchFade = k;
    if (k <= 0) {
      this.scorch.visible = false;
      this.fissure.visible = false;
    }
    if (this.rubble.visible && Math.abs(k - this.rubbleK) > 0.01) {
      this.rubbleK = k;
      if (k <= 0.02) {
        this.rubble.visible = false;
      } else {
        this._conformRubble();
      }
    }
  }

  reset() {
    this.progress = 0;
    this.autoGrow = true;
    this.scorchFade = 0;
    this.rubbleK = 0;
    this.rubble.visible = false;
    this.setProgress(0);
    this.scorch.visible = false;
    this.fissure.visible = false;
  }

  dispose() {
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.scorch.geometry.dispose();
    this.scorch.material.dispose();
    this.fissure.geometry.dispose();
    this.fissure.material.dispose();
    this.rubble.geometry.dispose();
    this.rubble.material.dispose();
    this.scene.remove(this.ground, this.scorch, this.fissure, this.rubble);
  }
}
