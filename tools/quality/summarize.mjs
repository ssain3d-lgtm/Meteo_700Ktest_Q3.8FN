// Wait for all phase reports and print a compact table (used when the browser is driven manually).
import { readFile } from 'node:fs/promises';
const PHASES = ['IDLE', 'SUMMON', 'CHARGE', 'SKY_WARNING', 'DESCENT', 'IMPACT', 'AFTERMATH', 'DISSIPATE'];
const deadline = Date.now() + Number(process.argv[2] || 300000);
const reports = [];
while (Date.now() < deadline) {
  for (const p of PHASES) {
    if (reports.some((r) => r.phase === p)) continue;
    try {
      reports.push(JSON.parse(await readFile(`quality/report-${p}.json`, 'utf8')));
    } catch { /* not yet */ }
  }
  if (reports.length === PHASES.length) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const rows = [];
for (const rep of reports) {
  for (const c of rep.checks) {
    const detail = Object.entries(c).filter(([k]) => k !== 'id' && k !== 'status')
      .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    rows.push([c.id, rep.phase, c.status, detail]);
  }
}
const cols = [0, 1, 2, 3];
const w = cols.map((i) => Math.max(6, ...rows.map((r) => String(r[i] ?? '').length)));
const line = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join(' | ');
console.log(line(['CHECK', 'PHASE', 'STATUS', 'DETAIL']));
console.log(w.map((n) => '-'.repeat(n)).join('-+-'));
for (const r of rows) console.log(line(r));
const counts = {};
for (const r of rows) counts[r[2]] = (counts[r[2]] ?? 0) + 1;
console.log('');
console.log('phases reported:', reports.map((r) => r.phase).join(','));
console.log('counts:', JSON.stringify(counts));
if (reports.length < PHASES.length) console.log('MISSING:', PHASES.filter((p) => !reports.some((r) => r.phase === p)).join(','));
