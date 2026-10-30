/* Fotbollsspelet – server
   Kör med:  node server.js   (Node 18 eller nyare, inga paket behövs)
   Öppna sedan http://localhost:3000 – kompisar på samma nätverk använder datorns IP-adress. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FB = require('./docs/js/shared.js');
const G = require('./docs/js/logic.js');

const PORT = +process.env.PORT || 3000;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'docs'); // webbsidan – samma mapp som GitHub Pages publicerar
// DATA_DIR = mapp för sparad data. På en webbhost: peka den mot en permanent disk (volym),
// så att konton och ändringar i spelardokumentet finns kvar när servern startas om.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CSV_FILE = process.env.DATA_DIR ? path.join(DATA_DIR, 'spelare.csv') : path.join(PUB, 'spelare.csv');
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CSV_FILE)) fs.copyFileSync(path.join(PUB, 'spelare.csv'), CSV_FILE);
} catch (e) {
  console.error('Kunde inte förbereda datamappen:', e.message);
}

// ------------------------------------------------------------------ lagring
let db = { users: {}, sessions: {}, market: [], marketHistory: [], seq: 1 };
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
} catch (e) {
  console.error('Kunde inte läsa databasen, startar med en tom:', e.message);
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
  }, 250);
}
const newUid = () => 'p' + (db.seq++).toString(36) + crypto.randomBytes(3).toString('hex');

// ------------------------------------------------------------ spelardokumentet
function readPlayersCsv() {
  try { return G.parsePlayersCsv(fs.readFileSync(CSV_FILE, 'utf8')); } catch (e) { return { comments: [], players: [] }; }
}
function writePlayersCsv(players) {
  fs.writeFileSync(CSV_FILE, G.formatPlayersCsv(players, readPlayersCsv().comments));
}

// ------------------------------------------------------------------ hjälp
const fail = G.fail;
const keyOf = name => String(name || '').trim().toLowerCase();
const { fixLineup, inbox, teamOvr, canRemove, addToSquad } = G;

function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }

function publicUser(u) {
  const { pin, ...rest } = u;
  return rest;
}

function userByToken(token) {
  const name = db.sessions[token];
  return name ? db.users[name] : null;
}

// Vem får ändra spelardokumentet? Ägaren (första kontot på servern) och de ägaren har gett tillåtelse.
const canEditDoc = u => !!u && (u.role === 'admin' || u.role === 'editor');
function ownerOf() { return Object.values(db.users).find(u => u.role === 'admin') || null; }
function ensureAdmin() {
  const forced = keyOf(process.env.ADMIN || '');
  if (forced && db.users[forced] && db.users[forced].role !== 'admin') { db.users[forced].role = 'admin'; save(); }
  const users = Object.values(db.users);
  if (users.length && !users.some(u => u.role === 'admin')) {
    users.sort((a, c) => (a.created || 0) - (c.created || 0))[0].role = 'admin';
    save();
  }
}

function createUser(name, pin, club) {
  const salt = crypto.randomBytes(12).toString('hex');
  const u = G.newProfile(name, club, newUid);
  u.pin = { salt, hash: hashPin(pin, salt) };
  u.role = Object.keys(db.users).length === 0 ? 'admin' : null;
  return u;
}

// --------------------------------------------------------------- marknaden
function marketMinBid(l) { return l.bid ? l.bid.amount + Math.max(10, Math.round(l.bid.amount * 0.05)) : l.start; }

function completeSale(l, buyerName, price) {
  const buyer = db.users[buyerName], seller = db.users[l.seller];
  db.market = db.market.filter(x => x !== l);
  l.status = 'sold'; l.buyer = buyerName; l.price = price; l.closed = Date.now();
  db.marketHistory.unshift(l); db.marketHistory = db.marketHistory.slice(0, 60);
  if (buyer) { addToSquad(buyer, l.player); inbox(buyer, `Du köpte ${l.player.name} för ${FB.formatCoins(price)} spelpengar.`); }
  if (seller) { seller.coins += price; inbox(seller, `${l.player.name} såldes till ${buyer ? buyer.club : 'okänd'} för ${FB.formatCoins(price)} spelpengar.`); }
}

function processMarket() {
  const now = Date.now();
  let changed = false;
  for (const l of db.market.slice()) {
    if (l.ends > now) continue;
    changed = true;
    if (l.bid) completeSale(l, l.bid.user, l.bid.amount);
    else {
      db.market = db.market.filter(x => x !== l);
      const seller = db.users[l.seller];
      if (seller) { addToSquad(seller, l.player); inbox(seller, `Ingen bjöd på ${l.player.name}. Han är tillbaka i din trupp.`); }
    }
  }
  if (changed) save();
}
setInterval(processMarket, 5000);

// ------------------------------------------------------------------ API
const loginFails = new Map();
const api = {
  'POST /api/register': (req, b) => {
    const name = String(b.name || '').trim(), pin = String(b.pin || ''), club = String(b.club || '').trim() || name + ' FC';
    G.checkName(name);
    if (!/^\d{4,8}$/.test(pin)) fail('PIN-koden ska vara 4–8 siffror.');
    G.checkClub(club);
    if (db.users[keyOf(name)]) fail('Det namnet är redan taget. Välj ett annat eller logga in.');
    const u = createUser(name, pin, club);
    db.users[keyOf(name)] = u;
    ensureAdmin();
    if (u.role === 'admin') inbox(u, 'Du äger spelet på den här servern. Bara du – och de du ger tillåtelse under Spelardokument – kan ändra spelardokumentet.');
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = keyOf(name);
    save();
    return { token, profile: publicUser(u) };
  },
  'POST /api/login': (req, b) => {
    // efter 5 fel PIN-koder i rad låses kontot i 10 minuter, så att ingen kan prova alla koder
    const k = keyOf(b.name), now = Date.now();
    const f = loginFails.get(k);
    if (f && f.until > now) fail(`För många fel PIN-koder. Försök igen om ${Math.ceil((f.until - now) / 60000)} minuter.`, 429);
    const u = db.users[k];
    if (!u || hashPin(String(b.pin || ''), u.pin.salt) !== u.pin.hash) {
      const n = (f && f.until <= now && f.until ? 0 : f ? f.count : 0) + 1;
      loginFails.set(k, { count: n, until: n >= 5 ? now + 10 * 60000 : 0 });
      fail(n >= 5 ? 'För många fel PIN-koder. Kontot är låst i 10 minuter.' : 'Fel namn eller PIN-kod.', 401);
    }
    loginFails.delete(k);
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[token] = keyOf(u.name);
    save();
    return { token, profile: publicUser(u) };
  },
  'POST /api/logout': (req, b, u, token) => { delete db.sessions[token]; save(); return { ok: true }; },
  'GET /api/profile': (req, b, u) => ({ profile: publicUser(u) }),

  // spelardokumentet
  'GET /api/players': () => ({ players: readPlayersCsv().players, owner: ownerOf() ? ownerOf().name : null }),
  'PUT /api/players': (req, b, u) => {
    if (!canEditDoc(u)) fail(`Bara ägaren av spelet${ownerOf() ? ` (${ownerOf().name})` : ''} och de som fått tillåtelse kan ändra spelardokumentet.`, 403);
    writePlayersCsv(G.cleanPlayers(b.players));
    return { players: readPlayersCsv().players };
  },
  'GET /api/doc/editors': (req, b, u) => {
    if (!u || u.role !== 'admin') fail('Bara ägaren kan se det här.', 403);
    const users = Object.values(db.users).sort((a, c) => a.name.localeCompare(c.name, 'sv'));
    return { users: users.map(x => ({ name: x.name, club: x.club, role: x.role || null })) };
  },
  'POST /api/doc/editors': (req, b, u) => {
    if (!u || u.role !== 'admin') fail('Bara ägaren kan ge eller ta bort tillåtelse.', 403);
    const t = db.users[keyOf(b.name)];
    if (!t) fail('Spelaren finns inte.');
    if (t.role === 'admin') fail('Ägaren har alltid tillåtelse.');
    t.role = b.allow ? 'editor' : null;
    inbox(t, b.allow ? `${u.name} har gett dig tillåtelse att ändra spelardokumentet.` : `${u.name} har tagit bort din tillåtelse att ändra spelardokumentet.`);
    save();
    const users = Object.values(db.users).sort((a, c) => a.name.localeCompare(c.name, 'sv'));
    return { users: users.map(x => ({ name: x.name, club: x.club, role: x.role || null })) };
  },

  // global marknad
  'GET /api/market': (req, b, u) => {
    processMarket();
    const view = l => ({
      id: l.id, seller: l.seller, sellerClub: l.sellerClub, player: l.player, start: l.start, buyNow: l.buyNow, ends: l.ends,
      bid: l.bid ? { amount: l.bid.amount, club: l.bid.club, mine: l.bid.user === keyOf(u.name) } : null,
      mine: l.seller === keyOf(u.name), minBid: marketMinBid(l),
    });
    const me = keyOf(u.name);
    const history = db.marketHistory.filter(l => l.seller === me || l.buyer === me).slice(0, 10)
      .map(l => ({ id: l.id, name: l.player.name, price: l.price, sold: l.seller === me, club: l.seller === me ? (db.users[l.buyer] || {}).club : l.sellerClub, closed: l.closed }));
    return { now: Date.now(), listings: db.market.slice().sort((a, c) => a.ends - c.ends).map(view), history };
  },
  'POST /api/market/list': (req, b, u) => {
    const p = u.squad.find(q => q.uid === b.uid);
    if (!p) fail('Spelaren finns inte i din trupp.');
    const why = canRemove(u, p);
    if (why) fail(why);
    const start = Math.round(+b.start || 0), buyNow = b.buyNow ? Math.round(+b.buyNow) : null;
    if (start < 50 || start > 1e6) fail('Utgångspriset ska vara minst 50.');
    if (buyNow != null && buyNow < start) fail('Köp nu-priset måste vara minst lika högt som utgångspriset.');
    const minutes = [5, 60, 360, 1440].includes(b.minutes | 0) ? b.minutes | 0 : 60;
    if (db.market.filter(l => l.seller === keyOf(u.name)).length >= 5) fail('Du kan ha högst 5 spelare ute till försäljning samtidigt.');
    u.squad = u.squad.filter(q => q !== p);
    fixLineup(u);
    const l = { id: crypto.randomBytes(5).toString('hex'), seller: keyOf(u.name), sellerClub: u.club, player: p, start, buyNow, bid: null, ends: Date.now() + minutes * 60000, created: Date.now() };
    db.market.push(l);
    save();
    return { profile: publicUser(u) };
  },
  'POST /api/market/bid': (req, b, u) => {
    processMarket();
    const l = db.market.find(x => x.id === b.id);
    if (!l) fail('Auktionen är redan avslutad.');
    const me = keyOf(u.name);
    if (l.seller === me) fail('Du kan inte buda på din egen spelare.');
    const amount = Math.round(+b.amount || 0);
    if (amount < marketMinBid(l)) fail(`Lägsta bud är ${FB.formatCoins(marketMinBid(l))}.`);
    const already = l.bid && l.bid.user === me ? l.bid.amount : 0;
    if (u.coins + already < amount) fail('Du har inte tillräckligt med spelpengar.');
    if (l.bid) {
      const prev = db.users[l.bid.user];
      if (prev) { prev.coins += l.bid.amount; if (l.bid.user !== me) inbox(prev, `Du blev överbjuden på ${l.player.name}. Ditt bud på ${FB.formatCoins(l.bid.amount)} har betalats tillbaka.`); }
    }
    u.coins -= amount;
    l.bid = { user: me, club: u.club, amount, t: Date.now() };
    if (l.ends - Date.now() < 30000) l.ends = Date.now() + 30000;
    if (l.buyNow && amount >= l.buyNow) completeSale(l, me, amount);
    save();
    return { profile: publicUser(u) };
  },
  'POST /api/market/buy': (req, b, u) => {
    processMarket();
    const l = db.market.find(x => x.id === b.id);
    if (!l || !l.buyNow) fail('Spelaren kan inte köpas direkt längre.');
    const me = keyOf(u.name);
    if (l.seller === me) fail('Det är din egen spelare.');
    const already = l.bid && l.bid.user === me ? l.bid.amount : 0;
    if (u.coins + already < l.buyNow) fail('Du har inte tillräckligt med spelpengar.');
    if (l.bid) { const prev = db.users[l.bid.user]; if (prev) { prev.coins += l.bid.amount; if (l.bid.user !== me) inbox(prev, `${l.player.name} köptes direkt av någon annan. Ditt bud har betalats tillbaka.`); } }
    u.coins -= l.buyNow;
    completeSale(l, me, l.buyNow);
    save();
    return { profile: publicUser(u) };
  },
  'POST /api/market/cancel': (req, b, u) => {
    const l = db.market.find(x => x.id === b.id);
    if (!l || l.seller !== keyOf(u.name)) fail('Auktionen hittades inte.');
    if (l.bid) fail('Någon har redan budat – auktionen kan inte avbrytas.');
    db.market = db.market.filter(x => x !== l);
    addToSquad(u, l.player);
    save();
    return { profile: publicUser(u) };
  },

  'GET /api/leaderboard': () => {
    const rows = Object.values(db.users).map(u => ({ club: u.club, name: u.name, played: u.stats.played, won: u.stats.won, trophies: u.stats.trophies, ovr: teamOvr(u) }));
    rows.sort((a, c) => c.trophies - a.trophies || c.won - a.won || c.ovr - a.ovr);
    return { rows: rows.slice(0, 15) };
  },
};

// Lagets handlingar (affär, träning, scouting, turneringar, matchresultat) delas med webbläsarversionen
const profileRoutes = G.profileRoutes({
  uid: newUid,
  id: () => crypto.randomBytes(6).toString('hex'),
  random: () => crypto.randomInt(2 ** 32) / 2 ** 32,
  catalog: () => readPlayersCsv().players,
});
for (const [key, fn] of Object.entries(profileRoutes)) {
  api[key] = (req, b, u) => {
    const out = fn(b, u) || {};
    save();
    return Object.assign({ profile: publicUser(u) }, out);
  };
}

const PUBLIC_ROUTES = new Set(['POST /api/register', 'POST /api/login', 'GET /api/players', 'GET /api/leaderboard']);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2e6) { reject(new G.GameError('För stor förfrågan.', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new G.GameError('Ogiltig JSON.', 400)); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUB, rel));
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Hittades inte'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  const key = `${req.method} ${url.pathname}`;
  const fn = api[key];
  if (!fn) return sendJson(res, 404, { error: 'Okänd förfrågan.' });
  try {
    const body = req.method === 'GET' ? {} : await readBody(req);
    const token = req.headers['x-token'] || '';
    const u = userByToken(token);
    if (!u && !PUBLIC_ROUTES.has(key)) throw new G.GameError('Logga in igen.', 401);
    if (u) fixLineup(u);
    const out = await fn(req, body, u, token);
    sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof G.GameError) sendJson(res, e.code, { error: e.message });
    else { console.error(e); sendJson(res, 500, { error: 'Något gick fel på servern.' }); }
  }
});

// ------------------------------------------------------- WebSocket (kompismatcher)
class WSConn {
  constructor(socket) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null; this.closed = false;
    this.onmessage = null; this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', d => this.data(d));
    socket.on('close', () => this.end());
    socket.on('error', () => this.end());
  }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; }
      const ml = masked ? 4 : 0;
      if (this.buf.length < off + ml + len) return;
      let payload = Buffer.from(this.buf.subarray(off + ml, off + ml + len));
      if (masked) { const m = this.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + ml + len);
      this.frame(fin, op, payload);
      if (this.closed) return;
    }
  }
  frame(fin, op, payload) {
    if (op === 8) return this.close();
    if (op === 9) return this.raw(10, payload);
    if (op === 10) return;
    if (op === 1 || op === 2) { if (fin) this.msg(payload); else this.frag = [payload]; }
    else if (op === 0 && this.frag) { this.frag.push(payload); if (fin) { const p = Buffer.concat(this.frag); this.frag = null; this.msg(p); } }
  }
  msg(p) {
    let o;
    try { o = JSON.parse(p.toString('utf8')); } catch (e) { return; }
    if (this.onmessage) this.onmessage(o);
  }
  raw(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let h;
    if (len < 126) h = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(len, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([h, payload]));
  }
  send(obj) { this.raw(1, Buffer.from(JSON.stringify(obj))); }
  busy() { return this.socket.writableLength > 512 * 1024; }
  close() { if (!this.closed) { try { this.raw(8, Buffer.alloc(0)); } catch (e) { /* redan stängd */ } this.socket.end(); } this.end(); }
  end() { if (this.closed) return; this.closed = true; if (this.onclose) this.onclose(); }
}

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function leaveRoom(conn, reason) {
  const room = conn.room;
  if (!room) return;
  conn.room = null;
  const other = room.host === conn ? room.guest : room.host;
  if (room.state === 'playing' && !room.settled && other) {
    // den som lämnar förlorar på walkover
    const hostWins = other === room.host;
    settle(room, hostWins ? 3 : 0, hostWins ? 0 : 3, [], [0, 0], true);
  }
  if (other && !other.closed) other.send({ t: 'peerLeft', reason: reason || 'Motståndaren lämnade matchen.' });
  if (other) other.room = null;
  rooms.delete(room.code);
}

