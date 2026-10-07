/* Super Smash Ballers — menus: title, character select, stage select, results (S.ui).
   Every scene is { update() (60/s), render(ctx, W, H) } and is driven by mouse AND keyboard/gamepads.
   Layout is done in a virtual space at least 1280×720 (scaled to fit), so it reads the same at any size.
   Keyboard/gamepad users move focus cursors with their stick (spatial navigation) and press attack to choose. */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp } = S;
  const sfx = (n) => { try { S.audio && S.audio[n] && S.audio[n](); } catch (e) { /* ignore */ } };

  // ------------------------------------------------------------ palette (white-paper wiki look)
  const C = {
    paper: "#fffdf4", line: "rgba(80,130,220,.16)", margin: "rgba(230,60,60,.35)",
    ink: "#141414", sub: "#555", faint: "#8a8a8a", card: "#ffffff", shadow: "#141414",
    yellow: "#ffd23f", link: "#1a5fd0", off: "#cfcfcf",
  };
  const DEVICE_OPTIONS = [["kbA", "pad0"], ["kbB", "pad1"], ["pad0"], ["pad1"], ["pad2"], ["pad3"], ["kbA"], ["kbB"]];
  const devLabel = (i) => DEVICE_OPTIONS[i].map((d) => (S.DEVICE_LABELS && S.DEVICE_LABELS[d]) || d).join(" + ");
  const LEVEL_NAMES = ["", "EASY", "NORMAL", "HARD"];
  const canvasEl = () => document.getElementById("game");

  // ------------------------------------------------------------ persistent setup
  function defaultSetup() {
    const ids = S.FIGHTER_ORDER;
    return {
      stocks: 3, stage: null,
      ports: [
        { type: "human", dev: 0, level: 2, fighter: null },
        { type: "cpu", dev: 1, level: 2, fighter: ids[1 % Math.max(1, ids.length)] || null },
        { type: "off", dev: 4, level: 2, fighter: null },
        { type: "off", dev: 5, level: 2, fighter: null },
      ],
    };
  }
  function loadSetup() {
    let s = defaultSetup();
    try {
      const raw = localStorage.getItem("smash.setup");
      if (raw) {
        const o = JSON.parse(raw);
        if (o && Array.isArray(o.ports) && o.ports.length === 4) {
          s.stocks = clamp(+o.stocks || 3, 1, 5); s.stage = o.stage || null;
          s.ports = o.ports.map((p, i) => ({
            type: ["human", "cpu", "off"].includes(p.type) ? p.type : s.ports[i].type,
            dev: clamp(p.dev | 0, 0, DEVICE_OPTIONS.length - 1), level: clamp(p.level | 0 || 2, 1, 3),
            fighter: p.fighter === "random" || S.FIGHTERS[p.fighter] ? p.fighter : null,
          }));
        }
      }
    } catch (e) { /* storage blocked */ }
    return s;
  }
  function saveSetup() { try { localStorage.setItem("smash.setup", JSON.stringify(S.ui.setup)); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------ input: device pads → menu events
  const DEVS = ["kbA", "kbB", "pad0", "pad1", "pad2", "pad3"];
  const devState = {};
  function pollDevices() {
    const out = [];
    for (const d of DEVS) {
      let st = devState[d];
      if (!st) st = devState[d] = { pad: S.newPad(), prev: { a: true, b: true, j: true, s: true, start: true }, nx: 0, ny: 0, hold: 0 };
      S.input.readPad(st.pad, [d]);
      const p = st.pad;
      const nx = p.x > 0.5 ? 1 : p.x < -0.5 ? -1 : 0, ny = p.y > 0.5 ? 1 : p.y < -0.5 ? -1 : 0;
      if (nx || ny) {
        let fire = false;
        if (nx !== st.nx || ny !== st.ny) { st.hold = 0; fire = true; }
        else if (++st.hold >= 20 && (st.hold - 20) % 6 === 0) fire = true;
        if (fire) out.push(Math.abs(p.x) >= Math.abs(p.y) && nx ? { dev: d, type: "dir", dx: nx, dy: 0 } : { dev: d, type: "dir", dx: 0, dy: ny });
      } else st.hold = 0;
      st.nx = nx; st.ny = ny;
      for (const b of ["a", "b", "j", "s", "start"]) { if (p[b] && !st.prev[b]) out.push({ dev: d, type: b }); st.prev[b] = !!p[b]; }
    }
    return out;
  }
  function primeDevices() { pollDevices(); for (const d of DEVS) if (devState[d]) Object.assign(devState[d].prev, { a: true, b: true, j: true, s: true, start: true }); }

  // Base scene: virtual coordinates, mouse/click bookkeeping, hit areas.
  function baseScene(o) {
    const sc = Object.assign({
      t: 0, k: 1, VW: 1280, VH: 720, hits: [], hover: null, pendingClick: false,
      mouse() { return { x: S.input.mouse.x / this.k, y: S.input.mouse.y / this.k }; },
      hitAt(p) { for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]; if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) return h; } return null; },
      // returns { presses, click, events, hover }
      poll() {
        this.t++;
        const presses = S.input.takePresses();
        const click = S.input.takeClick() || this.pendingClick; this.pendingClick = false;
        const events = pollDevices();
        const m = this.mouse();
        const mv = S.input.mouse.x !== this._mx || S.input.mouse.y !== this._my;
        this._mx = S.input.mouse.x; this._my = S.input.mouse.y;
        const h = this.hitAt(m);
        this.hover = h ? h.id : null;
        if (mv || click) this.mouseActive = true;
        const el = canvasEl(); if (el) el.style.cursor = h && h.act !== false ? "pointer" : "default";
        return { presses, click: click ? h || { id: null } : null, events, mouseMoved: mv };
      },
      begin(c, W, H) {
        // a click that lands between two updates would otherwise be cleared by the engine before update() sees it
        if (S.input.mouse.clicked) this.pendingClick = true;
        this.k = Math.min(W / 1280, H / 720); this.VW = W / this.k; this.VH = H / this.k;
        this.hits = [];
        c.save(); c.scale(this.k, this.k);
      },
      end(c) { c.restore(); },
      hit(id, x, y, w, h, extra) { const r = Object.assign({ id, x, y, w, h }, extra || {}); this.hits.push(r); return r; },
    }, o);
    return sc;
  }

  // Spatial navigation: from rect `cur`, find the best item in direction (dx, dy).
  function navigate(items, curId, dx, dy) {
    const cur = items.find((i) => i.id === curId);
    if (!cur) return items.length ? items[0].id : null;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null, bs = Infinity;
    for (const it of items) {
      if (it === cur || it.nav === false) continue;
      const ix = it.x + it.w / 2, iy = it.y + it.h / 2;
      const along = (ix - cx) * dx + (iy - cy) * dy;
      if (along <= 4) continue;
      const perp = Math.abs((ix - cx) * dy) + Math.abs((iy - cy) * dx);
      const s = along + perp * 2.2;
      if (s < bs) { bs = s; best = it; }
    }
    if (!best) {
      // wrap around in that direction
      let far = null, fs = -Infinity;
      for (const it of items) {
        if (it === cur || it.nav === false) continue;
        const ix = it.x + it.w / 2, iy = it.y + it.h / 2;
        const perp = Math.abs((ix - cx) * dy) + Math.abs((iy - cy) * dx);
        if (perp > 60) continue;
        const back = -((ix - cx) * dx + (iy - cy) * dy);
        if (back > fs) { fs = back; far = it; }
      }
      return far ? far.id : curId;
    }
    return best.id;
  }

  // ------------------------------------------------------------ drawing helpers
  function paperBg(c, VW, VH, t) {
    c.fillStyle = C.paper; c.fillRect(0, 0, VW, VH);
    c.strokeStyle = C.line; c.lineWidth = 1.5;
    const off = (t * 0.15) % 34;
    for (let y = 34 - off; y < VH; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(VW, y); c.stroke(); }
    c.strokeStyle = C.margin; c.lineWidth = 2;
    c.beginPath(); c.moveTo(64, 0); c.lineTo(64, VH); c.stroke();
  }
  // neo-brutalist panel: solid offset shadow + thick ink border
  function panel(c, x, y, w, h, fill, opts = {}) {
    const r = opts.r != null ? opts.r : 12, sh = opts.shadow != null ? opts.shadow : 5, lw = opts.lw || 3;
    if (sh) { c.fillStyle = opts.shadowColor || C.shadow; S.roundRect(c, x + sh, y + sh, w, h, r); c.fill(); }
    c.fillStyle = fill; S.roundRect(c, x, y, w, h, r); c.fill();
    if (lw) { c.lineWidth = lw; c.strokeStyle = opts.stroke || C.ink; S.roundRect(c, x, y, w, h, r); c.stroke(); }
  }
  function button(c, sc, id, x, y, w, h, label, opts = {}) {
    const hov = sc.hover === id || opts.focused;
    const lift = hov && !opts.disabled ? -2 : 0;
    panel(c, x, y + lift, w, h, opts.disabled ? "#eee" : hov ? opts.hoverFill || C.yellow : opts.fill || C.card, { r: opts.r || 10, shadow: opts.disabled ? 2 : hov ? 6 : 4 });
    S.text(c, label, x + w / 2, y + lift + h / 2 + (opts.size || 18) * 0.36, opts.size || 18, opts.disabled ? "#999" : opts.color || C.ink, "center", opts.font || S.FONT_BIG, opts.weight || "900");
    sc.hit(id, x, y, w, h, opts.hit);
  }
  function fitText(c, str, maxW, size, font, weight = "bold") {
    let s = size;
    c.font = `${weight} ${s}px ${font}`;
    while (s > 9 && c.measureText(str).width > maxW) { s -= 1; c.font = `${weight} ${s}px ${font}`; }
    return s;
  }
  function wrap(c, str, maxW, maxLines, size, font, weight = "normal") {
    c.font = `${weight} ${size}px ${font}`;
    const words = String(str || "").split(/\s+/).filter(Boolean);
    const lines = []; let cur = "";
    for (let i = 0; i < words.length; i++) {
      const tryS = cur ? cur + " " + words[i] : words[i];
      if (c.measureText(tryS).width <= maxW || !cur) cur = tryS;
      else {
        lines.push(cur); cur = words[i];
        if (lines.length === maxLines) { cur = null; break; }
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines || (cur === null)) {
      lines.length = maxLines;
      let last = lines[maxLines - 1];
      while (last.length > 1 && c.measureText(last + "…").width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/[\s,.;:]+$/, "") + "…";
    }
    return lines;
  }
  function drawWrapped(c, lines, x, y, size, color, align, font, lh) {
    lines.forEach((ln, i) => S.text(c, ln, x, y + i * (lh || size * 1.25), size, color, align, font, "normal"));
  }
  function portToken(c, x, y, port, label, scale = 1) {
    const col = S.PORT_COLORS[port];
    c.save(); c.translate(x, y); c.scale(scale, scale);
    c.fillStyle = C.ink; c.beginPath(); c.arc(2, 2, 17, 0, Math.PI * 2); c.fill();
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, 17, 0, Math.PI * 2); c.fill();
    c.lineWidth = 3; c.strokeStyle = C.ink; c.stroke();
    S.text(c, label, 0, 6, 15, "#fff", "center", S.FONT_BIG, "900", C.ink);
    c.restore();
  }
  function openWiki(slug) {
    if (!slug) return;
    try { window.open("../" + slug + ".html", "_blank", "noopener"); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ puppets: real fighter drawings on fake fighters
  const fakeG = {
    frame: 0, rng: S.makeRng(3), fighters: [], projectiles: [], particles: [], platforms: [], ledges: [], state: {},
    stage: { blast: { left: -1e5, right: 1e5, top: -1e5, bottom: 1e5 } }, stageDef: {}, tapJump: false,
    spawn(o) { return Object.assign({ dead: true }, o); },
  };
  const puppets = {};
  function puppet(id, port = 0) {
    const key = id + ":" + port;
    if (puppets[key]) return puppets[key];
    const def = S.FIGHTERS[id];
    if (!def) return null;
    let f;
    try { f = new S.Fighter(def, port, { stocks: 1 }); } catch (e) { return null; }
    f.grounded = true; f.state = "idle";
    try { if (def.init) def.init(f, fakeG); } catch (e) { /* ignore */ }
    f.grounded = true; f.state = "idle";
    puppets[key] = f;
    return f;
  }
  // state: "idle" | "run" | "air" | "attack:<move>" ; mf = frame within the move
  function drawPuppet(c, f, x, y, scale, o = {}) {
    if (!f) return;
    fakeG.frame = o.frame != null ? o.frame : 0;
    f.x = 0; f.y = 0; f.facing = 1; f.hitlag = 0; f.invuln = 0; f.charging = 0; f.out = false; f.respawnPlat = false;
    f.move = null; f.moveName = null; f.mf = 0; f.vx = 0; f.vy = 0; f.grounded = true; f.airJumped = 0;
    const st = o.state || "idle";
    if (st.startsWith("attack:")) {
      const name = st.slice(7), m = f.moves[name];
      if (m) { f.state = "attack"; f.move = m; f.moveName = name; f.mf = o.mf || 0; } else f.state = "idle";
    } else {
      f.state = st; f.stateFrame = fakeG.frame;
      if (st === "run" || st === "dash") f.vx = 7;
      if (st === "air") { f.grounded = false; f.vy = o.vy || 0; }
      if (st === "walk") f.vx = 3;
    }
    c.save(); c.translate(x, y); c.scale(scale * (o.facing || 1), scale);
    try { S.drawFighterBody(c, f, fakeG, "ui:" + f.def.id); }
    catch (e) { try { S.drawDummy(c, f, fakeG); } catch (e2) { /* ignore */ } }
    c.restore();
  }
  // Loops a few of a fighter's moves for "showing off" (hovered cards, winner screen).
  const SHOW = ["jab", "ftilt", "fsmash", "nspecial", "utilt", "usmash", "dspecial", "sspecial"];
  function showOff(f, t) {
    const list = SHOW.filter((n) => f.moves[n]);
    let tt = t;
    for (let loop = 0; loop < 2; loop++) {
      for (const n of list) {
        const len = Math.min(70, (f.moves[n].frames || 30)) + 18;
        if (tt < len) return tt < len - 18 ? { state: "attack:" + n, mf: tt } : { state: "idle" };
        tt -= len;
      }
      const total = list.reduce((a, n) => a + Math.min(70, (f.moves[n].frames || 30)) + 18, 0) || 1;
      tt = tt % total;
    }
    return { state: "idle" };
  }

  // ------------------------------------------------------------ TITLE
  function title() {
    S.ui.setup = S.ui.setup || loadSetup();
    const nP = Math.max(1, S.FIGHTER_ORDER.length);
    const parade = S.FIGHTER_ORDER.map((id, i) => ({ id, x: -100 + (i / nP) * 1500, speed: 2.4 + (i % 3) * 0.45, jumpAt: 80 + i * 37, port: i % 4 }));
    const sc = baseScene({
      enter() { primeDevices(); try { S.audio && S.audio.music && S.audio.music("menu"); } catch (e) { /* ignore */ } },
      update() {
        const inp = this.poll();
        const go = inp.presses.some((k) => k !== "KeyM" && k !== "Backquote") || inp.events.some((e) => e.type !== "dir") || (inp.click && inp.click.id !== "mute");
        if (inp.click && inp.click.id === "mute") { try { S.audio && S.audio.toggleMute && S.audio.toggleMute(); } catch (e) { /* ignore */ } return; }
        if (go && this.t > 10) { sfx("select"); S.ui.charSelect(); return; }
        for (const p of parade) {
          p.x += p.speed;
          if (p.x > this.VW + 120) { p.x = -120 - ((p.speed * 97) % 200); }
        }
      },
      render(c, W, H) {
        this.begin(c, W, H);
        const { VW, VH, t } = this;
        paperBg(c, VW, VH, t);
        // sun-burst behind the logo
        c.save(); c.translate(VW / 2, VH * 0.27); c.rotate(t * 0.002);
        for (let i = 0; i < 18; i++) {
          c.rotate(Math.PI / 9); c.fillStyle = i % 2 ? "rgba(255,210,63,.28)" : "rgba(255,210,63,.12)";
          c.beginPath(); c.moveTo(0, 0); c.lineTo(900, -80); c.lineTo(900, 80); c.closePath(); c.fill();
        }
        c.restore();
        // layout (top → bottom): logo, tagline, prompt, controls panel, parade on the floor
        const big = Math.min(112, VW / 9.6);
        const panelY = VH - 64 - 92 - 136;               // controls panel sits above the parade
        const logoY = Math.max(70, (panelY - 30 - (big * 2.2 + 120)) / 2 + 40);
        const wob = Math.sin(t * 0.04) * 0.012;
        c.save(); c.translate(VW / 2, logoY); c.rotate(-0.035 + wob);
        S.text(c, "THE LEGEND OF CHRIS:", 0, 0, 36, C.ink, "center", S.FONT_BIG, "900");
        S.text(c, "SUPER SMASH", 6, big * 0.95 + 6, big, C.ink, "center", S.FONT_BIG, "900");
        S.text(c, "SUPER SMASH", 0, big * 0.95, big, "#e8333a", "center", S.FONT_BIG, "900", C.ink);
        S.text(c, "BALLERS", 6, big * 2.02 + 6, big * 1.08, C.ink, "center", S.FONT_BIG, "900");
        S.text(c, "BALLERS", 0, big * 2.02, big * 1.08, C.yellow, "center", S.FONT_BIG, "900", C.ink);
        c.restore();
        S.text(c, "a platform fighter where everyone is a baller (allegedly)", VW / 2, logoY + big * 2.02 + 38, 19, C.sub, "center", S.FONT_COMIC, "bold");
        // press start
        const blink = (Math.sin(t * 0.09) + 1) / 2;
        c.globalAlpha = 0.45 + blink * 0.55;
        S.text(c, "PRESS ANY KEY / CLICK TO BALL", VW / 2, panelY - 18, 28, C.ink, "center", S.FONT_BIG, "900");
        c.globalAlpha = 1;
        this.panelY = panelY;
        // ground + parade of fighters
        const gy = VH - 40;
        c.strokeStyle = C.ink; c.lineWidth = 4; c.beginPath(); c.moveTo(0, gy); c.lineTo(VW, gy); c.stroke();
        for (const p of parade) {
          const f = puppet(p.id, p.port); if (!f) continue;
          const ph = (t + p.jumpAt) % 260;
          let y = gy, state = "run", vy = 0;
          if (ph < 40) { const u = ph / 40; y = gy - Math.sin(u * Math.PI) * 60; state = "air"; vy = u < 0.5 ? -5 : 5; }
          else if (ph > 200 && ph < 236) state = "attack:" + (f.moves.dash ? "dash" : "jab");
          drawPuppet(c, f, p.x, y, 0.95, { state, mf: ph - 200, frame: t + p.port * 13, vy });
        }
        this.drawControls(c, VW, VH);
        // mute toggle
        const muted = S.audio && S.audio.muted;
        button(c, this, "mute", VW - 150, 14, 132, 36, muted ? "🔇 SOUND OFF" : "🔊 SOUND ON", { size: 13, font: S.FONT, weight: "bold" });
        S.text(c, "fan-made for the Legend Of Chris wiki · no balls were harmed", VW / 2, VH - 12, 13, C.faint, "center", S.FONT_COMIC, "bold");
        this.end(c);
      },
      drawControls(c, VW, VH) {
        const w = Math.min(1180, VW - 60), h = 132, x = (VW - w) / 2, y = this.panelY;
        panel(c, x, y, w, h, "rgba(255,255,255,.94)", { shadow: 5 });
        const cols = [
          ["KEYBOARD P1", ["Move: W A S D", "Attack: F   Special: G", "Jump: H / Space", "Shield: T / L-Shift"]],
          ["KEYBOARD P2", ["Move: Arrow keys", "Attack: ,   Special: .", "Jump: /  (Numpad 1/2/3/0)", "Shield: R-Shift"]],
          ["GAMEPAD", ["Stick / D-pad to move", "A attack · B special", "X / Y jump", "Bumpers/Triggers shield"]],
          ["HOW TO BALL", ["Dash: double-tap a direction", "Smash: tap direction + attack", "Tilt: hold direction, then attack", "Enter/Esc pause · M mute"]],
        ];
        const cw = w / 4;
        cols.forEach(([head, lines], i) => {
          const cx = x + 18 + i * cw;
          S.text(c, head, cx, y + 28, 15, i === 3 ? "#e8333a" : C.ink, "left", S.FONT_BIG, "900");
          lines.forEach((ln, j) => {
            const s = fitText(c, ln, cw - 26, 14, S.FONT_COMIC);
            S.text(c, ln, cx, y + 52 + j * 21, s, "#333", "left", S.FONT_COMIC, "bold");
          });
          if (i) { c.strokeStyle = "rgba(0,0,0,.15)"; c.lineWidth = 2; c.beginPath(); c.moveTo(x + i * cw, y + 14); c.lineTo(x + i * cw, y + h - 14); c.stroke(); }
        });
      },
    });
    S.setScene(sc);
  }

  // ------------------------------------------------------------ CHARACTER SELECT
  function charSelect() {
    const setup = (S.ui.setup = S.ui.setup || loadSetup());
    // drop fighters that no longer exist
    for (const p of setup.ports) if (p.fighter && p.fighter !== "random" && !S.FIGHTERS[p.fighter]) p.fighter = null;
    const cards = S.FIGHTER_ORDER.concat(["random"]);
    const cursors = [0, 1, 2, 3].map((i) => ({ focus: "card:" + (setup.ports[i].fighter || cards[Math.min(i, cards.length - 1)]), assign: i }));
    const guest = { focus: "card:" + cards[0], assign: 0 };
    let active = 0;   // port that mouse / guest picks go to
    let items = [];   // focusable rects (from last layout)

    const ready = () => setup.ports.filter((p) => p.type !== "off" && p.fighter).length >= 2 && setup.ports.every((p) => p.type === "off" || p.fighter);
    const portsOn = () => setup.ports.filter((p) => p.type !== "off").length;
    function ownerPorts(dev) { const r = []; setup.ports.forEach((p, i) => { if (p.type === "human" && DEVICE_OPTIONS[p.dev].includes(dev)) r.push(i); }); return r; }
    function nextActive(from) {
      for (let k = 1; k <= 4; k++) { const i = (from + k) % 4; if (setup.ports[i].type !== "off" && !setup.ports[i].fighter) return i; }
      return from;
    }
    function pick(port, id) {
      const P = setup.ports[port];
      if (P.type === "off") P.type = port === 0 ? "human" : "cpu";
      P.fighter = id; sfx("select"); saveSetup();
    }
    function cycleType(i) {
      const P = setup.ports[i];
      P.type = P.type === "off" ? "human" : P.type === "human" ? "cpu" : "off";
      if (P.type === "cpu" && !P.fighter) P.fighter = "random";
      sfx("menu"); saveSetup();
    }
    function goStage() {
      if (!ready()) { sfx("back"); sc.flash = 40; return; }
      sfx("select"); saveSetup(); stageSelect();
    }
    // activate a focus item (by keyboard cursor `cur` for port `port`, or by mouse when cur is null)
    function activate(id, port, cur, mx) {
      if (!id) return;
      const [kind, arg] = id.split(":");
      if (kind === "card") {
        const target = cur ? cur.assign : active;
        pick(target, arg);
        if (cur) cur.assign = port;
        else active = nextActive(target);
      } else if (kind === "wiki") { const d = S.FIGHTERS[arg]; if (d) openWiki(d.slug || d.id); }
      else if (kind === "type") cycleType(+arg);
      else if (kind === "opt") {
        const P = setup.ports[+arg];
        if (P.type === "cpu") P.level = P.level % 3 + 1;
        else if (P.type === "human") P.dev = (P.dev + 1) % DEVICE_OPTIONS.length;
        else cycleType(+arg);
        sfx("menu"); saveSetup();
      } else if (kind === "lvl") { const [pi, lv] = arg.split("."); setup.ports[+pi].level = +lv; sfx("menu"); saveSetup(); }
      else if (kind === "slot") {
        // choose who the next pick goes to (lets keyboard/pad players pick for CPUs)
        const i = +arg;
        if (setup.ports[i].type === "off") { cycleType(i); }
        if (cur) cur.assign = i; else active = i;
        sfx("menu");
      } else if (kind === "stocks") {
        const d = mx != null ? (mx < sc.stocksMid ? -1 : 1) : 1;
        setup.stocks = d < 0 ? (setup.stocks + 3) % 5 + 1 : setup.stocks % 5 + 1;
        sfx("menu"); saveSetup();
      } else if (kind === "back") { sfx("back"); title(); }
      else if (kind === "ready") goStage();
    }

    const sc = baseScene({
      flash: 0,
      enter() { primeDevices(); try { S.audio && S.audio.music && S.audio.music("menu"); } catch (e) { /* ignore */ } },
      update() {
        const inp = this.poll();
        if (this.flash > 0) this.flash--;
        for (const k of inp.presses) {
          if (k === "Escape") { sfx("back"); title(); return; }
          if (k === "Enter" || k === "NumpadEnter") { goStage(); return; }
        }
        if (inp.click && inp.click.id) {
          activate(inp.click.id, null, null, this.mouse().x);
          if (S.scene !== this) return;
        }
        for (const ev of inp.events) {
          if (ev.type === "start") { goStage(); return; }
          const owners = ownerPorts(ev.dev);
          const list = owners.length ? owners.map((i) => ({ cur: cursors[i], port: i })) : [{ cur: guest, port: active }];
          for (const { cur, port } of list) {
            if (ev.type === "dir") {
              if (cur.focus === "stocks" && ev.dx) { setup.stocks = clamp(setup.stocks + ev.dx, 1, 5); sfx("menu"); saveSetup(); continue; }
              const n = navigate(items, cur.focus, ev.dx, ev.dy);
              if (n !== cur.focus) { cur.focus = n; sfx("menu"); }
              this.mouseActive = false;
            } else if (ev.type === "a") {
              activate(cur.focus, port, cur);
              if (S.scene !== this) return;
            } else if (ev.type === "b") {
              const P = setup.ports[cur.assign];
              if (cur.assign !== port) { cur.assign = port; sfx("back"); }
              else if (P.fighter) { P.fighter = null; sfx("back"); saveSetup(); }
            }
          }
        }
      },
      render(c, W, H) {
        this.begin(c, W, H);
        const { VW, VH, t } = this;
        paperBg(c, VW, VH, t);
        items = [];
        const pad = 24;
        // ---- top bar
        const bx = Math.max(168, 165 / this.k);   // clear of the page's "Back to the wiki" link
        button(c, this, "back", bx, 14, 104, 40, "◀ BACK", { size: 16 });
        items.push({ id: "back", x: bx, y: 14, w: 104, h: 40 });
        S.text(c, "CHOOSE YOUR BALLERS", bx + 122, 46, 30, C.ink, "left", S.FONT_BIG, "900");
        c.font = `900 30px ${S.FONT_BIG}`;
        const tw = c.measureText("CHOOSE YOUR BALLERS").width;
        if (VW > 1240) S.text(c, "click a card, or stick + attack", bx + 136 + tw, 44, 15, C.sub, "left", S.FONT_COMIC, "bold");
        // stocks
        const sw = 220, sx = VW - pad - sw;
        const sHov = this.hover === "stocks";
        panel(c, sx, 12, sw, 44, sHov ? "#fff6cf" : C.card, { r: 10, shadow: 4 });
        S.text(c, "STOCKS", sx + 16, 41, 17, C.ink, "left", S.FONT_BIG, "900");
        S.text(c, "◀", sx + 112, 42, 20, C.ink, "center", S.FONT, "bold");
        S.text(c, String(setup.stocks), sx + 150, 44, 28, "#e8333a", "center", S.FONT_BIG, "900");
        S.text(c, "▶", sx + 188, 42, 20, C.ink, "center", S.FONT, "bold");
        this.stocksMid = sx + 150;
        this.hit("stocks", sx, 12, sw, 44);
        items.push({ id: "stocks", x: sx, y: 12, w: sw, h: 44 });

        // ---- layout: grid / ports / ready bar
        const readyH = 52, portsH = clamp(VH * 0.3, 196, 250);
        const portsY = VH - readyH - 22 - portsH;
        const gridY = 74, gridH = portsY - gridY - 16;
        const gw = VW - pad * 2;
        const n = cards.length, gap = 14;
        let best = null;
        for (let cols = 1; cols <= n; cols++) {
          const rows = Math.ceil(n / cols);
          let w = (gw - gap * (cols - 1)) / cols, h = (gridH - gap * (rows - 1)) / rows;
          w = Math.min(w, h * 1.25); h = Math.min(h, w * 1.3);
          const score = Math.min(w, h * 1.05);
          if (!best || score > best.score) best = { cols, rows, w, h, score };
        }
        const { cols, w: cwid, h: chgt } = best;
        const rows = Math.ceil(n / cols);
        const totalW = cols * cwid + (cols - 1) * gap;
        const gx0 = (VW - totalW) / 2, gy0 = gridY + (gridH - (rows * chgt + (rows - 1) * gap)) / 2;
        const focusOf = {};
        const curList = [];
        setup.ports.forEach((p, i) => { if (p.type === "human") curList.push({ cur: cursors[i], port: i, label: "P" + (i + 1) }); });
        if (!curList.length || !this.mouseActive) { /* guest cursor shown only when used */ }
        const guestUsed = !setup.ports.some((p) => p.type === "human");
        if (guestUsed) curList.push({ cur: guest, port: active, label: "P" + (active + 1) });
        for (const cl of curList) (focusOf[cl.cur.focus] = focusOf[cl.cur.focus] || []).push(cl);

        cards.forEach((id, idx) => {
          const col = idx % cols, row = Math.floor(idx / cols);
          // center the last row
          const inRow = row === rows - 1 ? n - row * cols : cols;
          const rowOff = (cols - inRow) * (cwid + gap) / 2;
          const x = gx0 + rowOff + col * (cwid + gap), y = gy0 + row * (chgt + gap);
          this.drawCard(c, id, x, y, cwid, chgt, focusOf["card:" + id] || []);
          items.push({ id: "card:" + id, x, y, w: cwid, h: chgt });
        });

        // ---- port panels
        const pw = (VW - pad * 2 - 3 * 16) / 4;
        for (let i = 0; i < 4; i++) this.drawPort(c, i, pad + i * (pw + 16), portsY, pw, portsH, focusOf);

        // ---- ready bar
        const ry = VH - readyH - 14, ok = ready();
        const rHov = this.hover === "ready";
        if (ok) {
          const pulse = (Math.sin(t * 0.12) + 1) / 2;
          panel(c, pad, ry, VW - pad * 2, readyH, rHov ? "#ffe066" : C.yellow, { shadow: 5 + pulse * 2 });
          c.save(); S.roundRect(c, pad, ry, VW - pad * 2, readyH, 12); c.clip();
          c.fillStyle = "rgba(232,51,58,.9)";
          for (let x = -80 + (t * 2) % 80; x < VW; x += 80) { c.beginPath(); c.moveTo(x, ry + readyH); c.lineTo(x + 30, ry); c.lineTo(x + 50, ry); c.lineTo(x + 20, ry + readyH); c.fill(); }
          c.restore();
          c.lineWidth = 3; c.strokeStyle = C.ink; S.roundRect(c, pad, ry, VW - pad * 2, readyH, 12); c.stroke();
          S.text(c, "READY TO BALL!", VW / 2, ry + 36, 30, "#fff", "center", S.FONT_BIG, "900", C.ink);
          S.text(c, "Enter / Start / click", VW - pad - 18, ry + 33, 15, C.ink, "right", S.FONT_COMIC, "bold");
        } else {
          const shake = this.flash > 0 ? Math.sin(this.flash * 1.3) * 6 : 0;
          panel(c, pad + shake, ry, VW - pad * 2, readyH, "#f1efe6", { shadow: 3 });
          const need = portsOn() < 2 ? "Turn on at least 2 players (click a port's OFF / HUMAN / CPU button)" : "Every active player needs a fighter — pick one from the grid";
          S.text(c, need, VW / 2 + shake, ry + 33, 18, this.flash > 0 ? "#e8333a" : C.sub, "center", S.FONT_COMIC, "bold");
        }
        this.hit("ready", pad, ry, VW - pad * 2, readyH);
        items.push({ id: "ready", x: pad, y: ry, w: VW - pad * 2, h: readyH });
        // keyboard cursors' tokens on non-card items
        for (const id in focusOf) {
          if (id.startsWith("card:")) continue;
          const it = items.find((q) => q.id === id); if (!it) continue;
          focusOf[id].forEach((cl, k) => {
            c.lineWidth = 4; c.strokeStyle = S.PORT_COLORS[cl.port]; S.roundRect(c, it.x - 4 - k * 3, it.y - 4 - k * 3, it.w + 8 + k * 6, it.h + 8 + k * 6, 12); c.stroke();
            portToken(c, it.x + 6 + k * 30, it.y - 2, cl.cur.assign !== cl.port ? cl.cur.assign : cl.port, cl.label, 0.8);
          });
        }
        this.end(c);
      },
      drawCard(c, id, x, y, w, h, curs) {
        const t = this.t;
        const hov = this.hover === "card:" + id || this.hover === "wiki:" + id;
        const focused = curs.length > 0;
        const def = S.FIGHTERS[id];
        const pickedBy = setup.ports.map((p, i) => (p.type !== "off" && p.fighter === id ? i : -1)).filter((i) => i >= 0);
        const lift = hov || focused ? -3 : 0;
        y += lift;
        const accent = def ? def.color || "#888" : "#9b59b6";
        panel(c, x, y, w, h, C.card, { shadow: hov || focused ? 8 : 5, stroke: focused ? S.PORT_COLORS[curs[0].port] : C.ink, lw: focused ? 5 : 3 });
        // vertical budget: name + tagline lines + wiki link under the portrait
        const ns0 = Math.min(20, h * 0.11), tagSize = clamp(h * 0.068, 11, 14), ls = clamp(h * 0.065, 11, 13);
        let tagLines = 2, ph = h - 12 - (ns0 + 8 + tagLines * tagSize * 1.2 + ls + 12);
        if (ph < h * 0.5) { tagLines = 1; ph = h - 12 - (ns0 + 8 + tagSize * 1.2 + ls + 12); }
        c.save(); S.roundRect(c, x + 6, y + 6, w - 12, ph, 8); c.clip();
        const grd = c.createLinearGradient(0, y, 0, y + ph);
        grd.addColorStop(0, shadeHex(accent, 0.75)); grd.addColorStop(1, shadeHex(accent, 0.35));
        c.fillStyle = grd; c.fillRect(x, y, w, ph + 6);
        // halftone dots
        c.fillStyle = "rgba(255,255,255,.18)";
        for (let yy = y + 10; yy < y + ph; yy += 12) for (let xx = x + 10 + ((yy / 12) % 2) * 6; xx < x + w; xx += 12) { c.beginPath(); c.arc(xx, yy, 2, 0, Math.PI * 2); c.fill(); }
        if (def) {
          const f = puppet(id, 0);
          const sc2 = Math.min(ph / ((f ? f.h : 70) * 1.25), (w - 12) / 70);
          const anim = hov || focused ? showOff(f, (t + id.length * 7) % 100000) : { state: "idle" };
          drawPuppet(c, f, x + w / 2 - 6 * sc2, y + 6 + ph - 6, sc2, Object.assign({ frame: t + id.length * 11 }, anim));
        } else {
          // random: cycling silhouettes + ?
          const ids = S.FIGHTER_ORDER; const rid = ids[Math.floor(t / 20) % ids.length];
          const f = puppet(rid, 0);
          const sc2 = Math.min(ph / ((f ? f.h : 70) * 1.25), (w - 12) / 70);
          c.globalAlpha = 0.25; drawPuppet(c, f, x + w / 2, y + 6 + ph - 6, sc2, { frame: t }); c.globalAlpha = 1;
          S.text(c, "?", x + w / 2, y + ph * 0.72, ph * 0.62, "#fff", "center", S.FONT_BIG, "900", C.ink);
        }
        c.restore();
        c.lineWidth = 2; c.strokeStyle = C.ink; S.roundRect(c, x + 6, y + 6, w - 12, ph, 8); c.stroke();
        // text
        const name = def ? def.name : "RANDOM";
        const ns = fitText(c, name.toUpperCase(), w - 16, ns0, S.FONT_BIG, "900");
        S.text(c, name.toUpperCase(), x + w / 2, y + 6 + ph + 4 + ns0, ns, C.ink, "center", S.FONT_BIG, "900");
        const lines = wrap(c, def ? def.tagline || "" : "Let fate pick your baller.", w - 16, tagLines, tagSize, S.FONT_COMIC, "bold");
        lines.forEach((ln, i) => S.text(c, ln, x + w / 2, y + 6 + ph + 6 + ns0 + tagSize * 1.2 * (i + 1), tagSize, "#444", "center", S.FONT_COMIC, "bold"));
        this.hit("card:" + id, x, y, w, h);
        if (def) {
          const ly = y + h - 8;
          const lh = this.hover === "wiki:" + id;
          c.font = `bold ${ls}px ${S.FONT}`;
          const lw = c.measureText("Read on the wiki ↗").width;
          S.text(c, "Read on the wiki ↗", x + w / 2, ly, ls, lh ? "#e8333a" : C.link, "center", S.FONT, "bold");
          if (lh) { c.fillStyle = "#e8333a"; c.fillRect(x + w / 2 - lw / 2, ly + 2, lw, 1.5); }
          this.hit("wiki:" + id, x + w / 2 - lw / 2 - 6, ly - ls - 3, lw + 12, ls + 8);
        }
        // port tokens of players who picked it
        pickedBy.forEach((pi, k) => portToken(c, x + w - 18 - k * 30, y + 18, pi, (setup.ports[pi].type === "cpu" ? "C" : "P") + (pi + 1), 0.85));
        // keyboard cursor tokens
        curs.forEach((cl, k) => portToken(c, x + 18 + k * 26, y + ph - 4, cl.cur.assign, "P" + (cl.port + 1) + (cl.cur.assign !== cl.port ? "→" : ""), 0.9));
      },
      drawPort(c, i, x, y, w, h, focusOf) {
        const P = setup.ports[i], col = S.PORT_COLORS[i], t = this.t;
        const on = P.type !== "off";
        const isActive = i === active && (this.mouseActive || !setup.ports.some((p) => p.type === "human"));
        panel(c, x, y, w, h, on ? C.card : "#ecebe4", { shadow: on ? 5 : 3, stroke: isActive ? col : C.ink, lw: isActive ? 5 : 3 });
        // header
        c.save(); S.roundRect(c, x, y, w, 40, 12); c.clip();
        c.fillStyle = on ? col : "#b9b9b9"; c.fillRect(x, y, w, 40); c.restore();
        c.strokeStyle = C.ink; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y + 40); c.lineTo(x + w, y + 40); c.stroke();
        S.text(c, "P" + (i + 1), x + 14, y + 30, 24, "#fff", "left", S.FONT_BIG, "900", C.ink);
        // type toggle
        const tb = { x: x + w - 118, y: y + 6, w: 108, h: 28 };
        const typeLabel = P.type === "human" ? "HUMAN" : P.type === "cpu" ? "CPU" : "OFF";
        const tHov = this.hover === "type:" + i;
        c.fillStyle = tHov ? C.yellow : "#fff"; S.roundRect(c, tb.x, tb.y, tb.w, tb.h, 8); c.fill();
        c.lineWidth = 2.5; c.strokeStyle = C.ink; c.stroke();
        S.text(c, typeLabel + " ⟳", tb.x + tb.w / 2, tb.y + 20, 14, C.ink, "center", S.FONT_BIG, "900");
        this.hit("type:" + i, tb.x, tb.y, tb.w, tb.h);
        // body (slot)
        const by = y + 44, bh = h - 44 - 46;
        this.hit("slot:" + i, x, by, w, bh);
        const slotHov = this.hover === "slot:" + i;
        if (!on) {
          S.text(c, "click to join", x + w / 2, by + bh / 2 + 2, 20, "#888", "center", S.FONT_COMIC, "bold");
          S.text(c, "(or press its OFF button)", x + w / 2, by + bh / 2 + 24, 13, "#999", "center", S.FONT_COMIC, "bold");
        } else {
          const id = P.fighter;
          const def = id && id !== "random" ? S.FIGHTERS[id] : null;
          const pwid = Math.min(110, w * 0.38);
          // portrait well
          c.save(); S.roundRect(c, x + 10, by + 4, pwid, bh - 8, 8); c.clip();
          c.fillStyle = def ? shadeHex(def.color || "#888", 0.7) : "#ddd"; c.fillRect(x + 10, by + 4, pwid, bh - 8);
          if (def) {
            const f = puppet(id, i);
            const s2 = Math.min((bh - 14) / ((f ? f.h : 70) * 1.15), pwid / 60);
            drawPuppet(c, f, x + 10 + pwid / 2, by + bh - 8, s2, { frame: t + i * 17 });
          } else S.text(c, "?", x + 10 + pwid / 2, by + bh / 2 + 22, 60, id === "random" ? "#9b59b6" : "#aaa", "center", S.FONT_BIG, "900");
          c.restore();
          c.lineWidth = 2; c.strokeStyle = C.ink; S.roundRect(c, x + 10, by + 4, pwid, bh - 8, 8); c.stroke();
          const tx = x + 20 + pwid, tw = w - pwid - 30;
          const name = def ? def.name : id === "random" ? "Random" : P.type === "human" ? "Pick a baller!" : "Pick for CPU";
          const ns = fitText(c, name, tw, 20, S.FONT_BIG, "900");
          S.text(c, name, tx, by + 26, ns, def ? C.ink : "#888", "left", S.FONT_BIG, "900");
          const tag = def ? def.tagline || "" : id === "random" ? "Chosen when the match starts." : P.type === "human" ? "Move your cursor & press attack, or click a card." : "Click here, then a card.";
          drawWrapped(c, wrap(c, tag, tw, 3, 13, S.FONT_COMIC, "bold"), tx, by + 46, 13, "#444", "left", S.FONT_COMIC, 16);
          if (isActive || slotHov) {
            S.text(c, isActive ? "▼ next pick goes here" : "click: pick for this port", tx, by + bh - 6, 12, isActive ? col : "#777", "left", S.FONT, "bold");
          }
        }
        items.push({ id: "slot:" + i, x, y: by, w, h: bh });
        items.push({ id: "type:" + i, x: tb.x, y: tb.y, w: tb.w, h: tb.h });
        // options row
        const oy = y + h - 42, ox = x + 10, ow = w - 20;
        if (P.type === "cpu") {
          S.text(c, "LEVEL", ox, oy + 24, 13, C.ink, "left", S.FONT_BIG, "900");
          const bw = (ow - 56) / 3;
          for (let lv = 1; lv <= 3; lv++) {
            const bx = ox + 56 + (lv - 1) * bw, sel = P.level === lv, hv = this.hover === "lvl:" + i + "." + lv;
            c.fillStyle = sel ? col : hv ? C.yellow : "#fff"; S.roundRect(c, bx + 2, oy + 4, bw - 4, 28, 7); c.fill();
            c.lineWidth = 2; c.strokeStyle = C.ink; c.stroke();
            const fs = fitText(c, LEVEL_NAMES[lv], bw - 10, 13, S.FONT_BIG, "900");
            S.text(c, LEVEL_NAMES[lv], bx + bw / 2, oy + 23, fs, sel ? "#fff" : C.ink, "center", S.FONT_BIG, "900");
            this.hit("lvl:" + i + "." + lv, bx, oy + 4, bw, 28);
          }
          items.push({ id: "opt:" + i, x: ox, y: oy + 4, w: ow, h: 28 });
        } else if (P.type === "human") {
          const hv = this.hover === "opt:" + i;
          c.fillStyle = hv ? C.yellow : "#fff"; S.roundRect(c, ox, oy + 4, ow, 28, 7); c.fill();
          c.lineWidth = 2; c.strokeStyle = C.ink; c.stroke();
          const lab = "🎮 " + devLabel(P.dev) + "  ⟳";
          const fs = fitText(c, lab, ow - 12, 14, S.FONT, "bold");
          S.text(c, lab, ox + ow / 2, oy + 23, fs, C.ink, "center", S.FONT, "bold");
          this.hit("opt:" + i, ox, oy + 4, ow, 28);
          items.push({ id: "opt:" + i, x: ox, y: oy + 4, w: ow, h: 28 });
        } else {
          S.text(c, "—", ox + ow / 2, oy + 24, 16, "#aaa", "center", S.FONT, "bold");
        }
      },
    });
    S.setScene(sc);
  }

  function shadeHex(hex, amt) {
    // amt 0..1: mix toward white
    if (S.shade) { try { return mix(hex, amt); } catch (e) { /* fallthrough */ } }
    return mix(hex, amt);
  }
  function mix(hex, amt) {
    let h = String(hex || "#888").replace("#", "");
    if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
    const n = parseInt(h.slice(0, 6), 16);
    if (isNaN(n)) return "#ccc";
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const m = (v) => Math.round(v + (255 - v) * amt);
    return `rgb(${m(r)},${m(g)},${m(b)})`;
  }

  // ------------------------------------------------------------ STAGE SELECT
  const thumbCache = {};
  function stageThumb(id, w, h) {
    const def = S.STAGES[id];
    const dpr = Math.min(2, window.devicePixelRatio || 1) * 1.0;
    const key = id + ":" + Math.round(w) + "x" + Math.round(h) + "@" + dpr;
    if (thumbCache[key]) return thumbCache[key];
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    const c = cv.getContext("2d");
    c.scale(dpr, dpr);
    let ok = false;
    if (def && def.thumb) { try { def.thumb(c, w, h); ok = true; } catch (e) { console.error(e); } }
    if (!ok) {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#2a3350"); g.addColorStop(1, "#7a4cc2");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      // little platform sketch
      if (def && def.platforms) {
        const xs = def.platforms.flatMap((p) => [p.x1, p.x2]), ys = def.platforms.map((p) => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const s = Math.min((w * 0.8) / (maxX - minX || 1), (h * 0.5) / (maxY - minY + 120));
        c.save(); c.translate(w / 2 - ((minX + maxX) / 2) * s, h * 0.7 - maxY * s);
        for (const p of def.platforms) { c.fillStyle = p.solid ? "#ddd" : "#aaa"; c.fillRect(p.x1 * s, p.y * s, (p.x2 - p.x1) * s, p.solid ? Math.max(6, (p.depth || 60) * s) : 4); }
        c.restore();
      }
      S.text(c, def ? def.name : "?", w / 2, h / 2, Math.min(28, w / 8), "#fff", "center", S.FONT_BIG, "900", "#000");
    }
    thumbCache[key] = cv;
    return cv;
  }

  function stageSelect() {
    const setup = (S.ui.setup = S.ui.setup || loadSetup());
    const list = S.STAGE_ORDER.concat(["random"]);
    let focus = "stage:" + (setup.stage && (setup.stage === "random" || S.STAGES[setup.stage]) ? setup.stage : list[0]);
    let items = [];
    function start(id) {
      setup.stage = id; saveSetup();
      const stage = id === "random" ? S.STAGE_ORDER[Math.floor(Math.random() * S.STAGE_ORDER.length)] : id;
      sfx("select");
      S.startMatch(buildConfig(stage));
    }
    function activate(id) {
      if (!id) return;
      const [kind, arg] = id.split(":");
      if (kind === "stage") start(arg);
      else if (kind === "wiki") { const d = S.STAGES[arg]; if (d) openWiki(d.slug || d.id); }
      else if (kind === "back") { sfx("back"); charSelect(); }
    }
    const sc = baseScene({
      enter() { primeDevices(); },
      update() {
        const inp = this.poll();
        for (const k of inp.presses) {
          if (k === "Escape" || k === "Backspace") { sfx("back"); charSelect(); return; }
          if (k === "Enter" || k === "NumpadEnter") { activate(focus); return; }
        }
        if (inp.click && inp.click.id) { activate(inp.click.id); if (S.scene !== this) return; }
        if (inp.mouseMoved && this.hover && this.hover.startsWith("stage:")) focus = this.hover;
        for (const ev of inp.events) {
          if (ev.type === "dir") { const n = navigate(items, focus, ev.dx, ev.dy); if (n !== focus) { focus = n; sfx("menu"); } }
          else if (ev.type === "a" || ev.type === "start") { activate(focus); return; }
          else if (ev.type === "b") { sfx("back"); charSelect(); return; }
        }
      },
      render(c, W, H) {
        this.begin(c, W, H);
        const { VW, VH, t } = this;
        paperBg(c, VW, VH, t);
        items = [];
        const pad = 24;
        const bx = Math.max(168, 165 / this.k);
        button(c, this, "back", bx, 14, 104, 40, "◀ BACK", { size: 16, focused: focus === "back" });
        items.push({ id: "back", x: bx, y: 14, w: 104, h: 40 });
        S.text(c, "PICK A BATTLEFIELD", bx + 122, 46, 30, C.ink, "left", S.FONT_BIG, "900");
        // who's playing strip
        const pls = setup.ports.map((p, i) => ({ p, i })).filter((o) => o.p.type !== "off");
        let sx = VW - pad;
        for (let k = pls.length - 1; k >= 0; k--) {
          const { p, i } = pls[k];
          const def = S.FIGHTERS[p.fighter];
          const label = (p.type === "cpu" ? "CPU " : "P" + (i + 1) + " ") + (def ? def.short || def.name : "Random");
          c.font = `900 13px ${S.FONT_BIG}`;
          const w = c.measureText(label).width + 22;
          sx -= w;
          c.fillStyle = S.PORT_COLORS[i]; S.roundRect(c, sx, 20, w, 28, 14); c.fill(); c.lineWidth = 2.5; c.strokeStyle = C.ink; c.stroke();
          S.text(c, label, sx + w / 2, 39, 13, "#fff", "center", S.FONT_BIG, "900", C.ink);
          sx -= 8;
        }
        S.text(c, setup.stocks + " stock" + (setup.stocks > 1 ? "s" : "") + " each", sx - 6, 40, 15, C.sub, "right", S.FONT_COMIC, "bold");

        // grid
        const n = list.length, gap = 18, gy = 76, gh = VH - gy - 56, gw = VW - pad * 2;
        let best = null;
        for (let cols = 1; cols <= n; cols++) {
          const rows = Math.ceil(n / cols);
          let w = (gw - gap * (cols - 1)) / cols, h = (gh - gap * (rows - 1)) / rows;
          h = Math.min(h, w * 0.86); w = Math.min(w, h / 0.62);
          if (!best || w * h > best.w * best.h) best = { cols, rows, w, h };
        }
        const { cols, rows, w: cw, h: ch } = best;
        const totalW = cols * cw + (cols - 1) * gap, totalH = rows * ch + (rows - 1) * gap;
        const x0 = (VW - totalW) / 2, y0 = gy + (gh - totalH) / 2;
        list.forEach((id, idx) => {
          const col = idx % cols, row = Math.floor(idx / cols);
          const inRow = row === rows - 1 ? n - row * cols : cols;
          const x = x0 + (cols - inRow) * (cw + gap) / 2 + col * (cw + gap), y = y0 + row * (ch + gap);
          this.drawStage(c, id, x, y, cw, ch, focus === "stage:" + id);
          items.push({ id: "stage:" + id, x, y, w: cw, h: ch });
        });
        S.text(c, "Stick/arrows + attack/Enter to choose · Esc/special to go back · click works too", VW / 2, VH - 20, 15, C.sub, "center", S.FONT_COMIC, "bold");
        this.end(c);
      },
      drawStage(c, id, x, y, w, h, focused) {
        const hov = this.hover === "stage:" + id || this.hover === "wiki:" + id;
        const on = hov || focused;
        const lift = on ? -3 : 0; y += lift;
        panel(c, x, y, w, h, C.card, { shadow: on ? 8 : 5, stroke: focused ? "#e8333a" : C.ink, lw: focused ? 5 : 3 });
        const th = h * 0.68;
        c.save(); S.roundRect(c, x + 6, y + 6, w - 12, th, 8); c.clip();
        if (id === "random") {
          const ids = S.STAGE_ORDER, rid = ids[Math.floor(this.t / 30) % ids.length];
          if (rid) c.drawImage(stageThumb(rid, w - 12, th), x + 6, y + 6, w - 12, th);
          c.fillStyle = "rgba(20,20,20,.55)"; c.fillRect(x, y, w, th + 6);
          S.text(c, "?", x + w / 2, y + 6 + th * 0.72, th * 0.7, C.yellow, "center", S.FONT_BIG, "900", C.ink);
        } else {
          c.drawImage(stageThumb(id, w - 12, th), x + 6, y + 6, w - 12, th);
          if (on) { c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(x, y, w, th + 6); }
        }
        c.restore();
        c.lineWidth = 2; c.strokeStyle = C.ink; S.roundRect(c, x + 6, y + 6, w - 12, th, 8); c.stroke();
        const def = S.STAGES[id];
        const name = def ? def.name : "RANDOM STAGE";
        const ns = fitText(c, name.toUpperCase(), w - 20, 19, S.FONT_BIG, "900");
        S.text(c, name.toUpperCase(), x + 12, y + th + 12 + ns, ns, C.ink, "left", S.FONT_BIG, "900");
        const tag = def ? def.tagline || "" : "Can't decide? Neither can we.";
        const lines = wrap(c, tag, w - 24, 1, 13, S.FONT_COMIC, "bold");
        S.text(c, lines[0] || "", x + 12, y + th + 12 + ns + 20, 13, "#444", "left", S.FONT_COMIC, "bold");
        this.hit("stage:" + id, x, y, w, h);
        if (def) {
          const lh = this.hover === "wiki:" + id;
          c.font = `bold 12px ${S.FONT}`; const lw = c.measureText("Read on the wiki ↗").width;
          const lx = x + w - 12 - lw, ly = y + h - 10;
          S.text(c, "Read on the wiki ↗", lx, ly, 12, lh ? "#e8333a" : C.link, "left", S.FONT, "bold");
          if (lh) { c.fillStyle = "#e8333a"; c.fillRect(lx, ly + 2, lw, 1.5); }
          this.hit("wiki:" + id, lx - 6, ly - 15, lw + 12, 22);
        }
        if (focused) portToken(c, x + 22, y + 22, 0, "▶", 0.8);
      },
    });
    S.setScene(sc);
  }

  function buildConfig(stage) {
    const setup = S.ui.setup;
    const ids = S.FIGHTER_ORDER;
    const players = [];
    setup.ports.forEach((p, i) => {
      if (p.type === "off" || !p.fighter) return;
      const fighter = p.fighter === "random" || !S.FIGHTERS[p.fighter] ? ids[Math.floor(Math.random() * ids.length)] : p.fighter;
      players.push({ fighter, port: i, cpu: p.type === "cpu", level: p.level, devices: DEVICE_OPTIONS[p.dev].slice() });
    });
    return { stage, stocks: setup.stocks, seed: (Math.random() * 1e9) >>> 0, players };
  }

  // ------------------------------------------------------------ RESULTS
  function results(g, cfg) {
    const W0 = g.winner;
    // placement: winner, then by stocks left, then by when they went out (later = better), then KOs
    const rows = g.fighters.slice().sort((a, b) => {
      if (a === W0) return -1; if (b === W0) return 1;
      return (b.stocks - a.stocks) || (b.kos - a.kos) || (a.falls - b.falls) || (b.dmgDealt - a.dmgDealt);
    });
    const confetti = [];
    for (let i = 0; i < 90; i++) confetti.push({ x: Math.random(), y: -Math.random(), vy: 0.002 + Math.random() * 0.004, vx: (Math.random() - 0.5) * 0.002, r: Math.random() * 6, c: S.PORT_COLORS[i % 4], s: 5 + Math.random() * 6 });
    let focus = "continue";
    let items = [];
    const rematch = () => { sfx("select"); S.startMatch(Object.assign({}, cfg, { seed: (Math.random() * 1e9) >>> 0 })); };
    const cont = () => { sfx("select"); charSelect(); };
    const sc = baseScene({
      enter() { primeDevices(); try { S.audio && S.audio.music && S.audio.music("menu"); } catch (e) { /* ignore */ } },
      update() {
        const inp = this.poll();
        for (const c of confetti) { c.y += c.vy; c.x += c.vx; c.r += 0.08; if (c.y > 1.05) { c.y = -0.05; c.x = Math.random(); } }
        if (this.t < 30) return;   // don't skip the screen with a mashed button
        for (const k of inp.presses) {
          if (k === "KeyR") { rematch(); return; }
          if (k === "Enter" || k === "NumpadEnter" || k === "Escape") { focus === "rematch" && k !== "Escape" ? rematch() : cont(); return; }
        }
        if (inp.click && inp.click.id === "rematch") { rematch(); return; }
        if (inp.click && inp.click.id === "continue") { cont(); return; }
        for (const ev of inp.events) {
          if (ev.type === "dir") { const n = navigate(items, focus, ev.dx, ev.dy); if (n !== focus) { focus = n; sfx("menu"); } }
          else if (ev.type === "a" || ev.type === "start") { focus === "rematch" ? rematch() : cont(); return; }
          else if (ev.type === "j") { rematch(); return; }
        }
      },
      render(c, W, H) {
        this.begin(c, W, H);
        const { VW, VH, t } = this;
        paperBg(c, VW, VH, t);
        items = [];
        const col = W0 ? S.PORT_COLORS[W0.port] : "#888";
        // burst
        c.save(); c.translate(VW * 0.26, VH * 0.5); c.rotate(t * 0.004);
        for (let i = 0; i < 16; i++) { c.rotate(Math.PI / 8); c.fillStyle = i % 2 ? hexA(col, 0.22) : hexA(col, 0.08); c.beginPath(); c.moveTo(0, 0); c.lineTo(700, -90); c.lineTo(700, 90); c.closePath(); c.fill(); }
        c.restore();
        // winner art
        const leftW = VW * 0.46;
        if (W0) {
          const f = puppet(W0.def.id, W0.port);
          const s = Math.min(3.4, (VH * 0.42) / (f ? f.h : 70));
          const anim = showOff(f, t);
          c.fillStyle = "rgba(0,0,0,.12)"; c.beginPath(); c.ellipse(VW * 0.26, VH * 0.8, 120, 18, 0, 0, Math.PI * 2); c.fill();
          drawPuppet(c, f, VW * 0.26, VH * 0.8, s, Object.assign({ frame: t }, anim));
          const name = (W0.def.short || W0.def.name).toUpperCase() + " WINS!";
          const fs = fitText(c, name, leftW - 40, 76, S.FONT_BIG, "900");
          c.save(); c.translate(VW * 0.26, VH * 0.2); c.rotate(-0.04);
          S.text(c, name, 5, 5, fs, C.ink, "center", S.FONT_BIG, "900");
          S.text(c, name, 0, 0, fs, col, "center", S.FONT_BIG, "900", C.ink);
          c.restore();
          S.text(c, (W0.cpu ? "CPU" : "Player " + (W0.port + 1)) + " · " + W0.def.name, VW * 0.26, VH * 0.2 + 40, 20, C.sub, "center", S.FONT_COMIC, "bold");
        } else {
          S.text(c, "NO CONTEST!", VW * 0.26, VH * 0.25, 64, C.ink, "center", S.FONT_BIG, "900");
          S.text(c, "everybody lost. honestly iconic.", VW * 0.26, VH * 0.25 + 40, 20, C.sub, "center", S.FONT_COMIC, "bold");
        }
        // table
        const tx = leftW + 10, tw = VW - tx - 30, ty = 70;
        panel(c, tx, ty, tw, 70 + rows.length * 62, "#fff", { shadow: 6 });
        S.text(c, "RESULTS", tx + 20, ty + 40, 28, C.ink, "left", S.FONT_BIG, "900");
        const heads = ["KOs", "FALLS", "SDs", "DMG DEALT", "DMG TAKEN"];
        const colX = (k) => tx + tw * 0.44 + k * (tw * 0.56 - 20) / 5 + (tw * 0.56 - 20) / 10;
        heads.forEach((h, k) => { const fs = fitText(c, h, (tw * 0.56 - 20) / 5 - 6, 13, S.FONT_BIG, "900"); S.text(c, h, colX(k), ty + 40, fs, C.sub, "center", S.FONT_BIG, "900"); });
        rows.forEach((f, r) => {
          const y = ty + 60 + r * 62, pc = S.PORT_COLORS[f.port];
          c.fillStyle = r % 2 ? "rgba(0,0,0,.035)" : "rgba(0,0,0,0)"; c.fillRect(tx + 6, y, tw - 12, 58);
          c.fillStyle = pc; c.fillRect(tx + 6, y + 4, 8, 50);
          S.text(c, String(r + 1), tx + 34, y + 40, 28, r === 0 && W0 ? "#e8b100" : C.ink, "center", S.FONT_BIG, "900", r === 0 && W0 ? C.ink : null);
          // mini portrait
          c.save(); c.beginPath(); c.rect(tx + 54, y + 2, 50, 54); c.clip();
          drawPuppet(c, puppet(f.def.id, f.port), tx + 79, y + 56, 0.62, { frame: t + r * 9 });
          c.restore();
          const nm = f.def.name;
          const ns = fitText(c, nm, tw * 0.44 - 120, 18, S.FONT_BIG, "900");
          S.text(c, nm, tx + 112, y + 28, ns, C.ink, "left", S.FONT_BIG, "900");
          S.text(c, (f.cpu ? "CPU lv" + f.level : "P" + (f.port + 1)) + (f.out ? " · out" : " · " + f.stocks + " stock" + (f.stocks === 1 ? "" : "s") + " left"), tx + 112, y + 48, 13, pc, "left", S.FONT, "bold");
          [f.kos, f.falls, f.sds, Math.round(f.dmgDealt) + "%", Math.round(f.dmgTaken) + "%"].forEach((v, k) => S.text(c, String(v), colX(k), y + 37, 22, k === 2 && f.sds ? "#e8333a" : C.ink, "center", S.FONT_BIG, "900"));
        });
        // buttons
        const by = Math.min(VH - 80, ty + 70 + rows.length * 62 + 30), bw = (tw - 20) / 2;
        button(c, this, "continue", tx, by, bw, 54, "CHARACTER SELECT", { size: 18, focused: focus === "continue" });
        button(c, this, "rematch", tx + bw + 20, by, bw, 54, "REMATCH (R)", { size: 18, focused: focus === "rematch" });
        items.push({ id: "continue", x: tx, y: by, w: bw, h: 54 }, { id: "rematch", x: tx + bw + 20, y: by, w: bw, h: 54 });
        S.text(c, "Enter / attack / click to continue · R or jump for a rematch", tx + tw / 2, by + 84, 15, C.sub, "center", S.FONT_COMIC, "bold");
        // confetti
        for (const p of confetti) {
          c.save(); c.translate(p.x * VW, p.y * VH); c.rotate(p.r); c.fillStyle = p.c; c.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); c.restore();
        }
        this.end(c);
      },
    });
    S.setScene(sc);
  }
  function hexA(col, a) {
    const n = parseInt(String(col).replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  S.ui = { setup: null, title, charSelect, stageSelect, results, buildConfig, DEVICE_OPTIONS };
})();
