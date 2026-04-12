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

const EXPERIMENTED_BASE_TYPES = new Set([
  // One-Hand Axes
  'Disapprobation Axe', 'Psychotic Axe',
  // Two-Hand Axes
  'Honed Cleaver', 'Apex Cleaver',
  // Bows
  'Foundry Bow', 'Solarine Bow',
  // Claws
  'Malign Fangs', 'Void Fangs',
  // Daggers (generic)
  'Pressurised Dagger', 'Pneumatic Dagger',
  // Daggers (rune)
  'Flashfire Blade', 'Infernal Blade',
  // One-Hand Maces
  'Crack Mace', 'Boom Mace',
  // Two-Hand Maces
  'Crushing Force Magnifier', 'Impact Force Propagator',
  // Sceptres
  'Oscillating Sceptre', 'Stabilising Sceptre', 'Alternating Sceptre',
  // Staves
  'Reciprocation Staff', 'Battery Staff',
  // War Staves
  'Potentiality Rod', 'Eventuality Rod',
  // One-Hand Swords
  'Capricious Spiritblade', 'Anarchic Spiritblade',
  // Two-Hand Swords
  'Blasting Blade', 'Banishing Blade',
  // Wands
  'Congregator Wand', 'Accumulator Wand',
  // Shields (Str)
  'Magmatic Tower Shield', 'Heat-attuned Tower Shield',
  // Shields (Dex)
  'Polar Buckler', 'Cold-attuned Buckler',
  // Shields (Int)
  'Subsuming Spirit Shield', 'Transfer-attuned Spirit Shield',
  // Belts
  'Micro-Distillery Belt', 'Mechanical Belt',
  // Amulets
  'Focused Amulet', 'Simplex Amulet', 'Astrolabe Amulet',
  // Rings
  'Cogwork Ring', 'Composite Ring', 'Geodesic Ring',
  'Helical Ring', 'Manifold Ring', 'Ratcheting Ring',
]);

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

  // Experimented base types data
  if (pathname === '/api/experimented') {
    const league = parsedUrl.query.league;
    if (!league) { res.writeHead(400); res.end(JSON.stringify({ error: 'missing league' })); return; }

    const cachePath = path.join(CACHE_DIR, 'exp_' + league.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');

    try {
      if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (Date.now() - cached.timestamp < CACHE_TTL) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ ...cached, fromCache: true }));
          return;
        }
      }
    } catch (e) {}

    (async () => {
      try {
        const data = await fetchJson(
          `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=BaseType`
        );

        const EXP_CATEGORY = t => {
          if (['One Handed Sword','One Handed Axe','One Handed Mace','Dagger','Claw','Wand','Sceptre'].includes(t)) return '1H Weapon';
          if (['Two Handed Sword','Two Handed Axe','Two Handed Mace','Staff','War Staff','Bow'].includes(t)) return '2H Weapon';
          if (t === 'Shield') return 'Armour';
          if (['Belt','Ring','Amulet'].includes(t)) return 'Accessory';
          return 'Other';
        };

        const items = (data.lines || [])
          .filter(item => EXPERIMENTED_BASE_TYPES.has(item.name) && !item.variant && (item.levelRequired === 83 || item.levelRequired === 84))
          .map(item => ({ ...item, _category: EXP_CATEGORY(item.itemType) }));

        const payload = { timestamp: Date.now(), items, errors: [] };
        try { fs.writeFileSync(cachePath, JSON.stringify(payload)); } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ...payload, fromCache: false }));
      } catch (e) {
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    })().catch(e => { res.writeHead(500); res.end(JSON.stringify({ error: e.message })); });
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
