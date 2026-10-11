// All textures are generated procedurally on a canvas (no external assets).
// Seam policy:
//  - textures used with RepeatWrapping are drawn seam-free: periodic integer-lattice
//    value noise for fills, and 3x3 wrapped re-drawing for any motif that touches an edge.
//  - sprites / radial textures use ClampToEdgeWrapping (their alpha fades to 0 at borders).
import * as THREE from 'three';

export const textureRegistry = [];

export function registerTexture(tex, { repeat = 'clamp', note = '' } = {}) {
  tex.colorSpace = THREE.SRGBColorSpace;
  textureRegistry.push({ tex, repeat, note });
  return tex;
}

export function setTextureAnisotropy(maxAniso) {
  for (const entry of textureRegistry) entry.tex.anisotropy = maxAniso;
}

// ---------- canvas helpers ----------
function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, ctx: c.getContext('2d') };
}

function toTex(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (repeat === 'repeat') {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  } else if (repeat && repeat.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat.repeat[0], repeat.repeat[1]);
  } else {
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  }
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Periodic value noise: lattice wraps at (nx, ny) so the texture tiles seamlessly.
function periodicNoise(nx, ny) {
  const g = new Float32Array(nx * ny);
  for (let i = 0; i < g.length; i++) g[i] = Math.random();
  const at = (x, y) => g[((y % ny) + ny) % ny * nx + ((x % nx) + nx) % nx];
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

function makeFbm(baseNx, baseNy, octaves = 4) {
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    layers.push({ noise: periodicNoise(baseNx << o, baseNy << o), amp: 1 / (1 << o) });
  }
  const norm = layers.reduce((s, l) => s + l.amp, 0);
  return function fbm(x, y) {
    let v = 0;
    for (let o = 0; o < layers.length; o++) {
      const scale = 1 << o;
      v += layers[o].amp * layers[o].noise(x * scale, y * scale);
    }
    return v / norm;
  };
}

// Re-draw a motif 3x3 (offset copies) when its bbox touches a texture edge.
// `spansEdge` must be computed from the motif's FULL geometry before drawing.
export function wrapTile(ctx, w, h, draw, spansEdge) {
  if (!spansEdge) { draw(); return; }
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * w, oy * h);
      draw();
      ctx.restore();
    }
  }
}

function polylineBBox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

function spansEdge(bbox, w, h, pad = 0) {
  return bbox[0] < pad || bbox[1] < pad || bbox[2] > w - pad || bbox[3] > h - pad;
}