function settle(room, sh, sa, injuries, drinks, walkover) {
  if (room.settled) return;
  room.settled = true;
  room.state = 'done';
  const H = db.users[room.hostUser], A = db.users[room.guestUser];
  if (!H || !A) return;
  const inj = side => (injuries || []).filter(i => i.side === side);
  G.settleFriend(H, { mine: sh, theirs: sa, wager: room.wager, opponent: A.club, injuries: inj(0), drinks: drinks ? drinks[0] : 0, walkover });
  G.settleFriend(A, { mine: sa, theirs: sh, wager: room.wager, opponent: H.club, injuries: inj(1), drinks: drinks ? drinks[1] : 0, walkover });
  save();
  const res = { score: [sh, sa], walkover: !!walkover };
  for (const [conn, u, mine, theirs] of [[room.host, H, sh, sa], [room.guest, A, sa, sh]]) {
    if (conn && !conn.closed) conn.send({ t: 'settled', result: res, profile: publicUser(u), won: mine > theirs, draw: sh === sa });
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const conn = new WSConn(socket);
  conn.onclose = () => leaveRoom(conn, 'Motståndaren tappade anslutningen.');
  conn.onmessage = m => {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      const u = userByToken(m.token);
      if (!u) return conn.send({ t: 'error', msg: 'Logga in igen.' });
      conn.user = keyOf(u.name);
      return conn.send({ t: 'welcome', name: u.name });
    }
    if (!conn.user) return;
    const u = db.users[conn.user];
    if (!u) return;
    if (m.t === 'relay') {
      const room = conn.room;
      if (!room || room.state !== 'playing') return;
      const other = room.host === conn ? room.guest : room.host;
      if (other && !other.closed) {
        if (m.d && m.d.k === 'snap' && other.busy()) return;
        other.send({ t: 'relay', d: m.d });
      }
      return;
    }
    if (m.t === 'create') {
      leaveRoom(conn);
      const wager = Math.max(0, Math.min(100000, m.wager | 0));
      if (u.coins < wager) return conn.send({ t: 'error', msg: `Du har inte ${wager} spelpengar.` });
      const code = newCode();
      const room = { code, host: conn, guest: null, hostUser: conn.user, guestUser: null, wager, state: 'waiting', settled: false };
      rooms.set(code, room);
      conn.room = room;
      return conn.send({ t: 'created', code, wager });
    }
    if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.state !== 'waiting') return conn.send({ t: 'error', msg: 'Hittade ingen väntande match med den koden.' });
      if (room.hostUser === conn.user) return conn.send({ t: 'error', msg: 'Du kan inte spela mot dig själv. Logga in som en annan användare.' });
      const H = db.users[room.hostUser];
      if (!H || H.coins < room.wager) return conn.send({ t: 'error', msg: 'Värden har inte råd med insatsen längre.' });
      if (u.coins < room.wager) return conn.send({ t: 'error', msg: `Insatsen är ${room.wager} spelpengar – du har inte råd.` });
      leaveRoom(conn);
      H.coins -= room.wager; u.coins -= room.wager;
      room.guest = conn; room.guestUser = conn.user; room.state = 'playing';
      conn.room = room;
      fixLineup(H); fixLineup(u);
      save();
      room.host.send({ t: 'start', role: 'host', code, wager: room.wager, opponent: u.club, guestTeam: FB.teamFromProfile(u), coins: H.coins });
      conn.send({ t: 'start', role: 'guest', code, wager: room.wager, opponent: H.club, coins: u.coins });
      return;
    }
    if (m.t === 'result') {
      const room = conn.room;
      if (!room || room.host !== conn || room.state !== 'playing') return;
      const sc = Array.isArray(m.score) ? m.score.map(v => Math.max(0, Math.min(30, v | 0))) : [0, 0];
      settle(room, sc[0], sc[1], Array.isArray(m.injuries) ? m.injuries : [], Array.isArray(m.drinks) ? m.drinks : [0, 0], false);
      return;
    }
    if (m.t === 'leave') return leaveRoom(conn);
    if (m.t === 'ping') return conn.send({ t: 'pong' });
  };
});

ensureAdmin();
server.listen(PORT, () => {
  const nets = require('os').networkInterfaces();
  const ips = [];
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  console.log(`\n⚽  Fotbollsspelet körs!`);
  console.log(`   På den här datorn:  http://localhost:${PORT}`);
  for (const ip of ips) console.log(`   För kompisar på samma nätverk:  http://${ip}:${PORT}`);
  console.log(`   Spelardokumentet:  ${CSV_FILE}`);
  const owner = ownerOf();
  console.log(owner ? `   Ägare (får ändra dokumentet och ge andra tillåtelse):  ${owner.name}\n` : '   Ägare: den som skapar första kontot blir ägare.\n');
});
