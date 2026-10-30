/* Webbläsarversionen (t.ex. på GitHub Pages): samma regler som servern (logic.js),
   men laget sparas i webbläsaren i stället för på en server. */
(function (root) {
  'use strict';
  const FB = root.FB, G = FB.Logic;
  const KEY = 'matchdag_lag_v1';
  const fail = G.fail;

  let st;
  try { st = JSON.parse(localStorage.getItem(KEY)); } catch (e) { st = null; }
  if (!st || typeof st !== 'object' || !st.teams) st = { current: null, teams: {}, seq: 1 };
  let saved = true;
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(st)); saved = true; } catch (e) { saved = false; }
  }

  const uid = () => 'l' + (st.seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const keyOf = n => String(n || '').trim().toLowerCase();
  const clone = o => JSON.parse(JSON.stringify(o));
  const me = () => (st.current && st.teams[st.current]) || null;

  // Spelardokumentet läses som en vanlig fil bredvid index.html
  let catalog = [];
  let catalogP = null;
  function loadCatalog() {
    if (!catalogP) {
      catalogP = fetch('spelare.csv', { cache: 'no-cache' })
        .then(r => { if (!r.ok) throw new Error(); return r.text(); })
        .then(t => (catalog = G.parsePlayersCsv(t).players))
        .catch(() => { catalogP = null; throw new G.GameError('Kunde inte läsa spelare.csv. Den ska ligga i samma mapp som index.html.'); });
    }
    return catalogP;
  }

  const routes = G.profileRoutes({ uid, id: rid, random: Math.random, catalog: () => catalog });

  function teamList() {
    return Object.values(st.teams).map(t => ({ name: t.name, club: t.club, played: t.stats.played, won: t.stats.won, trophies: t.stats.trophies, ovr: G.teamOvr(t) }));
  }

  const local = {
    'POST /api/register': b => {
      const name = String(b.name || '').trim(), club = String(b.club || '').trim() || name + ' FC';
      G.checkName(name);
      G.checkClub(club);
      if (st.teams[keyOf(name)]) fail('Det finns redan ett lag med det namnet på den här enheten. Välj det i listan i stället.');
      const u = G.newProfile(name, club, uid);
      u.role = 'local';
      G.inbox(u, 'Laget sparas i den här webbläsaren. Spara en kopia ibland under Inställningar, så att du inte blir av med det.');
      st.teams[keyOf(name)] = u;
      st.current = keyOf(name);
      return { token: st.current, profile: u };
    },
    'POST /api/login': b => {
      const k = keyOf(b.name);
      if (!st.teams[k]) fail('Hittade inget lag med det namnet på den här enheten.');
      st.current = k;
      return { token: k, profile: st.teams[k] };
    },
    'POST /api/logout': () => { st.current = null; return { ok: true }; },
    'GET /api/profile': (b, u) => ({ profile: u }),
    'GET /api/teams': () => ({ teams: teamList() }),
    'GET /api/players': async () => ({ players: await loadCatalog(), owner: null }),
    'PUT /api/players': () => fail('I webbläsarversionen ändras spelardokumentet i filen spelare.csv (på GitHub).', 403),
    'GET /api/leaderboard': () => {
      const rows = teamList().sort((a, c) => c.trophies - a.trophies || c.won - a.won || c.ovr - a.ovr);
      return { rows };
    },

    // spara och läsa in en kopia av laget
    'GET /api/export': (b, u) => ({ data: { format: 'matchdag-lag', version: 1, team: u } }),
    'POST /api/import': b => {
      const t = b.data && b.data.team;
      if (!b.data || b.data.format !== 'matchdag-lag' || !t || !Array.isArray(t.squad) || !t.name || !t.club) fail('Filen är inte en kopia av ett Matchdag-lag.');
      const team = clone(t);
      team.squad = team.squad.slice(0, 60).map(p => G.cleanOwnedPlayer(p, p.uid ? String(p.uid) : uid()));
      FB.numberSquad(team.squad);
      team.coins = Math.max(0, team.coins | 0);
      team.role = 'local';
      team.pending = null;
      for (const k of ['items', 'kits', 'stats']) if (!team[k] || typeof team[k] !== 'object') team[k] = G.newProfile('x', 'x', uid)[k];
      let name = String(team.name).slice(0, 16), n = 2;
      while (st.teams[keyOf(name)]) name = `${String(team.name).slice(0, 13)} ${n++}`;
      team.name = name;
      G.fixLineup(team);
      st.teams[keyOf(name)] = team;
      st.current = keyOf(name);
      return { token: st.current, profile: team };
    },

    // kompismatch: insatsen dras när matchen startar, resultatet räknas av G.settleFriend
    'POST /api/friend/stake': (b, u) => {
      const w = Math.max(0, b.wager | 0);
      if (u.coins < w) fail(`Insatsen är ${w} spelpengar – du har inte råd.`);
      u.coins -= w;
    },
    'POST /api/friend/settle': (b, u) => { G.settleFriend(u, b); },

    // handel med kompis: köparen betalar i förväg och får tillbaka pengarna om affären inte blir av
    'POST /api/friend/escrow': (b, u) => {
      const a = Math.max(0, Math.round(+b.amount || 0));
      if (u.coins < a) fail('Du har inte tillräckligt med spelpengar.');
      u.coins -= a;
    },
    'POST /api/friend/refund': (b, u) => { u.coins += Math.max(0, Math.round(+b.amount || 0)); },
    'POST /api/friend/sell': (b, u) => {
      const p = u.squad.find(q => q.uid === b.uid);
      if (!p) fail('Spelaren finns inte längre i truppen.');
      const why = G.canRemove(u, p);
      if (why) fail(why);
      const amount = Math.max(0, Math.round(+b.amount || 0));
      u.squad = u.squad.filter(q => q !== p);
      u.coins += amount;
      G.fixLineup(u);
      G.inbox(u, `${p.name} såldes till ${b.club} för ${FB.formatCoins(amount)} spelpengar.`);
      return { player: clone(p) };
    },
    'POST /api/friend/receive': (b, u) => {
      const p = G.cleanOwnedPlayer(b.player, uid());
      G.addToSquad(u, p);
      G.inbox(u, `Du köpte ${p.name} av ${b.club} för ${FB.formatCoins(Math.round(+b.amount || 0))} spelpengar.`);
    },
  };

  const PUBLIC = new Set(['POST /api/register', 'POST /api/login', 'POST /api/logout', 'GET /api/teams', 'GET /api/players', 'GET /api/leaderboard', 'POST /api/import']);

  async function api(method, url, body) {
    const key = `${method} ${url}`;
    const b = body || {};
    let u = null;
    if (!PUBLIC.has(key)) {
      u = me();
      if (!u) throw new G.GameError('Välj ditt lag igen.', 401);
      G.fixLineup(u);
    }
    let out;
    if (routes[key]) {
      if (key === 'POST /api/shop/player') await loadCatalog();
      out = Object.assign({ profile: u }, routes[key](b, u) || {});
    } else if (local[key]) {
      out = (await local[key](b, u)) || {};
      if (u && !out.profile) out.profile = u;
    } else {
      throw new G.GameError('Det här finns inte i webbläsarversionen.', 404);
    }
    persist();
    return clone(out);
  }

  FB.LocalBackend = { api, isSaved: () => saved, teams: teamList };
})(window);
