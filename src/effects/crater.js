// Ground + crater: the plane is deformed into a bowl with a raised rim after impact.
// Height is a single analytic function (smooth, low-frequency) shared by BOTH the ground
// mesh and the decal meshes, and the decals are ring-subdivided grids conformed to that
// function at DECAL_CLEARANCE above it. That guarantees no coplanar z-fighting and no
// black patches, regardless of crater size.
import * as THREE from 'three';

const GROUND_SIZE = 240;
const GROUND_SEG = 180;
export const DECAL_CLEARANCE = 0.3;

// Continuous, deterministic value noise (lattice cell = 8 world units).
function smoothNoise(x, z) {
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8);
  const h = (a, b) => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  let fx = x / 8 - cx, fz = z / 8 - cz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = h(cx, cz), b = h(cx + 1, cz), c = h(cx, cz + 1), d = h(cx + 1, cz + 1);
  return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
}

// Unit disc with radial rings so it can follow terrain without cutting through it.
function makeDiscGeometry(rings = 28, segments = 96) {
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
  }

  // Analytic terrain height. Identical for ground and decals.
  heightAt(x, z) {
    if (this.progress <= 0) return 0;
    const dx = x - this.center.x, dz = z - this.center.z;
    const r = Math.sqrt(dx * dx + dz * dz);
    const R = this.radius;
    const p = this.progress;
    let h = 0;
    if (r < R) {
      const t = r / R;
      h = -this.depth * p * (1 - t * t);
      h += smoothNoise(x, z) * 0.35 * p * (1 - t * 0.6);
    } else if (r < R * 1.5) {
      const t = (r - R) / (R * 0.5);
      const bump = Math.sin(t * Math.PI);
      h = this.depth * 0.3 * p * bump;
      h += smoothNoise(x + 53.1, z - 27.7) * 0.22 * p * bump;
    }
    return h;
  }

  trigger(center, strength) {
    this.center.copy(center);
    this.radius = 13 * strength + 6;
    this.depth = 4.2 * strength + 2.2;
    const worldRadius = this.radius * 2.4;
    this.scorch.scale.setScalar(worldRadius);
    this.fissure.scale.setScalar(worldRadius);
    this.scorchFade = 1;
    this.progress = 0;
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
    if (this.progress < 1) this.setProgress(Math.min(1, this.progress + dt * 2.0));
    this.scorch.visible = true;
    this.scorch.material.opacity = Math.min(0.9, this.scorchFade) * 0.9;
    this.fissure.visible = true;
    this.fissurePulse += dt;
    const pulse = 0.7 + 0.22 * Math.sin(this.fissurePulse * 1.15) + 0.08 * Math.sin(this.fissurePulse * 2.93 + 1.1);
    const k = Math.max(0, lavaIntensity) * pulse;
    this.fissure.material.opacity = Math.min(1, k);
    this.fissure.material.color.setRGB(Math.min(1.6, k * 1.6), k * 0.55, k * 0.16);
  }

  fadeOut(k) {
    this.scorchFade = k;
    if (k <= 0) {
      this.scorch.visible = false;
      this.fissure.visible = false;
    }
  }

  reset() {
    this.progress = 0;
    this.scorchFade = 0;
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
    this.scene.remove(this.ground, this.scorch, this.fissure);
  }
}
