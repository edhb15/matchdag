/* Matchmotorn: fysik, regler, datorspelare och fasta situationer.
   Körs i webbläsaren och kan även köras i Node (för automatiska tester).
   Koordinater i meter: x längs planen (0–105), y tvärs över (0–68), z uppåt. */
(function (root) {
  'use strict';
  const FB = root.FB;

  const L = 105, W = 68, CY = W / 2;
  const GOAL_HW = 3.66, GOAL_H = 2.44, GOAL_DEPTH = 2.0;
  const BALL_R = 0.11, POST_R = 0.06, G = 9.81;
  const BOX_D = 16.5, BOX_HW = 20.16, SPOT = 11;
  const DT = 1 / 60;

  // Bollfysik
  const DRAG = 0.011;          // luftmotstånd (kvadratiskt)
  const MAGNUS = 0.03;         // skruv (sidokraft)
  const ROLL_K = 0.42;         // rullmotstånd på gräs
  const ROLL_C = 0.833;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hyp = Math.hypot;
  const angDiff = (a, b) => {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  function gauss(rng) {
    let u = 0, v = 0;
    while (!u) u = rng();
    while (!v) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Ett tidssteg för en boll som inte ägs av någon spelare
  function ballStep(b, dt) {
    let bounced = false;
    if (b.z > 0.001 || b.vz > 0) {
      const sp = hyp(b.vx, b.vy, b.vz);
      const d = DRAG * sp * dt;
      b.vx -= b.vx * d; b.vy -= b.vy * d; b.vz -= b.vz * d;
      if (b.spin) {
        const vx = b.vx, vy = b.vy, hs = hyp(vx, vy) || 1;
        const a = MAGNUS * b.spin * hs * dt;
        b.vx += (-vy / hs) * a;
        b.vy += (vx / hs) * a;
        b.spin *= Math.exp(-0.3 * dt);
      }
      b.vz -= G * dt;
    } else {
      const hs = hyp(b.vx, b.vy);
      if (hs > 0) {
        const k = Math.max(0, hs - ROLL_K * (hs + ROLL_C) * dt) / hs;
        b.vx *= k; b.vy *= k;
        if (hs < 0.05) { b.vx = 0; b.vy = 0; }
      }
      if (b.spin) {
        const vx = b.vx, vy = b.vy, hs2 = hyp(vx, vy) || 1;
        const a = MAGNUS * 0.4 * b.spin * hs2 * dt;
        b.vx += (-vy / hs2) * a; b.vy += (vx / hs2) * a;
        b.spin *= Math.exp(-3 * dt);
      }
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z < 0) {
      b.z = 0;
      if (b.vz < -1.4) {
        b.vz = -b.vz * 0.5; b.vx *= 0.84; b.vy *= 0.84; b.spin *= 0.5; bounced = true;
      } else b.vz = 0;
    }
    return bounced;
  }

  // Starthastighet för en markpassning som ska rulla d meter och komma fram med vEnd
  function groundSpeedFor(d, vEnd) {
    const dist = v0 => ((v0 - vEnd) - ROLL_C * Math.log((v0 + ROLL_C) / (vEnd + ROLL_C))) / ROLL_K;
    let lo = vEnd, hi = 45;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (dist(m) < d) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }

  // Simulera bollen längs linjen (ux,uy) tills den nått avståndet d
  function simulateAlong(from, vx, vy, vz, spin, ux, uy, d) {
    const b = { x: from.x, y: from.y, z: from.z, vx, vy, vz, spin };
    const h = 1 / 120;
    for (let i = 0; i < 720; i++) {
      ballStep(b, h);
      const along = (b.x - from.x) * ux + (b.y - from.y) * uy;
      if (along >= d) return { lat: (b.x - from.x) * -uy + (b.y - from.y) * ux, z: b.z, t: i * h };
      if (hyp(b.vx, b.vy) < 0.3 && b.z <= 0) return null;
    }
    return null;
  }

  // Räkna ut avsparkshastigheten så att bollen (med skruv och luftmotstånd) når target
  function solveLaunch(from, target, speed, spin) {
    const dx = target.x - from.x, dy = target.y - from.y;
    const d = Math.max(0.5, hyp(dx, dy));
    const ux = dx / d, uy = dy / d, base = Math.atan2(dy, dx);
    const dz = target.z - from.z, v2 = speed * speed;
    const disc = v2 * v2 - G * (G * d * d + 2 * dz * v2);
    let pitch = disc > 0 ? Math.atan((v2 - Math.sqrt(disc)) / (G * d)) : Math.PI / 4;
    let yaw = 0;
    for (let i = 0; i < 10; i++) {
      const cp = Math.cos(pitch);
      const r = simulateAlong(from, speed * cp * Math.cos(base + yaw), speed * cp * Math.sin(base + yaw), speed * Math.sin(pitch), spin, ux, uy, d);
      if (!r) { pitch = Math.min(pitch + 0.08, 0.95); continue; }
      const ez = target.z - r.z;
      yaw -= Math.atan2(r.lat, d) * 0.95;
      pitch = clamp(pitch + Math.atan2(ez, d) * 0.95, -0.25, 1.1);
      if (Math.abs(r.lat) < 0.03 && Math.abs(ez) < 0.03) break;
    }
    const cp = Math.cos(pitch);
    return { vx: speed * cp * Math.cos(base + yaw), vy: speed * cp * Math.sin(base + yaw), vz: speed * Math.sin(pitch) };
  }

  // Lyra: flygtid T, landa vid (ax, ay)
  function solveLob(from, ax, ay, T) {
    const dx = ax - from.x, dy = ay - from.y, d = Math.max(1, hyp(dx, dy));
    const ux = dx / d, uy = dy / d;
    const vz = (G * T) / 2 * 1.05;
    let vh = (d / T) * 1.1;
    for (let i = 0; i < 6; i++) {
      const b = { x: from.x, y: from.y, z: Math.max(from.z, 0.01), vx: ux * vh, vy: uy * vh, vz, spin: 0 };
      let land = d;
      for (let k = 0; k < 900; k++) {
        ballStep(b, 1 / 120);
        if (b.z <= 0 && b.vz <= 0.0001 || (b.vz < 0 && b.z <= 0.02)) { land = (b.x - from.x) * ux + (b.y - from.y) * uy; break; }
      }
      if (land < 0.5) break;
      vh *= clamp(d / land, 0.7, 1.4);
      if (Math.abs(land - d) < 0.25) break;
    }
    return { vx: ux * vh, vy: uy * vh, vz };
  }

  const DIFF = {
    easy: { think: 0.5, shoot: 0.75, dribble: 0.6, slide: 0.5, reach: 0.9 },
    medium: { think: 0.34, shoot: 1, dribble: 1, slide: 1, reach: 1 },
    hard: { think: 0.22, shoot: 1.15, dribble: 1.2, slide: 1.3, reach: 1.1 },
  };
  const SKINS = ['#f1c7a5', '#e0ac85', '#c68b5e', '#9a6440', '#6e452b', '#f5d0b5', '#d39a6a'];
  const HAIRS = ['#2a1d14', '#4a3020', '#151515', '#d9b86c', '#8a5a2b', '#2b2b2b', '#b8452c'];
  const STATE_CODE = { run: 0, slide: 1, down: 2, dive: 3, wall: 4 };
  const pi = p => (p ? { uid: p.uid, name: p.name, num: p.num, side: p.side } : null);
  const blankInput = () => ({ jx: 0, jy: 0, sprint: false, actions: [] });

  class Match {
    constructor(o) {
      this.rng = FB.rng(o.seed || ((Math.random() * 1e9) | 0));
      this.human = o.human || [true, false];
      this.duration = o.durationSec || 300;
      this.difficulty = o.difficulty || 'medium';
      this.mustWin = !!o.mustWin;
      this.teams = [this.makeTeam(o.home, 0), this.makeTeam(o.away, 1)];
      this.refreshAll();
      this.ball = {
        x: L / 2, y: CY, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, lastTouch: null,
        passTarget: null, pass: null, shot: null, lofted: false, deflectCD: 0, roll: 0, inNet: false,
      };
      this.clock = 0; this.half = 1; this.time = 0; this.acc = 0;
      this.phase = 'restart'; this.phaseT = 0;
      this.events = []; this.prompts = []; this.promptSeq = 1;
      this.inputs = [blankInput(), blankInput()];
      this.cam = { mode: 'side' }; this.camHold = 0;
      this.injuries = [];
      this.drinks = [o.home.energyDrinks || 0, o.away.energyDrinks || 0];
      this.drinksUsed = [0, 0];
      this.possSide = 0; this.possTime = [0, 0];
      this.roleT = 0; this.wallT = 0;
      this.restart = null; this.dead = null; this.pen = null; this.fk = null; this.shootout = null;
      this.scorers = []; this.rosterVersion = 1; this.netPulse = null;
      this.firstKick = 0; this.lastConceded = 0; this.paused = false;
      this.setupKickoff(0);
      this.emit('start', {});
    }

    // ------------------------------------------------------------ lag
    makeTeam(def, side) {
      const formation = FB.FORMATIONS[def.formation] ? def.formation : '4-3-3';
      const squad = def.squad.map(p => JSON.parse(JSON.stringify(p)));
      const byUid = new Map(squad.map(p => [p.uid, p]));
      let lineup = (def.lineup || []).filter(u => byUid.has(u));
      if (lineup.length !== 11 || new Set(lineup).size !== 11) lineup = FB.autoLineup(squad, formation);
      const t = {
        side, name: def.name, short: def.short || def.name.slice(0, 3).toUpperCase(),
        kit: def.kit || FB.KITS[0], gkKit: def.gkKit || FB.GK_KITS[side],
        dir: side === 0 ? 1 : -1, ownGoalX: side === 0 ? 0 : L, oppGoalX: side === 0 ? L : 0,
        formation, score: 0, subsLeft: 5, controlled: null, players: [], bench: [],
        stats: { shots: 0, onTarget: 0, passes: 0, passesOk: 0, tackles: 0, fouls: 0, saves: 0 },
      };
      lineup.forEach((uid, slot) => t.players.push(this.makeMP(byUid.get(uid), side, slot, formation)));
      t.bench = squad.filter(p => !lineup.includes(p.uid));
      return t;
    }

    mpStats(def, isGK) {
      const eff = FB.effectiveStats(def);
      if (def.pos === 'MV') return { diving: eff.diving, passing: eff.passing, shooting: 35, dribbling: 30, defending: 40, pace: 52, stamina: 70 };
      return Object.assign({}, eff, { diving: isGK ? 22 : 10 });
    }

    makeMP(def, side, slot, formation) {
      const F = FB.FORMATIONS[formation];
      const isGK = slot === 0;
      const r = FB.rng(FB.hash(def.uid));
      return {
        uid: def.uid, def, name: def.name, num: def.num || slot + 1, pos: isGK ? 'MV' : F.slots[slot], realPos: def.pos,
        slot, side, s: this.mpStats(def, isGK), injury: def.injury ? { sev: def.injury.sev, old: true } : null,
        x: 0, y: 0, vx: 0, vy: 0, face: side === 0 ? 0 : Math.PI, lookAt: null,
        state: 'run', stateT: 0, energy: 100, sprintGauge: 10, sprinting: false,
        frozen: 0, kickCD: 0, tackleCD: 0, dribbleCD: 0, think: r() * 0.3, holdT: 0, noTouch: 0,
        intent: { mx: 0, my: 0, sprint: false, face: null }, role: 'shape', anim: r() * 6.28,
        skin: SKINS[(r() * SKINS.length) | 0], hair: HAIRS[(r() * HAIRS.length) | 0], jit: r() * 100,
        wall: false, diveH: 0, diveDir: 0, slideDir: 0, slideDone: false, goals: 0,
      };
    }

    refreshAll() { this.all = this.teams[0].players.concat(this.teams[1].players); }
    keeper(side) { return this.teams[side].players.find(p => p.slot === 0); }
    nearest(list, x, y) {
      let best = null, bd = 1e9;
      for (const p of list) { const d = hyp(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
      return best;
    }
    inBox(side, x, y) { const gx = side === 0 ? 0 : L; return Math.abs(x - gx) < BOX_D && Math.abs(y - CY) < BOX_HW; }
    zoneOf(y) { return y < CY - 1.3 ? -1 : y > CY + 1.3 ? 1 : 0; }
    otherZone(z) { const o = [-1, 0, 1].filter(v => v !== z); return o[(this.rng() * 2) | 0]; }
    diff(side) { return this.human[side] ? DIFF.medium : DIFF[this.difficulty] || DIFF.medium; }

    emit(type, data) {
      this.events.push(Object.assign({ type, t: this.time, clock: this.clock }, data));
      if (this.events.length > 300) this.events.splice(0, 150);
    }
    takeEvents() { const e = this.events; this.events = []; return e; }

    // ------------------------------------------------------ inmatning
    setInput(side, jx, jy, sprint) {
      const i = this.inputs[side];
      i.jx = clamp(jx || 0, -1, 1); i.jy = clamp(jy || 0, -1, 1); i.sprint = !!sprint;
    }
    action(side, a) { this.inputs[side].actions.push(a); }

    // ------------------------------------------------------ frågor till spelaren (straff, räddning …)
    openPrompt(pr, onAnswer) {
      pr.id = this.promptSeq++;
      pr.onAnswer = onAnswer;
      pr.timeLeft = pr.timeout || 0;
      this.prompts.push(pr);
      this.emit('prompt', { id: pr.id, kind: pr.type, side: pr.side });
      return pr.id;
    }
    answerPrompt(id, ans) {
      const i = this.prompts.findIndex(p => p.id === id);
      if (i < 0) return;
      const pr = this.prompts[i];
      this.prompts.splice(i, 1);
      pr.onAnswer(ans || pr.def);
    }
    promptFor(side) { return this.prompts.find(p => p.side === side) || null; }
    publicPrompts() {
      return this.prompts.map(p => ({ id: p.id, type: p.type, side: p.side, data: p.data, timeLeft: Math.round(p.timeLeft * 10) / 10, timeout: p.timeout || 0, slowmo: !!p.slowmo }));
    }

    // ------------------------------------------------------ huvudloop
    update(realDt) {
      realDt = Math.min(realDt, 0.1);
      for (const pr of this.prompts.slice()) {
        if (pr.timeout) { pr.timeLeft -= realDt; if (pr.timeLeft <= 0) this.answerPrompt(pr.id, pr.def); }
      }
      if (this.paused || this.phase === 'halftime' || this.phase === 'fulltime') return;
      let scale = 1;
      if (this.prompts.length) {
        if (this.prompts.some(p => !p.slowmo)) return;
        scale = 0.07;
        const b = this.ball, s = b.shot;
        if (s) {
          const gx = s.defSide === 0 ? 0 : L;
          if (Math.abs(b.x - gx) / (Math.abs(b.vx) + 0.1) < 0.12) scale = 0;
        }
      }
      this.acc += realDt * scale;
      let n = 0;
      while (this.acc >= DT && n++ < 8) { this.acc -= DT; this.step(DT); }
      if (this.acc > DT * 8) this.acc = 0;
    }

    step(dt) {
      this.time += dt; this.phaseT += dt;
      const b = this.ball;
      for (const p of this.all) {
        if (p.kickCD > 0) p.kickCD -= dt;
        if (p.tackleCD > 0) p.tackleCD -= dt;
        if (p.dribbleCD > 0) p.dribbleCD -= dt;
        if (p.noTouch > 0) p.noTouch -= dt;
      }
      if (b.deflectCD > 0) b.deflectCD -= dt;
      if (this.wallT > 0) { this.wallT -= dt; if (this.wallT <= 0) for (const p of this.all) p.wall = false; }
      if (this.camHold > 0) { this.camHold -= dt; if (this.camHold <= 0) this.cam = { mode: 'side' }; }

      switch (this.phase) {
        case 'dead':
          this.dead.t -= dt;
          if (this.dead.t <= 0) { const f = this.dead.then; this.dead = null; f(); }
          break;
        case 'goal': if (this.phaseT > 3.4) this.setupKickoff(this.lastConceded); break;
        case 'restart': this.stepRestart(dt); break;
        case 'freekick': this.stepFreeKick(dt); break;
        case 'penalty': this.stepPenalty(dt); break;
      }
      for (let s = 0; s < 2; s++) {
        if (!this.human[s]) continue;
        const t = this.teams[s];
        if (!t.controlled || !t.players.includes(t.controlled)) t.controlled = this.nearest(t.players.filter(p => p.pos !== 'MV'), b.x, b.y);
        this.processActions(s);
      }
      this.roleT -= dt;
      if (this.roleT <= 0) { this.roleT = 0.15; this.updateRoles(); }
      for (const p of this.all) this.think(p, dt);
      for (const p of this.all) this.movePlayer(p, dt);
      this.separate();
      if (this.phase === 'restart') this.keepDistance();
      this.updateBall(dt);
      if (this.phase === 'play') {
        this.possTime[this.possSide] += dt;
        this.clock += (dt * 90) / this.duration;
        this.checkClock();
      }
    }

    live() { return this.phase === 'play' || (this.phase === 'penalty' && this.pen && this.pen.kicked); }

    // ------------------------------------------------------ avspark, halvtid, slut
    formationSpot(p) {
      const t = this.teams[p.side];
      const [d, w] = FB.FORMATIONS[t.formation].pos[p.slot];
      let xa = p.slot === 0 ? 2 : 12 + d * 34;
      xa = Math.min(xa, L / 2 - 1.5);
      const y = CY + (w - 0.5) * W * 0.8 * (t.side === 0 ? 1 : -1);
      return [t.side === 0 ? xa : L - xa, y];
    }
    formDepth(p) { return FB.FORMATIONS[this.teams[p.side].formation].pos[p.slot][0]; }

    setupKickoff(side) {
      for (const t of this.teams) {
        for (const p of t.players) {
          const [x, y] = this.formationSpot(p);
          Object.assign(p, { x, y, vx: 0, vy: 0, state: 'run', frozen: 0, wall: false, diveH: 0, face: t.dir > 0 ? 0 : Math.PI });
        }
      }
      const t = this.teams[side];
      const fwds = t.players.filter(p => p.pos !== 'MV').sort((a, c) => this.formDepth(c) - this.formDepth(a) || Math.abs(a.y - CY) - Math.abs(c.y - CY));
      const taker = fwds[0], mate = fwds[1];
      taker.x = L / 2 - t.dir * 0.5; taker.y = CY;
      if (mate) { mate.x = L / 2 - t.dir * 1.5; mate.y = CY + 9; }
      Object.assign(this.ball, { x: L / 2, y: CY, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, shot: null, passTarget: null, pass: null, lofted: false, inNet: false });
      this.cam = { mode: 'side' };
      this.beginRestart('kickoff', side, L / 2, CY, taker);
    }

    checkClock() {
      if (this.ball.shot && !this.ball.owner) return;
      if (this.half === 1 && this.clock >= 45) {
        this.clock = 45; this.phase = 'halftime'; this.phaseT = 0; this.prompts = [];
        this.emit('halftime', { score: this.scoreArr() });
      } else if (this.half === 2 && this.clock >= 90) {
        this.clock = 90; this.fullTime();
      }
    }
    continueMatch() {
      if (this.phase !== 'halftime') return;
      this.half = 2;
      for (const p of this.all) { p.energy = Math.min(100, p.energy + 35); p.sprintGauge = 10; }
      this.setupKickoff(1 - this.firstKick);
      this.emit('secondHalf', {});
    }
    fullTime() {
      if (this.mustWin && this.teams[0].score === this.teams[1].score) {
        this.emit('extraPens', { score: this.scoreArr() });
        this.startShootout();
        return;
      }
      this.endMatch();
    }
    endMatch() {
      this.phase = 'fulltime'; this.phaseT = 0; this.prompts = []; this.cam = { mode: 'side' };
      this.emit('fulltime', { score: this.scoreArr(), shootout: this.shootout ? this.shootoutScore() : null });
    }
    forfeit(side) {
      // Ge upp: motståndaren vinner med minst 3–0
      const o = this.teams[1 - side];
      o.score = Math.max(o.score, this.teams[side].score + 3);
      this.shootout = null;
      this.endMatch();
    }
    scoreArr() { return [this.teams[0].score, this.teams[1].score]; }

    // ------------------------------------------------------ fasta situationer
    stopPlay(delay, then) { this.phase = 'dead'; this.phaseT = 0; this.dead = { t: delay, then }; }

    beginRestart(type, side, x, y, taker) {
      const t = this.teams[side], b = this.ball;
      if (type === 'corner') { x = x < L / 2 ? 0.4 : L - 0.4; y = y < CY ? 0.4 : W - 0.4; }
      else if (type === 'goalkick') { x = t.ownGoalX === 0 ? 5.5 : L - 5.5; y = CY + (y < CY ? -5 : 5); }
      else if (type === 'throwin') { x = clamp(x, 1, L - 1); y = y < CY ? 0.3 : W - 0.3; }
      x = clamp(x, 0.3, L - 0.3); y = clamp(y, 0.3, W - 0.3);
      Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, shot: null, passTarget: null, pass: null, lofted: false, inNet: false });
      for (const p of this.all) if (p.state === 'wall') { p.state = 'run'; p.wall = false; }
      if (!taker) {
        if (type === 'goalkick') taker = this.keeper(side);
        else taker = this.nearest(t.players.filter(p => p.pos !== 'MV' && p.state !== 'down'), x, y) || t.players[1];
      }
      let face;
      if (type === 'corner') face = Math.atan2(CY - y, t.oppGoalX - x + (t.dir > 0 ? -8 : 8));
      else if (type === 'kickoff') face = t.dir > 0 ? Math.PI * 0.85 : -Math.PI * 0.15;
      else face = Math.atan2(CY - y, t.oppGoalX - x);
      taker.x = x - Math.cos(face) * 0.55; taker.y = y - Math.sin(face) * 0.55;
      Object.assign(taker, { face, vx: 0, vy: 0, state: 'run', frozen: 0 });
      b.owner = taker; b.lastTouch = taker;
      this.possSide = side;
      this.restart = { type, side, taker, wait: type === 'kickoff' ? 1.2 : 0.7, t: 0, aiDelay: 0.9 + this.rng() * 0.9, x, y };
      this.phase = 'restart'; this.phaseT = 0;
      if (this.human[side]) t.controlled = taker;
      const o = this.teams[1 - side];
      if (this.human[1 - side]) o.controlled = this.nearest(o.players.filter(p => p.pos !== 'MV'), x, y);
      this.emit('restart', { kind: type, side, p: pi(taker) });
    }

    stepRestart(dt) {
      const r = this.restart;
      if (!r) return;
      r.t += dt;
      if (r.wait > 0) { r.wait -= dt; return; }
      if (!this.human[r.side]) { r.aiDelay -= dt; if (r.aiDelay <= 0) this.aiRestartKick(r); }
      else if (r.t > 12) this.aiRestartKick(r);
    }

    aiRestartKick(r) {
      const p = r.taker, t = this.teams[r.side];
      let tgt = null, lofted = null;
      if (r.type === 'corner') {
        const box = t.players.filter(q => q !== p && this.inBox(1 - r.side, q.x, q.y));
        tgt = box.sort((a, c) => c.s.shooting - a.s.shooting)[(this.rng() * Math.min(3, box.length)) | 0];
        lofted = true;
      }
      if (r.type === 'goalkick' && this.rng() < 0.45) {
        tgt = t.players.filter(q => q.pos === 'A' || q.pos === 'M').sort((a, c) => (c.x - a.x) * t.dir)[(this.rng() * 3) | 0];
        lofted = true;
      }
      if (!tgt) tgt = this.passOptions(p).q;
      if (tgt) this.doPass(p, tgt, { lofted });
      else this.passTo(p, p.x + t.dir * 25, CY, true, null);
    }

    keepDistance() {
      const r = this.restart;
      if (!r) return;
      const R = r.type === 'throwin' ? 3 : 9.15;
      for (const p of this.teams[1 - r.side].players) {
        const dx = p.x - r.x, dy = p.y - r.y, d = hyp(dx, dy);
        if (d < R) { const k = R / (d || 1); p.x += (r.x + dx * k - p.x) * 0.25; p.y += (r.y + dy * k - p.y) * 0.25; }
      }
      if (r.type === 'kickoff') {
        for (const p of this.all) {
          if (p === r.taker) continue;
          if (p.side === 0 && p.x > L / 2 - 0.4) p.x = L / 2 - 0.4;
          if (p.side === 1 && p.x < L / 2 + 0.4) p.x = L / 2 + 0.4;
        }
      }
    }

    // Foul → frispark eller straff
    foul(p, victim) {
      this.teams[p.side].stats.fouls++;
      const b = this.ball;
      this.emit('foul', { p: pi(p), victim: pi(victim) });
      victim.state = 'down'; victim.stateT = 1.4; victim.vx = victim.vy = 0;
      if (b.owner === victim) b.owner = null;
      b.vx *= 0.2; b.vy *= 0.2; b.shot = null;
      if (this.rng() < 0.2) {
        const r = this.rng();
        this.injure(victim, r < 0.6 ? 1 : r < 0.9 ? 2 : 3);
      }
      const side = victim.side;
      const fx = clamp(victim.x, 0.5, L - 0.5), fy = clamp(victim.y, 0.5, W - 0.5);
      if (this.inBox(1 - side, fx, fy)) {
        this.emit('penalty', { side });
        this.stopPlay(1.8, () => this.setupPenalty(side));
        return;
      }
      const gx = this.teams[side].oppGoalX;
      const dist = hyp(gx - fx, CY - fy);
      const angle = Math.abs(Math.atan2(fy - CY, Math.abs(gx - fx)));
      const direct = dist < 32 && angle < 0.95;
      this.stopPlay(1.6, () => (direct ? this.setupDirectFreeKick(side, fx, fy) : this.beginRestart('freekick', side, fx, fy)));
    }

    setupDirectFreeKick(side, x, y) {
      const atk = this.teams[side], def = this.teams[1 - side];
      const gx = atk.oppGoalX, b = this.ball;
      Object.assign(b, { x, y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, shot: null, passTarget: null, pass: null, inNet: false });
      const taker = atk.players.filter(p => p.pos !== 'MV' && p.state !== 'down').sort((a, c) => c.s.shooting - a.s.shooting)[0] || atk.players[1];
      const dx = gx - x, dy = CY - y, d = hyp(dx, dy), ux = dx / d, uy = dy / d, nx = -uy, ny = ux;
      const n = d < 20 ? 4 : d < 26 ? 3 : 2;
      const wc = { x: x + ux * 9.15, y: y + uy * 9.15 };
      const near = Math.sign(y - CY) || 1;
      const postLat = ((gx - x) * nx + (CY + near * GOAL_HW - y) * ny) * (9.15 / d);
      const shift = postLat * 0.55;
      const pool = def.players.filter(p => p.pos !== 'MV').sort((a, c) => hyp(a.x - wc.x, a.y - wc.y) - hyp(c.x - wc.x, c.y - wc.y));
      for (let i = 0; i < n && i < pool.length; i++) {
        const p = pool[i], o = (i - (n - 1) / 2) * 0.62 + shift;
        Object.assign(p, { x: wc.x + nx * o, y: wc.y + ny * o, vx: 0, vy: 0, state: 'wall', wall: true, frozen: 0, face: Math.atan2(-uy, -ux) });
      }
      const ts = y < CY ? -1 : 1; // ansats snett bakifrån så att kameran ser bollen
      const tx = x - ux * 1.5 + nx * ts * 1.3, ty = y - uy * 1.5 + ny * ts * 1.3;
      Object.assign(taker, { x: tx, y: ty, vx: 0, vy: 0, face: Math.atan2(y - ty, x - tx), state: 'run', frozen: 0 });
      const K = this.keeper(1 - side);
      Object.assign(K, { x: gx === L ? L - 0.6 : 0.6, y: CY - near * 1.0, vx: 0, vy: 0, state: 'run', frozen: 0 });
      for (const p of this.all) {
        if (p.wall || p === taker || p === K) continue;
        const ex = p.x - x, ey = p.y - y, dd = hyp(ex, ey);
        if (dd < 9.6) { const k = 9.6 / (dd || 1); p.x = x + ex * k; p.y = y + ey * k; }
        p.vx = p.vy = 0;
      }
      this.phase = 'freekick'; this.phaseT = 0;
      this.fk = { side, taker, x, y, gx, aiT: 1.8 + this.rng(), wall: n };
      this.cam = { mode: 'freekick', from: { x, y }, goalX: gx };
      this.camHold = 0;
      this.possSide = side;
      if (this.human[side]) {
        atk.controlled = taker;
        this.openPrompt({ type: 'freekick', side, timeout: 40, def: { pass: true }, data: { goalX: gx, from: { x, y }, wall: n, dist: Math.round(d), shooting: taker.s.shooting, name: taker.name } }, a => this.takeFreeKick(a));
      }
      this.emit('freekick', { side, p: pi(taker), dist: Math.round(d) });
    }

    stepFreeKick(dt) {
      const fk = this.fk;
      if (!fk || this.human[fk.side]) return;
      fk.aiT -= dt;
      if (fk.aiT <= 0) this.takeFreeKick(this.aiFreeKickAnswer());
    }

    aiFreeKickAnswer() {
      const fk = this.fk, K = this.keeper(1 - fk.side);
      if (this.rng() < 0.18) return { pass: true };
      const side = K.y > CY ? -1 : 1;
      return {
        ty: CY + side * (GOAL_HW - 0.6 - this.rng() * 0.9), tz: 1.0 + this.rng() * 1.1,
        curve: (this.rng() * 0.4 + 0.12) * (this.rng() < 0.5 ? -1 : 1), power: 0.72 + this.rng() * 0.2,
      };
    }

    takeFreeKick(a) {
      const fk = this.fk;
      if (!fk) return;
      const p = fk.taker;
      this.fk = null;
      if (!a || a.pass) {
        this.beginRestart('freekick', fk.side, fk.x, fk.y, p);
        return;
      }
      const b = this.ball;
      const power = clamp(+a.power || 0.8, 0.1, 1);
      const kmh = FB.shotSpeedKmh(p.s.shooting, power * 100);
      const curve = clamp(+a.curve || 0, -1.5, 1.5);
      let ty = clamp(+a.ty || CY, -20, W + 20), tz = clamp(+a.tz || 1, 0.1, 8);
      // För mycket skruv eller för långt åt sidan → bollen går inte dit man vill
      const lateral = Math.max(0, Math.abs(ty - CY) - GOAL_HW);
      const excess = Math.max(0, Math.abs(curve) - 0.6) * 1.6 + lateral * 0.3;
      const sigma = ((100 - p.s.shooting) / 100) * 0.8 + excess * 2.5;
      ty += gauss(this.rng) * sigma;
      tz = Math.max(0.1, tz + gauss(this.rng) * sigma * 0.5);
      const spin = curve * 9;
      const v = solveLaunch({ x: b.x, y: b.y, z: BALL_R }, { x: fk.gx, y: ty, z: tz }, Math.max(8, kmh / 3.6), spin);
      for (const q of this.all) if (q.state === 'wall') q.state = 'run';
      this.wallT = 1.3;
      this.phase = 'play';
      this.kick(p, v.vx, v.vy, v.vz, spin * (1 + excess * 0.7));
      this.cam = { mode: 'freekick', from: { x: fk.x, y: fk.y }, goalX: fk.gx };
      this.camHold = 2.2;
      this.emit('freekickShot', { p: pi(p), kmh: Math.round(kmh), excess: excess > 0.3 });
      this.registerShot(p, kmh, { freekick: true });
    }

    // ------------------------------------------------------ straffar
    setupPenalty(side, taker) {
      const atk = this.teams[side];
      const gx = atk.oppGoalX, s = gx === L ? -1 : 1;
      const sx = gx + s * SPOT;
      const b = this.ball;
      Object.assign(b, { x: sx, y: CY, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, owner: null, shot: null, passTarget: null, pass: null, inNet: false });
      taker = taker || atk.players.filter(p => p.pos !== 'MV' && p.state !== 'down').sort((a, c) => c.s.shooting - a.s.shooting)[0];
      const K = this.keeper(1 - side);
      for (const p of this.all) {
        Object.assign(p, { vx: 0, vy: 0, state: 'run', frozen: 0, wall: false, diveH: 0 });
        if (p === taker || p === K) continue;
        if (this.shootout) {
          const i = this.all.indexOf(p);
          p.x = L / 2 + (p.side === 0 ? -1 : 1) * (2 + (i % 4)); p.y = CY - 6 + ((i * 1.7) % 12);
        } else {
          p.x = gx + s * (BOX_D + 1.5 + this.rng() * 7); p.y = CY + (this.rng() - 0.5) * 34;
        }
      }
      Object.assign(taker, { x: sx + s * 2.3, y: CY - 0.9, face: Math.atan2(0.9, -s * 2.3) });
      Object.assign(K, { x: gx === L ? L - 0.25 : 0.25, y: CY, face: s > 0 ? 0 : Math.PI });
      this.phase = 'penalty'; this.phaseT = 0;
      this.pen = { side, taker, K, gx, aim: null, dive: null, waitAim: false, waitDive: false, kicked: false, t: 0, after: 0, resolved: false };
      this.cam = { mode: 'penalty', from: { x: sx, y: CY }, goalX: gx };
      this.camHold = 0;
      this.possSide = side;
      if (this.human[side]) {
        this.pen.waitAim = true;
        this.teams[side].controlled = taker;
        this.openPrompt({ type: 'penalty', side, timeout: 20, def: { y: CY + (this.rng() < 0.5 ? -2.2 : 2.2), z: 0.7 }, data: { goalX: gx, from: { x: sx, y: CY }, name: taker.name, shooting: taker.s.shooting } },
          a => { this.pen.aim = { y: +a.y, z: +a.z }; this.pen.waitAim = false; });
      } else this.pen.aim = this.aiPenaltyAim();
      if (this.human[1 - side]) {
        this.pen.waitDive = true;
        this.openPrompt({ type: 'save', side: 1 - side, timeout: 20, def: { dir: 0 }, data: { goalX: gx, from: { x: sx, y: CY }, penalty: true, name: K.name, diving: K.s.diving } },
          a => { this.pen.dive = a && a.dir != null ? clamp(Math.round(a.dir), -1, 1) : 0; this.pen.waitDive = false; });
      }
      this.emit('penaltySetup', { side, p: pi(taker), k: pi(K), shootout: !!this.shootout });
    }

    aiPenaltyAim() {
      const r = this.rng();
      const zone = r < 0.4 ? -1 : r < 0.8 ? 1 : 0;
      return { y: CY + zone * (2.2 + this.rng() * 1.0), z: 0.3 + this.rng() * 1.5 };
    }

    stepPenalty(dt) {
      const pen = this.pen;
      if (!pen) return;
      if (!pen.kicked) {
        if (pen.waitAim || pen.waitDive) return;
        pen.t += dt;
        const tk = pen.taker, b = this.ball;
        const dx = b.x - tk.x, dy = b.y - tk.y, d = hyp(dx, dy);
        if (pen.t > 0.3 && d > 0.5) { tk.x += (dx / d) * 5 * dt; tk.y += (dy / d) * 5 * dt; tk.anim += 9 * dt; tk.face = Math.atan2(dy, dx); }
        if (pen.t > 0.3 && d <= 0.55) this.executePenalty();
        else if (pen.t > 2) this.executePenalty();
      } else if (this.shootout && !pen.resolved) {
        pen.after += dt;
        if (pen.after > 3.2) this.recordKick(false);
      }
    }

    executePenalty() {
      const pen = this.pen, b = this.ball, tk = pen.taker, K = pen.K;
      pen.kicked = true; pen.after = 0;
      const sh = tk.s.shooting;
      const sigma = ((100 - sh) / 100) * 0.6;
      const ty = pen.aim.y + gauss(this.rng) * sigma;
      const tz = Math.max(0.12, pen.aim.z + gauss(this.rng) * sigma * 0.6);
      const kmh = FB.shotSpeedKmh(sh, 88);
      const v = solveLaunch({ x: b.x, y: b.y, z: BALL_R }, { x: pen.gx, y: ty, z: tz }, kmh / 3.6, 0);
      this.kick(tk, v.vx, v.vy, v.vz, 0);
      const cross = this.predictCross(1 - pen.side);
      const onTarget = !!cross && Math.abs(cross.y - CY) < GOAL_HW - BALL_R && cross.z < GOAL_H - BALL_R;
      const zone = cross ? this.zoneOf(cross.y) : 0;
      let dir;
      if (this.human[1 - pen.side]) dir = pen.dive;
      else dir = this.rng() < 0.33 + K.s.diving / 400 ? zone : this.otherZone(zone);
      let save = false;
      if (onTarget && dir === zone) {
        let p = K.s.diving / 100;
        if (!this.human[1 - pen.side] && (Math.abs(cross.y - CY) > 2.6 || cross.z > 1.7)) p *= 0.75;
        save = this.rng() < p;
      }
      b.shot = { shooter: pi(tk), side: pen.side, defSide: 1 - pen.side, kmh, onTarget, cross, decided: true, save, diveDir: dir, zone, t0: this.time, penalty: true, dived: true };
      if (!save) K.noTouch = 2.5;
      this.startDive(K, K.x, save ? cross.y : CY + dir * 2.6, save ? cross.z : 0.9, 0.5);
      const st = this.teams[pen.side].stats;
      st.shots++; if (onTarget) st.onTarget++;
      this.emit('penaltyKick', { side: pen.side, p: pi(tk), kmh: Math.round(kmh), onTarget });
      if (!this.shootout) { this.phase = 'play'; this.pen = null; this.camHold = 1.8; }
    }

    // ------------------------------------------------------ straffläggning
    startShootout() {
      this.shootout = { kicks: [[], []], turn: 0, order: [this.penOrder(0), this.penOrder(1)], idx: [0, 0], done: false, winner: null };
      this.emit('shootoutStart', {});
      this.stopPlay(2.2, () => this.nextShootoutKick());
    }
    penOrder(side) {
      const ps = this.teams[side].players;
      return ps.filter(p => p.slot !== 0).sort((a, c) => c.s.shooting - a.s.shooting).concat(ps.filter(p => p.slot === 0));
    }
    nextShootoutKick() {
      const so = this.shootout, side = so.turn;
      const ord = so.order[side].filter(p => this.all.includes(p));
      const taker = ord[so.idx[side] % ord.length];
      so.idx[side]++;
      this.setupPenalty(side, taker);
    }
    recordKick(scored) {
      const so = this.shootout;
      if (!so || !this.pen || this.pen.resolved) return;
      this.pen.resolved = true;
      so.kicks[so.turn].push(scored);
      this.emit(scored ? 'shootoutGoal' : 'shootoutMiss', { side: so.turn, score: this.shootoutScore() });
      const w = this.shootoutWinner();
      if (w != null) {
        so.done = true; so.winner = w;
        this.stopPlay(2.6, () => this.endMatch());
        return;
      }
      so.turn = 1 - so.turn;
      this.stopPlay(2.0, () => this.nextShootoutKick());
    }
    shootoutScore() { const k = this.shootout.kicks; return [k[0].filter(Boolean).length, k[1].filter(Boolean).length]; }
    shootoutWinner() {
      const [a, c] = this.shootout.kicks;
      const ga = a.filter(Boolean).length, gc = c.filter(Boolean).length, na = a.length, nc = c.length;
      if (na <= 5 && nc <= 5) {
        if (ga + (5 - na) < gc) return 1;
        if (gc + (5 - nc) < ga) return 0;
        if (na === 5 && nc === 5 && ga !== gc) return ga > gc ? 0 : 1;
        return null;
      }
      if (na === nc && ga !== gc) return ga > gc ? 0 : 1;
      return null;
    }

    // ------------------------------------------------------ skador och byten
    injure(p, sev) {
      p.injury = { sev, now: true };
      const s = this.mpStats(Object.assign({}, p.def, { injury: { sev } }), p.slot === 0);
      p.s = s;
      this.injuries.push({ side: p.side, uid: p.uid, sev });
      this.emit('injury', { p: pi(p), sev });
      const t = this.teams[p.side];
      const bench = t.bench.filter(q => !q.injury && !q.subbedOut);
      if (this.human[p.side]) {
        this.openPrompt({
          type: 'injury', side: p.side, timeout: 30, def: { sub: null },
          data: { uid: p.uid, name: p.name, num: p.num, sev, subsLeft: t.subsLeft, bench: bench.map(q => ({ uid: q.uid, name: q.name, pos: q.pos, num: q.num, ovr: FB.overall(q) })) },
        }, a => { if (a && a.sub) this.substitute(p.side, p.uid, a.sub); });
      } else if (sev >= 2 && t.subsLeft > 0 && bench.length) {
        const sub = bench.filter(q => q.pos === p.realPos).sort((a, c) => FB.overall(c) - FB.overall(a))[0] || bench[0];
        this.substitute(p.side, p.uid, sub.uid);
      }
    }

    substitute(side, outUid, inUid) {
      const t = this.teams[side];
      if (t.subsLeft <= 0) return false;
      const i = t.players.findIndex(p => p.uid === outUid);
      const bi = t.bench.findIndex(p => p.uid === inUid && !p.subbedOut && !p.injury);
      if (i < 0 || bi < 0) return false;
      const old = t.players[i], def = t.bench[bi];
      const np = this.makeMP(def, side, old.slot, t.formation);
      Object.assign(np, { x: old.x, y: old.y, face: old.face });
      t.players[i] = np;
      t.bench.splice(bi, 1);
      const oldDef = old.def;
      if (old.injury && old.injury.now) oldDef.injury = { sev: old.injury.sev };
      oldDef.subbedOut = true;
      t.bench.push(oldDef);
      t.subsLeft--;
      const b = this.ball;
      if (b.owner === old) b.owner = np;
      if (b.lastTouch === old) b.lastTouch = np;
      if (b.passTarget === old) b.passTarget = np;
      if (t.controlled === old) t.controlled = np;
      if (this.restart && this.restart.taker === old) this.restart.taker = np;
      if (this.fk && this.fk.taker === old) this.fk.taker = np;
      if (this.pen && this.pen.taker === old) this.pen.taker = np;
      if (this.pen && this.pen.K === old) this.pen.K = np;
      if (this.shootout) this.shootout.order[side] = this.shootout.order[side].map(p => (p === old ? np : p));
      this.refreshAll();
      this.rosterVersion++;
      this.emit('sub', { side, out: pi(old), in: pi(np) });
      return true;
    }

    useEnergyDrink(side) {
      if (this.drinks[side] <= 0) return false;
      this.drinks[side]--; this.drinksUsed[side]++;
      for (const p of this.teams[side].players) { p.energy = 100; p.sprintGauge = 10; }
      this.rosterVersion++;
      this.emit('drink', { side });
      return true;
    }

    // ------------------------------------------------------ roller och datorspelare
    updateRoles() {
      const b = this.ball;
      for (const t of this.teams) {
        const ctl = this.human[t.side] ? t.controlled : null;
        for (const p of t.players) p.role = 'shape';
        if (this.phase !== 'play') continue;
        const cand = t.players.filter(p => p.pos !== 'MV' && p.state !== 'down' && p !== ctl);
        if (b.owner && b.owner.side !== t.side) {
          const c = b.owner;
          cand.sort((a, q) => hyp(a.x - c.x, a.y - c.y) - hyp(q.x - c.x, q.y - c.y));
          const ctlNear = ctl && hyp(ctl.x - c.x, ctl.y - c.y) < 9;
          if (cand[0]) cand[0].role = ctlNear ? 'cover' : 'press';
          if (cand[1] && !ctlNear) cand[1].role = 'cover';
        } else if (!b.owner) {
          if (b.passTarget && b.passTarget.side === t.side) continue;
          let best = null, bt = 1e9;
          for (const p of cand) {
            const d = hyp(b.x - p.x, b.y - p.y) / this.maxSpeed(p, true);
            if (d < bt) { bt = d; best = p; }
          }
          if (ctl) {
            const dc = hyp(b.x - ctl.x, b.y - ctl.y) / this.maxSpeed(ctl, true);
            if (dc < bt * 0.8) best = null;
          }
          if (best) best.role = 'chase';
        }
      }
    }

    think(p, dt) {
      const it = p.intent, b = this.ball, t = this.teams[p.side];
      it.mx = 0; it.my = 0; it.sprint = false; it.face = null;
      if (p.state !== 'run' || p.frozen > 0) return;
      const ph = this.phase;
      if (ph === 'freekick' || ph === 'penalty') { p.lookAt = Math.atan2(b.y - p.y, b.x - p.x); return; }
      if (ph === 'goal') return this.thinkCelebrate(p);
      if (ph === 'dead' || ph === 'halftime' || ph === 'fulltime') {
        if (ph === 'dead' && this.shootout) return;
        const [tx, ty] = this.shapeTarget(p);
        this.moveTo(p, tx, ty, 0.45, false);
        return;
      }
      const humanCtl = this.human[p.side] && t.controlled === p;
      if (ph === 'restart' && this.restart) {
        const r = this.restart;
        if (r.taker === p) {
          if (humanCtl) {
            const inp = this.inputs[p.side];
            if (hyp(inp.jx, inp.jy) > 0.3) it.face = Math.atan2(inp.jy, inp.jx);
          }
          return;
        }
        if (r.type === 'kickoff') { const [x, y] = this.formationSpot(p); this.moveTo(p, x, y, 0.6, false); return; }
        if (r.type === 'corner' && p.slot !== 0 && !humanCtl) { this.cornerPosition(p, r); return; }
      }
      if (humanCtl) {
        const inp = this.inputs[p.side];
        const jm = hyp(inp.jx, inp.jy);
        if (jm > 0.12) { const k = Math.min(1, jm) / jm; it.mx = inp.jx * k; it.my = inp.jy * k; }
        else if (b.passTarget === p && !b.owner) this.aiReceive(p);
        it.sprint = inp.sprint;
        if (b.owner && b.owner.side !== p.side && ph === 'play') this.tryStandingTackle(p, b.owner, 0.95);
        return;
      }
      if (p.slot === 0) return this.aiKeeper(p, dt);
      if (b.owner === p) return this.aiCarrier(p, dt);
      this.aiOffBall(p);
    }

    moveTo(p, tx, ty, mag = 1, sprint = false) {
      const dx = tx - p.x, dy = ty - p.y, d = hyp(dx, dy), it = p.intent;
      if (d < 0.3) { it.mx = 0; it.my = 0; return d; }
      const m = Math.min(mag, d / 2.5);
      it.mx = (dx / d) * m; it.my = (dy / d) * m;
      it.sprint = sprint && d > 3 && p.energy > 22 && p.sprintGauge > 1;
      return d;
    }

    shapeTarget(p) {
      const t = this.teams[p.side];
      const [d, w] = FB.FORMATIONS[t.formation].pos[p.slot];
      const b = this.ball;
      const bxa = t.side === 0 ? b.x : L - b.x;
      const inPoss = this.possSide === t.side;
      const defLine = inPoss ? clamp(bxa * 0.6 - 4, 14, 60) : clamp(bxa * 0.6 - 9, 9, 50);
      let xa = defLine + d * (inPoss ? 36 : 26);
      if (inPoss && p.pos === 'A') xa += 4 + Math.sin(this.time * 0.35 + p.jit) * 4;
      xa = clamp(xa, 5, L - 4);
      let y = CY + (w - 0.5) * W * (inPoss ? 0.9 : 0.64) * (t.side === 0 ? 1 : -1) + (b.y - CY) * (inPoss ? 0.18 : 0.38);
      y += Math.sin(this.time * 0.27 + p.jit * 1.7) * 1.6;
      return [t.side === 0 ? xa : L - xa, clamp(y, 2, W - 2)];
    }

    cornerPosition(p, r) {
      const atkSide = r.side, gx = this.teams[atkSide].oppGoalX, s = gx === L ? -1 : 1;
      const mates = this.teams[p.side].players.filter(q => q.slot !== 0 && q !== r.taker);
      const i = mates.indexOf(p);
      let tx, ty;
      if (p.side === atkSide) {
        const spots = [[7, -2], [10, 3], [12, -5], [6, 4], [14, 0], [9, -7], [24, -6], [26, 8], [40, 0]];
        const sp = spots[i % spots.length];
        tx = gx + s * sp[0]; ty = CY + sp[1];
      } else {
        const spots = [[2.5, -2], [2.5, 2], [6, -5], [6, 5], [8, 0], [5, -8], [10, 3], [12, -3], [16, 6], [30, 0]];
        const sp = spots[i % spots.length];
        tx = gx + s * sp[0]; ty = CY + sp[1];
      }
      this.moveTo(p, tx, ty, 1, false);
      p.lookAt = Math.atan2(this.ball.y - p.y, this.ball.x - p.x);
    }

    thinkCelebrate(p) {
      const c = this.celebrator;
      if (c && p === c) {
        const gx = this.teams[p.side].oppGoalX;
        this.moveTo(p, gx === L ? L - 4 : 4, p.y < CY ? 3 : W - 3, 1, true);
      } else if (c && p.side === c.side && p.slot !== 0 && hyp(p.x - c.x, p.y - c.y) < 30) {
        this.moveTo(p, c.x - (p.x > c.x ? -1.5 : 1.5), c.y + ((p.slot % 3) - 1) * 1.4, 1, true);
      } else {
        const [tx, ty] = this.shapeTarget(p);
        this.moveTo(p, tx, ty, 0.35, false);
      }
    }

    interceptPoint(p) {
      const b = this.ball;
      if (b.owner) return [b.owner.x, b.owner.y];
      const sp = this.maxSpeed(p, true) * 0.9;
      const q = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin };
      for (let i = 1; i <= 30; i++) {
        ballStep(q, 0.05); ballStep(q, 0.05);
        if (q.z < 1.3 && hyp(q.x - p.x, q.y - p.y) <= sp * i * 0.1 + 0.5) return [q.x, q.y];
      }
      return [q.x, q.y];
    }
    aiReceive(p) {
      const [tx, ty] = this.interceptPoint(p);
      this.moveTo(p, tx, ty, 1, hyp(tx - p.x, ty - p.y) > 5);
    }

    aiOffBall(p) {
      const b = this.ball, t = this.teams[p.side], diff = this.diff(p.side);
      if (b.passTarget === p && !b.owner) return this.aiReceive(p);
      const c = b.owner;
      if (p.role === 'press' && c) {
        const gx = t.ownGoalX, dx = gx - c.x, dy = CY - c.y, d = hyp(dx, dy) || 1;
        this.moveTo(p, c.x + (dx / d) * 0.9 + c.vx * 0.25, c.y + (dy / d) * 0.9 + c.vy * 0.25, 1, hyp(p.x - c.x, p.y - c.y) > 4);
        if (this.phase === 'play') {
          this.tryStandingTackle(p, c, 1.15 * diff.reach);
          this.maybeSlide(p, c, diff);
        }
        return;
      }
      if (p.role === 'cover') {
        const r = c || b, gx = t.ownGoalX, dx = gx - r.x, dy = CY - r.y, d = hyp(dx, dy) || 1;
        const off = Math.min(8, d * 0.4);
        this.moveTo(p, r.x + (dx / d) * off, r.y + (dy / d) * off, 1, false);
        return;
      }
      if (p.role === 'chase') {
        const [tx, ty] = this.interceptPoint(p);
        this.moveTo(p, tx, ty, 1, true);
        return;
      }
      let [tx, ty] = this.shapeTarget(p);
      const inPoss = this.possSide === p.side;
      if (!inPoss) {
        let mk = null, md = 11;
        for (const o of this.teams[1 - p.side].players) {
          if (o.slot === 0) continue;
          const d = hyp(o.x - tx, o.y - ty);
          if (d < md) { md = d; mk = o; }
        }
        if (mk) {
          const gx = t.ownGoalX, dx = gx - mk.x, dy = CY - mk.y, d = hyp(dx, dy) || 1;
          tx = tx * 0.45 + (mk.x + (dx / d) * 1.8) * 0.55;
          ty = ty * 0.45 + (mk.y + (dy / d) * 1.8) * 0.55;
        }
      }
      const far = hyp(tx - p.x, ty - p.y);
      this.moveTo(p, tx, ty, far > 6 ? 1 : 0.75, far > 16 && !inPoss);
      if (far < 1.2) p.lookAt = Math.atan2(b.y - p.y, b.x - p.x);
    }

    tryStandingTackle(p, c, reach) {
      if (p.tackleCD > 0 || p.frozen > 0 || c.side === p.side || this.phase !== 'play') return;
      if (hyp(p.x - c.x, p.y - c.y) > reach) return;
      p.tackleCD = 0.55 + this.rng() * 0.5;
      const pr = clamp(0.2 + (p.s.defending - c.s.dribbling) / 200, 0.06, 0.5);
      if (this.rng() >= pr) return;
      this.teams[p.side].stats.tackles++;
      c.kickCD = 0.5;
      this.emit('tackle', { p: pi(p), c: pi(c) });
      if (this.rng() < 0.6) this.gainPossession(p);
      else {
        const b = this.ball, a = Math.atan2(c.y - p.y, c.x - p.x) + (this.rng() < 0.5 ? 1.3 : -1.3);
        b.owner = null; b.vx = Math.cos(a) * 4; b.vy = Math.sin(a) * 4; b.lastTouch = p; p.kickCD = 0.15;
      }
    }

    maybeSlide(p, c, diff) {
      if (p.tackleCD > 0) return;
      const d = hyp(p.x - c.x, p.y - c.y);
      if (d < 1.6 || d > 3.2 || this.rng() > 0.012 * diff.slide) return;
      this.doSlide(p, c.x + c.vx * 0.3 - p.x, c.y + c.vy * 0.3 - p.y);
    }

    passOptions(p) {
      const t = this.teams[p.side], opp = this.teams[1 - p.side].players;
      let best = null, bestS = -1e9;
      for (const q of t.players) {
        if (q === p || q.state !== 'run' || q.frozen > 0) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = hyp(dx, dy);
        if (d < 4 || d > 45) continue;
        let lane = 99, open = 99;
        for (const o of opp) {
          lane = Math.min(lane, distSeg(o.x, o.y, p.x, p.y, q.x, q.y));
          open = Math.min(open, hyp(o.x - q.x, o.y - q.y));
        }
        const prog = dx * t.dir;
        const goalD = hyp(t.oppGoalX - q.x, CY - q.y);
        let s = prog * 0.35 + Math.min(open, 8) * 1.1 + Math.min(lane, 4) * 2.2 - Math.abs(d - 16) * 0.12 - goalD * 0.05;
        if (q.slot === 0) s -= 12;
        if (lane < 1.3 && d < 30) s -= 10;
        if (s > bestS) { bestS = s; best = q; }
      }
      return { q: best, s: bestS };
    }

    laneBlocked(p, ax, ay) {
      for (const o of this.teams[1 - p.side].players) {
        if (hyp(o.x - p.x, o.y - p.y) < 2.5) continue;
        if (distSeg(o.x, o.y, p.x, p.y, ax, ay) < 1.4) return true;
      }
      return false;
    }

    aiCarrier(p, dt) {
      const t = this.teams[p.side], diff = this.diff(p.side), it = p.intent;
      const gx = t.oppGoalX, dG = hyp(gx - p.x, CY - p.y);
      let nearO = null, nd = 99;
      for (const o of this.teams[1 - p.side].players) {
        if (o.frozen > 0) continue;
        const d = hyp(o.x - p.x, o.y - p.y);
        if (d < nd) { nd = d; nearO = o; }
      }
      let mx = (gx - p.x) / dG, my = (CY - p.y) / dG;
      if (dG > 30) my *= 0.45;
      if (nearO && nd < 6) {
        const ax = p.x - nearO.x, ay = p.y - nearO.y, al = hyp(ax, ay) || 1, w = ((6 - nd) / 6) * 1.3;
        mx += (ax / al) * w * 0.6; my += (ay / al) * w;
      }
      if (p.y < 4) my += (4 - p.y) * 0.3;
      if (p.y > W - 4) my -= (p.y - (W - 4)) * 0.3;
      const ml = hyp(mx, my) || 1;
      it.mx = mx / ml; it.my = my / ml;
      it.sprint = nd > 4 && p.energy > 35 && dG > 18 && p.sprintGauge > 2;

      p.think -= dt;
      if (p.think > 0 || this.phase !== 'play') return;
      p.think = diff.think * (0.7 + this.rng() * 0.6);
      const angOK = Math.abs(p.y - CY) < dG * 0.85 + 2;
      if (dG < 27 && angOK) {
        let sp = dG < 11 ? 0.9 : dG < 17 ? 0.5 : dG < 22 ? 0.22 : 0.08;
        if (nd < 2) sp *= 1.4;
        if (this.rng() < sp * diff.shoot) return this.aiShoot(p);
      }
      if (nd < 1.6 && p.dribbleCD <= 0 && this.rng() < 0.12 * diff.dribble) { this.doDribble(p); p.dribbleCD = 2.5; return; }
      // rensning: under press nära eget mål
      const own = hyp(t.ownGoalX - p.x, CY - p.y);
      if (own < 28 && nd < 2.6 && this.rng() < 0.45) {
        const tx = p.x + t.dir * (25 + this.rng() * 20), ty = this.rng() < 0.5 ? 6 + this.rng() * 10 : W - 6 - this.rng() * 10;
        this.emit('clearance', { p: pi(p) });
        return this.passTo(p, tx, ty, true, null);
      }
      const o = this.passOptions(p);
      if (o.q) {
        const mine = Math.min(nd, 8) * 1.1 + (dG < 30 ? (30 - dG) * 0.3 : 0) + 4;
        const urg = nd < 2.2 ? 6 : nd < 4 ? 2 : 0;
        const hold = p.holdT > 2.5 ? (p.holdT - 2.5) * 4 : 0;
        if (o.s + urg + hold > mine && this.rng() < 0.75) return this.doPass(p, o.q, {});
      }
    }

    aiShoot(p) {
      const t = this.teams[p.side], K = this.keeper(1 - p.side);
      const dG = hyp(t.oppGoalX - p.x, CY - p.y);
      const side = Math.abs(K.y - CY) > 0.4 ? -Math.sign(K.y - CY) : this.rng() < 0.5 ? -1 : 1;
      const ty = CY + side * (GOAL_HW - 0.35 - this.rng() * 0.9), tz = 0.2 + this.rng() * 1.5;
      const power = clamp(0.42 + dG / 55 + this.rng() * 0.22, 0.42, 0.93);
      this.doShoot(p, power, { y: ty, z: tz });
    }

    aiKeeper(K, dt) {
      const t = this.teams[K.side], b = this.ball, gx = t.ownGoalX;
      if (b.owner === K) {
        K.holdT += dt;
        if (K.holdT > 1.1 && this.phase === 'play') {
          const o = this.passOptions(K);
          if (o.q && o.s > 4 && this.rng() < 0.7) this.doPass(K, o.q, {});
          else {
            const fw = t.players.filter(q => q.slot !== 0).sort((a, c) => (c.x - a.x) * t.dir)[(this.rng() * 3) | 0];
            if (fw) this.doPass(K, fw, { lofted: true });
          }
        }
        return;
      }
      const dx = b.x - gx, dy = b.y - CY, d = hyp(dx, dy) || 1;
      let out = clamp(d * 0.1, 0.5, 4.5);
      const c = b.owner;
      if (c && c.side !== K.side && d < 18) out = clamp(d * 0.3, 1.5, 6);
      let tx = gx + (dx / d) * out, ty = CY + (dy / d) * out;
      ty = clamp(ty, CY - GOAL_HW - 0.6, CY + GOAL_HW + 0.6);
      const shotPending = b.shot && b.shot.defSide === K.side;
      if (!b.owner && this.phase === 'play' && this.inBox(K.side, b.x, b.y) && b.z < 2.2 && !shotPending) {
        const myD = hyp(b.x - K.x, b.y - K.y);
        let oppD = 99;
        for (const o of this.teams[1 - K.side].players) oppD = Math.min(oppD, hyp(b.x - o.x, b.y - o.y));
        if (myD < oppD * 0.9 && hyp(b.vx, b.vy) < 15) [tx, ty] = this.interceptPoint(K);
      }
      this.moveTo(K, tx, ty, 1, hyp(tx - K.x, ty - K.y) > 3);
      K.lookAt = Math.atan2(b.y - K.y, b.x - K.x);
    }

    // ------------------------------------------------------ mänskliga knappar
    processActions(side) {
      const inp = this.inputs[side];
      if (!inp.actions.length) return;
      const acts = inp.actions.splice(0);
      const t = this.teams[side], p = t.controlled, b = this.ball;
      const r = this.restart;
      const canKickRestart = this.phase === 'restart' && r && r.taker === p && r.wait <= 0;
      for (const a of acts) {
        if (a.type === 'switch') {
          if (this.phase === 'play' && (!b.owner || b.owner.side !== side)) this.switchPlayer(side);
          continue;
        }
        if (!p || (this.phase !== 'play' && !canKickRestart)) continue;
        if (a.type === 'pass' && b.owner === p) {
          let tgt = a.target != null ? t.players.find(q => q.uid === a.target && q !== p) : null;
          if (!tgt) tgt = this.humanPassTarget(p, inp.jx, inp.jy);
          if (tgt) this.doPass(p, tgt, { lofted: r && r.type === 'corner' ? true : null });
          return;
        }
        if (a.type === 'shoot' && b.owner === p) { this.doShoot(p, a.power, null, { jx: inp.jx, jy: inp.jy }); return; }
        if (this.phase !== 'play') continue;
        if (a.type === 'dribble' && b.owner === p) this.doDribble(p);
        else if (a.type === 'tackle' && b.owner !== p) this.doSlide(p, inp.jx, inp.jy);
      }
    }

    humanPassTarget(p, jx, jy) {
      const t = this.teams[p.side];
      const ang = hyp(jx, jy) > 0.3 ? Math.atan2(jy, jx) : p.face;
      let best = null, bs = -1e9;
      for (const q of t.players) {
        if (q === p || q.state === 'down') continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = hyp(dx, dy);
        if (d < 2 || d > 55) continue;
        const da = Math.abs(angDiff(ang, Math.atan2(dy, dx)));
        if (da > 1.1) continue;
        const s = Math.cos(da) * 3 - d / 25 - (q.slot === 0 ? 3 : 0);
        if (s > bs) { bs = s; best = q; }
      }
      return best || this.passOptions(p).q;
    }

    switchPlayer(side) {
      const t = this.teams[side], b = this.ball;
      const ref = b.owner && b.owner.side !== side ? b.owner : b;
      const cand = t.players.filter(p => p !== t.controlled && p.slot !== 0 && p.state !== 'down');
      const best = this.nearest(cand, ref.x, ref.y);
      if (best) { t.controlled = best; this.emit('switch', { side, p: pi(best) }); }
    }

    // ------------------------------------------------------ bollaktioner
    kick(p, vx, vy, vz, spin) {
      const b = this.ball;
      Object.assign(b, { owner: null, vx, vy, vz, spin: spin || 0, lastTouch: p, shot: null, passTarget: null, pass: null, lofted: false });
      p.kickCD = 0.3; p.holdT = 0;
      if (this.phase === 'restart') { this.phase = 'play'; this.restart = null; }
      this.emit('kick', { power: Math.round(hyp(vx, vy, vz)) });
      if (this.human[p.side] && this.teams[p.side].controlled === p && p.slot === 0) {
        const t = this.teams[p.side];
        t.controlled = this.nearest(t.players.filter(q => q.slot !== 0), p.x + t.dir * 30, CY);
      }
    }

    doPass(p, tgt, opts) {
      const b = this.ball;
      const d0 = hyp(tgt.x - b.x, tgt.y - b.y);
      const tEst = 0.2 + d0 / 17;
      const ax = clamp(tgt.x + tgt.vx * tEst * 0.9, 1, L - 1), ay = clamp(tgt.y + tgt.vy * tEst * 0.9, 1, W - 1);
      this.passTo(p, ax, ay, opts ? opts.lofted : null, tgt);
    }

    passTo(p, ax, ay, lofted, tgt) {
      const b = this.ball, ps = p.s.passing;
      const dist = Math.max(1, hyp(ax - b.x, ay - b.y));
      const q = (100 - ps) / 100;
      const ang = Math.atan2(ay - b.y, ax - b.x) + gauss(this.rng) * q * 0.1;
      const len = dist * (1 + gauss(this.rng) * q * 0.12);
      if (lofted == null) lofted = dist > 30 || (dist > 16 && this.laneBlocked(p, ax, ay));
      let vx, vy, vz = 0;
      if (!lofted) {
        const v0 = Math.min(groundSpeedFor(len, 3.5 + ps * 0.035), 9 + ps * 0.15);
        vx = Math.cos(ang) * v0; vy = Math.sin(ang) * v0;
      } else {
        const tx = b.x + Math.cos(ang) * len, ty = b.y + Math.sin(ang) * len;
        const v = solveLob({ x: b.x, y: b.y, z: b.z }, tx, ty, 0.8 + len / 24);
        vx = v.vx; vy = v.vy; vz = v.vz;
      }
      this.kick(p, vx, vy, vz, 0);
      b.lofted = lofted;
      const t = this.teams[p.side];
      t.stats.passes++;
      if (tgt) {
        b.passTarget = tgt; b.pass = { side: p.side, from: p, to: tgt };
        if (this.human[p.side]) t.controlled = tgt;
      }
      this.emit('pass', { p: pi(p), q: pi(tgt), lofted });
    }

    doShoot(p, power, aim, joy) {
      power = clamp(+power || 0, 0.05, 1);
      const t = this.teams[p.side], b = this.ball, gx = t.oppGoalX;
      const kmh = FB.shotSpeedKmh(p.s.shooting, power * 100);
      const speed = Math.max(6, kmh / 3.6);
      const dist = hyp(gx - b.x, CY - b.y);
      let ty, tz;
      if (aim) { ty = aim.y; tz = aim.z; }
      else {
        let sideSign = b.y < CY ? 1 : -1;
        if (joy && Math.abs(joy.jy) > 0.35) sideSign = Math.sign(joy.jy);
        ty = CY + sideSign * (GOAL_HW - 0.75);
        tz = 0.3 + power * 1.0;
      }
      const sh = p.s.shooting;
      let sigma = ((100 - sh) / 100) * (1.0 + dist / 6);
      if (power > 0.92) sigma += (power - 0.92) * 9;
      ty += gauss(this.rng) * sigma;
      tz += Math.abs(gauss(this.rng)) * sigma * 0.55 * (this.rng() < 0.7 ? 1 : -0.6);
      tz = Math.max(0.15, tz);
      const spin = gauss(this.rng) * 0.8;
      const v = solveLaunch({ x: b.x, y: b.y, z: Math.max(b.z, BALL_R) }, { x: gx, y: ty, z: tz }, speed, spin);
      this.kick(p, v.vx, v.vy, v.vz, spin);
      this.registerShot(p, kmh, {});
    }

    registerShot(p, kmh, o) {
      const b = this.ball, defSide = 1 - p.side, t = this.teams[p.side];
      t.stats.shots++;
      const cross = this.predictCross(defSide);
      const onTarget = !!cross && Math.abs(cross.y - CY) < GOAL_HW - BALL_R && cross.z < GOAL_H - BALL_R;
      const gx = defSide === 0 ? 0 : L;
      b.shot = { shooter: pi(p), side: p.side, defSide, kmh, onTarget, cross, decided: false, save: false, t0: this.time, zone: cross ? this.zoneOf(cross.y) : 0, dist: hyp(gx - p.x, CY - p.y) };
      this.emit('shot', { p: pi(p), kmh: Math.round(kmh), onTarget, header: !!o.header, freekick: !!o.freekick });
      if (onTarget) { t.stats.onTarget++; this.decideSave(b.shot, p); }
    }

    decideSave(s, shooter) {
      const K = this.keeper(s.defSide);
      if (!K) return;
      const gx = s.defSide === 0 ? 0 : L;
      if (this.human[s.defSide]) {
        if (!o_isCamFixed(this.cam)) this.cam = { mode: 'save', from: { x: shooter.x, y: shooter.y }, goalX: gx };
        this.openPrompt({ type: 'save', side: s.defSide, slowmo: true, timeout: 2.2, def: { dir: null }, data: { goalX: gx, from: { x: shooter.x, y: shooter.y }, kmh: Math.round(s.kmh), name: K.name, diving: K.s.diving } }, a => {
          const dir = a && a.dir != null ? clamp(Math.round(a.dir), -1, 1) : null;
          s.diveDir = dir == null ? 0 : dir;
          if (dir == null) s.save = s.zone === 0 && this.rng() < K.s.diving / 200;
          else s.save = dir === s.zone && this.rng() < K.s.diving / 100;
          s.decided = true;
          if (!s.save) K.noTouch = 1.6;
          this.camHold = 1.1;
          this.emit('dive', { side: s.defSide, dir, correct: dir === s.zone });
        });
      } else {
        const dir = this.rng() < 0.58 + K.s.diving / 250 ? s.zone : this.otherZone(s.zone);
        const speedF = clamp(1.3 - s.kmh / 250, 0.55, 1.05);
        const corner = Math.abs(s.cross.y - CY) > 2.4 || s.cross.z > 1.7;
        const distF = clamp(0.85 + s.dist / 45, 0.9, 1.35);
        const pr = dir === s.zone ? (K.s.diving / 100) * speedF * (corner ? 0.85 : 1) * distF : s.zone === 0 ? 0.15 : 0;
        s.diveDir = dir;
        s.save = this.rng() < clamp(pr, 0, 0.97);
        s.decided = true;
        if (!s.save) K.noTouch = 1.6;
      }
    }

    predictCross(defSide) {
      const b = this.ball, gx = defSide === 0 ? 0 : L;
      const q = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, spin: b.spin };
      for (let i = 0; i < 480; i++) {
        const px = q.x;
        ballStep(q, 1 / 120);
        if ((q.x - gx) * (px - gx) <= 0) return { y: q.y, z: q.z, t: i / 120 };
        if (hyp(q.vx, q.vy) < 1 && q.z <= 0) return null;
      }
      return null;
    }

    startDive(K, x, y, z, dur) {
      Object.assign(K, { state: 'dive', diveTX: x, diveTY: clamp(y, CY - GOAL_HW - 0.4, CY + GOAL_HW + 0.4), diveZ: clamp(z - 0.5, 0, 1.5), diveDur: dur, stateT: dur, diveDir: Math.sign(y - K.y) });
    }

    shotFlight() {
      const b = this.ball, s = b.shot;
      if (!s || b.owner) return;
      if (this.time - s.t0 > 3.5) { b.shot = null; return; }
      if (!s.onTarget || !s.decided) return;
      const K = this.keeper(s.defSide);
      if (!K) return;
      const gx = s.defSide === 0 ? 0 : L;
      const distLine = Math.abs(b.x - gx), tLeft = distLine / (Math.abs(b.vx) || 0.1);
      if (!s.dived && tLeft < 0.55 && (K.state === 'run' || K.state === 'down')) {
        s.dived = true;
        const y = s.save ? s.cross.y : CY + s.diveDir * 2.6;
        this.startDive(K, K.x, y, s.save ? s.cross.z : 0.8 + this.rng() * 0.6, Math.max(0.35, tLeft + 0.25));
      }
      if (s.save && distLine <= Math.abs(K.x - gx) + 0.35) this.performSave(K, s);
    }

    performSave(K, s) {
      const b = this.ball;
      b.shot = null;
      K.diveTY = b.y; K.y = K.y * 0.3 + b.y * 0.7;
      this.teams[K.side].stats.saves++;
      const catchIt = s.kmh < 100 && Math.abs(b.y - CY) < 2.8 && b.z < 2.0 && this.rng() < 0.65;
      if (this.shootout) { this.recordKick(false); }
      if (catchIt) {
        this.gainPossession(K);
        this.emit('save', { p: pi(K), catch: true, shooter: s.shooter, penalty: !!s.penalty });
      } else {
        const out = K.side === 0 ? 1 : -1;
        const sg = Math.sign(b.y - CY) || (this.rng() < 0.5 ? -1 : 1);
        Object.assign(b, { vx: out * (2 + this.rng() * 5), vy: sg * (4 + this.rng() * 6), vz: 2 + this.rng() * 4, spin: 0, lastTouch: K, deflectCD: 0.3, passTarget: null });
        K.kickCD = 0.6;
        this.emit('save', { p: pi(K), catch: false, shooter: s.shooter, penalty: !!s.penalty });
      }
    }

    // Dribbla: slumpa 1–100. Över spelarens dribbling → tappar bollen, annars fryses försvararna 1,5 s
    doDribble(p) {
      if (p.dribbleCD > 0) return;
      p.dribbleCD = 1.0;
      const roll = 1 + Math.floor(this.rng() * 100);
      const opp = this.teams[1 - p.side].players;
      const b = this.ball;
      if (roll > p.s.dribbling) {
        const o = this.nearest(opp, p.x, p.y);
        const a = o ? Math.atan2(o.y - p.y, o.x - p.x) : p.face;
        Object.assign(b, { owner: null, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, vz: 0, lastTouch: p });
        p.kickCD = 0.7;
        this.emit('dribbleFail', { p: pi(p), roll, stat: p.s.dribbling });
      } else {
        let n = 0;
        for (const o of opp) {
          if (o.slot === 0) continue;
          if (hyp(o.x - p.x, o.y - p.y) < 5) { o.frozen = 1.5; o.vx = 0; o.vy = 0; if (o.state === 'slide') o.state = 'run'; n++; }
        }
        this.emit('dribbleOk', { p: pi(p), roll, stat: p.s.dribbling, n });
      }
    }

    doSlide(p, dx, dy) {
      if (p.state !== 'run' || p.tackleCD > 0 || p.frozen > 0 || this.phase !== 'play') return;
      const b = this.ball;
      if (hyp(dx, dy) < 0.2) { dx = b.x - p.x; dy = b.y - p.y; }
      const a = Math.atan2(dy, dx);
      const sp = Math.max(hyp(p.vx, p.vy) + 2.5, 7);
      Object.assign(p, { state: 'slide', stateT: 0.6, slideDir: a, face: a, slideDone: false, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, tackleCD: 1.4 });
      this.emit('slide', { p: pi(p) });
    }

    resolveSlide(p) {
      if (p.slideDone) return;
      const b = this.ball, c = b.owner;
      if (c && c.side === p.side) return;
      const dBall = hyp(b.x - p.x, b.y - p.y);
      if (dBall < 0.95 && b.z < 0.6) {
        p.slideDone = true;
        if (!c) {
          Object.assign(b, { vx: Math.cos(p.slideDir) * 8, vy: Math.sin(p.slideDir) * 8, lastTouch: p, passTarget: null, shot: null });
          this.emit('slideClear', { p: pi(p) });
          return;
        }
        const win = this.rng() < clamp(0.2 + p.s.defending / 150 - c.s.dribbling / 500, 0.15, 0.95);
        if (win) {
          b.owner = null;
          Object.assign(b, { vx: Math.cos(p.slideDir) * 7 + c.vx * 0.3, vy: Math.sin(p.slideDir) * 7 + c.vy * 0.3, vz: 0, lastTouch: p });
          c.kickCD = 0.5;
          this.teams[p.side].stats.tackles++;
          this.emit('slideWin', { p: pi(p), c: pi(c) });
        } else if (this.rng() < 0.75) this.foul(p, c);
        else this.emit('slideMiss', { p: pi(p), c: pi(c) });
      } else if (c && hyp(c.x - p.x, c.y - p.y) < 0.8) {
        p.slideDone = true;
        if (this.rng() < 0.85 - p.s.defending / 400) this.foul(p, c);
      }
    }

    gainPossession(p) {
      const b = this.ball;
      const prevSide = b.lastTouch ? b.lastTouch.side : -1;
      const pass = b.pass;
      if (b.shot && p.slot === 0 && b.shot.defSide === p.side) {
        this.teams[p.side].stats.saves++;
        this.emit('save', { p: pi(p), catch: true, shooter: b.shot.shooter, penalty: !!b.shot.penalty });
      }
      Object.assign(b, { owner: p, lastTouch: p, vx: 0, vy: 0, vz: 0, spin: 0, shot: null, lofted: false, passTarget: null, pass: null });
      p.holdT = 0;
      if (pass && pass.side === p.side && pass.from !== p) this.teams[p.side].stats.passesOk++;
      if (this.possSide !== p.side || prevSide !== p.side) {
        this.possSide = p.side;
        if (pass && pass.side !== p.side) this.emit('intercept', { p: pi(p) });
        // tappade vi bollen långt från vår styrda spelare? byt automatiskt till den närmaste
        const o = this.teams[1 - p.side];
        if (this.human[o.side] && o.controlled && hyp(o.controlled.x - p.x, o.controlled.y - p.y) > 25) {
          const n = this.nearest(o.players.filter(q => q.slot !== 0 && q.state !== 'down'), p.x, p.y);
          if (n) o.controlled = n;
        }
      }
      if (this.human[p.side]) this.teams[p.side].controlled = p;
      if (p.slot === 0 && this.inBox(p.side, p.x, p.y)) this.emit('keeperBall', { p: pi(p) });
    }

    // ------------------------------------------------------ rörelse
    maxSpeed(p, sprint) {
      let v = sprint ? 6.6 + p.s.pace * 0.036 : 4.7 + p.s.pace * 0.023;
      if (this.ball.owner === p) v *= sprint ? 0.9 : 0.94;
      if (p.energy < 40) v *= 0.78 + (0.22 * p.energy) / 40;
      return v;
    }

    movePlayer(p, dt) {
      if (p.frozen > 0) {
        p.frozen -= dt; p.vx *= 0.85; p.vy *= 0.85; p.x += p.vx * dt; p.y += p.vy * dt;
        return;
      }
      if (p.state === 'slide') {
        p.stateT -= dt;
        const sp = hyp(p.vx, p.vy), nsp = Math.max(0, sp - 10 * dt);
        if (sp > 0) { p.vx *= nsp / sp; p.vy *= nsp / sp; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (this.phase === 'play') this.resolveSlide(p);
        if (p.stateT <= 0 && p.state === 'slide') { p.state = 'down'; p.stateT = 0.5; p.vx = p.vy = 0; }
        this.bound(p);
        return;
      }
      if (p.state === 'down') {
        p.stateT -= dt; p.vx = p.vy = 0;
        if (p.stateT <= 0) p.state = 'run';
        return;
      }
      if (p.state === 'dive') {
        p.stateT -= dt;
        const dx = p.diveTX - p.x, dy = p.diveTY - p.y, d = hyp(dx, dy);
        const sp = 7 + p.s.diving * 0.03;
        if (d > 0.05) { const m = Math.min(d, sp * dt); p.x += (dx / d) * m; p.y += (dy / d) * m; }
        p.diveH = Math.max(0, Math.sin(clamp(1 - p.stateT / p.diveDur, 0, 1) * Math.PI)) * p.diveZ;
        if (p.stateT <= 0) { p.state = 'down'; p.stateT = 0.6; p.diveH = 0; }
        return;
      }
      if (p.state === 'wall') { p.vx = p.vy = 0; return; }
      const it = p.intent;
      const wantSprint = it.sprint && p.sprintGauge > 0.05 && p.energy > 3;
      const maxV = this.maxSpeed(p, wantSprint);
      const tvx = it.mx * maxV, tvy = it.my * maxV;
      const ax = tvx - p.vx, ay = tvy - p.vy, al = hyp(ax, ay);
      const acc = (this.ball.owner === p ? 12 : 15) * dt;
      if (al > acc) { p.vx += (ax / al) * acc; p.vy += (ay / al) * acc; }
      else { p.vx = tvx; p.vy = tvy; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const sp = hyp(p.vx, p.vy);
      if (it.face != null) p.face = it.face;
      else if (sp > 0.5) p.face += angDiff(p.face, Math.atan2(p.vy, p.vx)) * Math.min(1, dt * (this.ball.owner === p ? 9 : 12));
      else if (p.lookAt != null) p.face += angDiff(p.face, p.lookAt) * Math.min(1, dt * 4);
      p.lookAt = null;
      // Ork: sprint tar mycket ork, högre stamina = långsammare förbrukning
      p.sprinting = wantSprint && sp > 3.5;
      const staF = 1.55 - p.s.stamina / 100;
      if (p.sprinting) {
        p.energy -= 3.0 * staF * dt;
        p.sprintGauge = Math.max(0, p.sprintGauge - dt);
      } else {
        p.sprintGauge = Math.min(10, p.sprintGauge + dt * 0.6);
        if (sp > 5.2) p.energy -= 0.22 * staF * dt;
        else p.energy += (sp < 2 ? 1.1 : 0.55) * dt;
      }
      p.energy = clamp(p.energy, 0, 100);
      p.anim += sp * dt * 1.7;
      this.bound(p);
    }

    bound(p) { p.x = clamp(p.x, -4, L + 4); p.y = clamp(p.y, -3, W + 3); }

    separate() {
      const a = this.all;
      for (let i = 0; i < a.length; i++) {
        const p = a[i];
        for (let j = i + 1; j < a.length; j++) {
          const q = a[j], dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 0.49 && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = 0.7 - d, nx = dx / d, ny = dy / d;
            const pw = p.state === 'wall' || p.state === 'dive' ? 0 : 1, qw = q.state === 'wall' || q.state === 'dive' ? 0 : 1;
            const s = pw + qw;
            if (!s) continue;
            p.x -= (nx * push * pw) / s; p.y -= (ny * push * pw) / s;
            q.x += (nx * push * qw) / s; q.y += (ny * push * qw) / s;
          }
        }
      }
    }

    // ------------------------------------------------------ bollen
    updateBall(dt) {
      const b = this.ball;
      if (this.phase === 'restart' && this.restart) { b.x = this.restart.x; b.y = this.restart.y; b.z = 0; b.vx = b.vy = b.vz = 0; return; }
      if (this.phase === 'freekick' || (this.phase === 'penalty' && this.pen && !this.pen.kicked)) { b.vx = b.vy = b.vz = 0; return; }
      if (b.owner) {
        const p = b.owner;
        const hands = p.slot === 0 && this.inBox(p.side, p.x, p.y);
        if (hands) {
          b.x = p.x + Math.cos(p.face) * 0.3; b.y = p.y + Math.sin(p.face) * 0.3; b.z = 0.95 + (p.diveH || 0);
          b.vx = p.vx; b.vy = p.vy; b.vz = 0;
          p.holdT += dt;
        } else if (p.state !== 'run' || p.frozen > 0) {
          b.owner = null; b.vx = p.vx * 0.5; b.vy = p.vy * 0.5;
        } else {
          const off = 0.5 + Math.min(hyp(p.vx, p.vy), 9) * 0.055;
          const tx = p.x + Math.cos(p.face) * off, ty = p.y + Math.sin(p.face) * off;
          const k = Math.min(1, dt * 16);
          b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.z = Math.max(0, b.z - dt * 4);
          b.vx = p.vx; b.vy = p.vy; b.vz = 0; b.spin = 0;
          b.roll += (hyp(p.vx, p.vy) * dt) / BALL_R;
          p.holdT += dt;
        }
        if (this.live()) this.checkGoalOrOut();
        return;
      }
      const sp = hyp(b.vx, b.vy, b.vz);
      const n = Math.max(1, Math.ceil((sp * dt) / 0.12));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        ballStep(b, h);
        this.goalFrame(b);
        if (b.inNet) this.netContain(b);
        if (this.live() && this.checkGoalOrOut()) break;
      }
      b.roll += (hyp(b.vx, b.vy) * dt) / BALL_R;
      if (this.live()) {
        this.shotFlight();
        if (this.live() && !b.owner) this.headers();
        if (this.live() && !b.owner) this.bodyCollisions();
        if (this.live() && !b.owner) this.tryPickup();
      }
    }

    checkGoalOrOut() {
      const b = this.ball;
      if (b.x < -BALL_R || b.x > L + BALL_R) {
        const defSide = b.x < 0 ? 0 : 1;
        if (Math.abs(b.y - CY) < GOAL_HW && b.z < GOAL_H) { this.goalScored(1 - defSide); return true; }
        if (this.shootout) { this.recordKick(false); return true; }
        const lt = b.lastTouch;
        if (lt && lt.side === defSide) this.ballOut('corner', 1 - defSide);
        else this.ballOut('goalkick', defSide);
        return true;
      }
      if (b.y < -BALL_R || b.y > W + BALL_R) {
        if (this.shootout) { this.recordKick(false); return true; }
        const lt = b.lastTouch;
        this.ballOut('throwin', lt ? 1 - lt.side : 0);
        return true;
      }
      return false;
    }

    ballOut(kind, side) {
      const b = this.ball, x = b.x, y = b.y;
      b.owner = null; b.shot = null; b.passTarget = null;
      this.emit('out', { kind, side });
      this.stopPlay(1.1, () => this.beginRestart(kind, side, x, y));
    }

    goalScored(side) {
      const b = this.ball;
      b.inNet = true; b.owner = null;
      if (this.shootout) { b.shot = null; this.recordKick(true); return; }
      const t = this.teams[side];
      t.score++;
      const scorer = b.lastTouch, own = !!scorer && scorer.side !== side;
      if (scorer && !own) scorer.goals++;
      this.scorers.push({ side, name: scorer ? scorer.name : '', min: Math.max(1, Math.ceil(this.clock)), own });
      b.shot = null;
      this.lastConceded = 1 - side;
      this.phase = 'goal'; this.phaseT = 0; this.prompts = [];
      this.celebrator = own ? null : scorer;
      this.camHold = 0.8;
      this.emit('goal', { side, p: pi(scorer), own, score: this.scoreArr() });
    }

    netContain(b) {
      const gx = b.x < L / 2 ? 0 : L, s = gx === 0 ? -1 : 1;
      if ((b.x - gx) * s <= 0) return;
      const back = gx + s * (GOAL_DEPTH - BALL_R);
      if ((b.x - back) * s > 0) {
        if (Math.abs(b.vx) > 2) this.netPulse = { x: gx, y: b.y, z: b.z, t: this.time, power: Math.min(1, Math.abs(b.vx) / 25) };
        b.x = back; b.vx = -b.vx * 0.12; b.vy *= 0.5; b.vz *= 0.5;
      }
      if (Math.abs(b.y - CY) > GOAL_HW - BALL_R) { b.y = CY + Math.sign(b.y - CY) * (GOAL_HW - BALL_R); b.vy *= -0.2; }
      if (b.z > GOAL_H - BALL_R) { b.z = GOAL_H - BALL_R; b.vz = -Math.abs(b.vz) * 0.2; }
    }

    // Stolpar och ribba
    goalFrame(b) {
      const R = BALL_R + POST_R;
      for (const gx of [0, L]) {
        if (Math.abs(b.x - gx) > 0.6) continue;
        if (b.z < GOAL_H + R) {
          for (const py of [CY - GOAL_HW, CY + GOAL_HW]) {
            const dx = b.x - gx, dy = b.y - py, d = hyp(dx, dy);
            if (d < R && d > 0) {
              const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
              if (vn < 0) {
                b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny;
                b.x = gx + nx * R; b.y = py + ny * R;
                if (this.live() && Math.abs(vn) > 3) this.emit('post', {});
                if (b.shot) b.shot.onTarget = false;
              }
            }
          }
        }
        if (Math.abs(b.y - CY) < GOAL_HW) {
          const dx = b.x - gx, dz = b.z - GOAL_H, d = hyp(dx, dz);
          if (d < R && d > 0) {
            const nx = dx / d, nz = dz / d, vn = b.vx * nx + b.vz * nz;
            if (vn < 0) {
              b.vx -= 1.7 * vn * nx; b.vz -= 1.7 * vn * nz;
              b.x = gx + nx * R; b.z = GOAL_H + nz * R;
              if (this.live() && Math.abs(vn) > 3) this.emit('bar', {});
              if (b.shot) b.shot.onTarget = false;
            }
          }
        }
        // inne i målet
        const inside = (gx === 0 ? b.x < 0 : b.x > L) && Math.abs(b.y - CY) < GOAL_HW && b.z < GOAL_H;
        if (inside) b.inNet = true;
      }
    }

    headers() {
      const b = this.ball;
      if (b.z < 1.0 || b.z > 2.5 || b.deflectCD > 0) return;
      for (const p of this.all) {
        if (p.state !== 'run' || p.kickCD > 0 || p.frozen > 0 || p.slot === 0) continue;
        if (hyp(b.x - p.x, b.y - p.y) > 0.7) continue;
        const t = this.teams[p.side];
        if (this.inBox(1 - p.side, p.x, p.y)) {
          const sh = p.s.shooting;
          const ty = CY + (this.rng() - 0.5) * 2 * (GOAL_HW - 0.4) + (gauss(this.rng) * (100 - sh)) / 40;
          const speed = 11 + sh * 0.1;
          const v = solveLaunch({ x: b.x, y: b.y, z: b.z }, { x: t.oppGoalX, y: ty, z: 0.3 + this.rng() * 1.5 }, speed, 0);
          this.kick(p, v.vx, v.vy, v.vz, 0);
          this.emit('header', { p: pi(p), shot: true });
          this.registerShot(p, speed * 3.6, { header: true });
        } else if (b.z < 1.7 && hyp(b.vx, b.vy) < 16) {
          this.gainPossession(p);
        } else {
          const ang = (t.dir > 0 ? 0 : Math.PI) + (this.rng() - 0.5) * 1.4;
          this.kick(p, Math.cos(ang) * 9, Math.sin(ang) * 9, 4, 0);
          this.emit('header', { p: pi(p), shot: false });
        }
        return;
      }
    }

    bodyCollisions() {
      const b = this.ball;
      if (b.deflectCD > 0) return;
      const bs = hyp(b.vx, b.vy, b.vz);
      for (const p of this.all) {
        if (p.state === 'down' || p.noTouch > 0) continue;
        if (p === b.lastTouch && p.kickCD > 0) continue;
        const h = p.state === 'slide' ? 0.5 : p.wall ? 2.25 : 1.85;
        if (b.z > h) continue;
        const dx = b.x - p.x, dy = b.y - p.y, d = hyp(dx, dy);
        const r = p.state === 'slide' ? 0.9 : 0.4;
        if (d >= r) continue;
        if (bs < 17 && b.z < 1.0 && p.kickCD <= 0 && p.frozen <= 0) continue; // kan tas ner – se tryPickup
        if (p.slot === 0 && this.inBox(p.side, p.x, p.y) && p.kickCD <= 0) continue; // målvakten använder händerna
        const nx = dx / (d || 1), ny = dy / (d || 1), vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.5 * vn * nx; b.vy -= 1.5 * vn * ny; }
        b.vx *= 0.5; b.vy *= 0.5; b.vz = Math.abs(b.vz) * 0.3 + 1 + this.rng() * 2; b.spin = 0;
        b.lastTouch = p; b.deflectCD = 0.2; b.passTarget = null; b.pass = null;
        if (b.shot) { this.emit('block', { p: pi(p) }); b.shot = null; }
        return;
      }
    }

    tryPickup() {
      const b = this.ball;
      if (b.owner) return;
      const bs = hyp(b.vx, b.vy, b.vz);
      let best = null, bestD = 1e9;
      for (const p of this.all) {
        if (p.kickCD > 0 || p.noTouch > 0 || p.frozen > 0 || (p.state !== 'run' && p.state !== 'dive')) continue;
        if (p.state === 'dive' && p.slot !== 0) continue;
        const d = hyp(b.x - p.x, b.y - p.y);
        const hands = p.slot === 0 && this.inBox(p.side, p.x, p.y);
        const reach = hands ? 1.25 : p === b.passTarget ? 0.95 : 0.75;
        const maxZ = hands ? 2.6 : 1.0;
        if (d >= reach || b.z >= maxZ) continue;
        if (!hands && bs > 17 && p !== b.passTarget) continue;
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return;
      if (this.shootout && this.pen && this.pen.kicked) {
        if (best.slot === 0 && best.side !== this.pen.side) this.recordKick(false);
        return;
      }
      this.gainPossession(best);
    }

    // ------------------------------------------------------ nätverk (spela mot kompis)
    roster() {
      return this.teams.map(t => ({
        name: t.name, short: t.short, kit: t.kit, gkKit: t.gkKit, subsLeft: t.subsLeft, drinks: this.drinks[t.side],
        players: t.players.map(p => ({ uid: p.uid, name: p.name, num: p.num, pos: p.pos, slot: p.slot, skin: p.skin, hair: p.hair, injury: p.injury ? p.injury.sev : 0, sh: p.s.shooting })),
        bench: t.bench.map(q => ({ uid: q.uid, name: q.name, pos: q.pos, num: q.num, ovr: FB.overall(q), injury: q.injury ? q.injury.sev : 0, out: !!q.subbedOut })),
      }));
    }

    snapshot() {
      const r2 = v => Math.round(v * 100) / 100;
      const b = this.ball;
      const p = this.all.map(q => [r2(q.x), r2(q.y), r2(q.vx), r2(q.vy), r2(q.face), STATE_CODE[q.state] || 0, Math.round(q.energy),
        r2(q.sprintGauge), q.frozen > 0 ? 1 : 0, r2(q.diveH || 0), q.injury ? q.injury.sev : 0, r2(q.anim % 1000), q.wall ? 1 : 0, q.diveDir || 0, q.sprinting ? 1 : 0]);
      const r = this.restart;
      return {
        t: r2(this.time), ph: this.phase, clk: r2(this.clock), half: this.half, sc: this.scoreArr(),
        rs: this.phase === 'restart' && r ? [this.all.indexOf(r.taker), r.wait <= 0 ? 1 : 0, r.type] : null,
        st: this.phase === 'halftime' || this.phase === 'fulltime' ? this.result().stats : null,
        b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz), b.owner ? this.all.indexOf(b.owner) : -1, r2(b.roll % 1000)],
        p, c: [this.all.indexOf(this.teams[0].controlled), this.all.indexOf(this.teams[1].controlled)],
        cam: this.cam, pr: this.publicPrompts(), rv: this.rosterVersion,
        so: this.shootout ? this.shootoutScore() : null, np: this.netPulse,
      };
    }

    result() {
      const tot = this.possTime[0] + this.possTime[1] || 1;
      return {
        score: this.scoreArr(),
        shootout: this.shootout && this.shootout.done ? { winner: this.shootout.winner, score: this.shootoutScore() } : null,
        injuries: this.injuries, drinksUsed: this.drinksUsed, scorers: this.scorers,
        stats: this.teams.map((t, i) => Object.assign({}, t.stats, { possession: Math.round((this.possTime[i] / tot) * 100) })),
      };
    }
  }

  function o_isCamFixed(cam) { return cam && cam.mode === 'freekick'; }

  function distSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
    return hyp(px - (ax + dx * t), py - (ay + dy * t));
  }

  const API = { Match, ballStep, solveLaunch, groundSpeedFor, L, W, CY, GOAL_HW, GOAL_H, GOAL_DEPTH, BALL_R, BOX_D, BOX_HW, SPOT, STATE_CODE };
  FB.Engine = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
