// Local dev server: `node dev/server.mjs` -> http://localhost:5173
// Serves the app and a mock /proxy backed by dev/fixtures/<pair>/<term>.html.
// Unknown terms get HTTP 502 so the Wiktionary fallback path can be exercised too.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURES = path.join(ROOT, 'dev', 'fixtures');
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1'; // HOST=0.0.0.0 to open it from a phone on the same Wi-Fi
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/proxy') {
      const pair = (url.searchParams.get('pair') || '').replace(/[^a-z]/g, '');
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const file = path.join(FIXTURES, pair, `${q}.html`);
      setTimeout(() => {
        if (file.startsWith(FIXTURES) && fs.existsSync(file)) {
          res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Access-Control-Allow-Origin': '*' });
          fs.createReadStream(file).pipe(res);
        } else {
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'upstream_unavailable', note: 'no fixture for this term' }));
        }
      }, 250); // simulate network latency
      return;
    }

    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || rel.includes('/dev/') || rel.includes('/worker/')) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  })
  .listen(PORT, HOST, () => console.log(`Tureng Mobile dev server: http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
