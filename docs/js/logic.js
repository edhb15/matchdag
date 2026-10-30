/* Spelets regler för laget: affär, träning, scouting, sjukstuga, turneringar och matchresultat.
   Används både av servern (node server.js) och av webbläsarversionen (GitHub Pages),
   så att reglerna bara finns på ett ställe. */
(function (root) {
  'use strict';
  const FB = root.FB || require('./shared.js');

  class GameError extends Error {
    constructor(msg, code) { super(msg); this.code = code || 400; }
  }
  const fail = (msg, code) => { throw new GameError(msg, code); };
  const G = { GameError, fail };

  // ------------------------------------------------------------ spelardokumentet
  G.CSV_COLS = ['id', 'namn', 'position', 'land', 'shooting', 'passing', 'dribbling', 'defending', 'pace', 'stamina', 'diving', 'pris'];

  G.parsePlayersCsv = function (text) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
    const comments = [];
    let header = null, sep = ';';
    const players = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#')) { if (!header) comments.push(raw); continue; }
      if (!header) {
        sep = line.includes(';') ? ';' : ',';
        header = line.split(sep).map(h => h.trim().toLowerCase());
        continue;
      }
      const cells = line.split(sep).map(c => c.trim());
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i] == null ? '' : cells[i]; });
      const pos = String(row.position || '').toUpperCase().replace('GK', 'MV');
      if (!['MV', 'B', 'M', 'A'].includes(pos) || !row.namn) continue;
      const num = k => { const v = parseInt(row[k], 10); return isFinite(v) ? Math.max(1, Math.min(99, v)) : null; };
      const stats = {};
      for (const k of FB.statsFor(pos)) stats[k] = num(k) || 50;
      const p = { id: String(row.id || players.length + 1), name: row.namn, pos, nation: row.land || '', stats, price: null };
      const pr = parseInt(row.pris, 10);
      p.price = isFinite(pr) && pr > 0 ? pr : FB.value(p);
      p.priceAuto = !(isFinite(pr) && pr > 0);
      players.push(p);
    }
    return { comments, players };
  };

  G.formatPlayersCsv = function (players, comments) {
    const out = (comments || []).slice();
    out.push(G.CSV_COLS.join(';'));
    for (const p of players) {
      const gk = p.pos === 'MV';
      const s = p.stats || {};
      const cell = k => (s[k] == null ? '' : String(Math.round(s[k])));
      out.push([
        p.id, String(p.name).replace(/[;\r\n]/g, ' '), p.pos, String(p.nation || '').replace(/[;\r\n]/g, ' '),
        gk ? '' : cell('shooting'), cell('passing'), gk ? '' : cell('dribbling'), gk ? '' : cell('defending'),
        gk ? '' : cell('pace'), gk ? '' : cell('stamina'), gk ? cell('diving') : '', p.priceAuto ? '' : String(p.price || ''),
      ].join(';'));
    }
    return out.join('\n') + '\n';
  };

  // Rensa och kontrollera en spelarlista som kommer från redigeraren
  G.cleanPlayers = function (list) {
    if (!Array.isArray(list)) fail('Fel format.');
    return list.slice(0, 500).map((p, i) => {
      const pos = ['MV', 'B', 'M', 'A'].includes(p.pos) ? p.pos : 'M';
      const stats = {};
      for (const k of FB.statsFor(pos)) stats[k] = Math.max(1, Math.min(99, Math.round(+(p.stats || {})[k] || 50)));
      const q = { id: String(p.id || i + 1).replace(/[;\s]/g, ''), name: String(p.name || 'Namnlös').slice(0, 40), pos, nation: String(p.nation || '').slice(0, 30), stats };
      const pr = Math.round(+p.price || 0);
      q.priceAuto = !(pr > 0) || !!p.priceAuto;
      q.price = q.priceAuto ? FB.value(q) : pr;
      return q;
    });
  };

  // Spelare som kommer från någon annan (t.ex. en kompis) – se till att värdena är rimliga
  G.cleanOwnedPlayer = function (p, uid) {
    const pos = ['MV', 'B', 'M', 'A'].includes(p && p.pos) ? p.pos : 'M';
    const stats = {};
    for (const k of FB.statsFor(pos)) stats[k] = Math.max(1, Math.min(99, Math.round(+((p && p.stats) || {})[k] || 40)));
    const sev = p && p.injury ? Math.max(1, Math.min(3, p.injury.sev | 0)) : 0;
    return {
      uid, dbId: p && p.dbId ? String(p.dbId) : undefined, name: String((p && p.name) || 'Namnlös').slice(0, 40), pos,
      nation: String((p && p.nation) || '').slice(0, 30), num: (p && p.num | 0) >= 1 && (p.num | 0) <= 99 ? p.num | 0 : 0, stats, injury: sev ? { sev, left: Math.max(1, Math.min(6, p.injury.left | 0)) } : null,
    };
  };

  // ------------------------------------------------------------------ laget
  G.fixLineup = function (u) {
    const ids = new Set(u.squad.map(p => p.uid));
    if (!FB.FORMATIONS[u.formation]) u.formation = '4-3-3';
    if (!Array.isArray(u.lineup) || u.lineup.length !== 11 || u.lineup.some(x => !ids.has(x)) || new Set(u.lineup).size !== 11) {
      u.lineup = FB.autoLineup(u.squad, u.formation);
    }
  };

  G.inbox = function (u, text) {
    u.inbox = u.inbox || [];
    u.inbox.unshift({ t: Date.now(), text });
    u.inbox = u.inbox.slice(0, 30);
  };

  G.teamOvr = function (u) {
    const xi = u.lineup.map(id => u.squad.find(p => p.uid === id)).filter(Boolean);
    return xi.length ? Math.round(xi.reduce((a, p) => a + FB.overall(p), 0) / xi.length) : 0;
  };

  G.canRemove = function (u, p) {
    if (u.squad.length <= 11) return 'Du måste ha minst 11 spelare kvar i truppen.';
    if (p.pos === 'MV' && u.squad.filter(q => q.pos === 'MV').length <= 1) return 'Du måste ha minst en målvakt kvar.';
    return null;
  };

  G.addToSquad = function (u, p) {
    if (u.squad.some(q => q.num === p.num)) p.num = 0;
    u.squad.push(p);
    FB.numberSquad(u.squad);
  };

  // Ett nytt lag. uid() ska ge unika id:n för spelarna.
  G.newProfile = function (name, club, uid) {
    const rng = FB.rng(FB.hash(name + Date.now()));
    const squad = FB.makeSquad(rng, 54, 'tmp').map(p => Object.assign(p, { uid: uid() }));
    const u = {
      name, club, coins: FB.START_COINS, squad, formation: '4-3-3', lineup: [],
      items: { energidryck: 1, medicin: 0, kikare: 0, proffsskor: 0 }, kits: { owned: ['klubb'], active: 'klubb' },
      stats: { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, trophies: 0 }, tournament: null, scouted: null,
      inbox: [{ t: Date.now(), text: `Välkommen till ${club}! Du har fått ${FB.START_COINS} spelpengar, en trupp på 16 spelare och en energidryck.` }],
      created: Date.now(),
    };
    G.fixLineup(u);
    return u;
  };

  G.checkName = function (name) {
    if (!/^[\p{L}\p{N} _-]{2,16}$/u.test(name)) fail('Namnet ska vara 2–16 tecken (bokstäver, siffror, mellanslag).');
  };
  G.checkClub = function (club) {
    if (club.length < 2 || club.length > 24) fail('Klubbnamnet ska vara 2–24 tecken.');
  };

  // ------------------------------------------------------------ turneringar
  function simWinner(rng, a, b) {
    const p = 1 / (1 + Math.exp(-(a.rating - b.rating) / 6));
    return rng() < p ? 0 : 1;
  }

  G.startTournament = function (u, fee, id) {
    const rng = FB.rng(FB.hash(u.name + Date.now()));
    const teams = FB.makeTournamentTeams(rng, fee, 7);
    const me = { id: 'me', name: u.club, short: FB.shortName(u.club), rating: G.teamOvr(u), user: true };
    const entrants = [me, ...teams];
    for (let i = entrants.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [entrants[i], entrants[j]] = [entrants[j], entrants[i]]; }
    const r0 = [];
    for (let i = 0; i < 8; i += 2) r0.push({ a: i, b: i + 1, w: null, score: null });
    return { id, fee, pot: fee * 8, round: 0, entrants, rounds: [r0], status: 'active', started: Date.now() };
  };

  G.advanceTournament = function (u, won, scoreText) {
    const t = u.tournament;
    const rng = FB.rng(FB.hash(t.id + t.round));
    const meIdx = t.entrants.findIndex(e => e.user);
    for (const m of t.rounds[t.round]) {
      if (m.a === meIdx || m.b === meIdx) {
        m.w = won ? meIdx : m.a === meIdx ? m.b : m.a;
        m.score = scoreText;
      } else {
        const w = simWinner(rng, t.entrants[m.a], t.entrants[m.b]);
        m.w = w === 0 ? m.a : m.b;
        const g1 = 1 + ((rng() * 3) | 0), g2 = (rng() * g1) | 0;
        m.score = w === 0 ? `${g1}–${g2}` : `${g2}–${g1}`;
      }
    }
    if (!won) { t.status = 'out'; G.inbox(u, `Utslagna i ${FB.TOURNAMENT_ROUNDS[t.round].toLowerCase()}en. Insatsen på ${t.fee} är förlorad.`); return; }
    if (t.round === 2) {
      t.status = 'won';
      u.coins += t.pot;
      u.stats.trophies++;
      G.inbox(u, `Turneringsseger! Du vann hela potten: ${FB.formatCoins(t.pot)} spelpengar.`);
      return;
    }
    const winners = t.rounds[t.round].map(m => m.w);
    const next = [];
    for (let i = 0; i < winners.length; i += 2) next.push({ a: winners[i], b: winners[i + 1], w: null, score: null });
    t.rounds.push(next);
    t.round++;
  };

  // ------------------------------------------------------------ matchresultat
  G.applyMatchAftermath = function (u, injuries, drinks) {
    const healed = [];
    const fresh = new Set((injuries || []).map(i => i.uid));
    for (const p of u.squad) {
      if (p.injury && !fresh.has(p.uid)) {
        p.injury.left = (p.injury.left || 1) - 1;
        if (p.injury.left <= 0) { p.injury = null; healed.push(p.name); }
      }
    }
    const hurt = [];
    for (const inj of injuries || []) {
      const p = u.squad.find(q => q.uid === inj.uid);
      const sev = Math.max(1, Math.min(3, inj.sev | 0));
      if (!p) continue;
      if (!p.injury || p.injury.sev < sev) p.injury = { sev, left: FB.INJURY[sev].matches };
      hurt.push(`${p.name} (${FB.INJURY[sev].short.toLowerCase()})`);
    }
    u.items.energidryck = Math.max(0, (u.items.energidryck || 0) - Math.max(0, drinks | 0));
    if (healed.length) G.inbox(u, `Friska igen: ${healed.join(', ')}.`);
    if (hurt.length) G.inbox(u, `Skadade i matchen: ${hurt.join(', ')}. Läk dem i Mitt lag → Sjukstugan.`);
    return { healed, hurt };
  };

  G.recordResult = function (u, gf, ga) {
    const s = u.stats;
    s.played++; s.gf += gf; s.ga += ga;
    if (gf > ga) s.won++; else if (gf === ga) s.drawn++; else s.lost++;
  };

  // Kompismatch: insatsen är redan betald. Vinnaren får potten (båda insatserna) plus bonus.
  G.settleFriend = function (u, o) {
    const mine = o.mine | 0, theirs = o.theirs | 0, wager = Math.max(0, o.wager | 0), wo = o.walkover ? ' (walkover)' : '';
    if (mine > theirs) {
      u.coins += wager * 2 + FB.FRIEND_WIN_REWARD;
      G.inbox(u, `Du vann mot ${o.opponent} med ${mine}–${theirs}${wo} och fick ${FB.formatCoins(wager * 2 + FB.FRIEND_WIN_REWARD)} spelpengar.`);
    } else if (mine === theirs) {
      u.coins += wager;
      G.inbox(u, `Oavgjort ${mine}–${theirs} mot ${o.opponent}. Insatsen betalades tillbaka.`);
    } else {
      G.inbox(u, `Du förlorade mot ${o.opponent} med ${mine}–${theirs}${wo}.`);
    }
    if (!o.walkover) {
      G.recordResult(u, mine, theirs);
      G.applyMatchAftermath(u, o.injuries || [], o.drinks || 0);
    }
  };

  // ------------------------------------------------------------ handlingar på laget
  // ctx: { uid(), id(), random(), catalog() } – skiljer sig mellan server och webbläsare.
  // Varje funktion får (body, profil) och returnerar extra svar (profilen läggs till av den som anropar).
  G.profileRoutes = function (ctx) {
    return {
      'POST /api/inbox/clear': (b, u) => { u.inbox = []; },
      'POST /api/club': (b, u) => {
        const club = String(b.club || '').trim();
        G.checkClub(club);
        u.club = club;
      },
      'POST /api/lineup': (b, u) => {
        if (b.formation && FB.FORMATIONS[b.formation]) u.formation = b.formation;
        if (Array.isArray(b.lineup)) u.lineup = b.lineup.map(String);
        G.fixLineup(u);
      },
      'POST /api/train': (b, u) => {
        const p = u.squad.find(q => q.uid === b.uid);
        if (!p) fail('Spelaren finns inte i din trupp.');
        if (!FB.statsFor(p.pos).includes(b.stat)) fail('Den egenskapen kan inte tränas för den här spelaren.');
        if (p.injury) fail('Skadade spelare kan inte träna. Läk spelaren först.');
        const v = p.stats[b.stat];
        if (v >= 99) fail('Redan max (99).');
        const cost = FB.trainCost(v);
        if (u.coins < cost) fail(`Träningen kostar ${cost} spelpengar.`);
        u.coins -= cost;
        const r = ctx.random();
        const gain = r < 0.1 ? 3 : r < 0.45 ? 2 : 1;
        p.stats[b.stat] = Math.min(99, v + gain);
        return { gain, cost };
      },
      'POST /api/heal': (b, u) => {
        const p = u.squad.find(q => q.uid === b.uid);
        if (!p || !p.injury) fail('Spelaren är inte skadad.');
        if (b.useItem) {
          if (!u.items.medicin) fail('Du har ingen medicinväska.');
          u.items.medicin--;
        } else {
          const cost = FB.INJURY[p.injury.sev].heal;
          if (u.coins < cost) fail(`Det kostar ${cost} spelpengar att läka ${p.name}.`);
          u.coins -= cost;
        }
        p.injury = null;
      },
      'POST /api/boots': (b, u) => {
        const p = u.squad.find(q => q.uid === b.uid);
        if (!p || p.pos === 'MV') fail('Välj en utespelare.');
        if (!u.items.proffsskor) fail('Du har inga proffsskor. Köp dem i affären.');
        u.items.proffsskor--;
        p.stats.pace = Math.min(99, p.stats.pace + 3);
        p.stats.shooting = Math.min(99, p.stats.shooting + 3);
      },
      'POST /api/scout': (b, u) => {
        if (u.coins < FB.SCOUT_COST) fail(`Scouting kostar ${FB.SCOUT_COST} spelpengar.`);
        u.coins -= FB.SCOUT_COST;
        const gold = (u.items.kikare || 0) > 0;
        if (gold) u.items.kikare--;
        const rng = FB.rng((ctx.random() * 4294967296) >>> 0);
        const pos = ['MV', 'B', 'M', 'A'];
        u.scouted = [0, 1, 2].map(() => {
          const base = gold ? 64 + rng() * 14 : 50 + rng() * 16;
          const p = FB.makePlayer(rng, pos[(rng() * 4) | 0], base, 'scout');
          p.nation = ['Sverige', 'Norge', 'Danmark', 'Finland', 'Ghana', 'Brasilien', 'Island'][(rng() * 7) | 0];
          p.price = Math.round((FB.value(p) * 0.7) / 10) * 10;
          return p;
        });
        return { gold };
      },
      'POST /api/sign': (b, u) => {
        const p = u.scouted && u.scouted[b.index | 0];
        if (!p) fail('Den talangen finns inte längre. Scouta igen.');
        if (u.squad.length >= FB.MAX_SQUAD) fail(`Truppen är full (${FB.MAX_SQUAD} spelare). Sälj någon först.`);
        if (u.coins < p.price) fail(`${p.name} kostar ${FB.formatCoins(p.price)} spelpengar.`);
        u.coins -= p.price;
        G.addToSquad(u, { uid: ctx.uid(), name: p.name, pos: p.pos, nation: p.nation, num: 0, stats: p.stats, injury: null });
        u.scouted = null;
      },
      'POST /api/shop/player': (b, u) => {
        const p = ctx.catalog().find(x => x.id === String(b.id));
        if (!p) fail('Spelaren finns inte i affären.');
        if (u.squad.some(q => q.dbId === p.id)) fail(`${p.name} spelar redan i ditt lag.`);
        if (u.squad.length >= FB.MAX_SQUAD) fail(`Truppen är full (${FB.MAX_SQUAD} spelare). Sälj någon först.`);
        if (u.coins < p.price) fail(`${p.name} kostar ${FB.formatCoins(p.price)} spelpengar.`);
        u.coins -= p.price;
        G.addToSquad(u, { uid: ctx.uid(), dbId: p.id, name: p.name, pos: p.pos, nation: p.nation, num: 0, stats: Object.assign({}, p.stats), injury: null });
      },
      'POST /api/shop/item': (b, u) => {
        const it = FB.ITEMS[b.item];
        if (!it) fail('Den saken finns inte.');
        if (u.coins < it.price) fail(`${it.name} kostar ${it.price} spelpengar.`);
        u.coins -= it.price;
        u.items[b.item] = (u.items[b.item] || 0) + 1;
      },
      'POST /api/shop/kit': (b, u) => {
        const k = FB.KITS.find(x => x.id === b.kit);
        if (!k) fail('Matchstället finns inte.');
        if (!u.kits.owned.includes(k.id)) {
          if (u.coins < k.price) fail(`${k.name} kostar ${k.price} spelpengar.`);
          u.coins -= k.price;
          u.kits.owned.push(k.id);
        }
        u.kits.active = k.id;
      },
      'POST /api/shop/sell': (b, u) => {
        const p = u.squad.find(q => q.uid === b.uid);
        if (!p) fail('Spelaren finns inte i din trupp.');
        const why = G.canRemove(u, p);
        if (why) fail(why);
        const price = Math.round((FB.value(p) * 0.4) / 10) * 10;
        u.squad = u.squad.filter(q => q !== p);
        u.coins += price;
        G.fixLineup(u);
        return { price };
      },
      'POST /api/match/start': (b, u) => {
        const mode = b.mode === 'tournament' ? 'tournament' : 'quick';
        if (mode === 'tournament' && (!u.tournament || u.tournament.status !== 'active')) fail('Du har ingen pågående turnering.');
        const diff = FB.DIFFICULTY[b.difficulty] ? b.difficulty : 'medium';
        u.pending = { id: ctx.id(), mode, difficulty: diff, t: Date.now() };
        return { matchId: u.pending.id };
      },
      'POST /api/match/result': (b, u) => {
        const pend = u.pending;
        if (!pend || pend.id !== b.matchId) fail('Matchen hittades inte (redan rapporterad?).');
        u.pending = null;
        const gf = Math.max(0, Math.min(30, b.gf | 0)), ga = Math.max(0, Math.min(30, b.ga | 0));
        G.recordResult(u, gf, ga);
        let reward = 0, outcome = gf > ga ? 'win' : gf === ga ? 'draw' : 'loss';
        let tournament = null;
        if (pend.mode === 'quick') {
          const d = FB.DIFFICULTY[pend.difficulty];
          reward = outcome === 'win' ? d.win : outcome === 'draw' ? d.draw : 0;
        } else if (u.tournament && u.tournament.status === 'active') {
          const won = gf > ga || (gf === ga && !!b.shootoutWin);
          if (won) reward = FB.TOURNAMENT_WIN_BONUS;
          outcome = won ? 'win' : 'loss';
          G.advanceTournament(u, won, `${gf}–${ga}${gf === ga ? ' (str)' : ''}`);
          tournament = u.tournament;
        }
        u.coins += reward;
        const after = G.applyMatchAftermath(u, b.injuries, b.drinks);
        return { reward, outcome, tournament, healed: after.healed, hurt: after.hurt };
      },
      'POST /api/tournament/start': (b, u) => {
        const fee = b.fee | 0;
        if (!FB.TOURNAMENT_FEES.includes(fee)) fail('Ogiltig insats.');
        if (u.tournament && u.tournament.status === 'active') fail('Du har redan en turnering igång.');
        if (u.coins < fee) fail(`Insatsen är ${fee} spelpengar.`);
        u.coins -= fee;
        u.tournament = G.startTournament(u, fee, ctx.id());
      },
      'POST /api/tournament/leave': (b, u) => {
        if (u.tournament && u.tournament.status === 'active') u.tournament.status = 'out';
        else u.tournament = null;
      },
      'POST /api/tournament/clear': (b, u) => {
        if (u.tournament && u.tournament.status !== 'active') u.tournament = null;
      },
    };
  };

  FB.Logic = G;
  if (typeof module !== 'undefined' && module.exports) module.exports = G;
})(typeof window !== 'undefined' ? window : globalThis);
