/* Fotbollsspelet – delad logik som används både i webbläsaren och på servern.
   Här finns statistik, betyg, skador, priser, formationer och datorlag. */
(function (root) {
  'use strict';
  const FB = {};

  // ---------------------------------------------------------------- statistik
  FB.STATS = ['shooting', 'passing', 'dribbling', 'defending', 'pace', 'stamina'];
  FB.GK_STATS = ['diving', 'passing'];
  FB.STAT_SHORT = { shooting: 'SHO', passing: 'PAS', dribbling: 'DRI', defending: 'DEF', pace: 'PAC', stamina: 'STA', diving: 'DIV' };
  FB.STAT_NAME = { shooting: 'Shooting', passing: 'Passing', dribbling: 'Dribbling', defending: 'Defending', pace: 'Pace', stamina: 'Stamina', diving: 'Diving' };
  FB.STAT_HELP = {
    shooting: 'Hårdare och mer träffsäkra skott',
    passing: 'Bättre och säkrare passningar',
    dribbling: 'Större chans att frysa försvararna',
    defending: 'Bättre tacklingar',
    pace: 'Snabbare med och utan boll',
    stamina: 'Orkar hålla högt tempo längre',
    diving: 'Chans att rädda när målvakten dyker åt rätt håll',
  };
  FB.POS = { MV: 'Målvakt', B: 'Back', M: 'Mittfältare', A: 'Anfallare' };
  FB.POS_ORDER = { MV: 0, B: 1, M: 2, A: 3 };
  FB.statsFor = pos => (pos === 'MV' ? FB.GK_STATS : FB.STATS);

  // ------------------------------------------------------------------- skador
  // drop = hur mycket spelarens alla värden sjunker. matches = hur många matcher skadan sitter i.
  FB.INJURY = [null,
    { name: 'Lätt skada', short: 'Lätt', drop: 0.06, matches: 1, heal: 100 },
    { name: 'Medelsvår skada', short: 'Medel', drop: 0.14, matches: 3, heal: 250 },
    { name: 'Svår skada', short: 'Svår', drop: 0.28, matches: 6, heal: 600 }];

  FB.effectiveStats = function (p) {
    const drop = p.injury ? FB.INJURY[p.injury.sev].drop : 0;
    const out = {};
    for (const k of FB.statsFor(p.pos)) out[k] = Math.max(1, Math.round((p.stats[k] || 1) * (1 - drop)));
    return out;
  };

  const WEIGHTS = {
    A: { shooting: 0.32, pace: 0.2, dribbling: 0.2, passing: 0.14, stamina: 0.08, defending: 0.06 },
    M: { passing: 0.3, dribbling: 0.18, stamina: 0.16, shooting: 0.14, defending: 0.12, pace: 0.1 },
    B: { defending: 0.4, pace: 0.18, stamina: 0.15, passing: 0.15, dribbling: 0.06, shooting: 0.06 },
  };

  // Totalbetyg (OVR). Med injured=true räknas skadan in.
  FB.overall = function (p, injured = true) {
    const s = injured ? FB.effectiveStats(p) : p.stats;
    if (p.pos === 'MV') return Math.round((s.diving || 1) * 0.78 + (s.passing || 1) * 0.22);
    const w = WEIGHTS[p.pos] || WEIGHTS.M;
    let t = 0;
    for (const k in w) t += (s[k] || 1) * w[k];
    return Math.round(t);
  };

  // Marknadsvärde i spelpengar
  FB.value = function (p) {
    const o = FB.overall(p, false);
    const v = Math.max(0, o - 40) ** 2 * 3 + 100;
    return Math.max(100, Math.round(v / 50) * 50);
  };

  FB.trainCost = v => 40 + Math.max(0, v - 40) * 4;

  // Skotthastighet enligt spelets regel: skottstatistik × procent / 50 = km/h
  // Exempel: 61 i shooting och 100 % kraft → 61 · 100 / 50 = 122 km/h
  FB.shotSpeedKmh = (shooting, percent) => (shooting * percent) / 50;

  // ---------------------------------------------------------------- slump
  FB.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  FB.hash = function (str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };

  // ------------------------------------------------------------------- namn
  const FIRST = ['Erik', 'Oskar', 'Viktor', 'Elias', 'Hugo', 'Leo', 'Noah', 'Liam', 'Alexander', 'William', 'Lucas',
    'Oliver', 'Axel', 'Isak', 'Filip', 'Anton', 'Emil', 'Ludvig', 'Melvin', 'Albin', 'Theo', 'Adam', 'Gustav', 'Nils',
    'Olle', 'Ali', 'Omar', 'Samir', 'Mateo', 'Diego', 'Kofi', 'Yusuf', 'Mikael', 'Jonas', 'Sami', 'Ivan', 'Luka',
    'Marco', 'Arvid', 'Vincent', 'Malte', 'Sixten', 'Elliot', 'Edvin', 'Josef', 'Amir', 'Daniel', 'Felix', 'Rasmus'];
  const LAST = ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson',
    'Gustafsson', 'Pettersson', 'Jonsson', 'Berg', 'Lind', 'Holm', 'Ek', 'Sjöberg', 'Lundqvist', 'Björk', 'Falk',
    'Hassan', 'Novak', 'Kovač', 'Silva', 'Moreno', 'Mensah', 'Diallo', 'Okafor', 'Rossi', 'Jansen', 'Dahl', 'Strand',
    'Wikström', 'Forsberg', 'Hedlund', 'Åberg', 'Nyström', 'Lövgren', 'Engström', 'Sandberg', 'Ali', 'Kaya', 'Bergqvist'];
  FB.randomName = rng => FIRST[(rng() * FIRST.length) | 0] + ' ' + LAST[(rng() * LAST.length) | 0];

  const PROFILE = {
    A: { shooting: 8, passing: -2, dribbling: 4, defending: -24, pace: 5, stamina: -1 },
    M: { shooting: -3, passing: 7, dribbling: 3, defending: -5, pace: -1, stamina: 5 },
    B: { shooting: -20, passing: -3, dribbling: -9, defending: 10, pace: 1, stamina: 3 },
  };
  const NATIONS = ['Norge', 'Danmark', 'Finland', 'Island', 'Ghana', 'Brasilien', 'Spanien', 'Bosnien', 'Nigeria', 'Polen', 'Turkiet', 'Gambia'];
  const clampStat = v => Math.max(15, Math.min(97, Math.round(v)));

  // Skapar en slumpad spelare runt ett ungefärligt betyg
  FB.makePlayer = function (rng, pos, rating, uid) {
    let stats;
    if (pos === 'MV') {
      stats = { diving: clampStat(rating + 3 + (rng() - 0.5) * 8), passing: clampStat(rating - 6 + (rng() - 0.5) * 14) };
    } else {
      stats = {};
      for (const k of FB.STATS) stats[k] = clampStat(rating + PROFILE[pos][k] + (rng() - 0.5) * 14);
    }
    const nation = rng() < 0.7 ? 'Sverige' : NATIONS[(rng() * NATIONS.length) | 0];
    return { uid, name: FB.randomName(rng), pos, nation, num: 0, stats, injury: null };
  };

  FB.numberSquad = function (squad) {
    const used = new Set(squad.filter(p => p.num).map(p => p.num));
    const pick = pref => {
      for (const n of pref) if (!used.has(n)) { used.add(n); return n; }
      for (let n = 2; n < 99; n++) if (!used.has(n)) { used.add(n); return n; }
      return 99;
    };
    for (const p of squad) {
      if (p.num) continue;
      p.num = pick(p.pos === 'MV' ? [1, 12, 30] : p.pos === 'B' ? [2, 3, 4, 5, 6, 15] : p.pos === 'M' ? [8, 6, 10, 14, 16, 18] : [9, 11, 7, 10, 19, 20]);
    }
    return squad;
  };

  FB.makeSquad = function (rng, rating, prefix) {
    const plan = ['MV', 'MV', 'B', 'B', 'B', 'B', 'B', 'M', 'M', 'M', 'M', 'M', 'A', 'A', 'A', 'A'];
    const squad = plan.map((pos, i) => FB.makePlayer(rng, pos, rating + (i === 1 ? -6 : 0), prefix + i));
    return FB.numberSquad(squad);
  };

  // --------------------------------------------------------------- formationer
  // pos: [djup 0 = backlinjen … 1 = anfallslinjen, bredd 0…1]
  FB.FORMATIONS = {
    '4-3-3': {
      slots: ['MV', 'B', 'B', 'B', 'B', 'M', 'M', 'M', 'A', 'A', 'A'],
      pos: [[0, 0.5], [0, 0.1], [0, 0.36], [0, 0.64], [0, 0.9], [0.48, 0.24], [0.42, 0.5], [0.48, 0.76], [1, 0.16], [1.05, 0.5], [1, 0.84]],
    },
    '4-4-2': {
      slots: ['MV', 'B', 'B', 'B', 'B', 'M', 'M', 'M', 'M', 'A', 'A'],
      pos: [[0, 0.5], [0, 0.1], [0, 0.36], [0, 0.64], [0, 0.9], [0.5, 0.1], [0.44, 0.37], [0.44, 0.63], [0.5, 0.9], [1, 0.36], [1, 0.64]],
    },
    '3-5-2': {
      slots: ['MV', 'B', 'B', 'B', 'M', 'M', 'M', 'M', 'M', 'A', 'A'],
      pos: [[0, 0.5], [0, 0.22], [0, 0.5], [0, 0.78], [0.56, 0.06], [0.45, 0.3], [0.38, 0.5], [0.45, 0.7], [0.56, 0.94], [1, 0.38], [1, 0.62]],
    },
  };

  // Välj bästa elvan automatiskt (friska spelare först)
  FB.autoLineup = function (squad, formation) {
    const f = FB.FORMATIONS[formation] || FB.FORMATIONS['4-3-3'];
    const used = new Set();
    const score = p => FB.overall(p) - (p.injury ? 30 : 0);
    const lineup = [];
    for (const want of f.slots) {
      let best = null;
      for (const p of squad) {
        if (used.has(p.uid) || p.pos !== want) continue;
        if (!best || score(p) > score(best)) best = p;
      }
      if (!best) {
        for (const p of squad) {
          if (used.has(p.uid) || (want !== 'MV' && p.pos === 'MV')) continue;
          if (!best || score(p) > score(best)) best = p;
        }
      }
      if (best) { used.add(best.uid); lineup.push(best.uid); }
    }
    return lineup;
  };

  // ---------------------------------------------------------------- matchställ
  FB.KITS = [
    { id: 'klubb', name: 'Klubbfärger', price: 0, shirt: '#1f3c88', shorts: '#f4f4f0', socks: '#1f3c88', num: '#ffffff' },
    { id: 'blagul', name: 'Blågul', price: 250, shirt: '#fecc02', shorts: '#006aa7', socks: '#fecc02', num: '#006aa7' },
    { id: 'rodsvart', name: 'Rödsvart rand', price: 300, shirt: '#c8102e', stripe: '#111111', shorts: '#111111', socks: '#c8102e', num: '#ffffff' },
    { id: 'gronvit', name: 'Grönvit', price: 250, shirt: '#0b7a3e', stripe: '#f4f4f0', shorts: '#f4f4f0', socks: '#0b7a3e', num: '#ffffff' },
    { id: 'svartguld', name: 'Svart & guld', price: 400, shirt: '#151515', shorts: '#151515', socks: '#d4a017', num: '#d4a017' },
    { id: 'lila', name: 'Lila natt', price: 300, shirt: '#5b2a86', shorts: '#2a1240', socks: '#5b2a86', num: '#f2d16b' },
    { id: 'orange', name: 'Orange', price: 300, shirt: '#ff6a13', shorts: '#1b1b1b', socks: '#ff6a13', num: '#1b1b1b' },
    { id: 'himmel', name: 'Himmelsblå', price: 250, shirt: '#7cc4f0', shorts: '#ffffff', socks: '#ffffff', num: '#0f2d52' },
  ];
  FB.kit = id => FB.KITS.find(k => k.id === id) || FB.KITS[0];
  FB.GK_KITS = [
    { shirt: '#2fbf71', shorts: '#16241d', socks: '#2fbf71', num: '#0d1a13' },
    { shirt: '#f2c14e', shorts: '#2b2b2b', socks: '#f2c14e', num: '#2b2b2b' },
  ];
  FB.AWAY_KIT = { shirt: '#f2f2ee', shorts: '#2a2a2a', socks: '#f2f2ee', num: '#202020' };

  // ----------------------------------------------------------------- saker
  FB.ITEMS = {
    energidryck: { name: 'Energidryck', price: 120, desc: 'Används i match via pausmenyn: hela laget får full ork.' },
    medicin: { name: 'Medicinväska', price: 200, desc: 'Läker en skadad spelare direkt, hur svår skadan än är.' },
    kikare: { name: 'Guldkikare', price: 300, desc: 'Nästa scouting hittar betydligt bättre talanger.' },
    proffsskor: { name: 'Proffsskor', price: 500, desc: 'Ge en utespelare +3 pace och +3 shooting för alltid.' },
  };

  // -------------------------------------------------------------- datorlag
  FB.AI_TEAMS = [
    { id: 'grus', name: 'Grusvallens IF', short: 'GIF', rating: 50, kit: { shirt: '#b5301f', shorts: '#ffffff', socks: '#b5301f', num: '#ffffff' } },
    { id: 'sjobo', name: 'Sjöbo Bollklubb', short: 'SBK', rating: 53, kit: { shirt: '#2f6f3a', shorts: '#2f6f3a', socks: '#ffffff', num: '#ffffff' } },
    { id: 'norrby', name: 'Norrby FF', short: 'NFF', rating: 56, kit: { shirt: '#e8e3d3', shorts: '#1e2a44', socks: '#1e2a44', num: '#1e2a44' } },
    { id: 'vastkust', name: 'Västkustens IK', short: 'VIK', rating: 62, kit: { shirt: '#0e5aa7', stripe: '#ffffff', shorts: '#0e5aa7', socks: '#0e5aa7', num: '#ffffff' } },
    { id: 'alvstad', name: 'Älvstadens FC', short: 'ÄFC', rating: 65, kit: { shirt: '#8a1538', shorts: '#ffffff', socks: '#8a1538', num: '#ffffff' } },
    { id: 'bergslag', name: 'Bergslagens BK', short: 'BBK', rating: 68, kit: { shirt: '#f0b323', shorts: '#222222', socks: '#222222', num: '#222222' } },
    { id: 'kungliga', name: 'Kungliga FC', short: 'KFC', rating: 75, kit: { shirt: '#ffffff', shorts: '#13294b', socks: '#ffffff', num: '#13294b' } },
    { id: 'nordic', name: 'Nordic United', short: 'NOR', rating: 79, kit: { shirt: '#d50032', shorts: '#ffffff', socks: '#d50032', num: '#ffffff' } },
    { id: 'oresund', name: 'Real Öresund', short: 'RÖ', rating: 83, kit: { shirt: '#3d1e6d', stripe: '#c9a227', shorts: '#3d1e6d', socks: '#3d1e6d', num: '#c9a227' } },
  ];
  FB.DIFFICULTY = {
    easy: { label: 'Lätt', teams: ['grus', 'sjobo', 'norrby'], win: 150, draw: 50 },
    medium: { label: 'Medel', teams: ['vastkust', 'alvstad', 'bergslag'], win: 300, draw: 100 },
    hard: { label: 'Svår', teams: ['kungliga', 'nordic', 'oresund'], win: 550, draw: 150 },
  };

  // Skapa ett komplett datorlag (samma lag varje gång tack vare seed)
  FB.makeAITeam = function (info, seed) {
    const rng = FB.rng(seed || FB.hash(info.id || info.name));
    const squad = FB.makeSquad(rng, info.rating, 'ai_' + (info.id || 'x') + '_' + (seed || 0) + '_');
    return {
      name: info.name, short: info.short, kit: info.kit, gkKit: FB.GK_KITS[1], ai: true, rating: info.rating,
      formation: rng() < 0.5 ? '4-3-3' : '4-4-2', squad,
      lineup: null,
    };
  };

  // Turneringar: insats → hur starka datorlagen är
  FB.TOURNAMENT_FEES = [100, 250, 500, 1000];
  FB.TOURNAMENT_RATING = { 100: 54, 250: 62, 500: 70, 1000: 78 };
  FB.TOURNAMENT_ROUNDS = ['Kvartsfinal', 'Semifinal', 'Final'];
  const T_PREFIX = ['Hamnens', 'Skogens', 'Norra', 'Södra', 'Östra', 'Västra', 'Fjällets', 'Kustens', 'Slättens', 'Brons', 'Stjärnans', 'Ekens'];
  const T_SUFFIX = ['IF', 'BK', 'FF', 'IK', 'FC', 'SK', 'United', 'Athletic'];
  const T_COLORS = ['#b5301f', '#0e5aa7', '#2f6f3a', '#f0b323', '#5b2a86', '#d9480f', '#0f766e', '#be185d', '#334155', '#7c2d12', '#e8e3d3', '#111827'];
  FB.makeTournamentTeams = function (rng, fee, count) {
    const base = FB.TOURNAMENT_RATING[fee] || 60;
    const used = new Set();
    const teams = [];
    while (teams.length < count) {
      const name = T_PREFIX[(rng() * T_PREFIX.length) | 0] + ' ' + T_SUFFIX[(rng() * T_SUFFIX.length) | 0];
      if (used.has(name)) continue;
      used.add(name);
      const shirt = T_COLORS[(rng() * T_COLORS.length) | 0];
      const light = /^#(e|f)/i.test(shirt);
      teams.push({
        id: 't' + FB.hash(name + fee), name, short: name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3),
        rating: Math.round(base + (rng() - 0.5) * 10), seed: (rng() * 1e9) | 0,
        kit: { shirt, shorts: light ? '#1e2a44' : '#f4f4f0', socks: shirt, num: light ? '#1e2a44' : '#ffffff' },
      });
    }
    return teams;
  };

  // Kortnamn för resultattavlan, t.ex. "Hammarby Bollklubb" → "HB", "Lejonen" → "LEJ"
  FB.shortName = function (name) {
    const w = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (w.length >= 2) return w.map(x => x[0]).join('').toUpperCase().slice(0, 3);
    return (w[0] || 'LAG').slice(0, 3).toUpperCase();
  };

  // Gör om en sparad profil till ett lag som matchmotorn förstår
  FB.teamFromProfile = function (u) {
    return {
      name: u.club, short: FB.shortName(u.club), kit: FB.kit(u.kits && u.kits.active), gkKit: FB.GK_KITS[0],
      formation: u.formation, squad: u.squad, lineup: u.lineup, energyDrinks: (u.items && u.items.energidryck) || 0,
    };
  };

  function hexRgb(h) { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colorDist(a, b) { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
  // Om lagens tröjor är för lika byter bortalaget till reservställ
  FB.resolveKits = function (home, away) {
    if (colorDist(home.kit.shirt, away.kit.shirt) < 110) {
      const alt = colorDist(home.kit.shirt, FB.AWAY_KIT.shirt) < 110 ? { shirt: '#20232b', shorts: '#20232b', socks: '#20232b', num: '#f2f2ee' } : FB.AWAY_KIT;
      away.kit = alt;
    }
    if (colorDist(home.gkKit.shirt, away.gkKit.shirt) < 90) away.gkKit = FB.GK_KITS[1];
    for (const t of [home, away]) {
      const other = t === home ? away : home;
      if (colorDist(t.gkKit.shirt, other.kit.shirt) < 90 || colorDist(t.gkKit.shirt, t.kit.shirt) < 90) t.gkKit = { shirt: '#ec4899', shorts: '#1f1f1f', socks: '#ec4899', num: '#1f1f1f' };
    }
  };

  FB.START_COINS = 1500;
  FB.SCOUT_COST = 150;
  FB.FRIEND_WIN_REWARD = 250;
  FB.TOURNAMENT_WIN_BONUS = 100;
  FB.MAX_SQUAD = 30;

  FB.formatCoins = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  if (typeof module !== 'undefined' && module.exports) module.exports = FB;
  root.FB = FB;
})(typeof window !== 'undefined' ? window : globalThis);
