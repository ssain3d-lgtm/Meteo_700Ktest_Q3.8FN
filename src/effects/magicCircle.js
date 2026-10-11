// Magic circle: 5 visual layers (outer rune ring, inner rune ring, geometry ring,
// central core sigil, floor glow) + rotating core orb, point light and energy arcs.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const DISC_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISC_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uBrightness;
uniform float uTime;
uniform float uSpin;
varying vec2 vUv;
void main() {
  float a = uSpin;
  float cs = cos(a), sn = sin(a);
  vec2 p = vUv - 0.5;
  vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) + 0.5;
  vec4 tex = texture2D(uMap, q);
  float pulse = 0.82 + 0.18 * sin(uTime * 2.3 + length(p) * 14.0);
  gl_FragColor = vec4(uColor * tex.rgb * uBrightness * pulse, tex.a * uBrightness);
}
`;

function makeDisc(tex, inner, outer, color, opacityBase) {
  const geo = new THREE.RingGeometry(inner, outer, 128, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uColor: { value: new THREE.Color(color) },
      uBrightness: { value: 0 },
      uTime: { value: 0 },
      uSpin: { value: 0 }
    },
    vertexShader: DISC_VERT,
    fragmentShader: DISC_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  mesh.renderOrder = 5;
  return mesh;
}

export class MagicCircle {
  constructor(scene, textures, radius = 9.5) {
    this.scene = scene;
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.layers = [
      { mesh: makeDisc(textures.runeOuter, 0.0, 1.0, 0xff7a2a, 1), spinSpeed: 0.35, scale: radius * 2 },
      { mesh: makeDisc(textures.runeInner, 0.0, 1.0, 0xffb347, 1), spinSpeed: -0.62, scale: radius * 1.42 },
      { mesh: makeDisc(textures.geometryRing, 0.0, 1.0, 0xffd980, 1), spinSpeed: 0.22, scale: radius * 1.78 },
      { mesh: makeDisc(textures.coreSigil, 0.0, 1.0, 0xffe9c0, 1), spinSpeed: -0.9, scale: radius * 0.9 },
      { mesh: makeDisc(textures.floorGlow, 0.0, 1.0, 0xff5a1e, 1), spinSpeed: 0.0, scale: radius * 2.6 }
    ];
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      l.mesh.scale.setScalar(l.scale);
      l.mesh.position.y = 0.06 + i * 0.015;
      this.group.add(l.mesh);
    }

    // central core orb
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uBrightness: { value: 0 } },
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vNrm; varying vec3 vView;
          ${GLSL_NOISE}
          void main() {
            vec3 p = position;
            float n = fbm3(normalize(position) * 3.0 + vec3(0.0, uTime * 0.8, 0.0));
            p += normal * n * 0.22;
            vNrm = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vView = -mv.xyz;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform float uBrightness;
          varying vec3 vNrm; varying vec3 vView;
          void main() {
            float fres = pow(1.0 - max(dot(normalize(vNrm), normalize(vView + vec3(0.0, 0.0, 1e-4))), 0.0), 1.6);
            float core = 1.0 - fres;
            vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.97, 0.88), pow(core, 2.0));
            float a = uBrightness * (0.35 + 0.75 * core);
            gl_FragColor = vec4(col * uBrightness * (0.6 + core * 1.6), a);
          }
        `,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      })
    );
    this.core.position.y = 0.9;
    this.group.add(this.core);

    this.light = new THREE.PointLight(0xff7a2e, 0, 40, 1.6);
    this.light.position.set(0, 1.2, 0);
    this.group.add(this.light);

    // energy arcs between rings
    const arcCount = 36;
    const positions = new Float32Array(arcCount * 2 * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.arcMat = new THREE.LineBasicMaterial({ color: 0xffcf7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.arcs = new THREE.LineSegments(arcGeo, this.arcMat);
    this.arcs.frustumCulled = false;
    this.arcs.visible = false;
    this.arcPositions = positions;
    this.arcCount = arcCount;
    this.group.add(this.arcs);
    this._arcTimer = 0;
    this._regenArcs();

    this.brightness = 0;
    this.targetBrightness = 0;
    this.spin = 0;
    this.active = false;
    this.charge = 0; // 0..1
  }

  _regenArcs() {
    const p = this.arcPositions;
    const r0 = this.radius * 0.55, r1 = this.radius * 0.95;
    for (let i = 0; i < this.arcCount; i++) {
      const a0 = Math.random() * Math.PI * 2;
      const a1 = a0 + (Math.random() - 0.5) * 1.4;
      const rA = r0 + Math.random() * (r1 - r0);
      const rB = r0 + Math.random() * (r1 - r0);
      const y = 0.12 + Math.random() * 0.5;
      p[i * 6] = Math.cos(a0) * rA; p[i * 6 + 1] = y; p[i * 6 + 2] = Math.sin(a0) * rA;
      p[i * 6 + 3] = Math.cos(a1) * rB; p[i * 6 + 4] = 0.12 + Math.random() * 0.5; p[i * 6 + 5] = Math.sin(a1) * rB;
    }
    this.arcs.geometry.attributes.position.needsUpdate = true;
  }

  show() {
    this.active = true;
    this.group.visible = true;
    this.group.scale.setScalar(0.25);
  }

  hide() {
    this.active = false;
    this.targetBrightness = 0;
  }

  setCharge(c) { this.charge = c; }

  update(dt, time) {
    if (!this.active && this.brightness < 0.01) {
      this.group.visible = false;
      return;
    }
    this.targetBrightness = this.active ? 0.42 + this.charge * 0.62 : 0;
    const rate = this.active ? 2.5 : 7.0;
    this.brightness += (this.targetBrightness - this.brightness) * Math.min(1, dt * rate);
    const scaleTarget = 1 + this.charge * 0.12;
    const s = this.group.scale.x + (scaleTarget - this.group.scale.x) * Math.min(1, dt * 1.8);
    this.group.scale.setScalar(s);
    const spinRate = 0.35 + this.charge * 1.35;
    this.spin += dt * spinRate;
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      const u = l.mesh.material.uniforms;
      u.uTime.value = time;
      u.uSpin.value = this.spin * l.spinSpeed;
      u.uBrightness.value = this.brightness * (i === 4 ? 0.7 : 1.0);
      l.mesh.visible = this.brightness > 0.02;
    }
    this.core.material.uniforms.uTime.value = time;
    this.core.material.uniforms.uBrightness.value = this.brightness * (0.6 + this.charge * 0.9);
    this.core.scale.setScalar(0.7 + this.charge * 0.9 + Math.sin(time * 7) * 0.06 * this.charge);
    this.core.visible = this.brightness > 0.02;
    this.light.intensity = this.brightness * (14 + this.charge * 40);

    this._arcTimer += dt;
    if (this._arcTimer > 0.12) {
      this._arcTimer = 0;
      this._regenArcs();
    }
    this.arcMat.opacity = this.brightness * (0.25 + this.charge * 0.55);
    this.arcs.visible = this.brightness > 0.15;
  }

  dispose() {
    for (const l of this.layers) { l.mesh.geometry.dispose(); l.mesh.material.dispose(); }
    this.core.geometry.dispose();
    this.core.material.dispose();
    this.arcs.geometry.dispose();
    this.arcMat.dispose();
    this.scene.remove(this.group);
  }
}