function drawPolyline(ctx, pts, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

// ---------- repeating fill textures ----------
// fbmToCanvas maps pixel -> domain [0, DOMAIN). Every makeFbm lattice base used for a
// RepeatWrapping texture MUST divide DOMAIN, otherwise the noise does not wrap and the
// tile shows a visible seam (gate A1).
const DOMAIN = 8;

function fbmToCanvas(size, fbmFn, colorFn) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * DOMAIN, v = (y / size) * DOMAIN;
      const n = fbmFn(u, v);
      const [r, g, b] = colorFn(n, u, v);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createGroundTextures() {
  const fbm = makeFbm(4, 4, 5);
  const fbm2 = makeFbm(8, 8, 4);
  const color = (v, u, w) => {
    const s = fbm2(u + 2.3, w + 5.1);
    const base = 0.10 + v * 0.16 + s * 0.08;
    const warm = Math.max(0, v - 0.62) * 0.35;
    return [
      Math.min(255, (base * 0.92 + warm * 0.9) * 255),
      Math.min(255, (base * 0.90 + warm * 0.45) * 255),
      Math.min(255, (base * 0.95) * 255)
    ];
  };
  const diffuse = registerTexture(toTex(fbmToCanvas(1024, fbm, color), { repeat: [10, 10] }),
    { repeat: 'repeat', note: 'ground rock mottle (periodic fbm)' });

  const bump = registerTexture(toTex(fbmToCanvas(1024, fbm, (v) => {
    const g = Math.min(255, v * 255);
    return [g, g, g];
  }), { repeat: [10, 10] }), { repeat: 'repeat', note: 'ground bump' });

  return { diffuse, bump };
}

export function createLavaTileTexture() {
  const fbmA = makeFbm(4, 4, 5);
  const fbmB = makeFbm(8, 8, 4);
  const c = fbmToCanvas(1024, (x, y) => {
    const warp = fbmB(x + 4.3, y + 7.1);
    return fbmA(x + warp * 1.6, y + warp * 1.6);
  }, (v) => {
    const t = Math.pow(Math.max(0, v - 0.42) / 0.58, 1.6);
    const rock = 0.05 + v * 0.10;
    const r = Math.min(255, (rock + t * 1.0) * 255);
    const g = Math.min(255, (rock * 0.8 + t * 0.55) * 255);
    const b = Math.min(255, (rock * 0.9 + t * 0.12) * 255);
    return [r, g, b];
  });
  return registerTexture(toTex(c, { repeat: [3, 3] }), { repeat: 'repeat', note: 'lava veins (warped periodic fbm)' });
}

export function createCrustTexture() {
  const fbm = makeFbm(4, 2, 5);
  const fbmCrack = makeFbm(4, 2, 4);
  const c = fbmToCanvas(1024, (x, y) => {
    const warp = fbmCrack(x * 0.5 + 2.0, y * 0.5 + 9.0);
    return fbm(x + warp * 1.2, y + warp * 1.2);
  }, (v) => {
    const crack = Math.max(0, 0.52 - v) / 0.52;
    const t = Math.pow(crack, 2.4);
    const rock = 0.045 + v * 0.10;
    return [
      Math.min(255, (rock + t * 1.0) * 255),
      Math.min(255, (rock * 0.85 + t * 0.5) * 255),
      Math.min(255, (rock * 0.85 + t * 0.1) * 255)
    ];
  });
  return registerTexture(toTex(c, { repeat: [3, 2] }), { repeat: 'repeat', note: 'meteor rock crust with hot cracks' });
}

export function createFireTexture() {
  const fbm = makeFbm(4, 4, 5);
  const S = 512;
  const { c, ctx } = canvas2d(S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * DOMAIN, v = (y / S) * DOMAIN;
      const warp = fbm(u * 2 + 3.1, v * 2 + 8.7);
      let n = fbm(u * 2 + warp * 1.4, v * 2 + warp * 1.1);
      n = Math.pow(n, 1.35);
      const r = Math.min(255, (0.75 + n * 0.25) * 255);
      const g = Math.min(255, (0.28 + n * 0.72) * 255);
      const b = Math.min(255, (0.03 + n * 0.22) * 255);
      const i = (y * S + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return registerTexture(toTex(c, { repeat: [1, 1] }), { repeat: 'repeat', note: 'fire tongues (periodic fbm)' });
}

// ---------- soft sprites (clamp) ----------
function softBlob(size, core, inner, outer, colorFn) {
  const { c, ctx } = canvas2d(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2), dy = (y - size / 2) / (size / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = 0;
      if (d < core) a = 1;
      else if (d < inner) a = 1 - (d - core) / (inner - core);
      else if (d < outer) a = (1 - (d - inner) / (outer - inner)) * 0.55;
      a = Math.pow(Math.max(0, a), 1.6);
      const [r, g, b] = colorFn(d);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function createEmberSprite() {
  return registerTexture(toTex(softBlob(128, 0.12, 0.45, 0.95, () => [255, 210, 130])),
    { repeat: 'clamp', note: 'ember sprite' });
}

export function createFlameSprite() {
  return registerTexture(toTex(softBlob(128, 0.10, 0.5, 1.0, (d) => {
    const t = 1 - d;
    return [255, Math.round(120 + 130 * t), Math.round(20 + 90 * t * t)];
  })), { repeat: 'clamp', note: 'flame sprite' });
}

export function createSmokeSprite() {
  const fbm = makeFbm(3, 3, 4);
  const { c, ctx } = canvas2d(256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = (x - 128) / 128, dy = (y - 128) / 128;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(x / 256 * 4 + 2.2, y / 256 * 4 + 5.5);
      let a = Math.max(0, 1 - d) * (0.35 + n * 0.65);
      a = Math.pow(a, 1.7) * 1.4;
      const g = Math.round(150 + n * 70);
      const i = (y * 256 + x) * 4;
      img.data[i] = g; img.data[i + 1] = g; img.data[i + 2] = g; img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'smoke puff sprite' });
}

export function createDustSprite() {
  const fbm = makeFbm(2, 2, 3);
  const { c, ctx } = canvas2d(256);
  const img = ctx.createImageData(256, 256);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const dx = (x - 128) / 128, dy = (y - 128) / 128;
      const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(x / 256 * 3 + 9.1, y / 256 * 3 + 1.7);
      let a = Math.pow(Math.max(0, 1 - d), 2.2) * (0.5 + n * 0.5);
      const i = (y * 256 + x) * 4;
      img.data[i] = 190; img.data[i + 1] = 175; img.data[i + 2] = 160; img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'dust burst sprite' });
}

// ---------- magic circle layers (clamp; alpha fades at borders) ----------
function glyphPath(ctx, x, y, s, rnd) {
  ctx.beginPath();
  ctx.moveTo(x + (rnd() - 0.5) * s, y + (rnd() - 0.5) * s);
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    ctx.lineTo(x + (rnd() - 0.5) * 2 * s, y + (rnd() - 0.5) * 2 * s);
  }
  ctx.stroke();
  if (rnd() > 0.55) {
    ctx.beginPath();
    ctx.arc(x, y, s * (0.25 + rnd() * 0.35), 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function createRuneRingTexture({ glyphs = 24, band = [0.84, 0.97], seed = 1, ticks = true } = {}) {
  const S = 1024, H = S / 2;
  const { c, ctx } = canvas2d(S);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 4;
  for (const rr of band) {
    ctx.beginPath(); ctx.arc(H, H, rr * H, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.lineWidth = 3;
  const mid = (band[0] + band[1]) / 2 * H;
  for (let i = 0; i < glyphs; i++) {
    const a = (i / glyphs) * Math.PI * 2;
    const x = H + Math.cos(a) * mid, y = H + Math.sin(a) * mid;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2);
    glyphPath(ctx, 0, 0, 26 + rnd() * 22, rnd);
    ctx.restore();
  }
  if (ticks) {
    ctx.lineWidth = 2;
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const r0 = band[0] * H, r1 = band[0] * H - 14 - (i % 3) * 10;
      ctx.beginPath();
      ctx.moveTo(H + Math.cos(a) * r0, H + Math.sin(a) * r0);
      ctx.lineTo(H + Math.cos(a) * r1, H + Math.sin(a) * r1);
      ctx.stroke();
    }
  }
  // soft outer falloff so the disc edge never shows a hard cut
  const grad = ctx.createRadialGradient(H, H, band[1] * H, H, H, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'rune ring band' });
}

export function createGeometryRingTexture(seed = 7) {
  const S = 1024, H = S / 2;
  const { c, ctx } = canvas2d(S);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(H, H, 0.80 * H, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(H, H, 0.52 * H, 0, Math.PI * 2); ctx.stroke();
  const star = (points, rOuter, rInner, phase) => {
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = phase + (i / points) * Math.PI * 2;
      const r = i % 2 === 0 ? rOuter : rInner;
      const x = H + Math.cos(a) * r, y = H + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  };
  star(12, 0.78 * H, 0.42 * H, 0.2);
  star(6, 0.66 * H, 0.34 * H, 1.1);
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(H + Math.cos(a) * 0.52 * H, H + Math.sin(a) * 0.52 * H);
    ctx.lineTo(H + Math.cos(a) * 0.80 * H, H + Math.sin(a) * 0.80 * H);
    ctx.stroke();
    const ar = rnd() * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(H + Math.cos(ar) * 0.66 * H, H + Math.sin(ar) * 0.66 * H, 8 + rnd() * 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  const grad = ctx.createRadialGradient(H, H, 0.80 * H, H, H, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'geometry ring' });
}

export function createCoreSigilTexture() {
  const S = 1024, H = S / 2;
  const { c, ctx } = canvas2d(S);
  const grad = ctx.createRadialGradient(H, H, 0, H, H, H);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,225,160,0.85)');
  grad.addColorStop(0.45, 'rgba(255,120,40,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(H + Math.cos(a) * 0.10 * H, H + Math.sin(a) * 0.10 * H);
    ctx.lineTo(H + Math.cos(a) * 0.42 * H, H + Math.sin(a) * 0.42 * H);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(H, H, 0.30 * H, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(H, H, 0.42 * H, 0, Math.PI * 2); ctx.stroke();
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'core sigil' });
}

export function createFloorGlowTexture() {
  const S = 512, H = S / 2;
  const { c, ctx } = canvas2d(S);
  const grad = ctx.createRadialGradient(H, H, 0, H, H, H);
  grad.addColorStop(0, 'rgba(255,150,60,0.85)');
  grad.addColorStop(0.4, 'rgba(255,90,30,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'floor glow' });
}

// ---------- sky / shockwave / decals ----------
export function createSkyCrackTexture() {
  const S = 1024, H = S / 2;
  const { c, ctx } = canvas2d(S);
  const rnd = mulberry32(4242);
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  const drawCrack = (angle, len) => {
    const pts = [[H, H]];
    let a = angle;
    for (let i = 0; i < 10; i++) {
      const last = pts[pts.length - 1];
      a += (rnd() - 0.5) * 0.7;
      const step = len / 10;
      pts.push([last[0] + Math.cos(a) * step, last[1] + Math.sin(a) * step]);
    }
    // clamp: cracks stay inside the disc; edge alpha is 0 anyway (radial mask)
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.9;
    drawPolyline(ctx, pts);
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6;
    drawPolyline(ctx, pts);
    ctx.globalAlpha = 1;
  };
  for (let i = 0; i < 9; i++) drawCrack((i / 9) * Math.PI * 2 + rnd() * 0.4, H * (0.6 + rnd() * 0.35));
  const grad = ctx.createRadialGradient(H, H, 0, H, H, H);
  grad.addColorStop(0, 'rgba(0,0,0,0.0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'sky crack' });
}

export function createShockRingTexture() {
  const S = 512;
  const { c, ctx } = canvas2d(S);
  const img = ctx.createImageData(S, S);
  const fbm = makeFbm(6, 6, 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      const wob = 1 + 0.25 * (fbm(Math.cos(ang) * 3 + 5, Math.sin(ang) * 3 + 9) - 0.5) * 2;
      const r = d * wob;
      let a = 0;
      if (r > 0.72 && r < 1.0) {
        const t = (r - 0.72) / 0.28;
        a = Math.pow(Math.sin(t * Math.PI), 1.4);
        a *= t < 0.35 ? 1 : (1 - (t - 0.35) / 0.65) * 0.9 + 0.1;
      }
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 225; img.data[i + 2] = 190; img.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return registerTexture(toTex(c), { repeat: 'clamp', note: 'shockwave ring band' });
}

export function createScorchLavaDecalTexture() {
  const S = 2048, H = S / 2;
  const { c, ctx } = canvas2d(S);
  const rnd = mulberry32(90210);
  // scorch: dark blotches under normal blending
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2;
    const r = (0.25 + rnd() * 0.72) * H;
    const x = H + Math.cos(a) * r, y = H + Math.sin(a) * r;
    const rad = 40 + rnd() * 130;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(10,6,5,0.55)');
    grad.addColorStop(1, 'rgba(10,6,5,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  const edge = ctx.createRadialGradient(H, H, H * 0.75, H, H, H);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  const scorch = registerTexture(toTex(c), { repeat: 'clamp', note: 'scorch decal' });

  // lava fissures: a CONNECTED CRACK NETWORK, not spokes.
  // The previous version drew 14 polylines radiating from the centre, which reads as
  // octopus tentacles. Cooling basalt / dried mud cracks form a web between seeds.
  const { c: c2, ctx: ctx2 } = canvas2d(S);
  ctx2.lineCap = 'round';
  ctx2.lineJoin = 'round';

  const seeds = [];
  for (let i = 0; i < 52; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.72) * H * 0.9; // denser toward the middle
    seeds.push([H + Math.cos(a) * r, H + Math.sin(a) * r]);
  }

  const edges = new Set();
  const maxSpan = H * 0.34;
  for (let i = 0; i < seeds.length; i++) {
    const near = seeds
      .map((s, j) => [j, Math.hypot(s[0] - seeds[i][0], s[1] - seeds[i][1])])
      .filter(([j, d]) => j !== i && d < maxSpan)
      .sort((a, b) => a[1] - b[1]);
    const k = 2 + Math.floor(rnd() * 2);
    for (let n = 0; n < Math.min(k, near.length); n++) {
      const j = near[n][0];
      edges.add(i < j ? `${i}|${j}` : `${j}|${i}`);
    }
  }

  const jitteredPath = (p0, p1) => {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const steps = 4 + Math.floor(rnd() * 4);
    const amp = len * (0.06 + rnd() * 0.12);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = (i === 0 || i === steps) ? 0 : (rnd() - 0.5) * 2 * amp;
      pts.push([p0[0] + dx * t + nx * off, p0[1] + dy * t + ny * off]);
    }
    return pts;
  };

  for (const key of edges) {
    const [i, j] = key.split('|').map(Number);
    const pts = jitteredPath(seeds[i], seeds[j]);
    const bbox = polylineBBox(pts);
    const midR = Math.hypot((bbox[0] + bbox[2]) / 2 - H, (bbox[1] + bbox[3]) / 2 - H) / H;
    // wider and brighter near the crater, hairline toward the field edge
    const width = (2.5 + rnd() * 5.5) * (1.25 - midR * 0.75);
    if (width <= 0.4) continue;
    const draw = () => {
      ctx2.strokeStyle = 'rgba(255,255,255,0.42)';
      ctx2.lineWidth = width * 2.1;
      drawPolyline(ctx2, pts);
      ctx2.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx2.lineWidth = width;
      drawPolyline(ctx2, pts);
    };
    if (spansEdge(bbox, S, S, 2)) {
      ctx2.save();
      ctx2.beginPath(); ctx2.arc(H, H, H * 0.985, 0, Math.PI * 2); ctx2.clip();
      draw();
      ctx2.restore();
    } else {
      draw();
    }
  }

  const grad2 = ctx2.createRadialGradient(H, H, 0, H, H, H);
  grad2.addColorStop(0, 'rgba(0,0,0,0)');
  grad2.addColorStop(0.72, 'rgba(0,0,0,0)');
  grad2.addColorStop(1, 'rgba(0,0,0,1)');
  ctx2.globalCompositeOperation = 'destination-out';
  ctx2.fillStyle = grad2;
  ctx2.fillRect(0, 0, S, S);
  ctx2.globalCompositeOperation = 'source-over';
  const fissures = registerTexture(toTex(c2), { repeat: 'clamp', note: 'lava fissure crack network' });
  return { scorch, fissures };
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAllTextures() {
  const ground = createGroundTextures();
  return {
    groundDiffuse: ground.diffuse,
    groundBump: ground.bump,
    lavaTile: createLavaTileTexture(),
    crust: createCrustTexture(),
    fire: createFireTexture(),
    ember: createEmberSprite(),
    flame: createFlameSprite(),
    smoke: createSmokeSprite(),
    dust: createDustSprite(),
    runeOuter: createRuneRingTexture({ glyphs: 26, band: [0.84, 0.97], seed: 11 }),
    runeInner: createRuneRingTexture({ glyphs: 16, band: [0.72, 0.86], seed: 23 }),
    geometryRing: createGeometryRingTexture(7),
    coreSigil: createCoreSigilTexture(),
    floorGlow: createFloorGlowTexture(),
    skyCrack: createSkyCrackTexture(),
    shockRing: createShockRingTexture(),
    ...createScorchLavaDecalTexture()
  };
}
