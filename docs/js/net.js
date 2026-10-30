/* Spela mot kompis i realtid.
   Värden kör matchmotorn och skickar ögonblicksbilder 20 gånger i sekunden.
   Gästen skickar joystick och knapptryck och ritar upp det värden skickar. */
(function (root) {
  'use strict';
  const FB = root.FB, E = FB.Engine;
  const hyp = Math.hypot;
  const STATE_NAME = Object.keys(E.STATE_CODE).reduce((o, k) => { o[E.STATE_CODE[k]] = k; return o; }, {});

  class Net {
    constructor(token) {
      this.token = token;
      this.handlers = {};
      this.ws = null;
    }
    connect() {
      return new Promise((resolve, reject) => {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        let ws;
        try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch (e) { reject(e); return; }
        this.ws = ws;
        const timer = setTimeout(() => reject(new Error('Servern svarar inte.')), 8000);
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: this.token }));
        ws.onmessage = e => {
          let m;
          try { m = JSON.parse(e.data); } catch (err) { return; }
          if (m.t === 'welcome') { clearTimeout(timer); resolve(); }
          if (m.t === 'error' && !this.handlers.error) { clearTimeout(timer); reject(new Error(m.msg)); }
          const h = this.handlers[m.t];
          if (h) h(m);
        };
        ws.onclose = () => { clearTimeout(timer); const h = this.handlers.close; if (h) h(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('Kunde inte ansluta till servern.')); };
      });
    }
    on(t, fn) { this.handlers[t] = fn; }
    send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    relay(d) { this.send({ t: 'relay', d }); }
    close() { this.handlers = {}; if (this.ws) { try { this.ws.close(); } catch (e) { /* stängd */ } } this.ws = null; }
  }

  // Värden: vanlig lokal match + skickar läget till gästen
  class HostAdapter extends FB.LocalAdapter {
    constructor(match, net) {
      super(match, 0);
      this.net = net;
      this.outbox = [];
      this.snapT = 0;
      this.rv = 0;
      net.on('relay', m => this.onGuest(m.d || {}));
    }
    onGuest(d) {
      const m = this.m;
      switch (d.k) {
        case 'in': m.setInput(1, +d.jx || 0, +d.jy || 0, !!d.sp); break;
        case 'act':
          if (d.a && ['pass', 'shoot', 'dribble', 'tackle', 'switch'].includes(d.a.type)) {
            m.action(1, { type: d.a.type, target: d.a.target != null ? String(d.a.target) : null, power: +d.a.power || 0 });
          }
          break;
        case 'ans': { const pr = m.prompts.find(p => p.id === d.id && p.side === 1); if (pr) m.answerPrompt(d.id, d.ans || {}); break; }
        case 'sub': m.substitute(1, String(d.o), String(d.i)); break;
        case 'drink': m.useEnergyDrink(1); break;
        case 'forfeit': m.forfeit(1); break;
      }
    }
    update(dt) {
      super.update(dt);
      this.snapT -= dt;
      if (this.snapT <= 0) {
        this.snapT = 0.05;
        if (this.m.rosterVersion !== this.rv) { this.rv = this.m.rosterVersion; this.net.relay({ k: 'roster', r: this.m.roster() }); }
        const ev = this.outbox.splice(0);
        this.net.relay({ k: 'snap', s: this.m.snapshot(), ev });
      }
    }
    events() {
      const e = super.events();
      for (const ev of e) this.outbox.push(ev);
      if (this.outbox.length > 80) this.outbox.splice(0, this.outbox.length - 80);
      return e;
    }
    setPaused() { /* online pausas aldrig matchen */ }
    sendEnd() {
      const r = this.m.result();
      this.net.relay({ k: 'end', r });
      this.net.send({ t: 'result', score: r.score, injuries: r.injuries, drinks: r.drinksUsed });
    }
  }

  // Gästen: bygger upp en "spegel" av matchen från värdens ögonblicksbilder
  class GuestAdapter {
    constructor(net) {
      this.net = net;
      this.side = 1;
      this.flip = true;
      this.snap = null;
      this.roster = null;
      this.evq = [];
      this.all = [];
      this.teams = [];
      this.ball = { x: E.L / 2, y: E.CY, z: 0, vx: 0, vy: 0, vz: 0, roll: 0 };
      this.answered = new Set();
      this.inp = { jx: 0, jy: 0, sp: false };
      this.sentInp = '';
      this.inT = 0;
      this.final = null;
      net.on('relay', m => {
        const d = m.d || {};
        if (d.k === 'roster') this.onRoster(d.r);
        else if (d.k === 'snap') this.onSnap(d.s, d.ev || []);
        else if (d.k === 'end') this.final = d.r;
      });
    }

    onRoster(r) {
      this.roster = r;
      const old = new Map(this.all.map(p => [p.uid, p]));
      this.teams = r.map((t, side) => ({ side, name: t.name, short: t.short, kit: t.kit, gkKit: t.gkKit }));
      const all = [];
      r.forEach((t, side) => {
        for (const q of t.players) {
          const prev = old.get(q.uid);
          all.push(Object.assign(prev || { x: 0, y: 0, vx: 0, vy: 0, face: 0, state: 'run', energy: 100, sprintGauge: 10, frozen: 0, diveH: 0, anim: 0 }, {
            uid: q.uid, name: q.name, num: q.num, pos: q.pos, slot: q.slot, side, skin: q.skin, hair: q.hair, injury: q.injury ? { sev: q.injury } : null, s: { shooting: q.sh || 60 },
          }));
        }
      });
      this.all = all;
      if (this.snap) this.applySnap(this.snap, true);
    }

    onSnap(s, ev) {
      for (const e of ev) this.evq.push(e);
      this.snap = s;
      this.snapAt = performance.now();
      if (this.all.length) this.applySnap(s, false);
    }

    applySnap(s, hard) {
      this.target = s;
      if (hard || !this.inited) {
        this.inited = true;
        s.p.forEach((a, i) => { const p = this.all[i]; if (p) { p.x = a[0]; p.y = a[1]; } });
        this.ball.x = s.b[0]; this.ball.y = s.b[1]; this.ball.z = s.b[2];
      }
    }

    update(dt) {
      const s = this.target;
      if (s && this.all.length) {
        const age = Math.min(0.15, (performance.now() - this.snapAt) / 1000);
        const k = Math.min(1, dt * 14);
        s.p.forEach((a, i) => {
          const p = this.all[i];
          if (!p) return;
          const tx = a[0] + a[2] * age, ty = a[1] + a[3] * age;
          if (hyp(tx - p.x, ty - p.y) > 4) { p.x = tx; p.y = ty; } else { p.x += (tx - p.x) * k; p.y += (ty - p.y) * k; }
          p.vx = a[2]; p.vy = a[3];
          let da = a[4] - p.face;
          while (da > Math.PI) da -= 2 * Math.PI;
          while (da < -Math.PI) da += 2 * Math.PI;
          p.face += da * k;
          p.state = STATE_NAME[a[5]] || 'run';
          p.energy = a[6]; p.sprintGauge = a[7]; p.frozen = a[8]; p.diveH = a[9];
          p.injury = a[10] ? { sev: a[10] } : null;
          p.wall = !!a[12]; p.diveDir = a[13] || 0; p.sprinting = !!a[14];
          p.anim = (p.anim || 0) + hyp(p.vx, p.vy) * dt * 1.7;
        });
        const b = this.ball, sb = s.b;
        const owner = sb[6] >= 0 ? this.all[sb[6]] : null;
        let tx = sb[0] + sb[3] * age, ty = sb[1] + sb[4] * age;
        let tz = Math.max(0, sb[2] + sb[5] * age - 4.9 * age * age);
        if (owner && owner.state === 'run') { tx = owner.x + Math.cos(owner.face) * 0.6; ty = owner.y + Math.sin(owner.face) * 0.6; }
        const kb = Math.min(1, dt * 22);
        if (hyp(tx - b.x, ty - b.y) > 6) { b.x = tx; b.y = ty; b.z = tz; }
        else { b.x += (tx - b.x) * kb; b.y += (ty - b.y) * kb; b.z += (tz - b.z) * kb; }
        b.vx = sb[3]; b.vy = sb[4]; b.vz = sb[5];
        b.roll = (b.roll || 0) + hyp(b.vx, b.vy) * dt / E.BALL_R;
        this.ownerIdx = sb[6];
      }
      this.inT -= dt;
      const key = `${this.inp.jx.toFixed(2)},${this.inp.jy.toFixed(2)},${this.inp.sp ? 1 : 0}`;
      if (this.inT <= 0 && (key !== this.sentInp || this.inT < -0.5)) {
        this.inT = 1 / 30;
        this.sentInp = key;
        this.net.relay({ k: 'in', jx: +this.inp.jx.toFixed(3), jy: +this.inp.jy.toFixed(3), sp: this.inp.sp });
      }
    }

    scene() {
      const s = this.snap;
      const markers = [];
      if (s) {
        if (this.all[s.c[1]]) markers.push({ p: this.all[s.c[1]], color: '#ffd23f' });
        if (this.all[s.c[0]]) markers.push({ p: this.all[s.c[0]], color: '#ff6b6b' });
      }
      const celebrate = null;
      return {
        all: this.all, teams: this.teams.length ? this.teams : [{ kit: FB.KITS[0], gkKit: FB.GK_KITS[0] }, { kit: FB.AWAY_KIT, gkKit: FB.GK_KITS[1] }],
        ball: this.ball, cam: s ? s.cam : { mode: 'side' }, flip: true, markers, netPulse: s ? s.np : null, time: s ? s.t : 0,
        ballOwned: this.ownerIdx >= 0, celebrate,
      };
    }

    info() {
      const s = this.snap;
      if (!s || !this.roster) {
        return { phase: 'waiting', clock: 0, half: 1, score: [0, 0], teams: [{ name: '', short: '', kit: FB.KITS[0] }, { name: '', short: '', kit: FB.AWAY_KIT }], controlled: null, hasBall: false, canKick: false, restartTaker: false, prompts: [], shootout: null, drinks: 0, subsLeft: 0, players: [], bench: [] };
      }
      const c = this.all[s.c[1]] || null;
      const ci = s.c[1];
      const hasBall = s.b[6] === ci && ci >= 0;
      const restartTaker = !!s.rs && s.rs[0] === ci;
      const r1 = this.roster[1];
      return {
        phase: s.ph, clock: s.clk, half: s.half, score: s.sc,
        teams: this.roster.map(t => ({ name: t.name, short: t.short, kit: t.kit, gkKit: t.gkKit })),
        controlled: c, hasBall, canKick: hasBall && (s.ph === 'play' || (restartTaker && s.rs[1] === 1)), restartTaker, restartType: s.rs ? s.rs[2] : null,
        prompts: (s.pr || []).filter(p => p.side === 1 && !this.answered.has(p.id)),
        shootout: s.so, drinks: r1.drinks, subsLeft: r1.subsLeft,
        players: this.all.filter(p => p.side === 1), bench: r1.bench, ball: this.ball, stats: s.st,
      };
    }

    setInput(jx, jy, sprint) { this.inp = { jx, jy, sp: !!sprint }; }
    action(a) { this.net.relay({ k: 'act', a }); }
    answer(id, ans) {
      if (this.answered.has(id)) return;
      this.answered.add(id);
      this.net.relay({ k: 'ans', id, ans });
    }
    events() { return this.evq.splice(0); }
    sub(o, i) { this.net.relay({ k: 'sub', o, i }); return true; }
    drink() { this.net.relay({ k: 'drink' }); return true; }
    forfeit() { this.net.relay({ k: 'forfeit' }); }
    continueMatch() { /* värden bestämmer */ }
    setPaused() { /* pausas inte online */ }
    result() {
      if (this.final) return this.final;
      const s = this.snap;
      return { score: s ? s.sc : [0, 0], shootout: null, injuries: [], drinksUsed: [0, 0], scorers: [], stats: s && s.st };
    }
  }

  FB.Net = Net;
  FB.HostAdapter = HostAdapter;
  FB.GuestAdapter = GuestAdapter;
})(window);
