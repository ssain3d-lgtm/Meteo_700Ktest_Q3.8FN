import * as THREE from 'three';
import { params } from './params.js';
import { createAllTextures, setTextureAnisotropy } from './assets/proceduralTextures.js';
import { StateMachine } from './stateMachine.js';
import { CameraDirector } from './cameraDirector.js';
import { CameraShake } from './effects/cameraShake.js';
import { PostFX } from './effects/postfx.js';
import { Environment } from './effects/environment.js';
import { createFireSystem, createEmberSystem, createSmokeSystem, createDustSystem, createDebrisSystem } from './effects/particles.js';
import { MagicCircle } from './effects/magicCircle.js';
import { SkyWarning } from './effects/skyWarning.js';
import { Meteor } from './effects/meteor.js';
import { Explosion } from './effects/explosion.js';
import { Shockwave } from './effects/shockwave.js';
import { Crater } from './effects/crater.js';
import { Lava } from './effects/lava.js';
import { SkillDirector } from './director.js';
import { MeteorAudio } from './audio/meteorAudio.js';
import { createUI } from './ui.js';

console.log('[BOOT] start');

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 1200);

console.log('[BOOT] textures: start');
const textures = createAllTextures();
setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
console.log('[BOOT] textures: done');

console.log('[BOOT] scene: start');
const environment = new Environment(scene, textures);
const crater = new Crater(scene, textures);

const particles = {
  fire: createFireSystem(textures.flame, 7000),
  embers: createEmberSystem(textures.ember, 6000),
  smoke: createSmokeSystem(textures.smoke, 3500),
  dust: createDustSystem(textures.dust, 3500),
  debris: createDebrisSystem(textures.flame, 2500)
};
const PARTICLE_KEYS = Object.keys(particles);
for (const key of PARTICLE_KEYS) {
  scene.add(particles[key].points);
}
const syncParticleScale = () => {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  for (const key of PARTICLE_KEYS) particles[key].setViewport(h, camera.fov);
};
syncParticleScale();

const magicCircle = new MagicCircle(scene, textures, 9.5);
const skyWarning = new SkyWarning(scene, textures);
const meteor = new Meteor(scene, textures, particles);
const explosion = new Explosion(scene, textures, particles);
const shockwave = new Shockwave(scene, textures, particles);
const lava = new Lava(scene, textures, particles, crater);
console.log('[BOOT] scene: done');

console.log('[BOOT] post: start');
const postfx = new PostFX(renderer, scene, camera);
console.log('[BOOT] post: done');

const sm = new StateMachine();
const shake = new CameraShake();
const cameraDirector = new CameraDirector(camera, shake);
const audio = new MeteorAudio();

const skillDirector = new SkillDirector({
  camera, sm, postfx, shake, director: cameraDirector, audio,
  environment, magicCircle, skyWarning, meteor, explosion, shockwave, crater, lava, particles, params
});

const ui = createUI({ params, audio, sm, postfx, onReset: () => skillDirector.resetAll() });

sm.onPhaseChange((phase) => {
  ui.refresh();
  console.log(`[PHASE] ${phase}`);
});

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  postfx.setSize(w, h);
  syncParticleScale();
}
window.addEventListener('resize', onResize);

// Audio must be created inside a user gesture on most browsers.
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

const timer = new THREE.Timer();
timer.connect(document);

let simTime = 0;
function step(dt) {
  simTime += dt;
  sm.update(dt);
  skillDirector.update(dt, simTime);
  shake.update(dt, params.shakeStrength);
  cameraDirector.update(dt, { meteor: meteor.active ? meteor : null });
}

// Deterministic simulation advance, independent of rAF throttling or tab visibility.
function advance(seconds, dt = 1 / 60) {
  const n = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < n; i++) step(dt);
}

let running = true;
function frame() {
  if (!running) return;
  requestAnimationFrame(frame);
  timer.update();
  const dt = Math.min(0.05, timer.getDelta());
  step(dt);
  postfx.render();
  ui.refresh();
}
frame();

window.__meteorApp = {
  THREE, scene, camera, renderer, sm, director: cameraDirector, shake, postfx,
  audio, textures, particles, environment, magicCircle, skyWarning, meteor,
  explosion, shockwave, crater, lava, params,
  setPhase: (name) => { sm.auto = false; sm.setPhase(name); },
  castFullDemo: () => sm.startDemo(),
  reset: () => { sm.reset(); skillDirector.resetAll(); },
  step,
  advance,
  simTime: () => simTime,
  pause: (v) => { running = !v; if (running) frame(); },
  frame
};

console.log('[BOOT] done');

if (new URLSearchParams(window.location.search).get('gate') === '1') {
  import('./quality/renderQualityGate.js').then((m) => m.installGate(window.__meteorApp).runSequence());
}
