const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

try { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR); } catch (e) { console.warn('Cache dir unavailable:', e.message); }

const CATEGORIES = ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel'];

function fetchJson(targetUrl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (poe-replica-tracker)', 'Accept': 'application/json' }
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        res.resume();
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `https://poe.ninja${res.headers.location}`;
        return resolve(fetchJson(next, redirects + 1));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    }).on('error', reject);
  });
}

function getCachePath(league) {
  return path.join(CACHE_DIR, league.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
}

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // League list proxy
  if (pathname === '/api/leagues') {
    fetchJson('https://www.pathofexile.com/api/trade/data/leagues')
      .then(data => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(data));
      })
      .catch(e => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  // Cache status (lightweight, no fetching)
  if (pathname === '/api/cache-status') {
    const league = parsedUrl.query.league;
    if (!league) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing league' })); return; }
    const cachePath = getCachePath(league);
    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        const fresh = Date.now() - cached.timestamp < CACHE_TTL;
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ timestamp: cached.timestamp, fresh }));
        return;
      }
    } catch (e) { }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ timestamp: null, fresh: false }));
    return;
  }

  // Data endpoint with file cache
  if (pathname === '/api/data') {
    const league = parsedUrl.query.league;
    if (!league) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing league' })); return; }

    const cachePath = getCachePath(league);

    // Serve from cache if fresh
    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ...cached, fromCache: true }));
          return;
        }
      }
    } catch (e) { /* stale or corrupt cache — fetch fresh */ }

    // Fetch fresh data from poe.ninja
    (async () => {
      const items = [];
      const errors = [];

      await Promise.all(CATEGORIES.map(async cat => {
        try {
          const data = await fetchJson(
            `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${cat}`
          );
          (data.lines || []).forEach(item => {
            if (item.name && item.name.includes('Replica')) {
              item._category = cat;
              items.push(item);
            }
          });
        } catch (e) {
          errors.push(`${cat}: ${e.message}`);
        }
      }));

      const payload = { timestamp: Date.now(), items, errors };
      try { fs.writeFileSync(cachePath, JSON.stringify(payload)); } catch (e) { }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ...payload, fromCache: false }));
    })().catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
    return;
  }

  // Static files
  const filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`PoE Replica Tracker running on http://localhost:${PORT}`);
});
