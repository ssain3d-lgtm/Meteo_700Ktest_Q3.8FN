// Minimal dependency-free static server for the demo (also receives quality reports).
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT || 8792);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);

  if (req.method === 'POST' && url.pathname === '/__quality-report') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const report = JSON.parse(body);
        const phase = String(report.phase || 'UNKNOWN').replace(/[^A-Z0-9_]/gi, '').toUpperCase() || 'UNKNOWN';
        await mkdir(join(root, 'quality'), { recursive: true });
        await writeFile(join(root, 'quality', `report-${phase}.json`), JSON.stringify(report, null, 2));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, phase }));
        console.log(`[GATE] report ${phase} received`);
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(root, rel);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
  if (rel === '/' || rel === '\\') filePath = join(root, 'index.html');

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // A missing baseline is an expected state, not an error: answer 200 so the
    // browser console stays clean and F1 measures real faults only.
    if (rel.replace(/\\/g, '/').startsWith('/quality/baseline-')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(port, () => {
  console.log(`[SERVE] http://127.0.0.1:${port}/index.html`);
});
