/* Grafiken: en perspektivkamera (som på TV) ritad på en vanlig 2D-canvas.
   Världen ritas i "vykoordinater": för spelare 2 i en kompismatch vänds planen 180°
   så att båda spelarna alltid anfaller åt höger. */
(function (root) {
  'use strict';
  const FB = root.FB, E = FB.Engine;
  const L = E.L, W = E.W, CY = E.CY, GHW = E.GOAL_HW, GH = E.GOAL_H, GD = E.GOAL_DEPTH, BR = E.BALL_R;
  const hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const NEAR = 0.4;
  const LINE = 0.12;
  const SPONSORS = ['SKOGSKAFFE', 'NORDLJUS ENERGI', 'LAGOM BANK', 'FJÄLLSKOR', 'SMÅLANDS MEJERI', 'KUSTFÄRJAN', 'BOLLPLANKET', 'VÄSTANVIND'];
  const BOARD_COLORS = ['#0f3d6e', '#c8102e', '#f2b705', '#14532d', '#1f2937', '#7c3aed', '#0e7490', '#b45309'];

  class Renderer {
    constructor(canvas) {
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.flip = false;
      this.cam = null;
      this.c = {};
      this.focusX = L / 2;
      this.screen = new Map();
      this.trail = [];
      this.particles = [];
      this.time = 0;
      this.makeTextures();
      this.resize();
    }

    resize() {
      const r = this.cv.getBoundingClientRect();
      const w = Math.max(1, r.width), h = Math.max(1, r.height);
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (w * h * dpr * dpr > 2.6e6) dpr = Math.sqrt(2.6e6 / (w * h));
      this.dpr = dpr;
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
      this.cw = this.cv.width; this.ch = this.cv.height;
      this.cssW = w; this.cssH = h;
    }

    makeTextures() {
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      // gräsbrus
      const n = mk(256, 256), g = n.getContext('2d');
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * 256, y = rnd() * 256, l = rnd();
        g.fillStyle = l < 0.5 ? `rgba(0,30,0,${0.05 + rnd() * 0.12})` : `rgba(200,255,170,${0.03 + rnd() * 0.06})`;
        g.fillRect(x, y, 1 + rnd() * 1.5, 1 + rnd() * 2.5);
      }
      this.noise = this.ctx.createPattern(n, 'repeat');
      // publik
      const c = mk(240, 120), cg = c.getContext('2d');
      cg.fillStyle = '#1b1f2a'; cg.fillRect(0, 0, 240, 120);
      const shirts = ['#c8102e', '#f4f4f0', '#1f3c88', '#fecc02', '#2a2a2a', '#0b7a3e', '#e5e7eb', '#7c2d12', '#f97316', '#38bdf8'];
      for (let row = 0; row < 20; row++) {
        for (let col = 0; col < 48; col++) {
          const x = col * 5 + (row % 2) * 2.5 + rnd() * 1.2, y = row * 6 + rnd();
          cg.fillStyle = shirts[(rnd() * shirts.length) | 0];
          cg.fillRect(x, y + 2.2, 3.4, 3.2);
          cg.fillStyle = ['#f1c7a5', '#c68b5e', '#6e452b', '#e0ac85'][(rnd() * 4) | 0];
          cg.beginPath(); cg.arc(x + 1.7, y + 1.4, 1.3, 0, 6.3); cg.fill();
        }
      }
      this.crowdCanvas = c;
      this.crowd = this.ctx.createPattern(c, 'repeat');
    }

    // ------------------------------------------------------------ kamera
    vx(x) { return this.flip ? L - x : x; }
    vy(y) { return this.flip ? W - y : y; }

    desiredCamera(scene, dt) {
      const b = scene.ball, cm = scene.cam || { mode: 'side' };
      const bx = this.vx(b.x), by = this.vy(b.y);
      if (cm.mode === 'side' || !cm.from) {
        const bvx = (this.flip ? -1 : 1) * (b.vx || 0);
        const look = clamp(bx + bvx * 0.35, 15, L - 15);
        this.focusX += (look - this.focusX) * Math.min(1, dt * 2.6);
        const aspect = this.cw / this.ch;
        const span = aspect < 1.1 ? 30 : aspect < 1.5 ? 38 : 44;
        // kameran sitter fast på läktaren men lutar med bollen så att den alltid syns
        const ty = clamp(by * 0.8 + CY * 0.2, 9, 60), dist = hyp(ty + 22, 18);
        return { px: this.focusX, py: -22, pz: 18, tx: this.focusX, ty, tz: 0, hh: Math.atan(span / 2 / dist), hv: Math.atan((span * 0.62) / 2 / dist) };
      }
      // bakom bollen: placera kameran och välj bildvinkel så att både bollen och hela målet syns
      const fx = this.vx(cm.from.x), fy = this.vy(cm.from.y), gx = this.vx(cm.goalX);
      const dx = gx - fx, dy = CY - fy, d = hyp(dx, dy) || 1, ux = dx / d, uy = dy / d;
      this.focusX = clamp(fx, 15, L - 15);
      const back = cm.mode === 'penalty' ? 4.6 : cm.mode === 'save' ? 4.5 : 6.5;
      const h = cm.mode === 'penalty' ? 1.9 : cm.mode === 'save' ? 2.4 : 2.8;
      const px = fx - ux * back, py = fy - uy * back;
      const pts = [[fx, fy, 0], [gx, CY - GHW - 0.4, 0], [gx, CY + GHW + 0.4, 0], [gx, CY - GHW - 0.4, GH + 0.5], [gx, CY + GHW + 0.4, GH + 0.5]];
      let h0 = 1e9, h1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const [x, y, z] of pts) {
        const vx = x - px, vy = y - py, hd = hyp(vx, vy);
        const ah = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy), av = Math.atan2(z - h, hd);
        h0 = Math.min(h0, ah); h1 = Math.max(h1, ah); v0 = Math.min(v0, av); v1 = Math.max(v1, av);
      }
      const yaw = Math.atan2(uy, ux) + (h0 + h1) / 2, pitch = (v0 + v1) / 2;
      return {
        px, py, pz: h, tx: px + Math.cos(yaw) * Math.cos(pitch) * 20, ty: py + Math.sin(yaw) * Math.cos(pitch) * 20, tz: h + Math.sin(pitch) * 20,
        hh: ((h1 - h0) / 2) * 1.15 + 0.03, hv: ((v1 - v0) / 2) * 1.16 + 0.03,
      };
    }

    updateCamera(scene, dt) {
      const want = this.desiredCamera(scene, dt);
      const modeKey = (scene.cam && scene.cam.mode) || 'side';
      // ny vinkel: klipp direkt, som i en TV-sändning
      if (!this.cam || this.camMode !== modeKey) this.cam = Object.assign({}, want);
      this.camMode = modeKey;
      const k = Math.min(1, dt * (modeKey === 'side' ? 5 : 8));
      for (const key of ['px', 'py', 'pz', 'tx', 'ty', 'tz', 'hh', 'hv']) this.cam[key] += (want[key] - this.cam[key]) * k;
      const c = this.cam;
      let fx = c.tx - c.px, fy = c.ty - c.py, fz = c.tz - c.pz;
      const fl = hyp(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
      let rx = fy, ry = -fx;
      const rl = hyp(rx, ry) || 1; rx /= rl; ry /= rl;
      const ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
      const Fw = this.cw / 2 / Math.tan(c.hh), Fh = this.ch / 2 / Math.tan(c.hv);
      this.c = { px: c.px, py: c.py, pz: c.pz, fx, fy, fz, rx, ry, ux, uy, uz, F: Math.min(Fw, Fh), cx: this.cw / 2, cy: this.ch * 0.5 };
    }

    toCam(x, y, z) {
      const c = this.c, dx = x - c.px, dy = y - c.py, dz = z - c.pz;
      return [dx * c.rx + dy * c.ry, dx * c.ux + dy * c.uy + dz * c.uz, dx * c.fx + dy * c.fy + dz * c.fz];
    }
    proj(x, y, z) {
      const [xc, yc, zc] = this.toCam(x, y, z);
      if (zc < NEAR) return null;
      const k = this.c.F / zc;
      return { x: this.c.cx + xc * k, y: this.c.cy - yc * k, s: k, d: zc };
    }
    // Lägg till en polygon (vykoordinater) i aktuell path, klippt mot kamerans närplan
    pathPoly(pts) {
      const cs = pts.map(p => this.toCam(p[0], p[1], p[2] || 0));
      const out = [];
      for (let i = 0; i < cs.length; i++) {
        const a = cs[i], b = cs[(i + 1) % cs.length];
        const ain = a[2] >= NEAR, bin = b[2] >= NEAR;
        if (ain) out.push(a);
        if (ain !== bin) {
          const t = (NEAR - a[2]) / (b[2] - a[2]);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
      }
      if (out.length < 3) return false;
      const c = this.c, ctx = this.ctx;
      out.forEach((p, i) => {
        const k = c.F / p[2], sx = c.cx + p[0] * k, sy = c.cy - p[1] * k;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
      return true;
    }
    fillPoly(pts, style) {
      const ctx = this.ctx;
      ctx.beginPath();
      if (this.pathPoly(pts)) { ctx.fillStyle = style; ctx.fill(); return true; }
      return false;
    }
    line3(a, b) {
      const pa = this.proj(a[0], a[1], a[2]), pb = this.proj(b[0], b[1], b[2]);
      if (!pa || !pb) return;
      this.ctx.moveTo(pa.x, pa.y); this.ctx.lineTo(pb.x, pb.y);
    }

    // ------------------------------------------------------------ planen
    drawBackground() {
      const ctx = this.ctx;
      const g = ctx.createLinearGradient(0, 0, 0, this.ch);
      g.addColorStop(0, '#0b1220'); g.addColorStop(0.6, '#18233a'); g.addColorStop(1, '#0d1626');
      ctx.fillStyle = g; ctx.fillRect(0, 0, this.cw, this.ch);
      // läktare
      const crowdFill = (pts, cx, cy, cz) => {
        const p = this.proj(cx, cy, cz);
        if (p && this.crowd.setTransform) {
          const k = clamp(p.s * 0.09, 0.15, 6);
          this.crowd.setTransform(new DOMMatrix([k, 0, 0, k, p.x, p.y]));
        }
        this.fillPoly(pts, this.crowd);
        this.fillPoly(pts, 'rgba(8,12,24,0.25)');
      };
      crowdFill([[-40, 77, 1.2], [145, 77, 1.2], [145, 108, 26], [-40, 108, 26]], 52, 90, 12);
      this.fillPoly([[-40, 75.5, 0], [145, 75.5, 0], [145, 77, 1.2], [-40, 77, 1.2]], '#2a3144');
      this.fillPoly([[-40, 108, 26], [145, 108, 26], [145, 112, 30], [-40, 112, 30]], '#0e1424');
      crowdFill([[-9, -40, 1.2], [-9, 108, 1.2], [-40, 108, 24], [-40, -40, 24]], -24, 34, 12);
      crowdFill([[L + 9, -40, 1.2], [L + 9, 108, 1.2], [L + 40, 108, 24], [L + 40, -40, 24]], L + 24, 34, 12);
      crowdFill([[-40, -9, 1.2], [145, -9, 1.2], [145, -40, 24], [-40, -40, 24]], 52, -24, 12);
      this.fillPoly([[-9, -12, 0], [-9, 80, 0], [-9, 80, 1.2], [-9, -12, 1.2]], '#2a3144');
      this.fillPoly([[L + 9, -12, 0], [L + 9, 80, 0], [L + 9, 80, 1.2], [L + 9, -12, 1.2]], '#2a3144');
    }

    drawPitch() {
      const ctx = this.ctx;
      const surround = [[-9, -9, 0], [L + 9, -9, 0], [L + 9, W + 7.5, 0], [-9, W + 7.5, 0]];
      this.fillPoly(surround, '#2f6b33');
      const N = 18, sw = (L + 8) / N;
      for (let i = 0; i < N; i++) {
        const x0 = -4 + i * sw, x1 = x0 + sw;
        this.fillPoly([[x0, -4, 0], [x1, -4, 0], [x1, W + 4, 0], [x0, W + 4, 0]], i % 2 ? '#3f8a3e' : '#4a9a45');
      }
      ctx.save();
      ctx.beginPath();
      if (this.pathPoly(surround)) {
        ctx.clip();
        ctx.fillStyle = this.noise;
        ctx.fillRect(0, 0, this.cw, this.ch);
        // strålkastarljus
        const lg = ctx.createRadialGradient(this.cw * 0.5, this.ch * 0.35, this.ch * 0.1, this.cw * 0.5, this.ch * 0.5, this.cw * 0.75);
        lg.addColorStop(0, 'rgba(255,255,230,0.06)'); lg.addColorStop(1, 'rgba(0,10,0,0.22)');
        ctx.fillStyle = lg; ctx.fillRect(0, 0, this.cw, this.ch);
      }
      ctx.restore();
      this.drawLines();
      this.drawBoards();
    }

    drawLines() {
      const ctx = this.ctx, h = LINE / 2;
      ctx.beginPath();
      const seg = (x0, y0, x1, y1) => {
        const dx = x1 - x0, dy = y1 - y0, l = hyp(dx, dy), nx = (-dy / l) * h, ny = (dx / l) * h;
        const ex = (dx / l) * h, ey = (dy / l) * h;
        this.pathPoly([[x0 + nx - ex, y0 + ny - ey], [x1 + nx + ex, y1 + ny + ey], [x1 - nx + ex, y1 - ny + ey], [x0 - nx - ex, y0 - ny - ey]]);
      };
      const arc = (cx, cy, r, a0, a1, n) => {
        const pts = [];
        for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * (r + h), cy + Math.sin(a) * (r + h)]); }
        for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * (r - h), cy + Math.sin(a) * (r - h)]); }
        this.pathPoly(pts);
      };
      const disc = (cx, cy, r) => {
        const pts = [];
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
        this.pathPoly(pts);
      };
      seg(0, 0, L, 0); seg(L, 0, L, W); seg(L, W, 0, W); seg(0, W, 0, 0);
      seg(L / 2, 0, L / 2, W);
      disc(L / 2, CY, 0.22);
      for (const gx of [0, L]) {
        const s = gx === 0 ? 1 : -1;
        seg(gx, CY - 20.16, gx + s * 16.5, CY - 20.16); seg(gx + s * 16.5, CY - 20.16, gx + s * 16.5, CY + 20.16); seg(gx + s * 16.5, CY + 20.16, gx, CY + 20.16);
        seg(gx, CY - 9.16, gx + s * 5.5, CY - 9.16); seg(gx + s * 5.5, CY - 9.16, gx + s * 5.5, CY + 9.16); seg(gx + s * 5.5, CY + 9.16, gx, CY + 9.16);
        disc(gx + s * 11, CY, 0.18);
        const a = Math.acos(5.5 / 9.15);
        if (s > 0) arc(gx + 11, CY, 9.15, -a, a, 20); else arc(gx - 11, CY, 9.15, Math.PI - a, Math.PI + a, 20);
      }
      for (const [cx, cy, a0] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]]) arc(cx, cy, 1, a0, a0 + Math.PI / 2, 6);
      ctx.fillStyle = 'rgba(245,245,238,0.88)';
      ctx.fill('nonzero');
      ctx.beginPath();
      arc(L / 2, CY, 9.15, 0, Math.PI * 2, 64);
      ctx.fill('evenodd');
    }

    drawBoards() {
      const ctx = this.ctx;
      const side = Math.abs(this.c.rx) > 0.9;
      const n = 12, bw = (L + 10) / n;
      for (let i = 0; i < n; i++) {
        const x0 = -5 + i * bw, x1 = x0 + bw - 0.15;
        const col = BOARD_COLORS[i % BOARD_COLORS.length];
        const yy = W + 4.5; // vykoordinater: tavlorna står alltid på bortre långsidan
        if (!this.fillPoly([[x0, yy, 0], [x1, yy, 0], [x1, yy, 0.95], [x0, yy, 0.95]], col)) continue;
        if (side) {
          const p = this.proj((x0 + x1) / 2, yy, 0.47);
          if (p && p.s > 3) {
            ctx.fillStyle = '#ffffff';
            ctx.font = `800 ${Math.round(p.s * 0.55)}px "Saira Condensed", "Arial Narrow", sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(SPONSORS[i % SPONSORS.length], p.x, p.y);
          }
        }
      }
      for (const gx of [-5, L + 5]) {
        for (let i = 0; i < 6; i++) {
          const y0 = 4 + i * 10, y1 = y0 + 9.8;
          this.fillPoly([[gx, y0, 0], [gx, y1, 0], [gx, y1, 0.95], [gx, y0, 0.95]], BOARD_COLORS[(i + 3) % BOARD_COLORS.length]);
        }
      }
    }

    // ------------------------------------------------------------ mål
    goalItems(scene) {
      const items = [];
      for (const wgx of [0, L]) {
        const gx = this.vx(wgx), out = gx < L / 2 ? -1 : 1;
        const pulse = scene.netPulse && scene.netPulse.x === wgx && scene.time - scene.netPulse.t < 0.9 ? scene.netPulse : null;
        const netC = this.toCam(gx + out * GD * 0.6, CY, 1.2);
        items.push({ d: netC[2] + 2, draw: () => this.drawNet(gx, out, pulse, scene.time) });
        for (const py of [CY - GHW, CY + GHW]) {
          const pc = this.toCam(gx, py, 1.2);
          items.push({ d: pc[2], draw: () => this.drawPost(gx, py) });
        }
        const bc = this.toCam(gx, CY, GH);
        items.push({ d: bc[2] + 0.01, draw: () => this.drawBar(gx) });
      }
      return items;
    }

    drawNet(gx, out, pulse, time) {
      const ctx = this.ctx, bx = gx + out * GD, top = GH * 0.8;
      let pv = null;
      if (pulse) {
        const age = time - pulse.t;
        pv = { y: this.vy(pulse.y), z: pulse.z, a: pulse.power * 0.7 * Math.exp(-age * 3.5) * Math.cos(age * 18) };
      }
      const bulge = (y, z) => (pv ? pv.a * Math.exp(-((y - pv.y) ** 2 + (z - pv.z) ** 2) / 1.6) : 0);
      this.fillPoly([[gx, CY - GHW, 0], [bx, CY - GHW, 0], [bx, CY - GHW, top], [gx, CY - GHW, GH]], 'rgba(255,255,255,0.05)');
      this.fillPoly([[gx, CY + GHW, 0], [bx, CY + GHW, 0], [bx, CY + GHW, top], [gx, CY + GHW, GH]], 'rgba(255,255,255,0.05)');
      this.fillPoly([[bx, CY - GHW, 0], [bx, CY + GHW, 0], [bx, CY + GHW, top], [bx, CY - GHW, top]], 'rgba(255,255,255,0.07)');
      ctx.beginPath();
      for (let y = -GHW; y <= GHW + 0.01; y += 0.36) {
        let prev = null;
        for (let z = 0; z <= top + 0.01; z += top / 6) {
          const pt = [bx + out * bulge(CY + y, z), CY + y, z];
          if (prev) this.line3(prev, pt);
          prev = pt;
        }
        this.line3([bx + out * bulge(CY + y, top), CY + y, top], [gx, CY + y, GH]);
      }
      for (let z = 0; z <= top + 0.01; z += 0.3) {
        let prev = null;
        for (let y = -GHW; y <= GHW + 0.01; y += GHW / 6) {
          const pt = [bx + out * bulge(CY + y, z), CY + y, z];
          if (prev) this.line3(prev, pt);
          prev = pt;
        }
      }
      for (const sy of [-GHW, GHW]) {
        for (let k = 0; k <= 5; k++) { const xx = gx + (out * GD * k) / 5; this.line3([xx, CY + sy, 0], [xx, CY + sy, GH + (top - GH) * (k / 5)]); }
        for (let z = 0.3; z < GH; z += 0.3) this.line3([gx, CY + sy, z], [bx, CY + sy, Math.min(z, top)]);
      }
      for (let k = 1; k <= 5; k++) { const xx = gx + (out * GD * k) / 5; this.line3([xx, CY - GHW, GH + (top - GH) * (k / 5)], [xx, CY + GHW, GH + (top - GH) * (k / 5)]); }
      ctx.strokeStyle = 'rgba(240,240,240,0.42)';
      ctx.lineWidth = Math.max(0.6, this.dpr * 0.7);
      ctx.stroke();
      ctx.beginPath();
      this.line3([bx, CY - GHW, 0], [bx, CY + GHW, 0]);
      this.line3([bx, CY - GHW, top], [bx, CY + GHW, top]);
      this.line3([gx, CY - GHW, GH], [bx, CY - GHW, top]); this.line3([gx, CY + GHW, GH], [bx, CY + GHW, top]);
      this.line3([bx, CY - GHW, 0], [bx, CY - GHW, top]); this.line3([bx, CY + GHW, 0], [bx, CY + GHW, top]);
      ctx.strokeStyle = 'rgba(210,210,210,0.7)'; ctx.lineWidth = Math.max(1, this.dpr * 1.2);
      ctx.stroke();
    }

    drawPost(gx, py) {
      const a = this.proj(gx, py, 0), b = this.proj(gx, py, GH);
      if (!a || !b) return;
      const ctx = this.ctx;
      ctx.strokeStyle = '#f7f7f2'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, 0.12 * a.s);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    drawBar(gx) {
      const a = this.proj(gx, CY - GHW, GH), b = this.proj(gx, CY + GHW, GH);
      if (!a || !b) return;
      const ctx = this.ctx;
      ctx.strokeStyle = '#f7f7f2'; ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, 0.12 * Math.min(a.s, b.s));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // ------------------------------------------------------------ spelare
    kitFor(scene, p) {
      const t = scene.teams[p.side];
      return p.slot === 0 ? t.gkKit : t.kit;
    }

    drawShadow(x, y, s, rx, ry, alpha) {
      const p = this.proj(x + 0.25, y + 0.35, 0);
      if (!p) return;
      const ctx = this.ctx;
      ctx.fillStyle = `rgba(10,25,10,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, Math.max(1, rx * p.s), Math.max(0.6, ry * p.s * Math.max(0.3, Math.abs(this.c.fz)) * 1.8), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPlayer(scene, p) {
      const x = this.vx(p.x), y = this.vy(p.y);
      const foot = this.proj(x, y, 0);
      if (!foot) return;
      const head = this.proj(x, y, 1.8);
      if (!head) return;
      const ctx = this.ctx;
      const u = (foot.y - head.y) / 1.8, w = foot.s;
      const kit = this.kitFor(scene, p);
      const face = p.face + (this.flip ? Math.PI : 0);
      const fp = this.proj(x + Math.cos(face), y + Math.sin(face), 0);
      let sdx = fp ? fp.x - foot.x : 1, sdy = fp ? fp.y - foot.y : 0;
      const sl = hyp(sdx, sdy) || 1; sdx /= sl; sdy /= sl;
      const dirX = sdx >= 0 ? 1 : -1;
      const speed = hyp(p.vx, p.vy);
      this.screen.set(p.uid, { x: foot.x / this.dpr, y: (foot.y - u * 1.0) / this.dpr, h: (u * 1.9) / this.dpr, side: p.side });

      ctx.save();
      // spelare alldeles framför kameran blir genomskinliga så att de inte skymmer
      if (foot.d < 6) ctx.globalAlpha = clamp((foot.d - 1.2) / 5, 0.22, 1);
      ctx.translate(foot.x, foot.y);
      let rot = 0, lift = 0, pose = 'run';
      if (p.state === 'slide') { rot = -dirX * 1.15; lift = 0.25 * u; pose = 'slide'; }
      else if (p.state === 'down') { rot = -dirX * 1.45; lift = 0.18 * u; pose = 'down'; }
      else if (p.state === 'dive') {
        const dd = this.diveScreenDir(p);
        rot = dd * (0.5 + Math.min(1, (p.diveH || 0) * 1.4 + 0.5)) * 1.0;
        lift = (p.diveH || 0) * u + 0.3 * u;
        pose = 'dive';
      } else if (p.state === 'wall') pose = 'wall';
      else if (scene.celebrate && scene.celebrate === p.uid) pose = 'cheer';
      if (p.wall && scene.ball && hyp(scene.ball.vx, scene.ball.vy) > 8) lift = 0.35 * u;
      ctx.translate(0, -lift);
      ctx.rotate(rot);
      this.drawFigure(ctx, u, w, kit, p, sdx, sdy, dirX, speed, pose);
      ctx.restore();

      if (p.frozen) {
        ctx.save();
        ctx.translate(foot.x, foot.y);
        ctx.fillStyle = 'rgba(170,220,255,0.38)';
        ctx.strokeStyle = 'rgba(225,245,255,0.9)';
        ctx.lineWidth = Math.max(1, w * 0.04);
        const rw = 0.42 * w, rh = 1.95 * u;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(-rw, -rh, rw * 2, rh, rw * 0.6) : ctx.rect(-rw, -rh, rw * 2, rh);
        ctx.fill(); ctx.stroke();
        this.snowflake(ctx, 0, -rh - 0.25 * u, 0.18 * u);
        ctx.restore();
      }
    }

    diveScreenDir(p) {
      const x = this.vx(p.x), y = this.vy(p.y);
      const dy = (p.diveDir || 1) * (this.flip ? -1 : 1);
      const a = this.proj(x, y, 1), b = this.proj(x, y + dy, 1);
      if (!a || !b) return 1;
      return b.x >= a.x ? 1 : -1;
    }

    snowflake(ctx, x, y, r) {
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = '#e6f6ff'; ctx.lineWidth = Math.max(1, r * 0.22); ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
        ctx.moveTo(r * 0.55, 0); ctx.lineTo(r * 0.8, r * 0.22); ctx.moveTo(r * 0.55, 0); ctx.lineTo(r * 0.8, -r * 0.22);
        ctx.stroke();
      }
      ctx.restore();
    }

    drawFigure(ctx, u, w, kit, p, sdx, sdy, dirX, speed, pose) {
      if (u < 2.2) {
        ctx.fillStyle = kit.shirt;
        ctx.fillRect(-0.2 * w, -1.5 * u, 0.4 * w, 0.9 * u);
        ctx.fillStyle = p.skin || '#e0ac85';
        ctx.fillRect(-0.12 * w, -1.8 * u, 0.24 * w, 0.3 * u);
        return;
      }
      const away = sdy < -0.35, toward = sdy > 0.35;
      const st = Math.min(1, speed / 7.5);
      const a = p.anim || 0;
      const swing = Math.sin(a);
      const strideX = sdx * 0.34 * w * st, strideY = sdy * 0.18 * u * st;
      const lean = (p.sprinting ? 0.12 : 0.05) * st * w * dirX;
      const hipY = -0.93 * u;
      const legW = Math.max(1.5, 0.15 * w);
      const skin = p.skin || '#e0ac85';
      const sock = kit.socks || kit.shirt;
      const boots = '#1b1b1b';

      const drawLeg = (sgn, behind) => {
        let fx = sgn * swing * strideX, fy = -Math.max(0, Math.cos(a + (sgn > 0 ? 0 : Math.PI))) * 0.13 * u * st + sgn * swing * strideY;
        let hx = sgn * 0.07 * w * (away || toward ? 1 : 0.4);
        if (pose === 'slide') { fx = dirX * (sgn > 0 ? 0.95 : 0.6) * u; fy = -0.05 * u; }
        if (pose === 'down') { fx = dirX * (sgn > 0 ? 0.9 : 0.75) * u; fy = 0; }
        if (pose === 'dive') { fx = -dirX * 0.25 * w * sgn; fy = 0; }
        const kx = (hx + fx) / 2 + dirX * 0.08 * w * st, ky = hipY / 2 - 0.02 * u;
        ctx.lineCap = 'round';
        ctx.strokeStyle = behind ? shade(skin, -0.18) : skin;
        ctx.lineWidth = legW;
        ctx.beginPath(); ctx.moveTo(hx, hipY); ctx.lineTo(kx, ky); ctx.stroke();
        ctx.strokeStyle = behind ? shade(sock, -0.2) : sock;
        ctx.lineWidth = legW * 0.92;
        ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy - 0.06 * u); ctx.stroke();
        ctx.fillStyle = boots;
        ctx.beginPath(); ctx.ellipse(fx + dirX * 0.05 * w, fy - 0.03 * u, Math.max(1.2, 0.12 * w), Math.max(0.8, 0.05 * u), 0, 0, Math.PI * 2); ctx.fill();
      };
      drawLeg(-1, true);
      drawLeg(1, false);

      // shorts
      ctx.fillStyle = kit.shorts;
      roundRect(ctx, -0.22 * w + lean * 0.3, hipY - 0.16 * u, 0.44 * w, 0.27 * u, 0.06 * w);
      ctx.fill();

      // armar bakom kroppen
      const shY = -1.42 * u;
      const armW = Math.max(1.2, 0.11 * w);
      const arm = (sgn, front) => {
        let hx = sgn * 0.27 * w - swing * sgn * strideX * 0.7 + lean, hy = shY + 0.55 * u;
        if (pose === 'cheer' || pose === 'dive') { hx = sgn * 0.3 * w + (pose === 'dive' ? dirX * 0.45 * w : 0); hy = shY - 0.55 * u; }
        if (pose === 'wall') { hx = sgn * 0.06 * w; hy = hipY + 0.05 * u; }
        if (pose === 'slide' || pose === 'down') { hx = -dirX * 0.4 * w + sgn * 0.1 * w; hy = shY + 0.3 * u; }
        const sx = sgn * 0.21 * w + lean;
        ctx.strokeStyle = front ? kit.shirt : shade(kit.shirt, -0.22);
        ctx.lineWidth = armW;
        ctx.beginPath(); ctx.moveTo(sx, shY + 0.04 * u); ctx.lineTo((sx + hx) / 2, (shY + hy) / 2); ctx.stroke();
        ctx.strokeStyle = front ? skin : shade(skin, -0.2);
        ctx.beginPath(); ctx.moveTo((sx + hx) / 2, (shY + hy) / 2); ctx.lineTo(hx, hy); ctx.stroke();
        if (p.slot === 0) { ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.arc(hx, hy, armW * 0.75, 0, 6.3); ctx.fill(); }
      };
      arm(-dirX, false);

      // tröja
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-0.2 * w + lean * 0.3, hipY - 0.1 * u);
      ctx.lineTo(0.2 * w + lean * 0.3, hipY - 0.1 * u);
      ctx.lineTo(0.25 * w + lean, shY);
      ctx.quadraticCurveTo(0 + lean, shY - 0.1 * u, -0.25 * w + lean, shY);
      ctx.closePath();
      ctx.fillStyle = kit.shirt;
      ctx.fill();
      if (kit.stripe) {
        ctx.clip();
        ctx.fillStyle = kit.stripe;
        for (let i = -2; i <= 2; i += 2) ctx.fillRect(i * 0.07 * w + lean * 0.6 - 0.035 * w, shY - 0.2 * u, 0.07 * w, 0.8 * u);
      }
      ctx.restore();
      // skuggning på tröjan
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.beginPath();
      ctx.moveTo(dirX * 0.04 * w + lean * 0.3, hipY - 0.1 * u);
      ctx.lineTo(-dirX * 0.2 * w + lean * 0.3, hipY - 0.1 * u);
      ctx.lineTo(-dirX * 0.25 * w + lean, shY);
      ctx.lineTo(-dirX * 0.02 * w + lean, shY - 0.05 * u);
      ctx.closePath(); ctx.fill();
      // nummer
      if (u > 7 && (away || (!toward && u > 14))) {
        ctx.fillStyle = kit.num || '#fff';
        ctx.font = `800 ${Math.round(u * 0.3)}px "Saira Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(p.num), lean * 0.7, -1.18 * u);
      } else if (u > 10 && toward) {
        ctx.fillStyle = kit.num || '#fff';
        ctx.font = `800 ${Math.round(u * 0.13)}px "Saira Condensed", "Arial Narrow", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(p.num), lean * 0.7 + 0.09 * w, -1.3 * u);
      }
      arm(dirX, true);

      // huvud
      const hx = lean * 1.2, hy = -1.64 * u, hr = Math.max(1.5, 0.125 * u);
      ctx.fillStyle = skin;
      ctx.fillRect(hx - hr * 0.35, hy + hr * 0.6, hr * 0.7, hr * 0.6);
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = p.hair || '#2a1d14';
      ctx.beginPath();
      if (away) ctx.arc(hx, hy, hr * 1.02, 0, Math.PI * 2);
      else {
        ctx.arc(hx, hy - hr * 0.12, hr * 1.02, Math.PI, Math.PI * 2);
        if (!toward) ctx.ellipse(hx - dirX * hr * 0.45, hy - hr * 0.05, hr * 0.6, hr * 0.75, 0, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // ------------------------------------------------------------ bollen
    drawBall(scene) {
      const b = scene.ball;
      const x = this.vx(b.x), y = this.vy(b.y);
      const p = this.proj(x, y, b.z + BR);
      if (!p) return;
      const ctx = this.ctx;
      const r = Math.max(2.4 * this.dpr, BR * 1.7 * p.s);
      const g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9ece6'); g.addColorStop(1, '#a8aea4');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      if (r > 3) {
        ctx.save();
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = '#222';
        const roll = b.roll || 0;
        for (let i = 0; i < 4; i++) {
          const a = roll * 0.5 + (i * Math.PI) / 2;
          const ox = Math.cos(a) * r * 0.62, oy = Math.sin(a * 0.7 + i) * r * 0.45;
          pentagon(ctx, p.x + ox, p.y + oy, r * 0.28, a);
        }
        pentagon(ctx, p.x + Math.cos(roll * 0.5 + 0.8) * r * 0.1, p.y + Math.sin(roll * 0.35) * r * 0.1, r * 0.3, roll);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(0.6, r * 0.08);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
      this.screen.set('ball', { x: p.x / this.dpr, y: p.y / this.dpr });
    }

    drawTrail(scene) {
      const b = scene.ball;
      const sp = hyp(b.vx, b.vy, b.vz || 0);
      const p = this.proj(this.vx(b.x), this.vy(b.y), b.z + BR);
      if (p && sp > 15 && !scene.ballOwned) this.trail.push({ x: p.x, y: p.y, r: Math.max(2, BR * 1.6 * p.s) });
      else if (this.trail.length) this.trail.shift();
      if (this.trail.length > 9) this.trail.shift();
      const ctx = this.ctx;
      for (let i = 0; i < this.trail.length; i++) {
        const t = this.trail[i];
        ctx.fillStyle = `rgba(255,255,255,${(i / this.trail.length) * 0.22})`;
        ctx.beginPath(); ctx.arc(t.x, t.y, t.r * (0.5 + (i / this.trail.length) * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }

    // ------------------------------------------------------------ helhet
    draw(scene, dt) {
      this.time += dt;
      this.flip = !!scene.flip;
      this.updateCamera(scene, dt);
      const ctx = this.ctx;
      this.screen.clear();
      this.drawBackground();
      this.drawPitch();
      // skuggor
      for (const p of scene.all) {
        const x = this.vx(p.x), y = this.vy(p.y);
        const lying = p.state === 'slide' || p.state === 'down';
        this.drawShadow(x + (lying ? 0.2 : 0), y, 1, lying ? 0.95 : 0.42, lying ? 0.32 : 0.2, 0.32);
      }
      const b = scene.ball;
      this.drawShadow(this.vx(b.x) - 0.25, this.vy(b.y) - 0.35 + 0.0, 1, 0.13 + b.z * 0.03, 0.09 + b.z * 0.02, clamp(0.4 - b.z * 0.04, 0.08, 0.4));
      // markering under styrda spelare (bara i TV-vinkeln)
      const markers = this.camMode === 'side' ? scene.markers || [] : [];
      for (const m of markers) {
        const p = m.p; if (!p) continue;
        const f = this.proj(this.vx(p.x), this.vy(p.y), 0);
        if (!f) continue;
        ctx.strokeStyle = m.color; ctx.lineWidth = Math.max(1.5, f.s * 0.09);
        ctx.beginPath(); ctx.ellipse(f.x, f.y, f.s * 0.62, f.s * 0.62 * Math.max(0.3, Math.abs(this.c.fz)), 0, 0, Math.PI * 2); ctx.stroke();
      }
      // djupsortering
      const items = this.goalItems(scene);
      for (const p of scene.all) {
        const c = this.toCam(this.vx(p.x), this.vy(p.y), 0.9);
        items.push({ d: c[2], draw: () => this.drawPlayer(scene, p) });
      }
      const bc = this.toCam(this.vx(b.x), this.vy(b.y), b.z);
      items.push({ d: bc[2] - 0.05, draw: () => { this.drawTrail(scene); this.drawBall(scene); } });
      items.sort((a, c) => c.d - a.d);
      for (const it of items) it.draw();
      // pil över styrd spelare
      for (const m of markers) {
        const p = m.p; if (!p) continue;
        const h = this.proj(this.vx(p.x), this.vy(p.y), 2.25);
        if (!h) continue;
        const sz = clamp(h.s * 0.28, 5 * this.dpr, 13 * this.dpr);
        ctx.fillStyle = m.color;
        ctx.beginPath(); ctx.moveTo(h.x - sz * 0.6, h.y - sz); ctx.lineTo(h.x + sz * 0.6, h.y - sz); ctx.lineTo(h.x, h.y); ctx.closePath(); ctx.fill();
        if (m.label) {
          ctx.font = `700 ${Math.round(Math.max(11 * this.dpr, sz * 0.95))}px "Saira Condensed", "Arial Narrow", sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.lineWidth = 3 * this.dpr; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.strokeText(m.label, h.x, h.y - sz * 1.15);
          ctx.fillStyle = '#fff';
          ctx.fillText(m.label, h.x, h.y - sz * 1.15);
        }
      }
    }

    // ------------------------------------------------------------ hjälp för inmatning
    // Skärmpunkt (CSS-pixlar) → punkt på målets plan x = planeX (världskoordinater)
    unprojectPlaneX(sx, sy, planeX) {
      const c = this.c;
      const xs = (sx * this.dpr - c.cx) / c.F, ys = -(sy * this.dpr - c.cy) / c.F;
      const dx = c.fx + c.rx * xs + c.ux * ys, dy = c.fy + c.ry * xs + c.uy * ys, dz = c.fz + c.uz * ys;
      const vxp = this.vx(planeX);
      if (Math.abs(dx) < 1e-6) return null;
      const t = (vxp - c.px) / dx;
      if (t <= 0) return null;
      const y = c.py + dy * t, z = c.pz + dz * t;
      return { y: this.vy(y), z };
    }
    worldToScreen(x, y, z) {
      const p = this.proj(this.vx(x), this.vy(y), z || 0);
      return p ? { x: p.x / this.dpr, y: p.y / this.dpr, s: p.s / this.dpr } : null;
    }
    // Världens y-riktning som pekar åt höger på skärmen (+1/-1), eller 0 om kameran står på sidan
    worldYRight() {
      const ry = (this.flip ? -1 : 1) * this.c.ry;
      return Math.abs(ry) > 0.5 ? Math.sign(ry) : 0;
    }
    camVectors() {
      const s = this.flip ? -1 : 1;
      return { rx: s * this.c.rx, ry: s * this.c.ry, fx: s * this.c.fx, fy: s * this.c.fy };
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  function pentagon(ctx, x, y, r, a) {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const t = a + (i * Math.PI * 2) / 5;
      if (i === 0) ctx.moveTo(x + Math.cos(t) * r, y + Math.sin(t) * r); else ctx.lineTo(x + Math.cos(t) * r, y + Math.sin(t) * r);
    }
    ctx.closePath(); ctx.fill();
  }
  function shade(hex, amt) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.round(clamp(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt, 0, 255));
    r = f(r); g = f(g); b = f(b);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  FB.Renderer = Renderer;
  FB.shade = shade;
})(window);
