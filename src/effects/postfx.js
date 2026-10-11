// Post-processing chain: RenderPass -> UnrealBloomPass -> HeatDistortionPass -> OutputPass.
// HalfFloat HDR target with MSAA samples (composer target ignores canvas antialias).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { GLSL_NOISE } from './glslCommon.js';

const HeatShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.2) },
    uRadius: { value: 0.5 },
    uAspect: { value: 1 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uIntensity;
    uniform vec2 uCenter;
    uniform float uRadius;
    uniform float uAspect;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
      float r = length(d) / max(1e-4, uRadius);
      float fall = max(0.0, 1.0 - r);
      fall *= fall;
      float w1 = sin(vUv.y * 26.0 + uTime * 7.0) * 0.6 + sin(vUv.y * 47.0 - uTime * 11.0) * 0.4;
      float w2 = cos(vUv.x * 31.0 + uTime * 5.0);
      vec2 off = normalize(d + vec2(0.0, 1e-4)) * w1 * 0.012 * uIntensity * fall;
      off += vec2(w2 * 0.004, 0.0) * uIntensity * fall;
      vec4 col = texture2D(tDiffuse, clamp(vUv + off, vec2(0.002), vec2(0.998)));
      col.rgb *= 1.0 + 0.10 * uIntensity * fall * (0.5 + 0.5 * sin(uTime * 3.1));
      gl_FragColor = col;
    }
  `
};

class HeatDistortionPass extends Pass {
  constructor() {
    super();
    this.material = new THREE.ShaderMaterial(HeatShader);
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.fsQuad = new FullScreenQuadShim(this.material);
    this.enabled = true;
  }
  setSize(w, h) {
    this.material.uniforms.uAspect.value = w / Math.max(1, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
      this.fsQuad.render(renderer);
    } else {
      renderer.setRenderTarget(writeBuffer);
      this.fsQuad.render(renderer);
    }
  }
  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

// tiny wrapper so we don't import the internal FullScreenQuad name
class FullScreenQuadShim {
  constructor(material) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }
  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.geometry.dispose();
    this.mesh.geometry = null;
  }
}

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.exposureBase = renderer.toneMappingExposure;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloomPass = new UnrealBloomPass(size.clone(), 1.0, 0.5, 0.78);
    this.heatPass = new HeatDistortionPass();
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.heatPass);
    this.composer.addPass(this.outputPass);
    this.flash = 0;
    this.baseBloom = 1.0;
  }

  setGlow(mult) {
    this.bloomPass.strength = this.baseBloom * mult;
  }

  setHeat(intensity, centerNdc, radius) {
    const u = this.heatPass.material.uniforms;
    u.uIntensity.value = intensity;
    if (centerNdc) {
      u.uCenter.value.set(centerNdc.x * 0.5 + 0.5, centerNdc.y * 0.5 + 0.5);
      u.uRadius.value = radius;
    }
  }

  update(dt, time) {
    this.heatPass.material.uniforms.uTime.value = time;
    this.flash = Math.max(0, this.flash - dt * 3.0);
    this.renderer.toneMappingExposure = this.exposureBase * (1 + this.flash * 0.55);
  }

  triggerFlash(v) { this.flash = Math.max(this.flash, v); }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  render() { this.composer.render(); }

  dispose() {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.heatPass.dispose();
    this.renderPass.dispose?.();
    this.outputPass.dispose?.();
  }
}

export { GLSL_NOISE };
