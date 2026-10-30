/* Menyerna: inloggning, startsida, lag, affär, marknad, turnering, kompismatch, spelardokument. */
(function () {
  'use strict';
  const FB = window.FB, E = FB.Engine, esc = FB.esc;
  const $ = (s, el) => (el || document).querySelector(s);
  const app = $('#app'), matchRoot = $('#match-root'), toastEl = $('#toast');

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privat läge */ } },
  };

  const S = {
    token: store.get('fb_token', null),
    profile: null,
    players: null,
    market: null,
    leaderboard: null,
    settings: Object.assign({ duration: 360, sound: true, voice: true }, store.get('fb_settings', {})),
    screen: 'hem',
    tab: { lag: 'laget', affar: 'spelare', marknad: 'auktioner' },
    sel: {},
    busy: false,
  };
  const sound = new FB.Sound();
  const comm = new FB.Commentator();
  let game = null;      // pågående match
  let net = null;       // kompisanslutning
  let marketTimer = null;

  // ------------------------------------------------------------------ hjälp
  async function api(method, url, body) {
    if (S.static) {
      // webbläsarversionen: samma regler, men laget sparas i webbläsaren
      try {
        const data = await FB.LocalBackend.api(method, url, body);
        if (data.profile) S.profile = data.profile;
        return data;
      } catch (e) {
        if (e.code === 401 && S.token) logout(true);
        throw new Error(e.message || 'Något gick fel.');
      }
    }
    const res = await fetch(url, {
      method, headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { 'X-Token': S.token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => { throw new Error('Kan inte nå servern. Är den igång (node server.js)?'); });
    let data = {};
    try { data = await res.json(); } catch (e) { /* tomt svar */ }
    if (res.status === 401 && S.token && url !== '/api/login') { logout(true); throw new Error(data.error || 'Logga in igen.'); }
    if (!res.ok) throw new Error(data.error || 'Något gick fel.');
    if (data.profile) S.profile = data.profile;
    return data;
  }

  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    toastEl.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  }

  async function act(fn, okMsg) {
    if (S.busy) return;
    S.busy = true;
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'good');
      render();
      return r;
    } catch (e) { toast(e.message, 'bad'); render(); }
    finally { S.busy = false; }
  }

  const coins = n => `<span class="coins"><i class="coin" aria-hidden="true"></i>${FB.formatCoins(n)}</span>`;
  const kitChip = k => `<span class="kitchip" style="background:${esc(k.shirt)};border-color:${esc(k.shorts)}"></span>`;
  const squadById = () => new Map(S.profile.squad.map(p => [p.uid, p]));
  const teamOvr = () => {
    const m = squadById();
    const xi = S.profile.lineup.map(u => m.get(u)).filter(Boolean);
    return xi.length ? Math.round(xi.reduce((a, p) => a + FB.overall(p), 0) / xi.length) : 0;
  };
  const posClass = pos => 'pos-' + (pos || 'M').toLowerCase();

  function injuryTag(p) {
    if (!p.injury) return '';
    const inj = FB.INJURY[p.injury.sev];
    return `<span class="inj s${p.injury.sev}" title="${esc(inj.name)} – ${p.injury.left || 1} match(er) kvar">${esc(inj.short)} · ${p.injury.left || 1} m</span>`;
  }

  function statGrid(p, effective) {
    const s = effective ? FB.effectiveStats(p) : p.stats;
    return `<div class="sgrid">${FB.statsFor(p.pos).map(k => `<span><b>${s[k]}</b><i>${FB.STAT_SHORT[k]}</i></span>`).join('')}</div>`;
  }

  function card(p, extra, opts) {
    opts = opts || {};
    const ovr = FB.overall(p);
    return `<article class="pcard ${posClass(p.pos)} ${p.injury ? 'hurt' : ''} ${opts.cls || ''}" ${opts.attrs || ''}>
      <header><b class="ovr">${ovr}</b><span class="ppos">${esc(p.pos)}</span>${p.num ? `<span class="pnum">#${p.num}</span>` : ''}</header>
      <h4>${esc(p.name)}</h4>
      <p class="pmeta">${esc(p.nation || FB.POS[p.pos])} ${injuryTag(p)}</p>
      ${statGrid(p, true)}
      ${extra || ''}
    </article>`;
  }

  function timeLeft(ms) {
    if (ms <= 0) return 'avslutas…';
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h} h ${m} min` : m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
  }

  function go(screen, tab) {
    S.screen = screen;
    if (tab) S.tab[screen] = tab;
    if (location.hash !== '#' + screen) history.replaceState(null, '', '#' + screen);
    render();
    window.scrollTo(0, 0);
    if (screen === 'marknad' && !S.static) loadMarket();
    if (screen === 'affar' || screen === 'dokument') loadPlayers();
    if (screen === 'dokument') loadEditors();
  }

  const canEditDoc = () => !!S.profile && (S.profile.role === 'admin' || S.profile.role === 'editor');

  async function loadPlayers(force) {
    if (S.players && !force) return;
    try { const r = await api('GET', '/api/players'); S.players = r.players; S.docOwner = r.owner; render(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function loadEditors() {
    if (!S.profile || S.profile.role !== 'admin') return;
    try { S.editors = (await api('GET', '/api/doc/editors')).users; if (S.screen === 'dokument') render(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function loadMarket() {
    try { S.market = await api('GET', '/api/market'); S.marketAt = Date.now(); render(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function loadLeaderboard() {
    if (S.static) return;
    try { S.leaderboard = (await api('GET', '/api/leaderboard')).rows; if (S.screen === 'hem') render(); } catch (e) { /* inte viktigt */ }
  }

  function logout(silent) {
    if (S.token && !silent) api('POST', '/api/logout').catch(() => {});
    S.token = null; S.profile = null;
    store.set('fb_token', null);
    render();
  }

  // ------------------------------------------------------------------ rendering
  const ICONS = {
    ball: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.2l3.3 2.4-1.3 3.9h-4l-1.3-3.9z" fill="currentColor"/><path d="M12 2.8v4.4M15.3 9.6l4.2-1.4M14 13.5l2.6 3.6M10 13.5l-2.6 3.6M8.7 9.6L4.5 8.2" stroke="currentColor" stroke-width="1.5"/></svg>',
    cup: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 01-10 0z M7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    duo: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16.5" cy="9" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 19c.6-3.4 2.8-5 5.5-5s4.9 1.6 5.5 5M13.5 14.6c.9-.4 1.9-.6 3-.6 2.4 0 4.3 1.5 4.9 4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    shirt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3l4 2 4-2 5 3-2.5 4-2-1V21H7.5V9l-2 1L3 6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function render() {
    if (game) return;
    clearInterval(marketTimer); marketTimer = null;
    if (!S.token || !S.profile) { app.innerHTML = renderLogin(); return; }
    const titles = { hem: '', spela: 'Snabbmatch', turnering: 'Turnering', kompis: 'Spela mot kompis', lag: 'Mitt lag', affar: 'Affär', marknad: 'Global marknad', dokument: 'Spelardokument', installningar: 'Inställningar', resultat: 'Resultat' };
    const fn = { hem: renderHub, spela: renderPlay, turnering: renderTournament, kompis: renderFriends, lag: renderTeam, affar: renderShop, marknad: renderMarket, dokument: renderDoc, installningar: renderSettings, resultat: renderResult }[S.screen] || renderHub;
    const p = S.profile;
    app.innerHTML = `
      <header class="topbar">
        ${S.screen !== 'hem' ? `<button type="button" class="iconbtn" data-go="hem" aria-label="Tillbaka till start">${ICONS.back}</button>` : `<span class="brand">${ICONS.ball}<b>Matchdag</b></span>`}
        <h1>${S.screen === 'hem' ? esc(p.club) : esc(titles[S.screen] || '')}</h1>
        <span class="wallet" title="Spelpengar">${coins(p.coins)}</span>
      </header>
      <main class="screen screen-${S.screen}">${fn()}</main>`;
    if (S.screen === 'marknad') marketTimer = setInterval(() => { if (S.screen === 'marknad' && !game) tickMarket(); }, 1000);
  }

  // ------------------------------------------------------------------ inloggning
  function loginHero() {
    return `
        <section class="login-hero">
          <span class="brand big">${ICONS.ball}<b>Matchdag</b></span>
          <p class="lede">Bygg ditt lag, köp och sälj spelare, spela turneringar och möt dina kompisar.</p>
          <ul class="feature-list">
            <li><b>11 mot 11</b> med riktig bollfysik: skruv, studs och stolpträffar</li>
            <li><b>Skottkraft</b> enligt regeln shooting × procent / 50 = km/h</li>
            <li><b>Turneringar</b> där vinnaren tar hela potten</li>
            ${S.static ? '<li><b>Spela och handla</b> med kompisar direkt mellan era webbläsare</li>' : '<li><b>Global marknad</b> där ni budar på varandras spelare</li>'}
          </ul>
        </section>`;
  }

  function renderLogin() {
    if (S.static) {
      const teams = FB.LocalBackend.teams();
      return `
      <main class="login">
        ${loginHero()}
        <section class="login-card">
          ${teams.length ? `<div class="stack"><h2>Fortsätt med ditt lag</h2>
            ${teams.map(t => `<button type="button" class="opp" data-pick-team="${esc(t.name)}"><b>${esc(t.club)}</b><span class="muted">${esc(t.name)} · ${t.won} vinster</span></button>`).join('')}</div>` : ''}
          <form id="login-form" class="form" autocomplete="off">
            <h2>${teams.length ? 'Nytt lag' : 'Skapa ditt lag'}</h2>
            <label>Ditt namn<input id="f-name" name="name" required minlength="2" maxlength="16" placeholder="t.ex. Alva"></label>
            <label>Klubbnamn<input id="f-club" name="club" maxlength="24" placeholder="t.ex. Lejonen FC"></label>
            <button class="primary big" type="submit">Skapa lag</button>
            <p class="muted small">Du får ${FB.START_COINS} spelpengar och 16 spelare. Laget sparas i den här webbläsaren.</p>
          </form>
          <label class="linkbtn file-btn">Läs in en sparad kopia av ett lag<input type="file" id="f-import" accept=".json,application/json" hidden></label>
        </section>
      </main>`;
    }
    const mode = S.sel.loginMode || 'login';
    return `
      <main class="login">
        ${loginHero()}
        <section class="login-card">
          <div class="seg" role="tablist">
            <button type="button" role="tab" aria-selected="${mode === 'login'}" data-login-mode="login">Logga in</button>
            <button type="button" role="tab" aria-selected="${mode === 'new'}" data-login-mode="new">Nytt konto</button>
          </div>
          <form id="login-form" class="form" autocomplete="on">
            <label>Ditt namn<input id="f-name" name="name" required minlength="2" maxlength="16" autocomplete="username" placeholder="t.ex. Alva"></label>
            <label>PIN-kod (4–8 siffror)<input id="f-pin" name="pin" required inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="${mode === 'new' ? 'new-password' : 'current-password'}" type="password" placeholder="••••"></label>
            ${mode === 'new' ? '<label>Klubbnamn<input id="f-club" name="club" maxlength="24" placeholder="t.ex. Lejonen FC"></label>' : ''}
            <button class="primary big" type="submit">${mode === 'new' ? 'Skapa konto och lag' : 'Logga in'}</button>
            <p class="muted small">${mode === 'new' ? `Du får ${FB.START_COINS} spelpengar och en trupp på 16 spelare att börja med.` : 'Kompisar skapar egna konton på samma server.'}</p>
          </form>
        </section>
      </main>`;
  }

  // ------------------------------------------------------------------ startsidan
  function renderHub() {
    const p = S.profile, st = p.stats, t = p.tournament;
    const injured = p.squad.filter(q => q.injury).length;
    const lb = S.leaderboard || [];
    const tStatus = t && t.status === 'active' ? `${FB.TOURNAMENT_ROUNDS[t.round]} väntar · pott ${FB.formatCoins(t.pot)}` : 'Lägg in pengar – vinnaren tar hela potten';
    return `
      <section class="club-strip">
        ${kitChip(FB.kit(p.kits.active))}
        <div><b class="big-num">${teamOvr()}</b><span class="label">Lagbetyg</span></div>
        <div><b class="big-num">${st.won}–${st.drawn}–${st.lost}</b><span class="label">V–O–F</span></div>
        <div><b class="big-num">${st.trophies}</b><span class="label">Troféer</span></div>
        <div><b class="big-num">${p.squad.length}</b><span class="label">Spelare${injured ? ` · <span class="warn">${injured} skadade</span>` : ''}</span></div>
      </section>
      <section class="tiles main-tiles">
        <button type="button" class="tile hero" data-go="spela">${ICONS.ball}<b>Snabbmatch</b><span>Spela mot datorn och vinn spelpengar</span></button>
        <button type="button" class="tile hero" data-go="turnering">${ICONS.cup}<b>Turnering</b><span>${esc(tStatus)}</span></button>
        <button type="button" class="tile hero" data-go="kompis">${ICONS.duo}<b>Spela mot kompis</b><span>Realtid över nätet, med insats</span></button>
      </section>
      <section class="tiles">
        <button type="button" class="tile" data-go="lag">${ICONS.shirt}<b>Mitt lag</b><span>Se laget, träna, scouta och läka</span></button>
        <button type="button" class="tile" data-go="affar">${ICONS.bag}<b>Affär</b><span>Köp spelare, saker och matchställ</span></button>
        ${S.static ? `<button type="button" class="tile" data-go="kompis">${ICONS.globe}<b>Handla med kompis</b><span>Köp och sälj spelare direkt med en kompis</span></button>`
          : `<button type="button" class="tile" data-go="marknad">${ICONS.globe}<b>Global marknad</b><span>Buda på andras spelare</span></button>`}
        <button type="button" class="tile" data-go="dokument">${ICONS.doc}<b>Spelardokument</b><span>${canEditDoc() ? 'Redigera spelare och statistik' : 'Se alla spelare och deras statistik'}</span></button>
        <button type="button" class="tile" data-go="installningar">${ICONS.gear}<b>Inställningar</b><span>Matchlängd, ljud, kontroller</span></button>
      </section>
      <section class="two-col">
        <div class="panel">
          <div class="panel-h"><h2>Meddelanden</h2>${p.inbox && p.inbox.length ? '<button type="button" class="linkbtn" data-a="clear-inbox">Rensa</button>' : ''}</div>
          ${p.inbox && p.inbox.length ? `<ul class="inbox">${p.inbox.slice(0, 6).map(m => `<li><time>${new Date(m.t).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${esc(m.text)}</li>`).join('')}</ul>` : '<p class="muted">Inga nya meddelanden.</p>'}
        </div>
        ${S.static ? `<div class="panel">
          <div class="panel-h"><h2>Sparat i den här webbläsaren</h2></div>
          <p class="muted">Ditt lag finns bara i den här webbläsaren. Spara en kopia ibland – den kan också läsas in på en annan dator eller mobil.</p>
          <div class="row"><button type="button" class="ghost" data-a="export">Spara en kopia</button><label class="ghost file-btn">Läs in kopia<input type="file" id="f-import" accept=".json,application/json" hidden></label></div>
        </div>` : `<div class="panel">
          <div class="panel-h"><h2>Topplista</h2></div>
          ${lb.length ? `<ol class="leader">${lb.slice(0, 8).map((r, i) => `<li class="${r.club === p.club ? 'me' : ''}"><span class="rank">${i + 1}</span><b>${esc(r.club)}</b><span class="muted">${esc(r.name)}</span><span>${r.trophies} troféer · ${r.won} vinster</span></li>`).join('')}</ol>` : '<p class="muted">Ingen har spelat än.</p>'}
        </div>`}
      </section>`;
  }

  // ------------------------------------------------------------------ snabbmatch
  function renderPlay() {
    const diff = S.sel.diff || 'medium';
    const d = FB.DIFFICULTY[diff];
    const teams = d.teams.map(id => FB.AI_TEAMS.find(t => t.id === id));
    const opp = S.sel.opp && d.teams.includes(S.sel.opp) ? S.sel.opp : teams[0].id;
    const m = squadById();
    const hurtXI = S.profile.lineup.map(u => m.get(u)).filter(q => q && q.injury);
    return `
      <section class="panel">
        <h2>Välj svårighet</h2>
        <div class="seg wide">${Object.entries(FB.DIFFICULTY).map(([k, v]) => `<button type="button" data-diff="${k}" aria-pressed="${k === diff}">${v.label}<small>Vinst ${coins(v.win)} · Oavgjort ${coins(v.draw)}</small></button>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>Välj motståndare</h2>
        <div class="opp-list">
          ${teams.map(t => `<button type="button" class="opp ${t.id === opp ? 'on' : ''}" data-opp="${t.id}">${kitChip(t.kit)}<b>${esc(t.name)}</b><span class="ovr-pill">${t.rating}</span></button>`).join('')}
        </div>
      </section>
      <section class="panel row-between">
        <div>
          <p>Ditt lag: <b>${teamOvr()}</b> i lagbetyg · formation ${esc(S.profile.formation)}</p>
          ${hurtXI.length ? `<p class="warn">${hurtXI.length} skadade i startelvan: ${hurtXI.map(q => esc(q.name)).join(', ')}. <button type="button" class="linkbtn" data-go="lag">Ändra laget</button></p>` : ''}
          <label class="inline">Matchlängd ${durationSelect('dur-play')}</label>
        </div>
        <button type="button" class="primary big" data-a="start-quick" data-opp-id="${opp}" data-diff-id="${diff}">Spela match</button>
      </section>`;
  }

  function durationSelect(id) {
    const opts = [[240, 'Kort · 4 min'], [360, 'Normal · 6 min'], [600, 'Lång · 10 min']];
    return `<select id="${id}" data-setting="duration">${opts.map(([v, l]) => `<option value="${v}" ${S.settings.duration === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  }

  // ------------------------------------------------------------------ turnering
  function renderTournament() {
    const t = S.profile.tournament;
    if (!t) {
      const fee = S.sel.fee || 250;
      return `
        <section class="panel">
          <h2>Så funkar turneringen</h2>
          <p>Du och sju datorlag lägger in samma insats. Det blir kvartsfinal, semifinal och final – vinner du finalen får du <b>hela potten</b>, alltså alla lags pengar. Förlorar du åker du ut och insatsen är borta. Oavgjort avgörs på straffar.</p>
        </section>
        <section class="panel">
          <h2>Välj insats</h2>
          <div class="fee-grid">
            ${FB.TOURNAMENT_FEES.map(f => `<button type="button" class="fee ${f === fee ? 'on' : ''}" data-fee="${f}">
              <span class="label">Insats</span>${coins(f)}<span class="label">Pott</span><b class="pot">${coins(f * 8)}</b><span class="muted small">Motståndare ca ${FB.TOURNAMENT_RATING[f]} i betyg</span></button>`).join('')}
          </div>
          <div class="row-between"><span>Ditt lagbetyg: <b>${teamOvr()}</b></span>
          <button type="button" class="primary big" data-a="start-tournament" data-fee-id="${fee}" ${S.profile.coins < fee ? 'disabled' : ''}>Lägg in ${FB.formatCoins(fee)} och starta</button></div>
        </section>`;
    }
    const me = t.entrants.findIndex(e => e.user);
    const roundCol = (ri) => {
      const r = t.rounds[ri];
      const name = FB.TOURNAMENT_ROUNDS[ri];
      if (!r) return `<div class="bcol"><h3>${name}</h3><div class="bmatch tbd"><span>–</span><span>–</span></div></div>`;
      return `<div class="bcol"><h3>${name}</h3>${r.map(m => {
        const row = idx => { const e = t.entrants[idx]; return `<span class="${idx === me ? 'me' : ''} ${m.w === idx ? 'win' : m.w != null ? 'lose' : ''}">${e.kit ? kitChip(e.kit) : kitChip(FB.kit(S.profile.kits.active))}${esc(e.name)} <i>${e.rating}</i></span>`; };
        return `<div class="bmatch">${row(m.a)}${row(m.b)}${m.score ? `<em>${esc(m.score)}</em>` : ''}</div>`;
      }).join('')}</div>`;
    };
    let head;
    if (t.status === 'active') {
      const m = t.rounds[t.round].find(x => x.a === me || x.b === me);
      const opp = t.entrants[m.a === me ? m.b : m.a];
      head = `<section class="panel row-between">
        <div><p class="eyebrow">${FB.TOURNAMENT_ROUNDS[t.round]} · pott ${coins(t.pot)}</p>
        <h2>${esc(S.profile.club)} mot ${esc(opp.name)}</h2>
        <p class="muted">Motståndarnas betyg ${opp.rating} · ditt lag ${teamOvr()}. Oavgjort avgörs på straffar.</p>
        <label class="inline">Matchlängd ${durationSelect('dur-t')}</label></div>
        <div class="stack"><button type="button" class="primary big" data-a="play-tournament">Spela ${FB.TOURNAMENT_ROUNDS[t.round].toLowerCase()}en</button>
        <button type="button" class="linkbtn danger-text" data-a="leave-tournament">Lämna turneringen (insatsen förloras)</button></div>
      </section>`;
    } else if (t.status === 'won') {
      head = `<section class="panel win-banner"><h2>Du vann turneringen!</h2><p>Hela potten på ${coins(t.pot)} är din.</p><button type="button" class="primary" data-a="new-tournament">Ny turnering</button></section>`;
    } else {
      head = `<section class="panel"><h2>Utslagna i ${FB.TOURNAMENT_ROUNDS[Math.min(t.round, 2)].toLowerCase()}en</h2><p class="muted">Insatsen på ${coins(t.fee)} gick till potten. Bättre lycka nästa gång!</p><button type="button" class="primary" data-a="new-tournament">Ny turnering</button></section>`;
    }
    return `${head}<section class="panel"><h2>Spelschema</h2><div class="bracket">${[0, 1, 2].map(roundCol).join('')}</div></section>`;
  }

  // ------------------------------------------------------------------ kompis
  function renderFriends() {
    const f = S.friend || {};
    let body;
    if (f.state === 'waiting') {
      body = `<section class="panel center">
        <p class="eyebrow">Väntar på kompisen</p>
        <div class="room-code" aria-label="Matchkod">${esc(f.code)}</div>
        <p>Be din kompis välja <b>Spela mot kompis → Gå med</b> och skriva in koden.${f.wager ? ` Insats: ${coins(f.wager)} var – vinnaren tar ${coins(f.wager * 2 + FB.FRIEND_WIN_REWARD)}.` : ` Vinnaren får ${coins(FB.FRIEND_WIN_REWARD)}.`}</p>
        <p class="muted small">Kompisen öppnar samma adress som du: <b>${esc(S.static ? location.origin + location.pathname : location.origin)}</b></p>
        <button type="button" class="ghost" data-a="friend-cancel">Avbryt</button>
      </section>`;
    } else if (f.state === 'connecting') {
      body = '<section class="panel center"><p>Ansluter…</p></section>';
    } else if (f.state === 'lobby') {
      body = renderLobby(f);
    } else {
      body = `
      <section class="two-col">
        <div class="panel">
          <h2>Skapa match</h2>
          <p class="muted">Du får en kod som kompisen skriver in. Ni lägger in lika mycket – vinnaren tar allt plus ${coins(FB.FRIEND_WIN_REWARD)} i bonus. Oavgjort = pengarna tillbaka.</p>
          <label>Insats var<input id="f-wager" type="number" min="0" step="50" max="${S.profile.coins}" value="${Math.min(100, S.profile.coins)}"></label>
          <label class="inline">Matchlängd ${durationSelect('dur-f')}</label>
          <button type="button" class="primary big" data-a="friend-create">Skapa match</button>
        </div>
        <div class="panel">
          <h2>Gå med</h2>
          <p class="muted">Skriv in koden din kompis fick.</p>
          <label>Matchkod<input id="f-code" maxlength="4" autocapitalize="characters" autocomplete="off" placeholder="ABCD" class="code-input"></label>
          <button type="button" class="primary big" data-a="friend-join">Gå med</button>
        </div>
      </section>
      <section class="panel">
        <h2>Så spelar ni över nätet</h2>
        ${S.static ? `<ol class="steps">
          <li>Skicka adressen till spelet (<code>${esc(location.origin + location.pathname)}</code>) till kompisen. Ni behöver inte vara på samma wifi.</li>
          <li>Kompisen skapar ett eget lag i sin webbläsare.</li>
          <li>En skapar match, den andra går med med koden. Sedan kan ni handla spelare med varandra innan matchen startar.</li>
        </ol>
        <p class="muted small">Webbläsarna kopplas ihop direkt. Vissa nätverk (t.ex. skolans eller jobbets wifi) blockerar sådana anslutningar – prova då ett annat nätverk.</p>`
        : `<ol class="steps">
          <li>Den som startade servern skickar adressen (står i terminalen, t.ex. <code>http://192.168.1.20:3000</code>) till kompisen.</li>
          <li>Kompisen skapar ett eget konto där.</li>
          <li>En skapar match, den andra går med med koden. Båda anfaller åt höger på sin egen skärm.</li>
        </ol>`}
      </section>`;
    }
    return body;
  }

  // Efter att ni kopplats ihop (webbläsarversionen): handla spelare, sedan startar värden matchen
  function renderLobby(f) {
    const tr = S.trade || (S.trade = { mine: [], theirs: [], bids: {}, pending: {} });
    const p = S.profile, opp = esc(f.opponent);
    const listed = new Set(tr.mine.map(x => x.uid));
    const sellable = p.squad.filter(q => !listed.has(q.uid)).sort((a, b) => FB.overall(b) - FB.overall(a));
    const mineRows = tr.mine.map(x => {
      const q = p.squad.find(s => s.uid === x.uid);
      if (!q) return '';
      const bid = tr.bids[x.uid];
      return `<div class="benchrow trade-row"><span class="ppos ${posClass(q.pos)}">${q.pos}</span><b>${esc(q.name)}</b>${coins(x.price)}
        ${bid ? `<span class="good-text small">Bud ${coins(bid)}</span><span class="row"><button type="button" class="primary sm" data-a="trade-accept" data-uid="${esc(x.uid)}">Sälj för ${FB.formatCoins(bid)}</button><button type="button" class="ghost sm" data-a="trade-decline" data-uid="${esc(x.uid)}">Neka</button></span>`
          : `<span></span><button type="button" class="ghost sm" data-a="trade-unlist" data-uid="${esc(x.uid)}">Ta bort</button>`}</div>`;
    }).join('');
    return `
      <section class="panel row-between">
        <div>
          <p class="eyebrow">Ihopkopplade${f.code ? ` · rum ${esc(f.code)}` : ''}</p>
          <h2>${esc(p.club)} mot ${opp}</h2>
          <p class="muted">${f.wager ? `Insats ${coins(f.wager)} var – vinnaren tar ${coins(f.wager * 2 + FB.FRIEND_WIN_REWARD)}.` : `Vinnaren får ${coins(FB.FRIEND_WIN_REWARD)}.`} Handla gärna spelare med varandra först.</p>
          ${f.role === 'host' ? `<label class="inline">Matchlängd ${durationSelect('dur-l')}</label>` : ''}
        </div>
        <div class="stack">
          ${f.role === 'host' ? '<button type="button" class="primary big" data-a="friend-start">Starta matchen</button>' : `<p class="muted">Väntar på att ${opp} startar matchen…</p>`}
          <button type="button" class="linkbtn" data-a="friend-cancel">Lämna</button>
        </div>
      </section>
      <section class="two-col">
        <div class="panel">
          <h2>Sälj till ${opp}</h2>
          <div class="form grid2">
            <label>Spelare<select id="t-uid"><option value="">Välj…</option>${sellable.map(q => `<option value="${esc(q.uid)}">${esc(q.name)} (${q.pos}, ${FB.overall(q)})</option>`).join('')}</select></label>
            <label>Pris<input id="t-price" type="number" min="0" step="50" value="500"></label>
          </div>
          <p><button type="button" class="primary" data-a="trade-list">Lägg ut</button></p>
          ${mineRows ? `<div class="bench">${mineRows}</div>` : '<p class="muted">Du har inte lagt ut någon spelare.</p>'}
        </div>
        <div class="panel">
          <h2>${opp}s spelare till salu</h2>
          ${tr.theirs.length ? `<div class="cards">${tr.theirs.map(x => {
            const pend = tr.pending[x.uid];
            return card(x.player, `<p class="small">Pris ${coins(x.price)}</p>${pend
              ? `<p class="muted small">Väntar på svar om ${pend.kind === 'bid' ? 'ditt bud på' : 'köp för'} ${FB.formatCoins(pend.amount)}…</p>`
              : `<button type="button" class="primary sm full" data-a="trade-buy" data-uid="${esc(x.uid)}" ${p.coins < x.price ? 'disabled' : ''}>Köp för ${coins(x.price)}</button>
                <div class="bidrow"><input type="number" id="tb-${esc(x.uid)}" min="1" step="10" value="${Math.max(10, Math.round((x.price * 0.8) / 10) * 10)}" aria-label="Ditt bud"><button type="button" class="ghost sm" data-a="trade-bid" data-uid="${esc(x.uid)}">Bjud</button></div>`}`);
          }).join('')}</div>` : `<p class="muted">${opp} har inte lagt ut några spelare än.</p>`}
        </div>
      </section>`;
  }

  // ------------------------------------------------------------------ mitt lag
  function renderTeam() {
    const tab = S.tab.lag;
    const tabs = [['laget', 'Laget'], ['trana', 'Träna'], ['scouta', 'Scouta'], ['sjuk', 'Sjukstugan']];
    const nav = `<nav class="tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="lag:${k}" aria-pressed="${k === tab}">${l}${k === 'sjuk' && S.profile.squad.some(p => p.injury) ? ` <span class="dot">${S.profile.squad.filter(p => p.injury).length}</span>` : ''}</button>`).join('')}</nav>`;
    const body = { laget: teamLineup, trana: teamTrain, scouta: teamScout, sjuk: teamClinic }[tab]();
    return nav + body;
  }

  function teamLineup() {
    const p = S.profile, m = squadById();
    const f = FB.FORMATIONS[p.formation];
    const picked = S.sel.swap;
    const inXI = new Set(p.lineup);
    const bench = p.squad.filter(q => !inXI.has(q.uid)).sort((a, b) => FB.POS_ORDER[a.pos] - FB.POS_ORDER[b.pos] || FB.overall(b) - FB.overall(a));
    const slot = (uid, i) => {
      const q = m.get(uid);
      if (!q) return '';
      const [d, w] = f.pos[i];
      const x = i === 0 ? 7 : 22 + d * 62, y = 10 + (1 - w) * 80;
      const wrong = q.pos !== f.slots[i] ? 'wrongpos' : '';
      return `<button type="button" class="slot ${posClass(f.slots[i])} ${picked === uid ? 'picked' : ''} ${q.injury ? 'hurt' : ''} ${wrong}" style="left:${x}%;top:${y}%" data-swap="${esc(uid)}" title="${esc(q.name)}">
        <b>${FB.overall(q)}</b><span>${esc(q.name.split(' ').slice(-1)[0])}</span><i>${esc(f.slots[i])}</i></button>`;
    };
    return `
      <section class="panel lineup-panel">
        <div class="row-between wrap">
          <div class="seg">${Object.keys(FB.FORMATIONS).map(k => `<button type="button" data-formation="${k}" aria-pressed="${k === p.formation}">${k}</button>`).join('')}</div>
          <div class="row"><span>Lagbetyg <b>${teamOvr()}</b></span><button type="button" class="ghost" data-a="auto-lineup">Bästa elvan automatiskt</button></div>
        </div>
        <p class="muted small">${picked ? 'Välj vem han ska byta plats med.' : 'Tryck på en spelare och sedan på en annan för att byta plats.'} Röd ram = skadad. Streckad = spelar på fel position.</p>
        <div class="lineup-pitch">${p.lineup.map(slot).join('')}</div>
      </section>
      <section class="panel">
        <h2>Avbytare och reserver (${bench.length})</h2>
        <div class="bench">${bench.map(q => `<button type="button" class="benchrow ${picked === q.uid ? 'picked' : ''}" data-swap="${esc(q.uid)}"><span class="ppos ${posClass(q.pos)}">${q.pos}</span><b>${esc(q.name)}</b>${injuryTag(q)}<span class="ovr-pill">${FB.overall(q)}</span></button>`).join('') || '<p class="muted">Inga reserver. Köp fler spelare i affären.</p>'}</div>
      </section>
      <section class="panel">
        <h2>Hela truppen</h2>
        <div class="cards">${p.squad.slice().sort((a, b) => FB.POS_ORDER[a.pos] - FB.POS_ORDER[b.pos] || FB.overall(b) - FB.overall(a)).map(q => card(q)).join('')}</div>
      </section>`;
  }

  function teamTrain() {
    const p = S.profile;
    const uid = S.sel.train && p.squad.some(q => q.uid === S.sel.train) ? S.sel.train : p.lineup[0];
    const q = p.squad.find(x => x.uid === uid);
    const list = p.squad.slice().sort((a, b) => FB.POS_ORDER[a.pos] - FB.POS_ORDER[b.pos] || FB.overall(b) - FB.overall(a));
    return `
      <section class="split">
        <div class="panel pick-list">
          ${list.map(x => `<button type="button" class="benchrow ${x.uid === uid ? 'picked' : ''}" data-train-pick="${esc(x.uid)}"><span class="ppos ${posClass(x.pos)}">${x.pos}</span><b>${esc(x.name)}</b>${injuryTag(x)}<span class="ovr-pill">${FB.overall(x)}</span></button>`).join('')}
        </div>
        <div class="panel">
          ${q ? `
          <h2>${esc(q.name)} <span class="muted">· ${FB.POS[q.pos]} · ${FB.overall(q)}</span></h2>
          ${q.injury ? '<p class="warn">Skadade spelare kan inte träna. Läk honom i Sjukstugan först.</p>' : '<p class="muted">Varje träning ger +1 till +3. Ju högre värde, desto dyrare.</p>'}
          <div class="train-list">
            ${FB.statsFor(q.pos).map(k => {
              const v = q.stats[k], cost = FB.trainCost(v);
              return `<div class="train-row"><div><b>${FB.STAT_NAME[k]}</b><span class="muted small">${esc(FB.STAT_HELP[k])}</span></div>
                <div class="meterbar"><i style="width:${v}%"></i></div><b class="val">${v}</b>
                <button type="button" class="primary sm" data-a="train" data-uid="${esc(q.uid)}" data-stat="${k}" ${q.injury || v >= 99 || p.coins < cost ? 'disabled' : ''}>Träna ${coins(cost)}</button></div>`;
            }).join('')}
          </div>
          ${q.pos !== 'MV' ? `<div class="row-between boots"><span>Proffsskor: +3 pace och +3 shooting för alltid. Du har <b>${p.items.proffsskor || 0}</b>.</span>
            <button type="button" class="ghost" data-a="boots" data-uid="${esc(q.uid)}" ${(p.items.proffsskor || 0) < 1 ? 'disabled' : ''}>Ge proffsskor</button></div>` : ''}` : ''}
        </div>
      </section>`;
  }

  function teamScout() {
    const p = S.profile;
    const sc = p.scouted;
    return `
      <section class="panel row-between">
        <div><h2>Scouta nya talanger</h2>
          <p class="muted">Scouten letar fram tre spelare som du kan värva. ${(p.items.kikare || 0) > 0 ? `<b>Guldkikare används automatiskt</b> (du har ${p.items.kikare}) – då blir talangerna mycket bättre.` : 'Med en Guldkikare från affären hittar scouten bättre spelare.'}</p></div>
        <button type="button" class="primary big" data-a="scout" ${p.coins < FB.SCOUT_COST ? 'disabled' : ''}>Scouta ${coins(FB.SCOUT_COST)}</button>
      </section>
      ${sc && sc.length ? `<section class="panel"><h2>Hittade talanger</h2><div class="cards">${sc.map((q, i) => card(q, `<button type="button" class="primary sm full" data-a="sign" data-index="${i}" ${p.coins < q.price ? 'disabled' : ''}>Värva ${coins(q.price)}</button>`)).join('')}</div></section>` : ''}`;
  }

  function teamClinic() {
    const p = S.profile;
    const hurt = p.squad.filter(q => q.injury);
    return `
      <section class="panel">
        <h2>Sjukstugan</h2>
        <p class="muted">Skadade spelare får lägre värden: lätt skada −6 %, medelsvår −14 %, svår −28 %. Skadan läker av sig själv efter några matcher, eller direkt här mot en kostnad.</p>
        ${hurt.length ? `<div class="cards">${hurt.map(q => {
          const inj = FB.INJURY[q.injury.sev];
          return card(q, `<p class="small">${esc(inj.name)} · ${q.injury.left || 1} match(er) kvar · utan skada ${FB.overall(q, false)}</p>
            <div class="stack"><button type="button" class="primary sm full" data-a="heal" data-uid="${esc(q.uid)}" ${p.coins < inj.heal ? 'disabled' : ''}>Läk ${coins(inj.heal)}</button>
            ${(p.items.medicin || 0) > 0 ? `<button type="button" class="ghost sm full" data-a="heal-item" data-uid="${esc(q.uid)}">Använd medicinväska (${p.items.medicin})</button>` : ''}</div>`);
        }).join('')}</div>` : '<p class="good-text">Alla spelare är friska!</p>'}
      </section>`;
  }

  // ------------------------------------------------------------------ affären
  function renderShop() {
    const tab = S.tab.affar;
    const tabs = [['spelare', 'Spelare'], ['saker', 'Saker'], ['stall', 'Matchställ'], ['salj', 'Sälj']];
    const nav = `<nav class="tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="affar:${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>`;
    return nav + { spelare: shopPlayers, saker: shopItems, stall: shopKits, salj: shopSell }[tab]();
  }

  function shopPlayers() {
    if (!S.players) return '<p class="muted">Laddar spelare…</p>';
    const pos = S.sel.shopPos || 'alla';
    const owned = new Set(S.profile.squad.map(q => q.dbId).filter(Boolean));
    const list = S.players.filter(q => pos === 'alla' || q.pos === pos).sort((a, b) => FB.overall(b) - FB.overall(a));
    return `
      <section class="panel">
        <div class="row-between wrap"><div class="seg">${['alla', 'MV', 'B', 'M', 'A'].map(k => `<button type="button" data-shop-pos="${k}" aria-pressed="${k === pos}">${k === 'alla' ? 'Alla' : FB.POS[k]}</button>`).join('')}</div>
        <span class="muted small">Spelarna kommer från spelardokumentet (spelare.csv).</span></div>
        <div class="cards">${list.map(q => card(q, `<button type="button" class="primary sm full" data-a="buy-player" data-id="${esc(q.id)}" ${owned.has(q.id) || S.profile.coins < q.price ? 'disabled' : ''}>${owned.has(q.id) ? 'Finns i laget' : 'Köp ' + coins(q.price)}</button>`)).join('')}</div>
      </section>`;
  }

  function shopItems() {
    const it = S.profile.items;
    return `<section class="panel"><div class="items">${Object.entries(FB.ITEMS).map(([k, v]) => `
      <article class="item item-${k}"><div class="item-art" aria-hidden="true"></div><div><h3>${esc(v.name)}</h3><p class="muted">${esc(v.desc)}</p><p class="small">Du har <b>${it[k] || 0}</b></p></div>
      <button type="button" class="primary sm" data-a="buy-item" data-item="${k}" ${S.profile.coins < v.price ? 'disabled' : ''}>Köp ${coins(v.price)}</button></article>`).join('')}</div></section>`;
  }

  function shopKits() {
    const k = S.profile.kits;
    return `<section class="panel"><div class="kits">${FB.KITS.map(kit => {
      const own = k.owned.includes(kit.id), on = k.active === kit.id;
      return `<article class="kit ${on ? 'on' : ''}">
        <div class="kit-art" style="--shirt:${esc(kit.shirt)};--stripe:${esc(kit.stripe || kit.shirt)};--shorts:${esc(kit.shorts)};--socks:${esc(kit.socks)};--num:${esc(kit.num)}"><span class="shirt"><em>10</em></span><span class="shorts"></span><span class="socks"></span></div>
        <h3>${esc(kit.name)}</h3>
        <button type="button" class="${on ? 'ghost' : 'primary'} sm" data-a="kit" data-kit="${kit.id}" ${on || (!own && S.profile.coins < kit.price) ? 'disabled' : ''}>${on ? 'Används' : own ? 'Använd' : 'Köp ' + coins(kit.price)}</button></article>`;
    }).join('')}</div></section>`;
  }

  function shopSell() {
    const p = S.profile;
    const confirm = S.sel.sellConfirm;
    return `<section class="panel"><p class="muted">Klubben köper spelare för 40 % av värdet. Vill du ha mer betalt – sälj på Global marknad.</p>
      <div class="bench">${p.squad.slice().sort((a, b) => FB.overall(b) - FB.overall(a)).map(q => {
        const price = Math.round((FB.value(q) * 0.4) / 10) * 10;
        return `<div class="benchrow"><span class="ppos ${posClass(q.pos)}">${q.pos}</span><b>${esc(q.name)}</b>${injuryTag(q)}<span class="ovr-pill">${FB.overall(q)}</span>
          ${confirm === q.uid ? `<button type="button" class="danger sm" data-a="sell" data-uid="${esc(q.uid)}">Bekräfta ${coins(price)}</button><button type="button" class="ghost sm" data-a="sell-cancel">Avbryt</button>`
            : `<button type="button" class="ghost sm" data-a="sell-ask" data-uid="${esc(q.uid)}">Sälj ${coins(price)}</button>`}</div>`;
      }).join('')}</div></section>`;
  }

  // ------------------------------------------------------------------ marknaden
  function renderMarket() {
    if (S.static) {
      return `<section class="panel"><h2>Handla med kompisar</h2>
        <p>En global marknad behöver en server där alla lag finns samlade. I den här versionen handlar ni i stället direkt med varandra: koppla ihop er under <b>Spela mot kompis</b>, lägg ut spelare och buda – sedan kan ni spela match direkt efteråt.</p>
        <button type="button" class="primary big" data-go="kompis">Till kompishandeln</button></section>`;
    }
    const tab = S.tab.marknad;
    const tabs = [['auktioner', 'Auktioner'], ['salj', 'Sälj spelare'], ['historik', 'Mina affärer']];
    const nav = `<nav class="tabs">${tabs.map(([k, l]) => `<button type="button" data-tab="marknad:${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</nav>`;
    const mk = S.market;
    if (!mk) return nav + '<p class="muted">Laddar marknaden…</p>';
    const skew = Date.now() - S.marketAt;
    const now = mk.now + skew;
    if (tab === 'auktioner') {
      const list = mk.listings.filter(l => !l.mine);
      return nav + `<section class="panel"><p class="muted">Bud dras från dina spelpengar direkt och betalas tillbaka om någon bjuder över dig. Högsta budet när tiden är ute vinner.</p>
        ${list.length ? `<div class="cards">${list.map(l => card(l.player, `
          <p class="small">Säljs av <b>${esc(l.sellerClub)}</b></p>
          <p class="small">${l.bid ? `Högsta bud ${coins(l.bid.amount)} ${l.bid.mine ? '<span class="good-text">(ditt)</span>' : `av ${esc(l.bid.club)}`}` : `Utgångspris ${coins(l.start)}`}</p>
          <p class="small">Slutar om <b class="tl" data-ends="${l.ends - skew}">${timeLeft(l.ends - now)}</b></p>
          <div class="bidrow"><input type="number" id="bid-${esc(l.id)}" min="${l.minBid}" step="10" value="${l.minBid}" aria-label="Ditt bud"><button type="button" class="primary sm" data-a="bid" data-id="${esc(l.id)}">Bjud</button></div>
          ${l.buyNow ? `<button type="button" class="ghost sm full" data-a="buynow" data-id="${esc(l.id)}">Köp nu ${coins(l.buyNow)}</button>` : ''}`)).join('')}</div>`
          : '<p>Inga spelare till salu just nu. Lägg ut en egen under <b>Sälj spelare</b>, eller be en kompis göra det.</p>'}
      </section>`;
    }
    if (tab === 'salj') {
      const mine = mk.listings.filter(l => l.mine);
      const p = S.profile;
      const uid = S.sel.listUid && p.squad.some(q => q.uid === S.sel.listUid) ? S.sel.listUid : '';
      const q = p.squad.find(x => x.uid === uid);
      return nav + `
        <section class="panel">
          <h2>Lägg ut en spelare</h2>
          <div class="form grid2">
            <label>Spelare<select id="m-uid" data-sel="listUid"><option value="">Välj…</option>${p.squad.slice().sort((a, b) => FB.overall(b) - FB.overall(a)).map(x => `<option value="${esc(x.uid)}" ${x.uid === uid ? 'selected' : ''}>${esc(x.name)} (${x.pos}, ${FB.overall(x)})</option>`).join('')}</select></label>
            <label>Utgångspris<input id="m-start" type="number" min="50" step="50" value="${q ? Math.round(FB.value(q) * 0.6 / 50) * 50 : 500}"></label>
            <label>Köp nu-pris (valfritt)<input id="m-buynow" type="number" min="50" step="50" placeholder="tomt = bara bud" value="${q ? Math.round(FB.value(q) * 1.2 / 50) * 50 : ''}"></label>
            <label>Hur länge?<select id="m-min"><option value="5">5 minuter</option><option value="60" selected>1 timme</option><option value="360">6 timmar</option><option value="1440">1 dygn</option></select></label>
          </div>
          ${q ? `<p class="muted small">Värde enligt spelet: ${coins(FB.value(q))}. Spelaren lämnar truppen medan auktionen pågår.</p>` : ''}
          <button type="button" class="primary" data-a="list" ${uid ? '' : 'disabled'}>Lägg ut på marknaden</button>
        </section>
        <section class="panel"><h2>Dina auktioner</h2>
          ${mine.length ? `<div class="bench">${mine.map(l => `<div class="benchrow"><span class="ppos ${posClass(l.player.pos)}">${l.player.pos}</span><b>${esc(l.player.name)}</b>
            <span>${l.bid ? `Bud ${coins(l.bid.amount)} (${esc(l.bid.club)})` : `Inga bud · start ${coins(l.start)}`}</span><span class="tl" data-ends="${l.ends - skew}">${timeLeft(l.ends - now)}</span>
            ${l.bid ? '' : `<button type="button" class="ghost sm" data-a="unlist" data-id="${esc(l.id)}">Ta tillbaka</button>`}</div>`).join('')}</div>` : '<p class="muted">Du har inga spelare ute till försäljning.</p>'}
        </section>`;
    }
    return nav + `<section class="panel"><h2>Mina affärer</h2>${mk.history.length ? `<ul class="inbox">${mk.history.map(h => `<li><time>${new Date(h.closed).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>${h.sold ? `Sålde <b>${esc(h.name)}</b> till ${esc(h.club || '')}` : `Köpte <b>${esc(h.name)}</b> av ${esc(h.club || '')}`} för ${coins(h.price)}</li>`).join('')}</ul>` : '<p class="muted">Inga affärer än.</p>'}</section>`;
  }

  function tickMarket() {
    for (const el of app.querySelectorAll('.tl[data-ends]')) el.textContent = timeLeft(+el.dataset.ends - Date.now());
    if (Date.now() - (S.marketAt || 0) > 8000 && !S.busy && !(document.activeElement && document.activeElement.tagName === 'INPUT')) loadMarket();
  }

  // ------------------------------------------------------------------ spelardokument
  function renderDoc() {
    if (!S.players) return '<p class="muted">Laddar…</p>';
    const filter = (S.sel.docFilter || '').toLowerCase();
    const cols = ['shooting', 'passing', 'dribbling', 'defending', 'pace', 'stamina', 'diving'];
    const search = `<input id="doc-filter" type="search" placeholder="Sök namn…" value="${esc(S.sel.docFilter || '')}" aria-label="Sök spelare">`;
    if (!canEditDoc()) {
      // bara läsa: ägaren bestämmer vem som får ändra
      return `
      <section class="panel">
        <p>Det här är <b>spelare.csv</b> – alla spelare som finns i affären och deras statistik. Utespelare har sex värden, målvakter har diving och passing.</p>
        <p class="muted">${S.static ? docGithubText() : `Bara ägaren av spelet${S.docOwner ? ` (<b>${esc(S.docOwner)}</b>)` : ''} och de som fått tillåtelse kan ändra dokumentet. Fråga ägaren om du vill ändra något.`}</p>
        ${search}
      </section>
      <section class="panel table-wrap">
        <table class="doc ro">
          <thead><tr><th>Namn</th><th>Pos</th><th>Land</th>${cols.map(c => `<th title="${esc(FB.STAT_HELP[c])}">${FB.STAT_SHORT[c]}</th>`).join('')}<th>OVR</th><th>Pris</th></tr></thead>
          <tbody>${S.players.filter(p => !filter || p.name.toLowerCase().includes(filter)).map(p => {
            const gk = p.pos === 'MV';
            return `<tr><td><b>${esc(p.name)}</b></td><td><span class="ppos ${posClass(p.pos)}">${p.pos}</span></td><td>${esc(p.nation)}</td>
              ${cols.map(c => `<td class="numc">${(gk ? c === 'diving' || c === 'passing' : c !== 'diving') ? p.stats[c] : '<span class="muted">–</span>'}</td>`).join('')}
              <td class="numc"><b>${FB.overall(p, false)}</b></td><td class="numc">${FB.formatCoins(p.price)}</td></tr>`;
          }).join('')}</tbody>
        </table>
      </section>`;
    }
    const rows = S.docRows || (S.docRows = S.players.map(p => JSON.parse(JSON.stringify(p))));
    const others = (S.editors || []).filter(x => x.name !== S.profile.name);
    const access = S.profile.role !== 'admin' ? '' : `
      <section class="panel">
        <h2>Vem får ändra dokumentet?</h2>
        <p class="muted">Du äger spelet, så du får alltid ändra. Ge tillåtelse till dem du litar på – alla andra kan bara läsa.</p>
        ${others.length ? `<div class="bench">${others.map(x => `<div class="benchrow access-row"><b>${esc(x.name)}</b><span class="muted">${esc(x.club)}</span>
          ${x.role === 'editor' ? '<span class="good-text small">Får ändra</span><button type="button" class="ghost sm" data-a="doc-allow" data-name="' + esc(x.name) + '" data-allow="0">Ta bort rätten</button>'
            : '<span class="muted small">Får bara läsa</span><button type="button" class="primary sm" data-a="doc-allow" data-name="' + esc(x.name) + '" data-allow="1">Ge rätt att ändra</button>'}</div>`).join('')}</div>`
          : '<p class="muted">Inga andra spelare har konto än.</p>'}
      </section>`;
    return `${access}
      <section class="panel">
        <p>Det här är <b>spelare.csv</b> – ett enkelt dokument med alla spelare och deras statistik. Ändra här och tryck <b>Spara</b>, eller öppna filen i ett kalkylprogram. Utespelare har sex värden, målvakter har diving och passing. Lämna priset tomt så räknas det ut automatiskt.</p>
        <div class="row-between wrap">
          ${search}
          <div class="row"><button type="button" class="ghost" data-a="doc-add">Lägg till spelare</button><button type="button" class="primary" data-a="doc-save" ${S.docDirty ? '' : 'disabled'}>Spara dokumentet</button></div>
        </div>
      </section>
      <section class="panel table-wrap">
        <table class="doc">
          <thead><tr><th>Namn</th><th>Pos</th><th>Land</th>${cols.map(c => `<th title="${esc(FB.STAT_HELP[c])}">${FB.STAT_SHORT[c]}</th>`).join('')}<th>OVR</th><th>Pris</th><th></th></tr></thead>
          <tbody>${rows.map((p, i) => {
            if (filter && !p.name.toLowerCase().includes(filter)) return '';
            const gk = p.pos === 'MV';
            return `<tr data-row="${i}">
              <td><input data-doc="name" value="${esc(p.name)}" aria-label="Namn"></td>
              <td><select data-doc="pos" aria-label="Position">${['MV', 'B', 'M', 'A'].map(k => `<option ${p.pos === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
              <td><input data-doc="nation" value="${esc(p.nation)}" class="w-nat" aria-label="Land"></td>
              ${cols.map(c => {
                const on = gk ? (c === 'diving' || c === 'passing') : c !== 'diving';
                return `<td>${on ? `<input data-doc="s.${c}" type="number" min="1" max="99" value="${p.stats[c] != null ? p.stats[c] : 50}" class="num" aria-label="${FB.STAT_NAME[c]}">` : '<span class="muted">–</span>'}</td>`;
              }).join('')}
              <td><b>${FB.overall({ pos: p.pos, stats: p.stats }, false)}</b></td>
              <td><input data-doc="price" type="number" min="0" step="50" value="${p.priceAuto ? '' : p.price}" placeholder="${FB.value({ pos: p.pos, stats: p.stats })}" class="num w-price" aria-label="Pris"></td>
              <td><button type="button" class="iconx" data-a="doc-del" data-row="${i}" aria-label="Ta bort">×</button></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </section>`;
  }

  // Länk till spelare.csv i GitHub-projektet när spelet ligger på GitHub Pages
  function githubFileUrl() {
    if (!/\.github\.io$/i.test(location.hostname)) return null;
    const owner = location.hostname.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    const repo = seg && !/\.html?$/i.test(seg) ? seg : location.hostname;
    return `https://github.com/${owner}/${repo}/blob/HEAD/docs/spelare.csv`;
  }
  function docGithubText() {
    const url = githubFileUrl();
    return `Dokumentet är filen <b>docs/spelare.csv</b> i spelets GitHub-projekt. Bara den som äger projektet – och de som fått tillgång – kan ändra den. Efter en ändring tar det någon minut innan den syns här.${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener">Öppna filen på GitHub</a>` : ''}`;
  }

  // ------------------------------------------------------------------ inställningar
  function renderSettings() {
    const s = S.settings;
    const sv = !!comm.voice;
    return `
      <section class="panel form">
        <label>Klubbnamn<div class="row"><input id="s-club" maxlength="24" value="${esc(S.profile.club)}"><button type="button" class="ghost" data-a="rename">Spara</button></div></label>
        <label class="inline">Matchlängd ${durationSelect('dur-s')}</label>
        <label class="check"><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}> Ljud (publik, spark, visselpipa)</label>
        <label class="check"><input type="checkbox" data-setting="voice" ${s.voice ? 'checked' : ''}> Kommentator läser upp händelser ${sv ? '' : '<span class="muted small">(ingen svensk röst hittades i webbläsaren – texten visas ändå)</span>'}</label>
      </section>
      <section class="panel">
        <h2>Kontroller</h2>
        <div class="two-col">
          <div><h3>Mobil / surfplatta</h3><ul class="plain">
            <li><b>Joystick</b> – dra med vänster tumme var som helst i nedre vänstra hörnet</li>
            <li><b>Passa</b> – tryck på en lagkamrat, eller på Passa-knappen</li>
            <li><b>Skjut</b> – håll in, ju längre desto hårdare (max 100 %)</li>
            <li><b>Dribbla</b> – fryser försvararna i 1,5 s eller tappar bollen</li>
            <li><b>Sprinta</b> – håll in, max 10 sekunder, tar extra ork</li>
            <li><b>Byt</b> – byter till spelaren närmast motståndaren med bollen</li>
            <li><b>Tackla</b> – glidtackling åt hållet du drar joysticken</li></ul></div>
          <div><h3>Tangentbord</h3><ul class="plain">
            <li><kbd>W A S D</kbd> eller pilar – spring</li><li><kbd>Shift</kbd> – sprinta</li>
            <li><kbd>J</kbd> – passa / byt spelare</li><li><kbd>K</kbd> eller <kbd>Mellanslag</kbd> – skjut (håll in) / tackla</li>
            <li><kbd>L</kbd> – dribbla</li><li><kbd>Esc</kbd> – paus</li><li>Klicka på en lagkamrat för att passa honom</li></ul></div>
        </div>
      </section>
      ${S.static ? `<section class="panel"><h2>Ditt lag</h2>
        <p class="muted">Laget sparas i den här webbläsaren. Spara en kopia ibland – du kan läsa in den igen här eller på en annan dator eller mobil.</p>
        <div class="row"><button type="button" class="ghost" data-a="export">Spara en kopia</button><label class="ghost file-btn">Läs in kopia<input type="file" id="f-import" accept=".json,application/json" hidden></label><button type="button" class="ghost" data-a="logout">Byt lag</button></div></section>`
        : `<section class="panel row-between"><span>Inloggad som <b>${esc(S.profile.name)}</b></span><button type="button" class="danger" data-a="logout">Logga ut</button></section>`}`;
  }

  // ------------------------------------------------------------------ resultat
  function renderResult() {
    const r = S.lastResult;
    if (!r) return '<p class="muted">Inget resultat.</p>';
    const cls = r.outcome === 'win' ? 'win' : r.outcome === 'draw' ? 'draw' : 'loss';
    const head = { win: 'Vinst!', draw: 'Oavgjort', loss: 'Förlust' }[r.outcome] || '';
    return `
      <section class="panel result ${cls}">
        <p class="eyebrow">${esc(r.title || '')}</p>
        <h2>${head}</h2>
        <div class="final">${esc(r.home)} <b>${r.score[0]}–${r.score[1]}</b> ${esc(r.away)}</div>
        ${r.shootout ? `<p>Straffar ${r.shootout.score[0]}–${r.shootout.score[1]}</p>` : ''}
        ${r.reward ? `<p class="reward">+${coins(r.reward)}</p>` : ''}
        ${r.notes && r.notes.length ? `<ul class="plain">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${r.scorers && r.scorers.length ? `<p class="muted">Mål: ${r.scorers.map(s => `${esc(s.name)} ${s.min}'${s.own ? ' (självmål)' : ''}`).join(', ')}</p>` : ''}
        <div class="row center">
          ${r.next ? `<button type="button" class="primary big" data-go="${r.next}">${r.next === 'turnering' ? 'Till turneringen' : 'Spela igen'}</button>` : ''}
          <button type="button" class="ghost" data-go="hem">Till startsidan</button>
        </div>
      </section>`;
  }

  // ------------------------------------------------------------------ matcher
  function launchMatch(cfg) {
    // cfg: { adapter | match, online, guest, autoContinue, onEnd }
    sound.setOn(S.settings.sound);
    sound.init();
    comm.voiceOn = S.settings.voice && !!comm.voice;
    app.hidden = true;
    matchRoot.hidden = false;
    document.body.classList.add('in-match');
    const ui = new FB.MatchUI(matchRoot, cfg.adapter, {
      sound, commentator: comm, online: cfg.online, guest: cfg.guest, autoContinue: cfg.autoContinue,
      allowSubs: true, settings: S.settings,
      onSettings: s => { S.settings = s; store.set('fb_settings', s); },
      onEnd: res => cfg.onEnd(res),
    });
    let last = performance.now(), raf = 0;
    const loop = now => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try { ui.frame(dt); } catch (e) { console.error(e); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    game = { ui, stop() { cancelAnimationFrame(raf); ui.destroy(); } };
    window.__fbGame = { ui, adapter: cfg.adapter }; // för felsökning och automatiska tester
    setTimeout(() => ui.renderer.resize(), 50);
    const root = matchRoot.querySelector('.match');
    if (root) root.focus();
  }

  function endMatch() {
    if (game) { game.stop(); game = null; }
    matchRoot.hidden = true;
    matchRoot.innerHTML = '';
    app.hidden = false;
    document.body.classList.remove('in-match');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }

  async function startQuick(oppId, diff) {
    const info = FB.AI_TEAMS.find(t => t.id === oppId);
    let matchId;
    try { matchId = (await api('POST', '/api/match/start', { mode: 'quick', difficulty: diff })).matchId; } catch (e) { toast(e.message, 'bad'); return; }
    const home = FB.teamFromProfile(S.profile);
    const away = FB.makeAITeam(info, FB.hash(info.id));
    FB.resolveKits(home, away);
    const match = new E.Match({ home, away, human: [true, false], durationSec: S.settings.duration, difficulty: diff });
    launchMatch({
      adapter: new FB.LocalAdapter(match, 0),
      onEnd: res => reportResult(matchId, res, { title: `Snabbmatch · ${FB.DIFFICULTY[diff].label}`, home: home.name, away: away.name, next: 'spela' }),
    });
  }

  async function startTournamentMatch() {
    const t = S.profile.tournament;
    if (!t || t.status !== 'active') return;
    const me = t.entrants.findIndex(e => e.user);
    const m = t.rounds[t.round].find(x => x.a === me || x.b === me);
    const e = t.entrants[m.a === me ? m.b : m.a];
    let matchId;
    try { matchId = (await api('POST', '/api/match/start', { mode: 'tournament' })).matchId; } catch (err) { toast(err.message, 'bad'); return; }
    const diff = e.rating < 60 ? 'easy' : e.rating < 72 ? 'medium' : 'hard';
    const home = FB.teamFromProfile(S.profile);
    const away = FB.makeAITeam({ id: e.id, name: e.name, short: e.short, rating: e.rating, kit: e.kit }, e.seed);
    FB.resolveKits(home, away);
    const match = new E.Match({ home, away, human: [true, false], durationSec: S.settings.duration, difficulty: diff, mustWin: true });
    launchMatch({
      adapter: new FB.LocalAdapter(match, 0),
      onEnd: res => reportResult(matchId, res, { title: `Turnering · ${FB.TOURNAMENT_ROUNDS[t.round]}`, home: home.name, away: away.name, next: 'turnering' }),
    });
  }

  async function reportResult(matchId, res, meta) {
    endMatch();
    const gf = res.score[0], ga = res.score[1];
    const shootoutWin = res.shootout ? res.shootout.winner === 0 : false;
    const injuries = res.injuries.filter(i => i.side === 0).map(i => ({ uid: i.uid, sev: i.sev }));
    const r = { title: meta.title, home: meta.home, away: meta.away, score: res.score, shootout: res.shootout, scorers: res.scorers, next: meta.next, notes: [] };
    try {
      const out = await api('POST', '/api/match/result', { matchId, gf, ga, shootoutWin, injuries, drinks: res.drinksUsed[0] });
      r.outcome = out.outcome;
      r.reward = out.reward;
      if (out.hurt && out.hurt.length) r.notes.push('Skadade: ' + out.hurt.join(', ') + '. Läk dem i Mitt lag → Sjukstugan.');
      if (out.healed && out.healed.length) r.notes.push('Friska igen: ' + out.healed.join(', ') + '.');
      if (out.tournament) {
        const t = out.tournament;
        if (t.status === 'won') r.notes.push(`Du vann turneringen och hela potten på ${FB.formatCoins(t.pot)} spelpengar!`);
        else if (t.status === 'out') r.notes.push('Du är utslagen ur turneringen.');
        else r.notes.push(`Vidare till ${FB.TOURNAMENT_ROUNDS[t.round].toLowerCase()}en!`);
      }
    } catch (e) {
      r.outcome = gf > ga || shootoutWin ? 'win' : gf === ga ? 'draw' : 'loss';
      r.notes.push('Resultatet kunde inte sparas: ' + e.message);
    }
    S.lastResult = r;
    go('resultat');
  }

  // ------------------------------------------------------------------ kompismatch
  async function friendConnect() {
    if (net) return net;
    S.friend = { state: 'connecting' };
    render();
    const n = S.static
      ? new FB.P2PNet({ profile: () => S.profile, stake: wager => api('POST', '/api/friend/stake', { wager }), team: () => FB.teamFromProfile(S.profile) })
      : new FB.Net(S.token);
    try { await n.connect(); } catch (e) { S.friend = null; toast(e.message, 'bad'); render(); return null; }
    net = n;
    n.on('lobby', m => { S.friend = { state: 'lobby', role: m.role, opponent: m.opponent, wager: m.wager, code: m.code }; S.trade = { mine: [], theirs: [], bids: {}, pending: {} }; if (!game) render(); });
    n.on('trade', m => onTrade(m));
    n.on('error', m => { toast(m.msg, 'bad'); if (S.friend && S.friend.state === 'connecting') { S.friend = null; render(); } });
    n.on('created', m => { S.friend = { state: 'waiting', code: m.code, wager: m.wager }; render(); });
    n.on('start', m => startFriendMatch(m));
    n.on('peerLeft', m => {
      toast(m.reason, 'bad');
      if (game && S.friend && S.friend.playing) S.friend.peerLeft = true;
      else refundPending();
    });
    n.on('settled', m => onFriendSettled(m));
    n.on('close', () => {
      if (net && net !== n) return; // en ny anslutning har redan tagit över
      net = null;
      const settling = S.friend && (S.friend.settled || S.friend.settling);
      if (game && S.friend && S.friend.playing && !settling) { endMatch(); toast(S.static ? 'Anslutningen till kompisen bröts.' : 'Anslutningen till servern bröts.', 'bad'); go('kompis'); }
      if (S.friend && S.friend.playing && settling) return; // resultatet visas strax
      S.friend = null;
      if (!game) render();
    });
    return n;
  }

  function startFriendMatch(m) {
    if (m.coins != null) S.profile.coins = m.coins;
    refundPending();
    S.trade = null;
    S.friend = { state: 'playing', playing: true, role: m.role, opponent: m.opponent, wager: m.wager };
    if (m.role === 'host') {
      const home = FB.teamFromProfile(S.profile);
      const away = m.guestTeam;
      FB.resolveKits(home, away);
      const match = new E.Match({ home, away, human: [true, true], durationSec: S.settings.duration, difficulty: 'medium' });
      const adapter = new FB.HostAdapter(match, net);
      launchMatch({ adapter, online: true, autoContinue: true, onEnd: () => { adapter.sendEnd(); S.friend.ended = true; S.friend.res = match.result(); maybeFinishFriend(); } });
    } else {
      const adapter = new FB.GuestAdapter(net);
      launchMatch({ adapter, online: true, guest: true, onEnd: res => { S.friend.ended = true; S.friend.res = res; maybeFinishFriend(); } });
    }
    // om motståndaren lämnar mitt i
    const watch = setInterval(() => {
      if (!S.friend || !S.friend.playing) { clearInterval(watch); return; }
      if (S.friend.peerLeft && S.friend.settled) { clearInterval(watch); maybeFinishFriend(true); }
    }, 300);
  }

  async function onFriendSettled(m) {
    if (!S.friend) return;
    S.friend.settling = true;
    if (S.static) {
      // utan server räknar varje webbläsare ut sin egen del av resultatet
      const host = S.friend.role === 'host', side = host ? 0 : 1, sc = m.result.score;
      try {
        await api('POST', '/api/friend/settle', {
          mine: host ? sc[0] : sc[1], theirs: host ? sc[1] : sc[0], wager: S.friend.wager, opponent: S.friend.opponent,
          injuries: (m.injuries || []).filter(i => i.side === side), drinks: (m.drinks || [0, 0])[side], walkover: !!m.result.walkover,
        });
      } catch (e) { toast(e.message, 'bad'); }
      if (!S.friend) return;
    } else if (m.profile) S.profile = m.profile;
    S.friend.settled = m;
    maybeFinishFriend();
  }

  // ------------------------------------------------------------------ handel med kompis (webbläsarversionen)
  function sendListings() {
    const tr = S.trade;
    if (!tr || !net) return;
    tr.mine = tr.mine.filter(x => S.profile.squad.some(q => q.uid === x.uid));
    net.send({ t: 'trade', k: 'list', items: tr.mine.map(x => ({ uid: x.uid, price: x.price, player: S.profile.squad.find(q => q.uid === x.uid) })) });
  }

  async function refundPending() {
    const tr = S.trade;
    if (!tr) return;
    const total = Object.values(tr.pending).reduce((a, x) => a + x.amount, 0);
    tr.pending = {};
    if (total > 0) {
      try { await api('POST', '/api/friend/refund', { amount: total }); toast(`${FB.formatCoins(total)} spelpengar från obesvarade köp och bud är tillbaka.`); } catch (e) { toast(e.message, 'bad'); }
    }
  }

  async function completeSale(uid, amount) {
    const tr = S.trade;
    try {
      const r = await api('POST', '/api/friend/sell', { uid, amount, club: S.friend.opponent });
      tr.mine = tr.mine.filter(x => x.uid !== uid);
      delete tr.bids[uid];
      net.send({ t: 'trade', k: 'sold', uid, amount, player: r.player });
      sendListings();
      toast(`${r.player.name} såld för ${FB.formatCoins(amount)} spelpengar!`, 'good');
    } catch (e) {
      net.send({ t: 'trade', k: 'reject', uid, msg: e.message });
      toast(e.message, 'bad');
    }
    if (!game) render();
  }

  async function onTrade(m) {
    const tr = S.trade;
    if (!tr || !S.friend || !net) return;
    const uid = String(m.uid || '').slice(0, 40);
    switch (m.k) {
      case 'list':
        tr.theirs = (Array.isArray(m.items) ? m.items : []).slice(0, 20).map(x => ({
          uid: String(x.uid || '').slice(0, 40), price: Math.max(0, Math.round(+x.price || 0)), player: FB.Logic.cleanOwnedPlayer(x.player, 'x'),
        }));
        break;
      case 'buy': {
        const l = tr.mine.find(x => x.uid === uid), amount = Math.round(+m.amount || 0);
        if (!l || amount < l.price) { net.send({ t: 'trade', k: 'reject', uid, msg: 'Spelaren är inte till salu för det priset längre.' }); break; }
        return completeSale(uid, amount);
      }
      case 'bid': {
        const l = tr.mine.find(x => x.uid === uid);
        if (!l) { net.send({ t: 'trade', k: 'reject', uid, msg: 'Spelaren är inte till salu längre.' }); break; }
        tr.bids[uid] = Math.max(1, Math.round(+m.amount || 0));
        const q = S.profile.squad.find(x => x.uid === uid);
        toast(`${S.friend.opponent} bjuder ${FB.formatCoins(tr.bids[uid])} på ${q ? q.name : 'din spelare'}.`);
        break;
      }
      case 'sold': {
        const pend = tr.pending[uid];
        if (!pend) break;
        delete tr.pending[uid];
        try {
          await api('POST', '/api/friend/receive', { player: m.player, amount: pend.amount, club: S.friend.opponent });
          toast(`Du köpte ${(m.player && m.player.name) || 'spelaren'}!`, 'good');
        } catch (e) { toast(e.message, 'bad'); }
        break;
      }
      case 'reject': {
        const pend = tr.pending[uid];
        if (!pend) break;
        delete tr.pending[uid];
        try { await api('POST', '/api/friend/refund', { amount: pend.amount }); } catch (e) { /* visas nedan */ }
        toast(`${String(m.msg || 'Affären blev inte av.').slice(0, 120)} Pengarna är tillbaka.`, 'bad');
        break;
      }
    }
    if (!game) render();
  }

  async function tradeOffer(uid, kind, amount) {
    const tr = S.trade;
    if (!tr || tr.pending[uid] || !net) return;
    if (!(amount > 0)) return toast('Skriv ett belopp.', 'bad');
    try {
      await api('POST', '/api/friend/escrow', { amount });
      tr.pending[uid] = { amount, kind };
      net.send({ t: 'trade', k: kind, uid, amount });
    } catch (e) { toast(e.message, 'bad'); }
    render();
  }

  // ------------------------------------------------------------------ spara och läsa in kopia av laget
  async function exportTeam() {
    try {
      const r = await api('GET', '/api/export');
      const blob = new Blob([JSON.stringify(r.data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `matchdag-${String(S.profile.club || 'lag').toLowerCase().replace(/[^a-z0-9åäö]+/gi, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('En kopia av laget har sparats som fil.', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  }

  function importTeam(file) {
    file.text()
      .then(txt => { let data; try { data = JSON.parse(txt); } catch (e) { throw new Error('Filen gick inte att läsa.'); } return api('POST', '/api/import', { data }); })
      .then(r => { S.token = r.token; store.set('fb_token', r.token); S.screen = 'hem'; toast(`${S.profile.club} är inläst.`, 'good'); render(); })
      .catch(err => toast(err.message, 'bad'));
  }

  function maybeFinishFriend(force) {
    const f = S.friend;
    if (!f || !f.settled || (!f.ended && !force)) return;
    const st = f.settled;
    const host = f.role === 'host';
    const my = host ? st.result.score[0] : st.result.score[1], their = host ? st.result.score[1] : st.result.score[0];
    endMatch();
    S.lastResult = {
      title: `Kompismatch mot ${f.opponent}`, home: S.profile.club, away: f.opponent, score: [my, their],
      outcome: my > their ? 'win' : my === their ? 'draw' : 'loss',
      reward: my > their ? f.wager * 2 + FB.FRIEND_WIN_REWARD : my === their ? 0 : 0,
      notes: [st.result.walkover ? 'Matchen avgjordes på walkover.' : '', my === their && f.wager ? 'Insatsen betalades tillbaka.' : ''].filter(Boolean),
      scorers: [], next: 'kompis',
    };
    S.friend = null;
    // vänta lite innan anslutningen stängs så att sista meddelandet hinner fram till kompisen
    const n = net;
    net = null;
    if (n) setTimeout(() => n.close(), S.static ? 1500 : 0);
    go('resultat');
  }

  // ------------------------------------------------------------------ händelser
  app.addEventListener('submit', async e => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const mode = S.static ? 'new' : S.sel.loginMode || 'login';
    const name = $('#f-name').value.trim(), pin = $('#f-pin') ? $('#f-pin').value.trim() : '';
    const club = mode === 'new' ? ($('#f-club').value.trim() || name + ' FC') : undefined;
    try {
      const r = await api('POST', mode === 'new' ? '/api/register' : '/api/login', { name, pin, club });
      S.token = r.token;
      store.set('fb_token', r.token);
      S.screen = 'hem';
      render();
      loadLeaderboard();
    } catch (err) { toast(err.message, 'bad'); }
  });

  app.addEventListener('click', e => {
    const t = e.target.closest('button, [data-go]');
    if (!t || t.disabled) return;
    sound.init();
    const d = t.dataset;
    if (d.go) return go(d.go);
    if (d.loginMode) { S.sel.loginMode = d.loginMode; return render(); }
    if (d.pickTeam) {
      return api('POST', '/api/login', { name: d.pickTeam })
        .then(r => { S.token = r.token; store.set('fb_token', r.token); S.screen = 'hem'; render(); })
        .catch(err => toast(err.message, 'bad'));
    }
    if (d.tab) { const [scr, tab] = d.tab.split(':'); S.tab[scr] = tab; S.sel.swap = null; S.sel.sellConfirm = null; render(); if (scr === 'marknad') loadMarket(); return; }
    if (d.diff) { S.sel.diff = d.diff; S.sel.opp = null; return render(); }
    if (d.opp) { S.sel.opp = d.opp; return render(); }
    if (d.fee) { S.sel.fee = +d.fee; return render(); }
    if (d.shopPos) { S.sel.shopPos = d.shopPos; return render(); }
    if (d.trainPick) { S.sel.train = d.trainPick; return render(); }
    if (d.formation) return act(() => api('POST', '/api/lineup', { formation: d.formation, lineup: S.profile.lineup }));
    if (d.swap) return onSwap(d.swap);
    const a = d.a;
    if (!a) return;
    const P = S.profile;
    switch (a) {
      case 'clear-inbox': return act(() => api('POST', '/api/inbox/clear'));
      case 'start-quick': return startQuick(d.oppId, d.diffId);
      case 'start-tournament': return act(() => api('POST', '/api/tournament/start', { fee: +d.feeId }), 'Turneringen har börjat – lycka till!');
      case 'play-tournament': return startTournamentMatch();
      case 'leave-tournament': return act(() => api('POST', '/api/tournament/leave'));
      case 'new-tournament': return act(() => api('POST', '/api/tournament/clear'));
      case 'auto-lineup': return act(() => api('POST', '/api/lineup', { formation: P.formation, lineup: FB.autoLineup(P.squad, P.formation) }), 'Bästa elvan är vald.');
      case 'train': return act(() => api('POST', '/api/train', { uid: d.uid, stat: d.stat }), r => `+${r.gain} ${FB.STAT_NAME[d.stat]}!`);
      case 'boots': return act(() => api('POST', '/api/boots', { uid: d.uid }), '+3 pace och +3 shooting!');
      case 'scout': return act(() => api('POST', '/api/scout'), r => (r.gold ? 'Guldkikaren hittade riktiga talanger!' : 'Scouten är tillbaka.'));
      case 'sign': return act(() => api('POST', '/api/sign', { index: +d.index }), 'Ny spelare i truppen!');
      case 'heal': return act(() => api('POST', '/api/heal', { uid: d.uid }), 'Spelaren är frisk igen.');
      case 'heal-item': return act(() => api('POST', '/api/heal', { uid: d.uid, useItem: true }), 'Medicinväskan gjorde susen.');
      case 'buy-player': return act(() => api('POST', '/api/shop/player', { id: d.id }), 'Spelaren köptes och finns nu i truppen.');
      case 'buy-item': return act(() => api('POST', '/api/shop/item', { item: d.item }), `${FB.ITEMS[d.item].name} köpt.`);
      case 'kit': return act(() => api('POST', '/api/shop/kit', { kit: d.kit }), 'Nytt matchställ på!');
      case 'sell-ask': S.sel.sellConfirm = d.uid; return render();
      case 'sell-cancel': S.sel.sellConfirm = null; return render();
      case 'sell': S.sel.sellConfirm = null; return act(() => api('POST', '/api/shop/sell', { uid: d.uid }), r => `Såld för ${FB.formatCoins(r.price)}.`);
      case 'bid': {
        const v = +($('#bid-' + CSS.escape(d.id)) || {}).value;
        return act(async () => { await api('POST', '/api/market/bid', { id: d.id, amount: v }); await loadMarket(); }, 'Bud lagt!');
      }
      case 'buynow': return act(async () => { await api('POST', '/api/market/buy', { id: d.id }); await loadMarket(); }, 'Köpt! Spelaren finns nu i truppen.');
      case 'list': {
        const body = { uid: $('#m-uid').value, start: +$('#m-start').value, buyNow: $('#m-buynow').value ? +$('#m-buynow').value : null, minutes: +$('#m-min').value };
        S.sel.listUid = null;
        return act(async () => { await api('POST', '/api/market/list', body); await loadMarket(); }, 'Spelaren ligger ute på marknaden.');
      }
      case 'unlist': return act(async () => { await api('POST', '/api/market/cancel', { id: d.id }); await loadMarket(); }, 'Spelaren är tillbaka i truppen.');
      case 'doc-add': {
        const rows = S.docRows;
        const id = String(rows.reduce((m, p) => Math.max(m, parseInt(p.id, 10) || 0), 0) + 1);
        rows.unshift({ id, name: 'Ny spelare', pos: 'M', nation: 'Sverige', stats: { shooting: 60, passing: 60, dribbling: 60, defending: 60, pace: 60, stamina: 60, diving: 50 }, priceAuto: true });
        S.docDirty = true; return render();
      }
      case 'doc-del': S.docRows.splice(+d.row, 1); S.docDirty = true; return render();
      case 'doc-allow': return act(async () => {
        S.editors = (await api('POST', '/api/doc/editors', { name: d.name, allow: d.allow === '1' })).users;
      }, d.allow === '1' ? `${d.name} får nu ändra dokumentet.` : `${d.name} kan nu bara läsa dokumentet.`);
      case 'doc-save': return act(async () => {
        const r = await api('PUT', '/api/players', { players: S.docRows });
        S.players = r.players; S.docRows = null; S.docDirty = false;
      }, 'Spelardokumentet är sparat.');
      case 'rename': return act(() => api('POST', '/api/club', { club: $('#s-club').value }), 'Klubbnamnet är ändrat.');
      case 'logout': return logout();
      case 'friend-create': {
        const wager = Math.max(0, Math.round(+$('#f-wager').value || 0));
        return friendConnect().then(n => { if (n) n.send({ t: 'create', wager }); });
      }
      case 'friend-join': {
        const code = $('#f-code').value.trim().toUpperCase();
        if (code.length !== 4) return toast('Koden är fyra bokstäver.', 'bad');
        return friendConnect().then(n => { if (n) { S.friend = { state: 'connecting' }; render(); n.send({ t: 'join', code }); } });
      }
      case 'friend-cancel': refundPending(); if (net) { net.send({ t: 'leave' }); net.close(); net = null; } S.friend = null; return render();
      case 'friend-start': if (net) { net.send({ t: 'start' }); toast('Startar matchen…'); } return;
      case 'trade-list': {
        const uid = $('#t-uid').value, price = Math.max(0, Math.round(+$('#t-price').value || 0));
        const q = P.squad.find(x => x.uid === uid);
        if (!q) return toast('Välj en spelare.', 'bad');
        const why = FB.Logic.canRemove(P, q);
        if (why) return toast(why, 'bad');
        S.trade.mine.push({ uid, price });
        sendListings();
        return render();
      }
      case 'trade-unlist': {
        const tr = S.trade;
        tr.mine = tr.mine.filter(x => x.uid !== d.uid);
        if (tr.bids[d.uid]) { net.send({ t: 'trade', k: 'reject', uid: d.uid, msg: 'Spelaren togs bort från försäljning.' }); delete tr.bids[d.uid]; }
        sendListings();
        return render();
      }
      case 'trade-buy': { const x = S.trade.theirs.find(y => y.uid === d.uid); return x && tradeOffer(d.uid, 'buy', x.price); }
      case 'trade-bid': return tradeOffer(d.uid, 'bid', Math.round(+($('#tb-' + CSS.escape(d.uid)) || {}).value || 0));
      case 'trade-accept': { const amount = S.trade.bids[d.uid]; return amount && completeSale(d.uid, amount); }
      case 'trade-decline': {
        delete S.trade.bids[d.uid];
        net.send({ t: 'trade', k: 'reject', uid: d.uid, msg: 'Budet nekades.' });
        return render();
      }
      case 'export': return exportTeam();
    }
  });

  function onSwap(uid) {
    const p = S.profile;
    const first = S.sel.swap;
    if (!first) { S.sel.swap = uid; return render(); }
    S.sel.swap = null;
    if (first === uid) return render();
    const lineup = p.lineup.slice();
    const i = lineup.indexOf(first), j = lineup.indexOf(uid);
    if (i >= 0 && j >= 0) { lineup[i] = uid; lineup[j] = first; }
    else if (i >= 0) lineup[i] = uid;
    else if (j >= 0) lineup[j] = first;
    else return render();
    act(() => api('POST', '/api/lineup', { formation: p.formation, lineup }));
  }

  app.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'f-import' && t.files && t.files[0]) { importTeam(t.files[0]); t.value = ''; return; }
    if (t.dataset.setting) {
      const k = t.dataset.setting;
      S.settings[k] = t.type === 'checkbox' ? t.checked : +t.value;
      store.set('fb_settings', S.settings);
      if (k === 'sound') sound.setOn(S.settings.sound);
      return;
    }
    if (t.dataset.sel) { S.sel[t.dataset.sel] = t.value; return render(); }
    const tr = t.closest('tr[data-row]');
    if (tr && t.dataset.doc) {
      const p = S.docRows[+tr.dataset.row];
      const k = t.dataset.doc;
      if (k === 'name' || k === 'nation') p[k] = t.value;
      else if (k === 'pos') p.pos = t.value;
      else if (k === 'price') { const v = Math.round(+t.value || 0); p.priceAuto = !(v > 0); p.price = v; }
      else if (k.startsWith('s.')) p.stats[k.slice(2)] = Math.max(1, Math.min(99, Math.round(+t.value || 1)));
      S.docDirty = true;
      render();
    }
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'doc-filter') {
      S.sel.docFilter = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const el = $('#doc-filter'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    }
    if (e.target.id === 'f-code') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });

  window.addEventListener('hashchange', () => {
    const h = location.hash.slice(1);
    if (!game && h && h !== S.screen && ['hem', 'spela', 'turnering', 'kompis', 'lag', 'affar', 'marknad', 'dokument', 'installningar'].includes(h)) go(h);
  });

  // ------------------------------------------------------------------ start
  // Utan server (GitHub Pages, eller filen öppnad direkt) körs allt i webbläsaren
  async function detectStatic() {
    if (window.MATCHDAG_MODE) return window.MATCHDAG_MODE === 'static';
    if (/\.github\.io$/i.test(location.hostname) || location.protocol === 'file:') return true;
    try {
      const r = await fetch('/api/leaderboard', { cache: 'no-store' });
      return !(r.ok && (r.headers.get('content-type') || '').includes('json'));
    } catch (e) { return true; }
  }

  (async function boot() {
    S.static = await detectStatic();
    document.body.classList.toggle('static', S.static);
    const h = location.hash.slice(1);
    if (['spela', 'turnering', 'kompis', 'lag', 'affar', 'marknad', 'dokument', 'installningar'].includes(h)) S.screen = h;
    if (S.token) {
      try { await api('GET', '/api/profile'); } catch (e) { S.token = null; store.set('fb_token', null); }
    }
    render();
    if (S.token) {
      loadLeaderboard();
      if (S.screen === 'marknad' && !S.static) loadMarket();
      if (S.screen === 'affar' || S.screen === 'dokument') loadPlayers();
      if (S.screen === 'dokument') loadEditors();
    }
  })();

  window.FBApp = { S, go, render };
})();
