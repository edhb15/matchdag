/* Matchens gränssnitt: joystick, knappar, ork-mätare, miniplan, paus, kommentator
   och de interaktiva lägena (frispark, straff, räddning, skada). */
(function (root) {
  'use strict';
  const FB = root.FB, E = FB.Engine;
  const hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CHARGE_TIME = 1.1;

  // ---------------------------------------------------------------- lokal match
  class LocalAdapter {
    constructor(match, side) { this.m = match; this.side = side; this.flip = side === 1; }
    update(dt) { this.m.update(dt); }
    scene() {
      const m = this.m, markers = [];
      for (let s = 0; s < 2; s++) {
        if (m.human[s] && m.teams[s].controlled) markers.push({ p: m.teams[s].controlled, color: s === this.side ? '#ffd23f' : '#ff6b6b' });
      }
      return {
        all: m.all, teams: m.teams, ball: m.ball, cam: m.cam, flip: this.flip, markers, netPulse: m.netPulse, time: m.time,
        ballOwned: !!m.ball.owner, celebrate: m.phase === 'goal' && m.celebrator ? m.celebrator.uid : null,
      };
    }
    info() {
      const m = this.m, t = m.teams[this.side], c = t.controlled, r = m.restart;
      const restartTaker = m.phase === 'restart' && !!r && r.taker === c;
      return {
        phase: m.phase, clock: m.clock, half: m.half, score: m.scoreArr(),
        teams: m.teams.map(q => ({ name: q.name, short: q.short, kit: q.kit, gkKit: q.gkKit })),
        controlled: c, hasBall: !!c && m.ball.owner === c,
        canKick: !!c && m.ball.owner === c && (m.phase === 'play' || (restartTaker && r.wait <= 0)),
        restartTaker, restartType: r ? r.type : null, keeperHold: m.keeperHolding() ? m.keeperHolding().side : null, prompts: m.publicPrompts().filter(p => p.side === this.side),
        shootout: m.shootout ? m.shootoutScore() : null, drinks: m.drinks[this.side], subsLeft: t.subsLeft,
        players: t.players, bench: t.bench, ball: m.ball, stats: m.result().stats, scorers: m.scorers,
      };
    }
    setInput(jx, jy, sprint) { this.m.setInput(this.side, jx, jy, sprint); }
    action(a) { this.m.action(this.side, a); }
    answer(id, ans) { this.m.answerPrompt(id, ans); }
    events() { return this.m.takeEvents(); }
    sub(outUid, inUid) { return this.m.substitute(this.side, outUid, inUid); }
    drink() { return this.m.useEnergyDrink(this.side); }
    forfeit() { this.m.forfeit(this.side); }
    continueMatch() { this.m.continueMatch(); }
    setPaused(p) { this.m.paused = p; }
    result() { return this.m.result(); }
  }

  // ---------------------------------------------------------------- gränssnittet
  class MatchUI {
    constructor(container, adapter, opts) {
      this.el = container;
      this.ad = adapter;
      this.opts = opts || {};
      this.sound = opts.sound;
      this.comm = opts.commentator;
      this.input = { jx: 0, jy: 0, keys: new Set(), sprintBtn: false, charging: false, chargeT: 0, chargeFor: null };
      this.promptId = null;
      this.prompt = null;
      this.fkPath = null; this.fkDone = false; this.fkKey = { y: E.CY, z: 1.4, curve: 0 };
      this.penAim = { y: E.CY, z: 1.0, hover: null };
      this.ended = false;
      this.paused = false;
      this.halftimeT = 0;
      this.build();
      this.renderer = new FB.Renderer(this.canvas);
      this.bind();
      if (this.comm) this.comm.onLine = (t, prio) => this.tick(t, prio);
    }

    build() {
      this.el.innerHTML = `
      <div class="match" tabindex="-1">
        <canvas class="pitch"></canvas>
        <div class="hud-top">
          <div class="scorebug">
            <span class="kitchip" data-k="0"></span><b class="tn" data-t="0"></b>
            <span class="score">0–0</span>
            <b class="tn" data-t="1"></b><span class="kitchip" data-k="1"></span>
            <span class="clock">0'</span>
          </div>
          <canvas class="minimap" width="168" height="109" aria-label="Miniplan"></canvas>
          <button class="pause-btn" type="button" aria-label="Paus"><span></span><span></span></button>
        </div>
        <div class="flash" aria-hidden="true"></div>
        <div class="ticker" aria-live="polite"></div>
        <div class="player-panel">
          <div class="pp-name"></div>
          <div class="meter"><span class="meter-l">ORK</span><div class="bar"><i class="ork"></i></div></div>
          <div class="meter"><span class="meter-l">SPRINT</span><div class="bar"><i class="spr"></i></div><span class="meter-v spr-v"></span></div>
        </div>
        <div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
        <div class="actions">
          <button type="button" class="act act-shoot" data-act="shoot"><b>Skjut</b><small>håll in · K</small></button>
          <button type="button" class="act act-pass" data-act="pass"><b>Passa</b><small>tryck på spelare · J</small></button>
          <button type="button" class="act act-dribble" data-act="dribble"><b>Dribbla</b><small>L</small></button>
          <button type="button" class="act act-tackle" data-act="tackle"><b>Tackla</b><small>K</small></button>
          <button type="button" class="act act-switch" data-act="switch"><b>Byt</b><small>J</small></button>
          <button type="button" class="act act-sprint" data-act="sprint"><b>Sprinta</b><small>Shift</small></button>
        </div>
        <div class="hint" hidden></div>
        <div class="power" hidden><div class="power-bar"><i></i></div><div class="power-txt"></div></div>
        <div class="prompt-layer" hidden></div>
        <div class="overlay" hidden></div>
        <div class="rotate-hint" hidden>Vänd mobilen till liggande läge för bästa spel</div>
      </div>`;
      const q = s => this.el.querySelector(s);
      this.root = q('.match');
      this.canvas = q('.pitch');
      this.mini = q('.minimap');
      this.miniCtx = this.mini.getContext('2d');
      this.tickerEl = q('.ticker');
      this.flashEl = q('.flash');
      this.actionsEl = q('.actions');
      this.powerEl = q('.power');
      this.hintEl = q('.hint');
      this.promptEl = q('.prompt-layer');
      this.overlayEl = q('.overlay');
      this.joyZone = q('.joy-zone');
      this.joyBase = q('.joy-base');
      this.joyKnob = q('.joy-knob');
      this.rotateEl = q('.rotate-hint');
      this.hud = {
        score: q('.score'), clock: q('.clock'), tn: [...this.el.querySelectorAll('.tn')], chips: [...this.el.querySelectorAll('.kitchip')],
        name: q('.pp-name'), ork: q('.ork'), spr: q('.spr'), sprV: q('.spr-v'),
      };
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.root.classList.add('touch');
    }

    bind() {
      const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); (this.unbind = this.unbind || []).push(() => el.removeEventListener(ev, fn, o)); };
      on(window, 'resize', () => this.renderer.resize());
      // joystick
      let joyId = null, cx = 0, cy = 0, joyT = 0, joyMoved = 0;
      const R = 56;
      on(this.joyZone, 'pointerdown', e => {
        if (joyId != null) return;
        joyId = e.pointerId;
        joyT = performance.now(); joyMoved = 0;
        this.joyZone.setPointerCapture(e.pointerId);
        const r = this.joyZone.getBoundingClientRect();
        cx = e.clientX; cy = e.clientY;
        this.joyBase.style.left = (cx - r.left) + 'px';
        this.joyBase.style.top = (cy - r.top) + 'px';
        this.joyBase.classList.add('active');
        this.sound && this.sound.init();
        e.preventDefault();
      });
      on(this.joyZone, 'pointermove', e => {
        if (e.pointerId !== joyId) return;
        let dx = e.clientX - cx, dy = e.clientY - cy;
        const d = hyp(dx, dy);
        joyMoved = Math.max(joyMoved, d);
        if (d > R) { dx *= R / d; dy *= R / d; }
        this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        this.input.jx = dx / R; this.input.jy = -dy / R;
      });
      const joyEnd = e => {
        if (e.pointerId !== joyId) return;
        joyId = null;
        // ett snabbt tryck utan att dra = passa till lagkamraten som trycktes på
        if (e.type === 'pointerup' && joyMoved < 12 && performance.now() - joyT < 300) this.tapPass(e.clientX, e.clientY);
        this.input.jx = 0; this.input.jy = 0;
        this.joyKnob.style.transform = '';
        this.joyBase.classList.remove('active');
        this.joyBase.style.left = ''; this.joyBase.style.top = '';
      };
      on(this.joyZone, 'pointerup', joyEnd);
      on(this.joyZone, 'pointercancel', joyEnd);

      // knappar
      for (const b of this.actionsEl.querySelectorAll('.act')) {
        on(b, 'pointerdown', e => { e.preventDefault(); this.sound && this.sound.init(); b.setPointerCapture(e.pointerId); this.press(b.dataset.act, true); b.classList.add('down'); });
        const up = e => { if (!b.classList.contains('down')) return; b.classList.remove('down'); this.press(b.dataset.act, false); };
        on(b, 'pointerup', up);
        on(b, 'pointercancel', up);
        on(b, 'contextmenu', e => e.preventDefault());
      }
      on(this.el.querySelector('.pause-btn'), 'click', () => this.openPause());

      // tryck på en lagkamrat = passa till honom
      on(this.canvas, 'pointerdown', e => {
        this.sound && this.sound.init();
        this.tapPass(e.clientX, e.clientY);
      });

      // tangentbord
      on(window, 'keydown', e => this.key(e, true));
      on(window, 'keyup', e => this.key(e, false));
      on(window, 'blur', () => { this.input.keys.clear(); this.input.sprintBtn = false; this.cancelCharge(); });
    }

    tapPass(clientX, clientY) {
      if (this.prompt) return false;
      const info = this.lastInfo;
      if (!info || !info.canKick) return false;
      const r = this.canvas.getBoundingClientRect();
      const x = clientX - r.left, y = clientY - r.top;
      let best = null, bd = 60;
      for (const p of info.players) {
        if (p === info.controlled) continue;
        const s = this.renderer.screen.get(p.uid);
        if (!s) continue;
        const d = Math.min(hyp(s.x - x, s.y - y), hyp(s.x - x, s.y - s.h * 0.4 - y));
        if (d < bd) { bd = d; best = p; }
      }
      if (!best) return false;
      this.ad.action({ type: 'pass', target: best.uid });
      this.cancelCharge();
      return true;
    }

    destroy() {
      (this.unbind || []).forEach(f => f());
      if (this.comm) { this.comm.onLine = null; this.comm.stop(); }
      this.el.innerHTML = '';
    }

    // ------------------------------------------------------------ knappar
    press(act, down) {
      const info = this.lastInfo;
      if (act === 'sprint') { this.input.sprintBtn = down; return; }
      if (!info) return;
      if (act === 'shoot') {
        if (down) { if (info.canKick) this.startCharge('shot'); }
        else this.releaseCharge();
        return;
      }
      if (!down) return;
      if (act === 'pass') this.ad.action({ type: 'pass' });
      else if (act === 'dribble') this.ad.action({ type: 'dribble' });
      else if (act === 'tackle') this.ad.action({ type: 'tackle' });
      else if (act === 'switch') this.ad.action({ type: 'switch' });
    }

    startCharge(kind) {
      this.input.charging = true; this.input.chargeT = 0; this.input.chargeFor = kind;
    }
    cancelCharge() { this.input.charging = false; this.powerEl.hidden = true; }
    releaseCharge() {
      if (!this.input.charging) return;
      const power = clamp(this.input.chargeT / CHARGE_TIME, 0.05, 1);
      const kind = this.input.chargeFor;
      this.cancelCharge();
      if (kind === 'shot') this.ad.action({ type: 'shoot', power });
      else if (kind === 'freekick') this.answerFreeKick(power);
    }

    key(e, down) {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      const map = { arrowleft: 'l', a: 'l', arrowright: 'r', d: 'r', arrowup: 'u', w: 'u', arrowdown: 'dn', s: 'dn' };
      if (k === 'escape' || k === 'p') { if (down) this.paused ? this.closePause() : this.openPause(); return; }
      if (this.prompt) { this.promptKey(k, down, e); return; }
      if (map[k]) { if (down) this.input.keys.add(map[k]); else this.input.keys.delete(map[k]); e.preventDefault(); return; }
      if (k === 'shift') { this.input.sprintKey = down; return; }
      if (e.repeat) return;
      const info = this.lastInfo;
      if (!info) return;
      if (k === 'k' || k === ' ') {
        e.preventDefault();
        if (info.hasBall) this.press('shoot', down);
        else if (down) this.ad.action({ type: 'tackle' });
        if (!down && this.input.charging) this.releaseCharge();
      } else if ((k === 'j' || k === 'e') && down) {
        this.ad.action({ type: info.hasBall ? 'pass' : 'switch' });
      } else if ((k === 'l' || k === 'q') && down) {
        this.ad.action({ type: 'dribble' });
      }
    }

    applyInput(dt, info) {
      const ks = this.input.keys;
      let kx = (ks.has('r') ? 1 : 0) - (ks.has('l') ? 1 : 0), ky = (ks.has('u') ? 1 : 0) - (ks.has('dn') ? 1 : 0);
      const kl = hyp(kx, ky) || 1;
      let jx = this.input.jx + kx / kl, jy = this.input.jy + ky / kl;
      const jl = hyp(jx, jy);
      if (jl > 1) { jx /= jl; jy /= jl; }
      if (this.ad.flip) { jx = -jx; jy = -jy; }
      const sprint = this.input.sprintBtn || !!this.input.sprintKey;
      if (this.prompt || this.paused) this.ad.setInput(0, 0, false);
      else this.ad.setInput(jx, jy, sprint);
      if (this.input.charging) {
        if (this.input.chargeFor === 'shot' && !info.canKick) this.cancelCharge();
        else this.input.chargeT += dt;
      }
    }

    // ------------------------------------------------------------ bildruta
    frame(dt) {
      const info0 = this.lastInfo;
      if (info0) this.applyInput(dt, info0);
      this.ad.update(dt);
      const scene = this.ad.scene();
      this.renderer.draw(scene, dt);
      const info = this.ad.info();
      this.lastInfo = info;
      this.drawPromptOverlay(info);
      this.updateHUD(info, dt);
      this.drawMinimap(scene, info);
      this.handleEvents(this.ad.events(), info);
      this.updatePrompt(info);
      this.updatePhase(info, dt);
      if (this.sound && scene.ball) {
        const bx = scene.ball.x;
        this.sound.setExcitement(clamp(1 - Math.min(bx, E.L - bx) / 35, 0, 1));
      }
      this.rotateEl.hidden = !(this.root.classList.contains('touch') && window.innerHeight > window.innerWidth * 1.1);
    }

    updateHUD(info, dt) {
      const h = this.hud;
      const sc = info.score;
      h.score.textContent = info.shootout ? `${sc[0]}–${sc[1]} (${info.shootout[0]}–${info.shootout[1]})` : `${sc[0]}–${sc[1]}`;
      const min = Math.min(90, Math.floor(info.clock));
      h.clock.textContent = info.phase === 'halftime' ? 'HT' : info.phase === 'fulltime' ? 'FT' : info.shootout ? 'STR' : `${min}'`;
      info.teams.forEach((t, i) => {
        h.tn[i].textContent = t.short;
        h.chips[i].style.background = t.kit.shirt;
        h.chips[i].style.borderColor = t.kit.shorts;
      });
      const c = info.controlled;
      if (c) {
        h.name.textContent = `${c.num} · ${c.name}`;
        h.ork.style.width = clamp(c.energy, 0, 100) + '%';
        h.ork.classList.toggle('low', c.energy < 35);
        h.spr.style.width = clamp((c.sprintGauge / 10) * 100, 0, 100) + '%';
        h.sprV.textContent = `${Math.floor(c.sprintGauge)} s`;
      }
      // knappar
      let mode = 'none';
      if (!info.prompts.length && !this.paused) {
        if (info.restartTaker) mode = 'restart';
        else if (info.phase === 'play') mode = info.hasBall ? 'ball' : 'noball';
      }
      if (mode !== this.btnMode) {
        this.btnMode = mode;
        this.actionsEl.dataset.mode = mode;
        this.joyZone.hidden = mode === 'none' && info.phase !== 'restart';
      }
      // tips när det är spelarens tur att sätta igång spelet
      let hint = '';
      if (info.restartTaker && !info.prompts.length && !this.paused) {
        const how = this.root.classList.contains('touch') ? 'tryck på en lagkamrat eller på Passa' : 'klicka på en lagkamrat eller tryck J';
        hint = {
          kickoff: `Avspark – passa bollen för att starta (${how})`,
          corner: `Hörna – ${how} för ett inlägg. Spelare i straffområdet nickar mot mål.`,
          throwin: `Inkast – ${how}`, goalkick: `Inspark – ${how}`, freekick: `Frispark – ${how}, eller håll in Skjut`,
        }[info.restartType] || '';
      } else if (info.keeperHold != null && info.phase === 'play' && !info.prompts.length && !this.paused) {
        hint = info.keeperHold === this.ad.side
          ? 'Målvakten har bollen i händerna – motståndarna backar. Passa eller sparka ut.'
          : 'Målvakten håller bollen – ditt lag backar ut ur straffområdet.';
      }
      if (hint !== this.hintText) { this.hintText = hint; this.hintEl.textContent = hint; this.hintEl.hidden = !hint; }
      // kraftmätare – visar spelets skottformel
      if (this.input.charging) {
        const pct = Math.round(clamp(this.input.chargeT / CHARGE_TIME, 0.05, 1) * 100);
        const shooter = this.input.chargeFor === 'freekick' && this.prompt ? this.prompt.data.shooting : c && c.s ? c.s.shooting : 60;
        const kmh = Math.round(FB.shotSpeedKmh(shooter, pct));
        this.powerEl.hidden = false;
        this.powerEl.querySelector('i').style.width = pct + '%';
        this.powerEl.querySelector('.power-txt').textContent = `${shooter} × ${pct} / 50 = ${kmh} km/h`;
      }
    }

    drawMinimap(scene, info) {
      const ctx = this.miniCtx, w = this.mini.width, h = this.mini.height;
      const pad = 4, sx = (w - pad * 2) / E.L, sy = (h - pad * 2) / E.W;
      const flip = this.ad.flip;
      const X = x => pad + (flip ? E.L - x : x) * sx, Y = y => pad + (flip ? y : E.W - y) * sy;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(20,60,30,0.82)';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
      ctx.beginPath(); ctx.moveTo(w / 2, pad); ctx.lineTo(w / 2, h - pad); ctx.stroke();
      ctx.beginPath(); ctx.arc(w / 2, h / 2, 9.15 * sx, 0, Math.PI * 2); ctx.stroke();
      for (const gx of [0, E.L]) {
        const x0 = X(gx), x1 = X(gx + (gx === 0 ? 16.5 : -16.5));
        ctx.strokeRect(Math.min(x0, x1), Y(E.CY + 20.16 * (flip ? -1 : 1)), Math.abs(x1 - x0), 40.32 * sy);
      }
      for (const p of scene.all) {
        const t = scene.teams[p.side];
        ctx.fillStyle = p.slot === 0 ? t.gkKit.shirt : t.kit.shirt;
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      if (info.controlled) {
        ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(info.controlled.x), Y(info.controlled.y), 5.5, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(X(scene.ball.x), Y(scene.ball.y), 2.6, 0, Math.PI * 2); ctx.fill();
    }

    tick(text, prio) {
      const el = document.createElement('div');
      el.className = 'tline' + (prio >= 3 ? ' big' : '');
      el.textContent = text;
      this.tickerEl.appendChild(el);
      while (this.tickerEl.children.length > 2) this.tickerEl.firstChild.remove();
      setTimeout(() => el.classList.add('fade'), 3800);
      setTimeout(() => el.remove(), 4600);
    }

    flash(text, cls) {
      const el = this.flashEl;
      el.textContent = text;
      el.className = 'flash show ' + (cls || '');
      clearTimeout(this.flashT);
      this.flashT = setTimeout(() => { el.className = 'flash'; }, 1700);
    }

    handleEvents(evs, info) {
      const names = { teams: info.teams.map(t => t.name) };
      for (const ev of evs) {
        if (this.comm) this.comm.handle(ev, names);
        const snd = this.sound;
        switch (ev.type) {
          case 'kick': snd && snd.kick(ev.power || 10); break;
          case 'goal':
            snd && snd.cheer(1);
            this.flash('MÅL!', ev.side === this.ad.side ? 'good' : 'bad');
            break;
          case 'shootoutGoal': snd && snd.cheer(0.8); this.flash('MÅL', ev.side === this.ad.side ? 'good' : 'bad'); break;
          case 'shootoutMiss': snd && snd.cheer(0.4); this.flash('MISS', ev.side === this.ad.side ? 'bad' : 'good'); break;
          case 'save': snd && snd.cheer(0.5); break;
          case 'post': case 'bar': snd && (snd.post(), snd.cheer(0.6)); break;
          case 'foul': snd && snd.whistle(1); break;
          case 'penalty': snd && snd.whistle(2); this.flash('STRAFF!'); break;
          case 'restart': if (ev.kind === 'kickoff') snd && snd.whistle(1); break;
          case 'halftime': snd && snd.whistle(2, true); break;
          case 'fulltime': snd && snd.whistle(3, true); break;
          case 'dribbleOk': if (ev.p && ev.p.side === this.ad.side) this.flash(`Dribbling ${ev.roll} ≤ ${ev.stat}`, 'good small'); break;
          case 'dribbleFail': if (ev.p && ev.p.side === this.ad.side) this.flash(`Dribbling ${ev.roll} > ${ev.stat}`, 'bad small'); break;
          case 'extraPens': this.flash('STRAFFLÄGGNING'); break;
        }
      }
    }

    // ------------------------------------------------------------ interaktiva lägen
    updatePrompt(info) {
      const pr = info.prompts[0] || null;
      const id = pr ? pr.id : null;
      if (id !== this.promptId) {
        this.promptId = id;
        this.prompt = pr;
        this.cancelCharge();
        this.buildPrompt(pr);
      } else this.prompt = pr;
      this.root.classList.toggle('prompting', !!pr);
      if (pr && this.timerEl && pr.timeout) this.timerEl.style.width = clamp((pr.timeLeft / pr.timeout) * 100, 0, 100) + '%';
    }

    buildPrompt(pr) {
      const el = this.promptEl;
      el.innerHTML = '';
      el.className = 'prompt-layer';
      this.timerEl = null;
      if (!pr) { el.hidden = true; return; }
      el.hidden = false;
      el.classList.add('pr-' + pr.type);
      const timer = '<div class="pr-timer"><i></i></div>';
      if (pr.type === 'save') {
        el.innerHTML = `
          <div class="pr-banner"><b>${pr.data.penalty ? 'Rädda straffen!' : 'Skott mot mål!'}</b>
            <span>${pr.data.cross ? `Bollen går mot den gula ringen. Dra åt det hållet – då har ${esc(pr.data.name)} ${pr.data.diving} % chans att rädda.`
              : `Dra åt det håll ${esc(pr.data.name)} ska dyka. Rätt håll = ${pr.data.diving} % chans att rädda.`}</span>${timer}</div>
          <div class="pr-capture"></div>
          <div class="pr-zones">
            <button type="button" data-z="-1">← Vänster</button>
            <button type="button" data-z="0">Mitten</button>
            <button type="button" data-z="1">Höger →</button>
          </div>`;
        const cap = el.querySelector('.pr-capture');
        let sx = 0, sy = 0;
        cap.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; cap.setPointerCapture(e.pointerId); });
        cap.addEventListener('pointerup', e => {
          const dx = e.clientX - sx;
          let z;
          if (Math.abs(dx) > 30) z = Math.sign(dx);
          else { const w = cap.clientWidth; z = e.clientX < w / 3 ? -1 : e.clientX > (w * 2) / 3 ? 1 : 0; }
          this.answerSave(z);
        });
        for (const b of el.querySelectorAll('[data-z]')) b.addEventListener('click', () => this.answerSave(+b.dataset.z));
      } else if (pr.type === 'penalty') {
        el.innerHTML = `
          <div class="pr-banner"><b>Straff!</b><span>Tryck i målet där ${esc(pr.data.name)} ska skjuta. Utanför stolparna blir det miss.</span>${timer}</div>
          <div class="pr-capture"></div>`;
        const cap = el.querySelector('.pr-capture');
        this.penAim.hover = null;
        cap.addEventListener('pointermove', e => { this.penAim.hover = this.localPoint(e); });
        cap.addEventListener('pointerdown', e => {
          const pt = this.localPoint(e);
          const a = this.renderer.unprojectPlaneX(pt.x, pt.y, pr.data.goalX);
          if (a) this.ad.answer(pr.id, { y: a.y, z: clamp(a.z, 0.05, 4) });
        });
      } else if (pr.type === 'freekick') {
        this.fkPath = null; this.fkDone = false; this.fkKey = { y: E.CY + (pr.data.from.y > E.CY ? -2.5 : 2.5), z: 1.6, curve: 0, used: false };
        el.innerHTML = `
          <div class="pr-banner"><b>Frispark · ${pr.data.dist} m · mur med ${pr.data.wall}</b>
            <span>Dra en linje från bollen dit du vill skjuta. Böj linjen för skruv – men för mycket skruv eller för långt åt sidan gör att bollen inte går dit du vill.</span></div>
          <div class="pr-capture"></div>
          <div class="pr-fk">
            <button type="button" class="pr-redo">Rita om</button>
            <button type="button" class="pr-passa">Passa istället</button>
            <button type="button" class="act act-shoot pr-shoot" disabled><b>Skjut</b><small>håll in</small></button>
          </div>`;
        const cap = el.querySelector('.pr-capture');
        const shootBtn = el.querySelector('.pr-shoot');
        cap.addEventListener('pointerdown', e => {
          cap.setPointerCapture(e.pointerId);
          const b = this.renderer.screen.get('ball');
          const pt = this.localPoint(e);
          this.fkPath = [b ? { x: b.x, y: b.y } : pt, pt];
          this.fkDone = false; this.fkKey.used = false;
          shootBtn.disabled = true;
        });
        cap.addEventListener('pointermove', e => { if (this.fkPath && !this.fkDone) this.fkPath.push(this.localPoint(e)); });
        cap.addEventListener('pointerup', () => {
          if (!this.fkPath) return;
          const a = this.fkPath[0], z = this.fkPath[this.fkPath.length - 1];
          if (hyp(z.x - a.x, z.y - a.y) < 25) { this.fkPath = null; return; }
          this.fkDone = true; shootBtn.disabled = false;
        });
        el.querySelector('.pr-redo').addEventListener('click', () => { this.fkPath = null; this.fkDone = false; shootBtn.disabled = true; });
        el.querySelector('.pr-passa').addEventListener('click', () => this.ad.answer(pr.id, { pass: true }));
        shootBtn.addEventListener('pointerdown', e => { e.preventDefault(); shootBtn.setPointerCapture(e.pointerId); if (this.fkReady()) this.startCharge('freekick'); });
        shootBtn.addEventListener('pointerup', () => this.releaseCharge());
        shootBtn.addEventListener('pointercancel', () => this.releaseCharge());
      } else if (pr.type === 'injury') {
        const sev = FB.INJURY[pr.data.sev];
        const bench = pr.data.bench || [];
        const can = pr.data.subsLeft > 0 && bench.length;
        el.innerHTML = `
          <div class="pr-modal" role="dialog" aria-label="Skada">
            <h3>${esc(pr.data.name)} är skadad</h3>
            <p><span class="inj s${pr.data.sev}">${esc(sev.name)}</span> Alla värden sänks med ${Math.round(sev.drop * 100)} % så länge han spelar.</p>
            ${can ? `<p class="muted">Vill du byta ut honom? (${pr.data.subsLeft} byten kvar)</p>
            <div class="sub-list">${bench.map(q => `<button type="button" data-sub="${esc(q.uid)}"><span class="pos">${esc(q.pos)}</span> ${esc(q.name)} <b>${q.ovr}</b></button>`).join('')}</div>`
            : '<p class="muted">Inga byten kvar.</p>'}
            <button type="button" class="ghost" data-sub="">Spela vidare utan byte</button>${timer}
          </div>`;
        for (const b of el.querySelectorAll('[data-sub]')) b.addEventListener('click', () => this.ad.answer(pr.id, { sub: b.dataset.sub || null }));
      }
      this.timerEl = el.querySelector('.pr-timer i');
    }

    localPoint(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    answerSave(screenDir) {
      const pr = this.prompt;
      if (!pr || pr.type !== 'save') return;
      const wr = this.renderer.worldYRight() || 1;
      this.ad.answer(pr.id, { dir: screenDir === 0 ? 0 : screenDir * wr });
    }

    fkReady() { return (this.fkPath && this.fkDone) || this.fkKey.used; }

    // Räkna ut mål och skruv från linjen spelaren ritade
    fkAim() {
      const pr = this.prompt;
      if (!pr) return null;
      if (this.fkKey.used && !(this.fkPath && this.fkDone)) return { ty: this.fkKey.y, tz: this.fkKey.z, curve: this.fkKey.curve };
      const path = this.fkPath;
      const a = path[0], b = path[path.length - 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = hyp(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      let dev = 0;
      for (const p of path) { const d = (p.x - a.x) * nx + (p.y - a.y) * ny; if (Math.abs(d) > Math.abs(dev)) dev = d; }
      const curveScreen = clamp((dev / len) * 2.5, -1.5, 1.5);
      const cv = this.renderer.camVectors();
      const sR = cv.rx * -cv.fy + cv.ry * cv.fx;
      const t = this.renderer.unprojectPlaneX(b.x, b.y, pr.data.goalX) || { y: E.CY, z: 1 };
      return { ty: t.y, tz: clamp(t.z, 0.1, 6), curve: -sR * curveScreen, curveScreen };
    }

    answerFreeKick(power) {
      const pr = this.prompt;
      if (!pr || pr.type !== 'freekick') return;
      const aim = this.fkAim();
      if (!aim) return;
      this.ad.answer(pr.id, { ty: aim.ty, tz: aim.tz, curve: aim.curve, power });
      this.fkPath = null;
    }

    promptKey(k, down, e) {
      const pr = this.prompt;
      if (!pr) return;
      if (pr.type === 'save' && down) {
        if (k === 'arrowleft' || k === 'a') this.answerSave(-1);
        else if (k === 'arrowright' || k === 'd') this.answerSave(1);
        else if (k === 'arrowdown' || k === 's' || k === ' ' || k === 'arrowup' || k === 'w') this.answerSave(0);
        e.preventDefault();
      } else if (pr.type === 'penalty') {
        const a = this.penAim;
        if (!down) return;
        const wr = this.renderer.worldYRight() || 1;
        if (k === 'arrowleft' || k === 'a') a.y -= 0.4 * wr;
        else if (k === 'arrowright' || k === 'd') a.y += 0.4 * wr;
        else if (k === 'arrowup' || k === 'w') a.z = Math.min(3, a.z + 0.25);
        else if (k === 'arrowdown' || k === 's') a.z = Math.max(0.1, a.z - 0.25);
        else if (k === ' ' || k === 'k' || k === 'enter') this.ad.answer(pr.id, { y: a.y, z: a.z });
        a.hover = null; a.key = true;
        e.preventDefault();
      } else if (pr.type === 'freekick') {
        const f = this.fkKey;
        const wr = this.renderer.worldYRight() || 1;
        e.preventDefault();
        if (k === ' ' || k === 'k') {
          if (down && !e.repeat) { if (!this.fkReady()) f.used = true; this.startCharge('freekick'); }
          else if (!down) this.releaseCharge();
          return;
        }
        if (!down) return;
        if (k === 'arrowleft' || k === 'a') f.y -= 0.35 * wr;
        else if (k === 'arrowright' || k === 'd') f.y += 0.35 * wr;
        else if (k === 'arrowup' || k === 'w') f.z = Math.min(4, f.z + 0.2);
        else if (k === 'arrowdown' || k === 's') f.z = Math.max(0.1, f.z - 0.2);
        else if (k === 'q') f.curve = clamp(f.curve - 0.1, -1.5, 1.5);
        else if (k === 'e') f.curve = clamp(f.curve + 0.1, -1.5, 1.5);
        else if (k === 'j') { this.ad.answer(pr.id, { pass: true }); return; }
        else return;
        f.used = true; this.fkPath = null; this.fkDone = false;
        const btn = this.promptEl.querySelector('.pr-shoot');
        if (btn) btn.disabled = false;
      }
    }

    drawPromptOverlay(info) {
      const pr = this.prompt;
      if (!pr) return;
      const ctx = this.renderer.ctx, dpr = this.renderer.dpr;
      ctx.save();
      ctx.scale(dpr, dpr);
      if (pr.type === 'save' && pr.data.cross) {
        // visa vart skottet är på väg: en pulserande ring i målet och en streckad linje från bollen
        const t = this.renderer.worldToScreen(pr.data.goalX, pr.data.cross.y, pr.data.cross.z);
        const b = this.renderer.screen.get('ball');
        if (t) {
          const pulse = Math.sin(performance.now() / 160) * 4;
          if (b) {
            ctx.setLineDash([8, 8]); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,210,63,0.75)';
            ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.fillStyle = 'rgba(255,210,63,0.22)';
          ctx.beginPath(); ctx.arc(t.x, t.y, 26 + pulse, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = 4; ctx.strokeStyle = '#ffd23f';
          ctx.beginPath(); ctx.arc(t.x, t.y, 26 + pulse, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = '#ffd23f';
          ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (pr.type === 'penalty') {
        let pt = this.penAim.hover;
        if (!pt && this.penAim.key) pt = this.renderer.worldToScreen(pr.data.goalX, this.penAim.y, this.penAim.z);
        if (pt) crosshair(ctx, pt.x, pt.y);
      } else if (pr.type === 'freekick') {
        let pts = null;
        if (this.fkPath && this.fkPath.length > 1) pts = this.fkPath;
        else if (this.fkKey.used) {
          const b = this.renderer.screen.get('ball');
          const t = this.renderer.worldToScreen(pr.data.goalX, this.fkKey.y, this.fkKey.z);
          if (b && t) {
            const cv = this.renderer.camVectors(), sR = cv.rx * -cv.fy + cv.ry * cv.fx;
            const cs = -this.fkKey.curve / (sR || 1);
            const dx = t.x - b.x, dy = t.y - b.y, len = hyp(dx, dy), nx = -dy / len, ny = dx / len;
            pts = [];
            for (let i = 0; i <= 20; i++) {
              const u = i / 20, bow = Math.sin(u * Math.PI) * (cs / 2.5) * len;
              pts.push({ x: b.x + dx * u + nx * bow, y: b.y + dy * u + ny * bow });
            }
          }
        }
        if (pts) {
          const aim = this.fkAim();
          const wild = aim && (Math.abs(aim.curveScreen != null ? aim.curveScreen : aim.curve) > 0.6 || Math.abs(aim.ty - E.CY) > E.GOAL_HW);
          ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = wild ? 'rgba(255,120,90,0.95)' : 'rgba(255,210,63,0.95)';
          ctx.setLineDash([10, 8]);
          ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
          ctx.setLineDash([]);
          const z = pts[pts.length - 1];
          crosshair(ctx, z.x, z.y, wild ? 'rgba(255,120,90,0.95)' : undefined);
        }
      }
      ctx.restore();
    }

    // ------------------------------------------------------------ halvtid, paus, slut
    updatePhase(info, dt) {
      if (info.phase === 'halftime' && !this.htShown) {
        this.htShown = true;
        this.halftimeT = 0;
        this.showHalftime(info);
      }
      if (info.phase !== 'halftime' && this.htShown) {
        this.htShown = false;
        if (this.overlayEl.dataset.kind === 'halftime') this.hideOverlay();
      }
      if (info.phase === 'halftime' && this.opts.autoContinue) {
        this.halftimeT += dt;
        const left = Math.max(0, Math.ceil(10 - this.halftimeT));
        const el = this.overlayEl.querySelector('.ht-count');
        if (el) el.textContent = `Andra halvlek startar om ${left} s`;
        if (this.halftimeT > 10) this.ad.continueMatch();
      }
      if (info.phase === 'fulltime' && !this.ended) {
        this.ended = true;
        this.closePause(true);
        if (this.opts.onEnd) setTimeout(() => this.opts.onEnd(this.ad.result ? this.ad.result() : null), 1600);
      }
    }

    statsTable(info) {
      const st = info.stats;
      if (!st) return '';
      const row = (label, a, b) => `<tr><td>${a}</td><th>${label}</th><td>${b}</td></tr>`;
      return `<table class="stats">
        ${row('Bollinnehav', st[0].possession + ' %', st[1].possession + ' %')}
        ${row('Skott', st[0].shots, st[1].shots)}
        ${row('Skott på mål', st[0].onTarget, st[1].onTarget)}
        ${row('Passningar', st[0].passes, st[1].passes)}
        ${row('Tacklingar', st[0].tackles, st[1].tackles)}
        ${row('Räddningar', st[0].saves, st[1].saves)}
      </table>`;
    }

    showOverlay(kind, html) {
      this.overlayEl.dataset.kind = kind;
      this.overlayEl.innerHTML = `<div class="ov-card">${html}</div>`;
      this.overlayEl.hidden = false;
    }
    hideOverlay() { this.overlayEl.hidden = true; this.overlayEl.innerHTML = ''; this.overlayEl.dataset.kind = ''; }

    showHalftime(info) {
      const canControl = !this.opts.guest;
      this.showOverlay('halftime', `
        <p class="eyebrow">Halvtid</p>
        <h2 class="ov-score">${esc(info.teams[0].name)} ${info.score[0]}–${info.score[1]} ${esc(info.teams[1].name)}</h2>
        ${this.statsTable(info)}
        <div class="ov-actions">
          ${this.opts.allowSubs !== false ? '<button type="button" class="ghost" data-a="subs">Byten</button>' : ''}
          ${info.drinks > 0 ? `<button type="button" class="ghost" data-a="drink">Energidryck (${info.drinks})</button>` : ''}
          ${canControl && !this.opts.autoContinue ? '<button type="button" class="primary" data-a="go">Starta andra halvlek</button>' : '<p class="ht-count muted">Andra halvlek startar snart</p>'}
        </div>`);
      this.bindOverlay();
    }

    openPause() {
      if (this.ended || this.paused) return;
      const info = this.lastInfo;
      if (!info || info.phase === 'halftime') return;
      this.paused = true;
      if (!this.opts.online) this.ad.setPaused(true);
      const s = this.opts.settings || {};
      this.showOverlay('pause', `
        <p class="eyebrow">${this.opts.online ? 'Meny – matchen fortsätter online' : 'Paus'}</p>
        <h2 class="ov-score">${esc(info.teams[0].short)} ${info.score[0]}–${info.score[1]} ${esc(info.teams[1].short)}</h2>
        <div class="ov-actions col">
          <button type="button" class="primary" data-a="resume">Fortsätt</button>
          ${this.opts.allowSubs !== false ? `<button type="button" class="ghost" data-a="subs">Byten (${info.subsLeft} kvar)</button>` : ''}
          <button type="button" class="ghost" data-a="drink" ${info.drinks > 0 ? '' : 'disabled'}>Energidryck – full ork för laget (${info.drinks} st)</button>
          <button type="button" class="ghost" data-a="sound">Ljud: ${s.sound !== false ? 'på' : 'av'}</button>
          <button type="button" class="ghost" data-a="voice">Kommentatorröst: ${s.voice !== false ? 'på' : 'av'}</button>
          <button type="button" class="ghost" data-a="full">Helskärm</button>
          <button type="button" class="danger" data-a="quit">Ge upp matchen</button>
        </div>
        <p class="muted keys">Tangentbord: WASD/pilar = spring · Shift = sprinta · J = passa/byt · K = skjut (håll in)/tackla · L = dribbla · Esc = paus</p>`);
      this.bindOverlay();
    }

    closePause(force) {
      if (!this.paused) return;
      this.paused = false;
      if (!this.opts.online) this.ad.setPaused(false);
      if (force || this.overlayEl.dataset.kind === 'pause' || this.overlayEl.dataset.kind === 'subs') this.hideOverlay();
    }

    bindOverlay() {
      for (const b of this.overlayEl.querySelectorAll('[data-a]')) {
        b.addEventListener('click', () => {
          const a = b.dataset.a;
          const s = this.opts.settings || {};
          if (a === 'resume') this.closePause();
          else if (a === 'go') this.ad.continueMatch();
          else if (a === 'drink') {
            if (this.ad.drink()) this.flash('Full ork!', 'good small');
            const kind = this.overlayEl.dataset.kind;
            if (kind === 'pause') { this.paused = false; this.openPause(); }
            else if (kind === 'halftime') this.showHalftime(this.ad.info());
          } else if (a === 'subs') this.showSubs();
          else if (a === 'sound') { s.sound = s.sound === false; this.sound && this.sound.setOn(s.sound); this.opts.onSettings && this.opts.onSettings(s); this.paused = false; this.openPause(); }
          else if (a === 'voice') { s.voice = s.voice === false; if (this.comm) { this.comm.voiceOn = s.voice; if (!s.voice) this.comm.stop(); } this.opts.onSettings && this.opts.onSettings(s); this.paused = false; this.openPause(); }
          else if (a === 'full') {
            const d = document.documentElement;
            if (!document.fullscreenElement && d.requestFullscreen) d.requestFullscreen().catch(() => {});
            else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
          } else if (a === 'quit') this.confirmQuit();
          else if (a === 'back') { const kind = this.backTo; if (kind === 'halftime') this.showHalftime(this.ad.info()); else { this.paused = false; this.openPause(); } }
          else if (a === 'yesquit') { this.closePause(true); this.ad.forfeit(); }
        });
      }
    }

    confirmQuit() {
      this.backTo = 'pause';
      this.showOverlay('pause', `
        <h2>Ge upp matchen?</h2>
        <p class="muted">Matchen räknas som förlust med minst 0–3.</p>
        <div class="ov-actions"><button type="button" class="ghost" data-a="back">Nej, spela vidare</button><button type="button" class="danger" data-a="yesquit">Ja, ge upp</button></div>`);
      this.bindOverlay();
    }

    showSubs() {
      const info = this.ad.info();
      this.backTo = this.overlayEl.dataset.kind === 'halftime' ? 'halftime' : 'pause';
      const sel = this.subOut || null;
      const players = info.players.filter(p => p.slot !== 0 || true);
      const bench = (info.bench || []).filter(q => !q.out && !q.subbedOut && !q.injury);
      this.showOverlay(this.backTo === 'halftime' ? 'halftime' : 'subs', `
        <p class="eyebrow">Byten · ${info.subsLeft} kvar</p>
        <h2>${sel ? 'Vem ska in?' : 'Vem ska ut?'}</h2>
        <div class="sub-list">
          ${sel ? bench.map(q => `<button type="button" data-in="${esc(q.uid)}"><span class="pos">${esc(q.pos)}</span> ${esc(q.name)} <b>${q.ovr != null ? q.ovr : FB.overall(q)}</b></button>`).join('') || '<p class="muted">Inga friska avbytare.</p>'
            : players.map(p => `<button type="button" data-out="${esc(p.uid)}"><span class="pos">${esc(p.pos)}</span> ${esc(p.name)} <small>ork ${Math.round(p.energy)} %</small>${p.injury ? ` <span class="inj s${p.injury.sev || p.injury}">skadad</span>` : ''}</button>`).join('')}
        </div>
        <div class="ov-actions"><button type="button" class="ghost" data-a="back">Tillbaka</button></div>`);
      for (const b of this.overlayEl.querySelectorAll('[data-out]')) b.addEventListener('click', () => { this.subOut = b.dataset.out; this.showSubs(); });
      for (const b of this.overlayEl.querySelectorAll('[data-in]')) b.addEventListener('click', () => {
        if (info.subsLeft > 0) this.ad.sub(this.subOut, b.dataset.in);
        this.subOut = null;
        this.showSubs();
      });
      this.bindOverlay();
      if (info.subsLeft <= 0 && sel) this.subOut = null;
    }
  }

  function crosshair(ctx, x, y, color) {
    ctx.strokeStyle = color || 'rgba(255,210,63,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 22); ctx.stroke();
  }

  FB.LocalAdapter = LocalAdapter;
  FB.MatchUI = MatchUI;
  FB.esc = esc;
})(window);
