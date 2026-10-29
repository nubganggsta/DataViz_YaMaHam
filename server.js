// Small localhost-only static server for the dashboard; no npm dependencies.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.resolve(__dirname);
const port = Number(process.env.DASHBOARD_PORT || 8000);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    const type = mime[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (file.endsWith('.json') && /gzip/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Dashboard available at http://127.0.0.1:${port}\n`);
});
