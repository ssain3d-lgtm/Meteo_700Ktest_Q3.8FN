// helper: wait until quality/report-<PHASE>.json appears (used while driving the gate manually)
import { readFile } from 'node:fs/promises';
const phase = (process.argv[2] || 'IDLE').toUpperCase();
const deadline = Date.now() + Number(process.argv[3] || 90000);
while (Date.now() < deadline) {
  try {
    const t = await readFile(`quality/report-${phase}.json`, 'utf8');
    console.log(t);
    process.exit(0);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
  }
}
console.log('TIMEOUT: no report for ' + phase);
process.exit(1);
