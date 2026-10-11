// SKY_WARNING: crimson fissures tearing open overhead + the distant approaching glow.
import * as THREE from 'three';
import { GLSL_NOISE } from './glslCommon.js';

const CRACK_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CRACK_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uReveal;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
${GLSL_NOISE}
void main() {
  vec4 tex = texture2D(uMap, vUv);
  float flicker = 0.72 + 0.28 * fbm2(vUv * 6.0 + vec2(uTime * 0.35, -uTime * 0.2));
  float breathe = 0.75 + 0.25 * sin(uTime * 1.7 + vUv.x * 9.0);
  float a = tex.a * uReveal * flicker * breathe;
  if (a < 0.004) discard;
  vec3 col = uColor * tex.rgb * (1.2 + uReveal * 1.6);
  gl_FragColor = vec4(col, a);
}
`;

export class SkyWarning {
  constructor(scene, textures) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.reveal = 0;
    this.target = 0;
    this.active = false;

    this.cracks = [];
    const layout = [
      { pos: [-40, 105, -150], size: 150, color: 0xff3a12, rot: 0.2 },
      { pos: [55, 128, -170], size: 190, color: 0xd8240e, rot: -0.5 },
      { pos: [5, 150, -210], size: 240, color: 0xff6a2a, rot: 0.9 }
    ];
    for (const l of layout) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: textures.skyCrack },
            uReveal: { value: 0 },
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(l.color) }
          },
          vertexShader: CRACK_VERT,
          fragmentShader: CRACK_FRAG,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        })
      );
      mesh.position.set(...l.pos);
      mesh.scale.setScalar(l.size);
      mesh.rotation.set(-0.55, l.rot, l.rot * 0.3);
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.cracks.push(mesh);
    }

    // distant approaching glow (the meteor, still far away)
    this.distantGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.ember, color: 0xffb070, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.distantGlow.scale.setScalar(26);
    this.distantGlow.position.set(38, 120, -140);
    this.distantGlow.renderOrder = 3;
    this.group.add(this.distantGlow);
  }

  show() {
    this.active = true;
    this.target = 1;
  }

  hide() {
    this.active = false;
    this.target = 0;
  }

  setLevel(v) { this.target = v; }

  update(dt, time) {
    if (!this.active && this.reveal < 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.reveal += (this.target - this.reveal) * Math.min(1, dt * 1.4);
    for (const c of this.cracks) {
      c.material.uniforms.uReveal.value = this.reveal;
      c.material.uniforms.uTime.value = time;
    }
    this.distantGlow.material.opacity = this.reveal * (0.5 + 0.2 * Math.sin(time * 3.1));
    this.distantGlow.scale.setScalar(22 + this.reveal * 14 + Math.sin(time * 2.3) * 2);
  }

  reset() {
    this.active = false;
    this.reveal = 0;
    this.target = 0;
    this.group.visible = false;
  }

  dispose() {
    for (const c of this.cracks) {
      c.geometry.dispose();
      c.material.dispose();
    }
    this.distantGlow.material.dispose();
    this.scene.remove(this.group);
  }
}
