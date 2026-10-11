// In-browser render quality gate.
// Measured (not assumed): A1 texture seams, B1 NaN/Inf in the HDR target, C1 MSAA samples,
// C2 composer chain, C4 bloom on/off black-patch flicker, C5 anisotropy, D1 decal clearance,
// E1 frame-to-frame regression + black-square blobs, F1 console errors.
// C3 (grain delta) is NOT TESTED: this project has no film-grain pass.
import { textureRegistry } from '../assets/proceduralTextures.js';
import { DECAL_CLEARANCE } from '../effects/crater.js';

const PHASE_SEQ = ['IDLE', 'SUMMON', 'CHARGE', 'SKY_WARNING', 'DESCENT', 'IMPACT', 'AFTERMATH', 'DISSIPATE'];

function halfIsBad(u16) {
  const exp = (u16 >> 10) & 0x1f;
  if (exp === 0x1f) return (u16 & 0x3ff) === 0 ? 'inf' : 'nan';
  return null;
}

export function installGate(app) {
  const errors = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); origError.apply(console, a); };
  console.warn = (...a) => { errors.push('WARN ' + a.map(String).join(' ')); origWarn.apply(console, a); };
  window.addEventListener('error', (e) => errors.push(String(e.message)));

  const renderer = app.renderer;
  const gl = renderer.getContext();
  const composer = app.postfx.composer;

  function grab() {
    app.postfx.render();
    const size = renderer.getDrawingBufferSize(new app.THREE.Vector2());
    const w = size.x, h = size.y;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return { buf, w, h };
  }

  // ---- A1: seam discontinuity of repeating textures ----
  function checkSeams() {
    const results = [];
    for (const entry of textureRegistry) {
      if (entry.repeat !== 'repeat') continue;
      const img = entry.tex.image;
      if (!img || !img.getContext) continue;
      const w = img.width, h = img.height;
      const ctx = img.getContext('2d');
      const data = ctx.getImageData(0, 0, w, h).data;
      const px = (x, y) => {
        const i = (y * w + x) * 4;
        return (data[i] + data[i + 1] + data[i + 2]) / 3;
      };
      let edgeH = 0, edgeV = 0;
      for (let y = 0; y < h; y++) edgeH += Math.abs(px(0, y) - px(w - 1, y));
      edgeH /= h;
      for (let x = 0; x < w; x++) edgeV += Math.abs(px(x, 0) - px(x, h - 1));
      edgeV /= w;
      // Interior reference: the mean adjacent-pixel difference of EVERY column.
      // Sampling a sparse subset gives a noisy baseline and produces false seams.
      let colSum = 0, colMax = 0;
      for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let y = 0; y < h; y++) s += Math.abs(px(x, y) - px(x + 1, y));
        s /= h;
        colSum += s;
        if (s > colMax) colMax = s;
      }
      const interior = colSum / (w - 2);
      const edge = Math.max(edgeH, edgeV);
      const ratio = edge / Math.max(0.5, interior);
      // A real seam is worse than the worst interior column, not just worse than the mean.
      let status = 'PASS';
      if (edge >= 8 || edge > colMax * 1.6) status = 'FAIL';
      else if (edge >= 3 || ratio >= 2) status = 'WARN';
      results.push({ id: 'A1', texture: entry.note, edgeDiff: +edge.toFixed(3), interiorDiff: +interior.toFixed(3), worstInteriorDiff: +colMax.toFixed(3), ratio: +ratio.toFixed(3), status });
    }
    return results;
  }

  // ---- B1: NaN / Inf in the HDR pipeline ----
  // The composer targets are multisampled, and readPixels on a multisampled FBO returns
  // zeros, so the scene is re-rendered into an identical HalfFloat target WITHOUT MSAA
  // and measured there. Bloom-induced black patches are covered separately by C4.
  function checkNaN() {
    const THREE = app.THREE;
    const w = 640, h = 360;
    const probe = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(probe);
    renderer.render(app.scene, app.camera);
    const buf = new Uint16Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.HALF_FLOAT, buf);
    renderer.setRenderTarget(null);
    probe.dispose();

    let nan = 0, inf = 0, maxFinite = 0;
    for (let i = 0; i < buf.length; i++) {
      const kind = halfIsBad(buf[i]);
      if (kind === 'nan') nan++;
      else if (kind === 'inf') inf++;
      else {
        const v = halfToFloat(buf[i]);
        if (v > maxFinite) maxFinite = v;
      }
    }
    const status = nan > 0 || inf > 0 ? 'FAIL' : 'PASS';
    return [{ id: 'B1', target: 'scene HDR (HalfFloat, non-MSAA probe)', nan, inf, maxFinite: +maxFinite.toFixed(2), headroom65504: +(65504 - maxFinite).toFixed(2), status }];
  }

  function halfToFloat(h) {
    const sign = (h >> 15) & 1 ? -1 : 1;
    const exp = (h >> 10) & 0x1f;
    const frac = h & 0x3ff;
    if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
    return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
  }

  // ---- C1 / C2 / C5 ----
  function checkPipeline() {
    renderer.setRenderTarget(composer.renderTarget1);
    const samples = gl.getParameter(gl.SAMPLES);
    renderer.setRenderTarget(null);
    const rtType = composer.renderTarget1.texture.type;
    const passes = composer.passes.map((p) => p.constructor.name);
    const hasRender = passes[0] === 'RenderPass';
    const hasOutput = passes[passes.length - 1] === 'OutputPass';
    const hasBloom = passes.includes('UnrealBloomPass');
    const c2 = hasRender && hasOutput && hasBloom ? 'PASS' : 'FAIL';
    const c1 = samples >= 2 && rtType === app.THREE.HalfFloatType ? 'PASS' : 'FAIL';

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    let worst = Infinity, worstName = '';
    for (const entry of textureRegistry) {
      if (entry.tex.anisotropy < worst) { worst = entry.tex.anisotropy; worstName = entry.note; }
    }
    const c5 = worst >= maxAniso / 2 ? 'PASS' : 'FAIL';
    return [
      { id: 'C1', samples, renderTargetType: rtType === app.THREE.HalfFloatType ? 'HalfFloat' : String(rtType), status: c1 },
      { id: 'C2', passes, status: c2 },
      { id: 'C5', maxAnisotropy: maxAniso, worstTextureAnisotropy: worst, worstTexture: worstName, status: c5 }
    ];
  }

  // ---- C4: bloom on/off comparison -> black patches introduced by bloom ----
  function checkBloomFlicker() {
    const bloom = app.postfx.bloomPass;
    bloom.enabled = true;
    const a1 = grab();
    const a2 = grab();
    bloom.enabled = false;
    const b1 = grab();
    bloom.enabled = true;

    let nondeterministic = 0, darkPatches = 0;
    const n = a1.buf.length;
    for (let i = 0; i < n; i += 4) {
      const d1 = Math.abs(a1.buf[i] - a2.buf[i]) + Math.abs(a1.buf[i + 1] - a2.buf[i + 1]) + Math.abs(a1.buf[i + 2] - a2.buf[i + 2]);
      if (d1 > 24) nondeterministic++;
      const lumA = (a1.buf[i] + a1.buf[i + 1] + a1.buf[i + 2]) / 3;
      const lumB = (b1.buf[i] + b1.buf[i + 1] + b1.buf[i + 2]) / 3;
      if (lumB > 24 && lumA < lumB - 40) darkPatches++;
    }
    return [{ id: 'C4', nondeterministicTexels: nondeterministic, bloomDarkenedTexels: darkPatches, status: darkPatches > 0 ? 'FAIL' : 'PASS' }];
  }

  // ---- D1: decal clearance above the deformed ground ----
  function checkClearance() {
    const crater = app.crater;
    if (crater.progress <= 0) {
      return [{ id: 'D1', status: 'NOT TESTED', reason: 'crater not formed in this phase' }];
    }
    const gGeo = crater.ground.geometry;
    const gPos = gGeo.attributes.position.array;
    const seg = 180, size = 240, cell = size / seg;
    const groundY = (x, z) => {
      const fx = (x + size / 2) / cell, fz = (z + size / 2) / cell;
      const ix = Math.min(seg, Math.max(0, Math.floor(fx))), iz = Math.min(seg, Math.max(0, Math.floor(fz)));
      const tx = fx - ix, tz = fz - iz;
      const idx = (a, b) => (b * (seg + 1) + a) * 3;
      const y00 = gPos[idx(ix, iz) + 1], y10 = gPos[idx(ix + 1, iz) + 1];
      const y01 = gPos[idx(ix, iz + 1) + 1], y11 = gPos[idx(ix + 1, iz + 1) + 1];
      return y00 + (y10 - y00) * tx + (y01 - y00) * tz + (y00 - y10 - y01 + y11) * tx * tz;
    };
    let minClearance = Infinity, worstAt = null, worstSurface = null;
    const targets = [
      { mesh: crater.scorch, label: 'scorch' },
      { mesh: crater.fissure, label: 'fissure' },
      { mesh: app.lava.pool, label: 'lavaPool' }
    ];
    for (const { mesh, label } of targets) {
      const pos = mesh.geometry.attributes.position.array;
      const sx = mesh.scale.x;
      const sy = mesh.scale.y;
      for (let i = 0; i < pos.length; i += 3) {
        const wx = pos[i] * sx + mesh.position.x;
        const wz = pos[i + 2] * sx + mesh.position.z;
        // WORLD y: the conforming code writes terrain heights into local Y, so the
        // object's Y scale must be applied here too. Ignoring it let a decal that was
        // hundreds of units underground report a healthy clearance.
        const wy = pos[i + 1] * sy + mesh.position.y;
        const clearance = wy - groundY(wx, wz);
        if (clearance < minClearance) {
          minClearance = clearance;
          worstAt = [+wx.toFixed(2), +wz.toFixed(2)];
          worstSurface = label;
        }
      }
    }
    const status = minClearance < 0.15 ? 'FAIL' : (minClearance < 0.2 ? 'WARN' : 'PASS');
    return [{ id: 'D1', minClearance: +minClearance.toFixed(4), configured: DECAL_CLEARANCE, worstAt, worstSurface, status }];
  }

  // ---- E1: fixed-camera regression + black square blobs ----
  function checkRegression(baseline) {
    const f1 = grab();
    const f2 = grab();
    let flicker = 0;
    const n = f1.buf.length;
    for (let i = 0; i < n; i += 4) {
      const d = Math.abs(f1.buf[i] - f2.buf[i]) + Math.abs(f1.buf[i + 1] - f2.buf[i + 1]) + Math.abs(f1.buf[i + 2] - f2.buf[i + 2]);
      if (d > 18) flicker++;
    }
    // A black-patch artifact is a solid near-black rectangle EMBEDDED in bright
    // content. A plain dark background is not an artifact, so the ring just outside
    // the candidate must be clearly lit.
    const { w, h, buf } = f1;
    const luma = (px) => (buf[px * 4] + buf[px * 4 + 1] + buf[px * 4 + 2]) / 3;
    const ringMean = (x, y, side) => {
      let sum = 0, n = 0;
      const g = 3;
      for (let i = 0; i <= side; i += 2) {
        for (const [sx, sy] of [[x + i, y - g], [x + i, y + side + g], [x - g, y + i], [x + side + g, y + i]]) {
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) return -1;
          sum += luma(sy * w + sx); n++;
        }
      }
      return sum / Math.max(1, n);
    };
    let blackSquares = 0;
    const blobs = [];
    const MIN_SIDE = 12;
    for (let y = 0; y + MIN_SIDE + 3 <= h; y += 3) {
      for (let x = 0; x + MIN_SIDE + 3 <= w; x += 3) {
        let solid = true;
        let innerSum = 0;
        for (let dy = 0; dy < MIN_SIDE && solid; dy++) {
          for (let dx = 0; dx < MIN_SIDE; dx++) {
            const l = luma((y + dy) * w + (x + dx));
            if (l >= 3) { solid = false; break; }
            innerSum += l;
          }
        }
        if (!solid) continue;
        const surround = ringMean(x, y, MIN_SIDE);
        // A rendering artifact is a VOID: essentially zero inside, clearly lit outside.
        // Dark regions of a dim scene are not artifacts.
        if (surround > 60) {
          blackSquares++;
          if (blobs.length < 8) {
            blobs.push({ x, y, innerMean: +(innerSum / (MIN_SIDE * MIN_SIDE)).toFixed(2), surroundMean: +surround.toFixed(1) });
          }
          x += MIN_SIDE * 3; // count one blob, not every offset inside it
        }
      }
    }
    let mean = 0;
    for (let i = 0; i < n; i += 4) mean += (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
    mean /= (w * h);
    const status = flicker > 0 || blackSquares > 0 ? 'FAIL' : 'PASS';
    const out = [{ id: 'E1', flickerTexels: flicker, blackSquareBlobs: blackSquares, blobSamples: blobs, meanLuma: +mean.toFixed(3), status }];
    if (baseline && typeof baseline.meanLuma === 'number') {
      const drift = Math.abs(mean - baseline.meanLuma) / Math.max(1e-6, baseline.meanLuma);
      out[0].baselineDrift = +drift.toFixed(4);
      if (drift > 0.12) out[0].status = 'WARN';
    }
    return out;
  }

  // Drive the state machine with DETERMINISTIC simulation steps, not rAF counts.
  // THREE.Timer zeroes its delta while the tab is hidden, so waiting on frames can
  // measure a phase that never actually happened (skill rule: measure AFTER the phase
  // is reached and pinned).
  const HOLD = { IDLE: 0, SUMMON: 1.2, CHARGE: 2.4, SKY_WARNING: 1.8, DESCENT: 0.8, IMPACT: 0.12, AFTERMATH: 2.0, DISSIPATE: 2.0 };

  function driveTo(phase) {
    app.audio.enabled = false;
    app.pause(true);          // the gate owns time from here on
    app.reset();
    app.sm.auto = false;
    const targetIdx = PHASE_SEQ.indexOf(phase);
    if (targetIdx < 0) throw new Error('unknown phase ' + phase);

    let i = PHASE_SEQ.indexOf(app.sm.phase);
    let guard = 0;
    while (i < targetIdx && guard++ < 16) {
      const next = PHASE_SEQ[i + 1];
      app.setPhase(next);
      if (next === 'DESCENT') {
        if (targetIdx === i + 1) { i = targetIdx; break; }
        // step until the rock lands; the machine advances to IMPACT on its own
        for (let k = 0; k < 4000 && app.sm.phase === 'DESCENT'; k++) app.step(1 / 60);
      } else {
        app.advance(0.5);
      }
      const now = PHASE_SEQ.indexOf(app.sm.phase);
      if (now < 0) throw new Error('state machine left the phase list: ' + app.sm.phase);
      i = now;
    }
    if (app.sm.phase !== phase) app.setPhase(phase);
    if (HOLD[phase]) app.advance(HOLD[phase]);
  }

  async function runPhase(phase) {
    const checks = [];
    let driveError = null;
    const savedDuration = app.director.duration;
    const savedElapsed = app.director.elapsed;
    const savedTracking = app.director.tracking;
    const savedBase = app.shake.base;
    try {
      driveTo(phase);
      // pin the camera so E1 is deterministic
      app.director.pin();
      app.shake.rotation.x = 0; app.shake.rotation.y = 0; app.shake.rotation.z = 0;
      app.shake.position.x = 0; app.shake.position.y = 0; app.shake.position.z = 0;
      app.shake.impulse = 0;
      app.shake.base = 0;

      let baseline = null;
      try {
        const r = await fetch(`/quality/baseline-${phase}.json`);
        if (r.ok) baseline = await r.json();
      } catch { /* no baseline */ }

      for (const [name, fn] of [
        ['A1', checkSeams], ['B1', checkNaN], ['C1/C2/C5', checkPipeline],
        ['C4', checkBloomFlicker], ['D1', checkClearance], ['E1', () => checkRegression(baseline)]
      ]) {
        try {
          checks.push(...fn());
        } catch (e) {
          checks.push({ id: name.split('/')[0], status: 'NOT TESTED', reason: String(e.message || e) });
        }
      }
    } catch (e) {
      driveError = String(e.message || e);
      checks.push({ id: 'GATE', status: 'NOT TESTED', reason: 'phase drive failed: ' + driveError });
    }

    checks.push({ id: 'C3', status: 'NOT TESTED', reason: 'no film-grain pass in this project' });
    checks.push({ id: 'F1', errors: errors.slice(0, 20), errorCount: errors.length, status: errors.some((e) => !e.startsWith('WARN')) ? 'FAIL' : 'PASS' });

    app.director.duration = savedDuration;
    app.director.elapsed = savedElapsed;
    app.director.tracking = savedTracking;
    app.shake.base = savedBase;
    app.pause(false);

    const report = { phase, driveError, checks, generatedAt: new Date().toISOString() };
    try {
      await fetch('/__quality-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
    } catch (e) {
      console.warn('report post failed', e);
    }
    window.__gateReport = report;
    return report;
  }

  async function runSequence() {
    const q = new URLSearchParams(location.search);
    const phase = q.get('phase') || 'IDLE';
    const once = q.get('once') === '1';
    await runPhase(phase);
    if (!once) {
      const i = PHASE_SEQ.indexOf(phase);
      if (i >= 0 && i < PHASE_SEQ.length - 1) {
        location.href = `${location.pathname}?gate=1&phase=${PHASE_SEQ[i + 1]}`;
      }
    }
  }

  return { runPhase, runSequence, checks: { checkSeams, checkNaN, checkPipeline, checkBloomFlicker, checkClearance, checkRegression } };
}
