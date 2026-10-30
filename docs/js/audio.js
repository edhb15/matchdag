/* Ljud (skapas direkt i webbläsaren med Web Audio) och kommentatorn */
(function (root) {
  'use strict';
  const FB = root.FB;

  class Sound {
    constructor() { this.ctx = null; this.on = true; this.excite = 0; }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.on ? 0.9 : 0;
        this.master.connect(this.ctx.destination);
        this.startCrowd();
      } catch (e) { this.ctx = null; }
    }

    setOn(on) {
      this.on = on;
      if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    }

    noiseBuffer(sec, brown) {
      const ctx = this.ctx, len = Math.floor(ctx.sampleRate * sec);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
      }
      return buf;
    }

    startCrowd() {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(4, true); src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.5;
      this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0.18;
      src.connect(bp); bp.connect(this.crowdGain); this.crowdGain.connect(this.master);
      src.start();
      const src2 = ctx.createBufferSource();
      src2.buffer = this.noiseBuffer(3, false); src2.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1800; hp.Q.value = 0.8;
      this.cheerGain = ctx.createGain(); this.cheerGain.gain.value = 0;
      src2.connect(hp); hp.connect(this.cheerGain); this.cheerGain.connect(this.master);
      src2.start();
    }

    setExcitement(x) {
      if (!this.ctx) return;
      this.excite += (x - this.excite) * 0.05;
      this.crowdGain.gain.setTargetAtTime(0.14 + this.excite * 0.22, this.ctx.currentTime, 0.3);
    }

    cheer(level) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, g = this.cheerGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.32 * level, t + 0.25);
      g.setTargetAtTime(0, t + (level > 0.8 ? 2.6 : 0.8), 0.6);
    }

    kick(power) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
      g.gain.setValueAtTime(Math.min(0.9, 0.25 + power / 40), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.16);
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(0.05, false);
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.18, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
      n.connect(f); f.connect(ng); ng.connect(this.master); n.start(t);
    }

    whistle(count, long) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      for (let i = 0; i < count; i++) {
        const t = ctx.currentTime + i * (long ? 0.55 : 0.32), dur = long && i === count - 1 ? 0.9 : 0.22;
        const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = 2650;
        lfo.frequency.value = 38; lg.gain.value = 140;
        lfo.connect(lg); lg.connect(o.frequency);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02);
        g.gain.setValueAtTime(0.16, t + dur - 0.04); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g); g.connect(this.master);
        o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
      }
    }

    post() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      for (const [f, v] of [[1180, 0.2], [2710, 0.1], [4020, 0.05]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.72);
      }
    }
  }

  // ------------------------------------------------------------------ kommentator
  const pick = a => a[(Math.random() * a.length) | 0];

  class Commentator {
    constructor() {
      this.voiceOn = true;
      this.onLine = null;
      this.lastSpoke = 0;
      this.passCount = 0;
      this.lastShot = 0;
      this.voice = null;
      if (root.speechSynthesis) {
        const choose = () => {
          const vs = speechSynthesis.getVoices();
          this.voice = vs.find(v => /^sv/i.test(v.lang)) || null;
        };
        choose();
        speechSynthesis.onvoiceschanged = choose;
      }
    }

    say(text, prio) {
      if (this.onLine) this.onLine(text, prio);
      if (!this.voiceOn || !root.speechSynthesis || !root.SpeechSynthesisUtterance) return;
      const now = performance.now();
      if (prio < 2 && (speechSynthesis.speaking || now - this.lastSpoke < 2500)) return;
      if (prio >= 2) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'sv-SE';
      if (this.voice) u.voice = this.voice;
      u.rate = prio >= 2 ? 1.15 : 1.08;
      u.pitch = prio >= 2 ? 1.15 : 1;
      this.lastSpoke = now;
      try { speechSynthesis.speak(u); } catch (e) { /* tal stöds inte */ }
    }

    stop() { if (root.speechSynthesis) speechSynthesis.cancel(); }

    // ev = händelse från matchmotorn, names = {teams:[namn0, namn1]}
    handle(ev, names) {
      const tn = s => (names.teams[s] || '').trim();
      const n = p => (p ? p.name : 'spelaren');
      const sc = ev.score ? `${ev.score[0]}–${ev.score[1]}` : '';
      switch (ev.type) {
        case 'start': this.say(`Välkomna! ${tn(0)} möter ${tn(1)}. Domaren blåser igång matchen!`, 1); break;
        case 'secondHalf': this.say('Andra halvlek är igång!', 1); break;
        case 'pass':
          this.passCount++;
          if (ev.lofted && Math.random() < 0.5) this.say(pick([`Långt uppspel från ${n(ev.p)}.`, `${n(ev.p)} lyfter bollen framåt.`]), 0);
          else if (this.passCount % 7 === 0 && ev.q) this.say(pick([`${n(ev.p)} spelar till ${n(ev.q)}.`, `Fint passningsspel av ${tn(ev.p.side)}.`, `${n(ev.q)} får bollen.`]), 0);
          break;
        case 'shot':
          this.lastShot = ev.t;
          if (ev.header) this.say(pick([`${n(ev.p)} nickar mot mål!`, `Nick av ${n(ev.p)}!`]), 1);
          else if (ev.freekick) this.say(`Frisparken går iväg i ${ev.kmh} kilometer i timmen!`, 1);
          else this.say(pick([`${n(ev.p)} skjuter! ${ev.kmh} kilometer i timmen!`, `Skott från ${n(ev.p)}!`, `${n(ev.p)} drar till – ${ev.kmh} kilometer i timmen!`]), 1);
          break;
        case 'save':
          if (ev.catch) this.say(pick([`Säker räddning av ${n(ev.p)}.`, `${n(ev.p)} plockar bollen.`, `${n(ev.p)} har full koll.`]), 1);
          else this.say(pick([`Vilken räddning av ${n(ev.p)}!`, `${n(ev.p)} boxar undan!`, `Fantastisk parad av ${n(ev.p)}!`]), 2);
          break;
        case 'dive': if (ev.dir != null && !ev.correct) this.say('Målvakten går åt fel håll!', 1); break;
        case 'goal':
          if (ev.own) this.say(`Självmål! Det står ${sc}.`, 3);
          else this.say(pick([`MÅÅÅL! ${n(ev.p)} gör mål för ${tn(ev.side)}! ${sc}!`, `MÅL! ${n(ev.p)} sätter dit den! ${sc}!`, `Där satt den! ${n(ev.p)}! ${sc}!`]), 3);
          break;
        case 'post': this.say(pick(['I stolpen!', 'Stolpen räddar!']), 2); break;
        case 'bar': this.say(pick(['I ribban!', 'Ribban skakar!']), 2); break;
        case 'block': this.say(`Skottet blockeras av ${n(ev.p)}!`, 1); break;
        case 'out':
          if (ev.kind === 'goalkick') this.say(ev.t - this.lastShot < 3 ? pick(['Skottet går utanför.', 'Utanför stolpen!', 'Över målet.']) : 'Inspark.', 1);
          else if (ev.kind === 'corner') this.say(`Hörna till ${tn(ev.side)}.`, 1);
          else if (Math.random() < 0.4) this.say(`Inkast till ${tn(ev.side)}.`, 0);
          break;
        case 'foul': this.say(pick([`Frispark! ${n(ev.p)} fäller ${n(ev.victim)}.`, `Domaren blåser för en foul av ${n(ev.p)}.`]), 1); break;
        case 'penalty': this.say('STRAFF! Domaren pekar på straffpunkten!', 3); break;
        case 'penaltySetup': this.say(ev.shootout ? `${n(ev.p)} ska skjuta.` : `${n(ev.p)} lägger upp bollen. ${n(ev.k)} står i mål.`, 1); break;
        case 'freekick': this.say(`Frispark i farligt läge, ${ev.dist} meter från mål.`, 1); break;
        case 'injury': this.say(`${n(ev.p)} har skadat sig – ${FB.INJURY[ev.sev].name.toLowerCase()}.`, 2); break;
        case 'dribbleOk': this.say(pick([`${n(ev.p)} fintar bort försvaret!`, `Vilken dribbling av ${n(ev.p)}!`, `${n(ev.p)} fryser försvararna!`]), 1); break;
        case 'dribbleFail': this.say(pick([`${n(ev.p)} tappar bollen i dribblingen.`, `Dribblingen misslyckas för ${n(ev.p)}.`]), 1); break;
        case 'slideWin': this.say(pick([`Snygg glidtackling av ${n(ev.p)}!`, `${n(ev.p)} glider in och tar bollen!`]), 1); break;
        case 'tackle': if (Math.random() < 0.5) this.say(`${n(ev.p)} vinner bollen.`, 0); break;
        case 'intercept': if (Math.random() < 0.6) this.say(`${n(ev.p)} bryter passningen!`, 0); break;
        case 'clearance': if (Math.random() < 0.5) this.say(`${n(ev.p)} rensar undan.`, 0); break;
        case 'halftime': this.say(`Halvtid! Ställningen är ${sc}.`, 2); break;
        case 'fulltime': this.say(`Slutsignal! ${tn(0)} ${sc} ${tn(1)}.`, 3); break;
        case 'extraPens': this.say('Oavgjort – det blir straffläggning!', 3); break;
        case 'shootoutGoal': this.say(pick(['Mål!', 'Säkert i nät!', 'Den sitter!']), 2); break;
        case 'shootoutMiss': this.say(pick(['Missat!', 'Räddad!', 'Ingen utdelning!']), 2); break;
        case 'sub': this.say(`Byte för ${tn(ev.side)}: ${n(ev.in)} kommer in för ${n(ev.out)}.`, 1); break;
        case 'drink': this.say(`${tn(ev.side)} tar en energidryck – full ork igen!`, 1); break;
      }
    }
  }

  FB.Sound = Sound;
  FB.Commentator = Commentator;
})(window);
