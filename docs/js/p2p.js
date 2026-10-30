/* Spela och handla med en kompis utan egen server (webbläsarversionen, t.ex. på GitHub Pages).
   Webbläsarna kopplas ihop direkt med WebRTC via biblioteket PeerJS. En gratis tjänst hos PeerJS
   används bara för att hitta varandra med rumskoden – själva matchen går direkt mellan er.
   Klassen har samma gränssnitt som Net i net.js, så matchkoden fungerar likadant med och utan server. */
(function (root) {
  'use strict';
  const FB = root.FB;
  const PREFIX = 'matchdag-v1-';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

  let peerLib = null;
  function loadPeerJs() {
    if (root.Peer) return Promise.resolve();
    if (!peerLib) {
      peerLib = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/vendor/peerjs.min.js';
        s.onload = () => (root.Peer ? resolve() : reject(new Error('PeerJS kunde inte laddas.')));
        s.onerror = () => { peerLib = null; reject(new Error('Kunde inte ladda js/vendor/peerjs.min.js.')); };
        document.head.appendChild(s);
      });
    }
    return peerLib;
  }

  const ERRORS = {
    'peer-unavailable': 'Hittade inget rum med den koden. Kolla koden och att kompisen har rummet öppet.',
    'browser-incompatible': 'Webbläsaren klarar inte direktanslutning (WebRTC). Prova Chrome, Edge, Firefox eller Safari.',
    network: 'Kunde inte nå tjänsten som kopplar ihop spelare. Kontrollera internetanslutningen.',
    'server-error': 'Kunde inte nå tjänsten som kopplar ihop spelare. Försök igen om en stund.',
    'socket-error': 'Kunde inte nå tjänsten som kopplar ihop spelare. Kontrollera internetanslutningen.',
    'socket-closed': 'Anslutningen till tjänsten som kopplar ihop spelare bröts.',
    'unavailable-id': 'Kunde inte skapa ett rum just nu. Försök igen.',
    timeout: 'Kunde inte ansluta till kompisen. Vissa nätverk (t.ex. skolans eller jobbets wifi) blockerar direktanslutningar – prova ett annat nätverk.',
  };

  class P2PNet {
    // hooks: { profile() → laget, stake(wager) → Promise (drar insatsen), team() → laget som matchmotorn vill ha det }
    constructor(hooks) {
      this.hooks = hooks;
      this.handlers = {};
      this.peer = null;
      this.conn = null;
      this.role = null;
      this.lobby = false;
      this.started = false;
      this.settled = false;
      this.closed = false;
      this.lastRecv = 0;
      this.lastSent = 0;
      // stäng snyggt när fliken stängs, så att kompisen märker det direkt
      this.onHide = () => this.close();
      root.addEventListener('pagehide', this.onHide);
    }

    connect() { return loadPeerJs(); }
    on(t, fn) { this.handlers[t] = fn; }
    emit(t, m) { const h = this.handlers[t]; if (h) h(Object.assign({ t }, m || {})); }
    raw(o) { if (this.conn && this.conn.open) { try { this.conn.send(o); this.lastSent = Date.now(); } catch (e) { /* stängd */ } } }
    relay(d) { this.raw({ t: 'relay', d }); }
    options() { return Object.assign({ debug: 0 }, root.MATCHDAG_PEER || {}); }

    send(obj) {
      switch (obj.t) {
        case 'create': return this.create(Math.max(0, obj.wager | 0));
        case 'join': return this.join(String(obj.code || ''));
        case 'start': return this.requestStart();
        case 'result': return this.result(obj);
        case 'trade': return this.raw(obj);
        case 'leave': return this.close();
      }
    }

    fail(err) {
      if (this.closed) return;
      const type = err && err.type;
      this.emit('error', { msg: ERRORS[type] || (err && err.message) || 'Anslutningen misslyckades.' });
      this.close();
    }

    create(wager) {
      this.role = 'host';
      this.wager = wager;
      const open = attempt => {
        let code = '';
        for (let i = 0; i < 4; i++) code += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
        const peer = new root.Peer(PREFIX + code.toLowerCase(), this.options());
        this.peer = peer;
        peer.on('open', () => { this.code = code; this.emit('created', { code, wager }); });
        peer.on('error', err => {
          if (err.type === 'unavailable-id' && attempt < 5 && !this.code) { peer.destroy(); open(attempt + 1); return; }
          if (this.lobby && (err.type === 'network' || err.type === 'socket-closed' || err.type === 'server-error')) return; // redan ihopkopplade
          this.fail(err);
        });
        peer.on('connection', conn => {
          if (this.conn) { conn.on('open', () => { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 400); }); return; }
          this.bind(conn);
        });
        peer.on('disconnected', () => { if (!this.closed && !this.lobby) { try { peer.reconnect(); } catch (e) { /* ignorera */ } } });
      };
      open(0);
    }

    join(code) {
      this.role = 'guest';
      const peer = new root.Peer(this.options());
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.trim().toLowerCase(), { reliable: true, serialization: 'json' });
        this.bind(conn);
        this.joinTimer = setTimeout(() => { if (!this.lobby) this.fail({ type: 'timeout' }); }, 20000);
      });
      peer.on('error', err => { if (!this.lobby) this.fail(err); });
    }

    bind(conn) {
      this.conn = conn;
      conn.on('open', () => {
        // livstecken: om inget hörs från kompisen på 9 sekunder räknas anslutningen som bruten
        this.lastRecv = Date.now();
        clearInterval(this.hb);
        this.hb = setInterval(() => {
          if (!this.conn || !this.conn.open) return;
          if (Date.now() - this.lastSent > 1500) this.raw({ t: 'ping' });
          if (Date.now() - this.lastRecv > 9000) this.lost();
        }, 1000);
        if (this.role === 'guest') {
          const u = this.hooks.profile();
          conn.send({ t: 'hello', club: u.club, coins: u.coins });
        }
      });
      conn.on('data', m => this.onData(m));
      conn.on('close', () => this.lost());
      conn.on('error', () => this.lost());
    }

    onData(m) {
      if (!m || typeof m !== 'object') return;
      this.lastRecv = Date.now();
      switch (m.t) {
        case 'hello': {
          if (this.role !== 'host' || this.lobby) return;
          this.opponent = String(m.club || 'Kompisen').slice(0, 24);
          if ((m.coins | 0) < this.wager) {
            this.raw({ t: 'deny', msg: `Insatsen är ${this.wager} spelpengar – du har inte råd.` });
            const c = this.conn;
            this.conn = null;
            setTimeout(() => c.close(), 400);
            return;
          }
          this.raw({ t: 'welcome', club: this.hooks.profile().club, wager: this.wager });
          this.lobby = true;
          this.emit('lobby', { role: 'host', opponent: this.opponent, wager: this.wager, code: this.code });
          break;
        }
        case 'welcome':
          clearTimeout(this.joinTimer);
          this.opponent = String(m.club || 'Kompisen').slice(0, 24);
          this.wager = Math.max(0, m.wager | 0);
          this.lobby = true;
          this.emit('lobby', { role: 'guest', opponent: this.opponent, wager: this.wager });
          break;
        case 'deny': this.emit('error', { msg: String(m.msg || 'Värden nekade.') }); this.close(); break;
        case 'busy': this.emit('error', { msg: 'Det rummet har redan två spelare.' }); this.close(); break;
        case 'start-req':
          // gästen betalar sin insats och skickar sitt lag till värden
          if (this.role !== 'guest' || this.started) return;
          Promise.resolve(this.hooks.stake(this.wager)).then(() => {
            this.started = true;
            this.raw({ t: 'start-ok', team: this.hooks.team() });
            this.emit('start', { role: 'guest', opponent: this.opponent, wager: this.wager });
          }, err => {
            this.raw({ t: 'start-no', msg: (err && err.message) || 'Kompisen kunde inte starta.' });
            this.emit('error', { msg: (err && err.message) || 'Kunde inte starta matchen.' });
          });
          break;
        case 'start-ok':
          if (this.role !== 'host' || this.started || !m.team) return;
          Promise.resolve(this.hooks.stake(this.wager)).then(() => {
            this.started = true;
            this.emit('start', { role: 'host', opponent: this.opponent, wager: this.wager, guestTeam: sanitizeTeam(m.team) });
          }, err => {
            this.emit('error', { msg: (err && err.message) || 'Kunde inte starta matchen.' });
            this.raw({ t: 'host-cancel' });
          });
          break;
        case 'start-no': this.emit('error', { msg: `${this.opponent}: ${String(m.msg || 'kunde inte starta')}` }); break;
        case 'host-cancel': this.emit('error', { msg: 'Värden kunde inte starta matchen.' }); break;
        case 'relay': this.emit('relay', { d: m.d }); break;
        case 'settle':
          if (this.role !== 'guest' || this.settled) return;
          this.settled = true;
          this.emit('settled', { result: { score: m.score, walkover: false }, injuries: m.injuries, drinks: m.drinks });
          break;
        case 'trade': this.emit('trade', m); break;
      }
    }

    requestStart() {
      if (this.role === 'host' && this.lobby && !this.started) this.raw({ t: 'start-req' });
    }

    result(o) {
      if (this.role !== 'host' || this.settled) return;
      this.settled = true;
      const msg = { score: o.score, injuries: o.injuries || [], drinks: o.drinks || [0, 0] };
      this.raw(Object.assign({ t: 'settle' }, msg));
      this.emit('settled', { result: { score: o.score, walkover: false }, injuries: msg.injuries, drinks: msg.drinks });
    }

    lost() {
      if (this.closed) return;
      if (this.settled) { this.close(); return; } // matchen är redan avgjord
      const wasLobby = this.lobby;
      this.emit('peerLeft', { reason: wasLobby ? 'Kompisen lämnade.' : 'Kompisen tappade anslutningen.', inMatch: this.started && !this.settled });
      if (this.started && !this.settled) {
        // den som försvinner mitt i matchen förlorar på walkover
        this.settled = true;
        this.emit('settled', { result: { score: this.role === 'host' ? [3, 0] : [0, 3], walkover: true } });
      }
      this.close();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      clearTimeout(this.joinTimer);
      clearInterval(this.hb);
      root.removeEventListener('pagehide', this.onHide);
      try { if (this.conn) this.conn.close(); } catch (e) { /* stängd */ }
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* stängd */ }
      this.conn = null;
      const h = this.handlers.close;
      this.handlers = {};
      if (h) h({ t: 'close' });
    }
  }

  // Laget kommer från kompisens webbläsare – kontrollera det innan matchmotorn får det
  function sanitizeTeam(t) {
    const G = FB.Logic;
    const squad = (Array.isArray(t.squad) ? t.squad : []).slice(0, 40).map((p, i) => G.cleanOwnedPlayer(p, String(p && p.uid ? p.uid : 'g' + i).slice(0, 40)));
    FB.numberSquad(squad);
    const kit = k => (k && typeof k.shirt === 'string' ? { shirt: k.shirt, shorts: k.shorts, socks: k.socks, num: k.num, stripe: k.stripe } : null);
    return {
      name: String(t.name || 'Kompisen').slice(0, 24), short: FB.shortName(t.name), kit: kit(t.kit) || FB.AWAY_KIT, gkKit: kit(t.gkKit) || FB.GK_KITS[1],
      formation: FB.FORMATIONS[t.formation] ? t.formation : '4-3-3', squad, lineup: Array.isArray(t.lineup) ? t.lineup.map(String).slice(0, 11) : null,
      energyDrinks: Math.max(0, Math.min(20, t.energyDrinks | 0)),
    };
  }

  FB.P2PNet = P2PNet;
})(window);
