const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

function proxyGet(targetUrl, res, redirects = 0) {
  if (redirects > 5) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Too many redirects' }));
    return;
  }
  https.get(targetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (poe-replica-tracker)',
      'Accept': 'application/json',
    }
  }, (proxyRes) => {
    if ((proxyRes.statusCode === 301 || proxyRes.statusCode === 302) && proxyRes.headers.location) {
      proxyRes.resume();
      const location = proxyRes.headers.location;
      const next = location.startsWith('http') ? location : `https://poe.ninja${location}`;
      proxyGet(next, res, redirects + 1);
      return;
    }
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  }).on('error', (err) => {
    res.writeHead(502);
    res.end(JSON.stringify({ error: err.message }));
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname.startsWith('/api/poeninja/')) {
    const query = parsedUrl.search || '';
    proxyGet(`https://poe.ninja/poe1/api/economy/stash/current/item/overview${query}`, res);
    return;
  }

  if (pathname === '/api/leagues') {
    proxyGet('https://www.pathofexile.com/api/trade/data/leagues', res);
    return;
  }

  // Serve static files
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath);
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`PoE Replica Tracker běží na http://localhost:${PORT}`);
});
