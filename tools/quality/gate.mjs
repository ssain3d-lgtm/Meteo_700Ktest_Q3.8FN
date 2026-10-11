// Quality gate runner: starts the local server, drives the in-browser gate per phase
// (Playwright when available, otherwise waits for a manually opened page), prints a
// PASS / WARN / FAIL / NOT TESTED table.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 8792);
const args = process.argv.slice(2);
const staticOnly = args.includes('--static-only');
const updateBaseline = args.includes('--update-baseline');
const noBrowser = args.includes('--no-browser');
const onlyPhase = (() => {
  const i = args.indexOf('--phase');
  return i >= 0 ? args[i + 1]?.toUpperCase() : null;
})();

const PHASES = onlyPhase ? [onlyPhase] : ['IDLE', 'SUMMON', 'CHARGE', 'SKY_WARNING', 'DESCENT', 'IMPACT', 'AFTERMATH', 'DISSIPATE'];

// ---------- static checks (no GPU needed) ----------
async function staticChecks() {
  const findings = [];
  const files = {
    postfx: await readFile(join(root, 'src/effects/postfx.js'), 'utf8'),
    textures: await readFile(join(root, 'src/assets/proceduralTextures.js'), 'utf8')
  };
  const need = [
    ['HalfFloatType', files.postfx, 'HDR render target'],
    ['samples:', files.postfx, 'MSAA samples on composer target'],
    ['OutputPass', files.postfx, 'OutputPass at end of chain'],
    ['UnrealBloomPass', files.postfx, 'bloom pass present']
  ];
  for (const [needle, hay, what] of need) {
    findings.push({ check: `static:${what}`, status: hay.includes(needle) ? 'PASS' : 'FAIL' });
  }
  findings.push({
    check: 'static:canvas antialias disabled when composer is used',
    status: /antialias:\s*false/.test(files.postfx) || /antialias:\s*false/.test(await readFile(join(root, 'src/main.js'), 'utf8')) ? 'PASS' : 'WARN'
  });
  findings.push({ check: 'static:wrapTile helper present', status: files.textures.includes('export function wrapTile') ? 'PASS' : 'FAIL' });
  findings.push({ check: 'static:periodic fbm for repeating textures', status: files.textures.includes('periodicNoise') ? 'PASS' : 'FAIL' });
  const shaders = await readFile(join(root, 'src/effects/glslCommon.js'), 'utf8');
  findings.push({ check: 'static:shared noise chunk', status: shaders.includes('fbm3') ? 'PASS' : 'FAIL' });
  return findings;
}

// ---------- browser driving ----------
async function tryPlaywright() {
  try {
    const mod = await import('playwright');
    return mod.chromium ? mod.chromium : mod.default?.chromium ?? null;
  } catch {
    return null;
  }
}

async function runWithPlaywright(chromium) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const reports = [];
  for (const phase of PHASES) {
    const url = `http://127.0.0.1:${port}/index.html?gate=1&once=1&phase=${phase}`;
    console.log(`[GATE] ${phase} <- ${url}`);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    const deadline = Date.now() + 180000;
    let report = null;
    while (Date.now() < deadline) {
      try {
        report = await readFile(join(root, 'quality', `report-${phase}.json`), 'utf8').then(JSON.parse);
        break;
      } catch {
        await page.waitForTimeout(1000);
      }
    }
    if (!report) console.log(`[GATE] ${phase}: no report received`);
    else reports.push(report);
  }
  await browser.close();
  return reports;
}

async function waitForManualReports() {
  console.log('');
  console.log('Playwright is not installed as a node module. Open these URLs one by one:');
  for (const phase of PHASES) console.log(`  http://127.0.0.1:${port}/index.html?gate=1&once=1&phase=${phase}`);
  console.log('Waiting for quality/report-*.json ... (max 5 min)');
  const deadline = Date.now() + 300000;
  const reports = [];
  while (Date.now() < deadline && reports.length < PHASES.length) {
    for (const phase of PHASES) {
      if (reports.some((r) => r.phase === phase)) continue;
      try {
        const r = await readFile(join(root, 'quality', `report-${phase}.json`), 'utf8');
        reports.push(JSON.parse(r));
        console.log(`[GATE] got ${phase}`);
      } catch { /* not yet */ }
    }
    if (reports.length < PHASES.length) await new Promise((r) => setTimeout(r, 2000));
  }
  return reports;
}

function printTable(findings, reports) {
  const rows = [];
  for (const f of findings) rows.push([f.check, '', f.status, '']);
  for (const rep of reports) {
    for (const c of rep.checks) {
      const detail = Object.entries(c)
        .filter(([k]) => k !== 'id' && k !== 'status')
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join(' ');
      rows.push([c.id, rep.phase, c.status, detail]);
    }
  }
  const w = [8, 11, 10, 0].map((n, i) => Math.max(n, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join(' | ');
  console.log('');
  console.log(line(['CHECK', 'PHASE', 'STATUS', 'DETAIL']));
  console.log(w.map((n) => '-'.repeat(n)).join('-+-'));
  for (const r of rows) console.log(line(r));
  const counts = { PASS: 0, WARN: 0, FAIL: 0, 'NOT TESTED': 0 };
  for (const r of rows) counts[r[2]] = (counts[r[2]] ?? 0) + 1;
  console.log('');
  console.log(`Summary: PASS=${counts.PASS ?? 0} WARN=${counts.WARN ?? 0} FAIL=${counts.FAIL ?? 0} NOT_TESTED=${counts['NOT TESTED'] ?? 0}`);
}

async function main() {
  console.log('[GATE] start');
  const findings = staticOnly ? await staticChecks() : await staticChecks();
  if (staticOnly) {
    printTable(findings, []);
    return;
  }

  const server = spawn(process.execPath, [join(root, 'tools/serve.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) } });
  server.stdout.on('data', (d) => process.stdout.write('[server] ' + d));
  server.stderr.on('data', (d) => process.stderr.write('[server:err] ' + d));
  await new Promise((r) => setTimeout(r, 1200));

  let reports = [];
  try {
    if (noBrowser) {
      reports = await waitForManualReports();
    } else {
      const chromium = await tryPlaywright();
      reports = chromium ? await runWithPlaywright(chromium) : await waitForManualReports();
    }
  } finally {
    server.kill();
  }

  if (updateBaseline) {
    await mkdir(join(root, 'quality'), { recursive: true });
    for (const rep of reports) {
      const e1 = rep.checks.find((c) => c.id === 'E1');
      if (e1) await writeFile(join(root, 'quality', `baseline-${rep.phase}.json`), JSON.stringify({ phase: rep.phase, meanLuma: e1.meanLuma }, null, 2));
    }
    console.log(`[GATE] baseline written for ${reports.length} phases`);
  }

  printTable(findings, reports);
  console.log('[GATE] done');
}

main().catch((e) => { console.error(e); process.exit(1); });
