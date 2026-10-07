/* Super Smash Ballers — engine: fixed-step loop, scenes, camera, match scene, HUD, pause, boot.
   Scenes are objects { update(), render(ctx, W, H) }. ui.js supplies S.ui.title/charSelect/results;
   without it, the engine boots straight into a match. URL ?quick=chris,lebron-james&stage=the-court&cpu=0,2
   starts a match directly (cpu: 0 = human, 1-3 = CPU level). Add &debug=1 for hitboxes. */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp, lerp } = S;

  let canvas, ctx, W = 960, H = 540, dpr = 1;
  S.scene = null;
  S.setScene = (sc) => { S.scene = sc; if (sc && sc.enter) sc.enter(); };
  S.debug = /[?&]debug=1/.test(location.search);
  S.view = { get W() { return W; }, get H() { return H; } };

  // ------------------------------------------------------------ fonts / text helpers (for UI too)
  S.FONT = 'Arial, "Arimo", Helvetica, sans-serif';
  S.FONT_BIG = '"Arial Black", "Arimo", Arial, sans-serif';
  S.FONT_COMIC = '"Comic Sans MS", "Comic Neue", "Chalkboard SE", cursive';
  S.text = function (c, str, x, y, size, color, align = "left", font = S.FONT, weight = "bold", outline) {
    c.font = `${weight} ${size}px ${font}`; c.textAlign = align; c.textBaseline = "alphabetic";
    if (outline) { c.lineWidth = Math.max(3, size / 6); c.strokeStyle = outline; c.lineJoin = "round"; c.strokeText(str, x, y); }
    c.fillStyle = color; c.fillText(str, x, y);
  };

  // ------------------------------------------------------------ camera
  function makeCamera(g) { return { x: 0, y: -150, zoom: 0.8, g }; }
  function updateCamera(cam, g) {
    const live = g.fighters.filter((f) => !f.out && f.state !== "dead");
    let x1 = -350, x2 = 350, y1 = -320, y2 = 60;
    if (live.length) {
      x1 = Infinity; x2 = -Infinity; y1 = Infinity; y2 = -Infinity;
      for (const f of live) { x1 = Math.min(x1, f.x); x2 = Math.max(x2, f.x); y1 = Math.min(y1, f.y - f.h); y2 = Math.max(y2, f.y); }
      // always keep a bit of the stage in view
      x1 = Math.min(x1, -200); x2 = Math.max(x2, 200); y2 = Math.max(y2, 40); y1 = Math.min(y1, -200);
    }
    const B = g.stage.blast;
    x1 = Math.max(x1 - 180, B.left + 40); x2 = Math.min(x2 + 180, B.right - 40);
    y1 = Math.max(y1 - 140, B.top + 40); y2 = Math.min(y2 + 150, B.bottom - 20);
    const tz = clamp(Math.min(W / (x2 - x1), H / (y2 - y1)), 0.28, 1.5);
    const tx = (x1 + x2) / 2, ty = (y1 + y2) / 2;
    cam.zoom = lerp(cam.zoom, tz, 0.06);
    cam.x = lerp(cam.x, tx, 0.1);
    cam.y = lerp(cam.y, ty, 0.1);
  }

  // ------------------------------------------------------------ match scene
  S.startMatch = function (cfg) {
    const g = new S.Game(cfg);
    S.game = g;
    const cam = makeCamera(g);
    const sc = {
      g, cam, paused: false, pauseSel: 0, countdown: 150,
      enter() { S.audio && S.audio.music && S.audio.music(g.stageDef.id); },
      update() {
        S.input.tick();
        const presses = S.input.takePresses();
        // pause toggle (any human: Enter/Escape or pad Start)
        let startPressed = presses.includes("Enter") || presses.includes("Escape");
        for (const f of g.fighters) if (!f.cpu) { const was = f._startHeld; f._startHeld = f.pad.start; if (f.pad.start && !was) startPressed = true; }
        if (presses.includes("Backquote")) S.debug = !S.debug;
        if (this.paused) {
          for (const f of g.fighters) if (!f.cpu) S.input.readPad(f.pad, f.devices);
          if (startPressed) this.paused = false;
          if (presses.includes("KeyQ")) { this.quit(); return; }
          if (presses.includes("KeyR")) { S.startMatch(cfg); return; }
          return;
        }
        if (startPressed && !g.over && this.countdown <= 0) { this.paused = true; S.audio && S.audio.pause && S.audio.pause(); return; }
        if (this.countdown > 0) {
          this.countdown--;
          for (const f of g.fighters) if (!f.cpu) S.input.readPad(f.pad, f.devices);
          if (this.countdown % 50 === 0 && S.audio && S.audio.count) S.audio.count(this.countdown === 0);
          updateCamera(cam, g);
          return;
        }
        for (const f of g.fighters) {
          if (f.cpu && f.brain) { f.brain.think(g, f.pad); S.input.finishAiPad(f.pad); }
          else if (!f.cpu) S.input.readPad(f.pad, f.devices);
        }
        g.step();
        updateCamera(cam, g);
        if (g.over && g.overTimer === 1 && S.audio && S.audio.game) S.audio.game();
        if (g.over && g.overTimer > 150) this.finish();
      },
      quit() { if (S.ui && S.ui.charSelect) S.ui.charSelect(); else S.startMatch(cfg); },
      finish() { if (S.ui && S.ui.results) S.ui.results(g, cfg); else S.startMatch(cfg); },
      render(c, W, H) { renderMatch(c, W, H, this); },
    };
    S.setScene(sc);
    return g;
  };

  function renderMatch(c, W, H, sc) {
    const g = sc.g, cam = sc.cam, st = g.stageDef;
    c.save();
    // background (screen space)
    if (st.drawBg) { try { st.drawBg(c, g.stage, g, cam, W, H); } catch (e) { logOnce(st, e); c.fillStyle = "#1c2230"; c.fillRect(0, 0, W, H); } }
    else { const grd = c.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, "#2a3350"); grd.addColorStop(1, "#0d0f18"); c.fillStyle = grd; c.fillRect(0, 0, W, H); }
    // world
    c.translate(W / 2, H / 2);
    if (g.shake) c.translate((g.frame % 2 ? 1 : -1) * g.shake * 0.6, (g.frame % 3 - 1) * g.shake * 0.4);
    c.scale(cam.zoom, cam.zoom);
    c.translate(-cam.x, -cam.y);
    if (st.drawMid) { try { st.drawMid(c, g.stage, g, cam); } catch (e) { logOnce(st, e); } }
    if (st.drawPlatforms) { try { st.drawPlatforms(c, g.stage, g); } catch (e) { logOnce(st, e); S.drawPlatformsDefault(c, g); } }
    else S.drawPlatformsDefault(c, g);
    const use3d = S.three && S.three.active;
    const flat = (p) => !(use3d && p.model3d);
    for (const p of g.projectiles) if (p.behind && flat(p)) S.drawProjectile(c, p, g);
    if (use3d) {
      drawShadows(c, g);
      for (const f of g.fighters) if (f.def.drawFxBehind && !f.out && f.state !== "dead" && S.three.has(f.def)) {
        c.save(); c.translate(f.x, f.y); c.scale(f.facing, 1);
        try { f.def.drawFxBehind(c, f, g); } catch (e) { logOnce(f.def, e); }
        c.restore();
      }
      const shk = g.shake ? [(g.frame % 2 ? 1 : -1) * g.shake * 0.6, (g.frame % 3 - 1) * g.shake * 0.4] : null;
      try { S.three.renderWorld(c, g, cam, W, H, dpr, shk); } catch (e) { console.error(e); S.three.active = false; S.three.failed = true; }
    }
    for (const f of g.fighters) S.drawFighter(c, f, g, S.debug, use3d && S.three.has(f.def) ? "overlay" : "full");
    for (const p of g.projectiles) if (!p.behind && flat(p)) S.drawProjectile(c, p, g);
    if (S.debug) { c.strokeStyle = "rgba(255,0,0,.6)"; c.lineWidth = 3; for (const p of g.projectiles) { c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.stroke(); } }
    S.drawParticles(c, g);
    if (st.drawFg) { try { st.drawFg(c, g.stage, g, cam); } catch (e) { logOnce(st, e); } }
    c.restore();
    offscreenBubbles(c, W, H, g, cam);
    drawHUD(c, W, H, g);
    if (sc.countdown > 0) {
      const n = Math.ceil(sc.countdown / 50);
      const label = sc.countdown > 0 && n > 0 ? String(n) : "GO!";
      S.text(c, sc.countdown < 12 ? "GO!" : label, W / 2, H / 2, 110, "#fff", "center", S.FONT_BIG, "900", "#000");
    } else if (g.frame < 40) S.text(c, "GO!", W / 2, H / 2, 110 + g.frame, `rgba(255,255,255,${1 - g.frame / 40})`, "center", S.FONT_BIG, "900");
    if (g.over) {
      const msg = "GAME!";
      const k = Math.min(1, g.overTimer / 20);
      S.text(c, msg, W / 2, H / 2, 70 + 70 * k, "#ffe14a", "center", S.FONT_BIG, "900", "#000");
    }
    if (sc.paused) drawPause(c, W, H, sc);
  }

  // Soft contact shadows under 3D fighters (on the highest platform below them).
  function drawShadows(c, g) {
    for (const f of g.fighters) {
      if (f.out || f.state === "dead") continue;
      let best = null;
      for (const P of g.platforms) if (f.x >= P.x1 && f.x <= P.x2 && P.y >= f.y - 2 && (!best || P.y < best.y)) best = P;
      if (!best) continue;
      const k = Math.max(0, 1 - (best.y - f.y) / 260);
      if (k <= 0) continue;
      c.fillStyle = `rgba(0,0,0,${0.32 * k})`;
      c.beginPath(); c.ellipse(f.x, best.y + 1, f.w * (0.45 + 0.35 * k), 4 + 2 * k, 0, 0, Math.PI * 2); c.fill();
    }
  }

  const logged = new WeakSet();
  function logOnce(o, e) { if (!logged.has(o)) { logged.add(o); console.error(e); } }

  // Fighters outside the view get a magnifier bubble at the edge.
  function offscreenBubbles(c, W, H, g, cam) {
    for (const f of g.fighters) {
      if (f.out || f.state === "dead") continue;
      const sx = (f.x - cam.x) * cam.zoom + W / 2, sy = (f.y - f.h / 2 - cam.y) * cam.zoom + H / 2;
      if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) continue;
      const bx = clamp(sx, 50, W - 50), by = clamp(sy, 50, H - 140);
      c.save();
      c.beginPath(); c.arc(bx, by, 40, 0, Math.PI * 2); c.fillStyle = "rgba(0,0,0,.55)"; c.fill();
      c.lineWidth = 4; c.strokeStyle = S.PORT_COLORS[f.port]; c.stroke();
      c.clip();
      c.translate(bx, by); c.scale(0.45, 0.45); c.translate(-f.x, -(f.y - f.h / 2));
      S.drawFighter(c, f, g, false);
      c.restore();
    }
  }

  function drawHUD(c, W, H, g) {
    const n = g.fighters.length, slotW = Math.min(220, (W - 40) / n), y = H - 18;
    const x0 = W / 2 - (slotW * n) / 2;
    g.fighters.forEach((f, i) => {
      const x = x0 + i * slotW + slotW / 2;
      const col = S.PORT_COLORS[f.port];
      c.save();
      c.globalAlpha = f.out ? 0.35 : 0.92;
      c.fillStyle = "rgba(10,10,14,.72)"; S.roundRect(c, x - slotW / 2 + 6, H - 96, slotW - 12, 86, 10); c.fill();
      c.fillStyle = col; c.fillRect(x - slotW / 2 + 6, H - 96, 8, 86);
      // portrait: a tiny version of the fighter
      c.save(); c.beginPath(); c.rect(x - slotW / 2 + 16, H - 94, 54, 82); c.clip();
      c.translate(x - slotW / 2 + 43, H - 18); c.scale(0.8, 0.8);
      const fake = Object.assign(Object.create(Object.getPrototypeOf(f)), f, { x: 0, y: 0, state: "idle", facing: 1, move: null, charging: 0, respawnPlat: false, invuln: 0, out: false, hitlag: 0, armor: false });
      c.save(); try { S.drawFighterBody(c, fake, g, "hud:" + f.port); } catch (e) { /* ignore in HUD */ } c.restore();
      c.restore();
      // damage
      const dmg = Math.floor(f.damage);
      const heat = clamp(f.damage / 150, 0, 1);
      const dcol = `rgb(255,${Math.round(255 - 200 * heat)},${Math.round(255 - 235 * heat)})`;
      const shake = f.hitlag > 0 && f.state === "hitstun" ? (g.frame % 2 ? 2 : -2) : 0;
      if (f.out) S.text(c, "OUT", x + 30, y - 22, 34, "#888", "center", S.FONT_BIG, "900", "#000");
      else S.text(c, dmg + "%", x + 30 + shake, y - 22, 40, dcol, "center", S.FONT_BIG, "900", "#000");
      S.text(c, (f.def.short || f.def.name).toUpperCase(), x + 30, y - 2, 12, "#ddd", "center");
      S.text(c, f.cpu ? "CPU" : "P" + (f.port + 1), x - slotW / 2 + 22, H - 80, 12, col, "left");
      // stocks
      const sc = Math.min(f.stocks, 6);
      for (let k = 0; k < sc; k++) { c.fillStyle = f.def.color || col; c.beginPath(); c.arc(x + 4 + k * 13, H - 82, 5, 0, Math.PI * 2); c.fill(); c.strokeStyle = "#000"; c.lineWidth = 1.5; c.stroke(); }
      if (f.stocks > 6) S.text(c, "×" + f.stocks, x + 86, H - 78, 12, "#fff");
      c.restore();
    });
  }

  function drawPause(c, W, H) {
    c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(0, 0, W, H);
    S.text(c, "PAUSED", W / 2, H / 2 - 40, 64, "#fff", "center", S.FONT_BIG, "900", "#000");
    S.text(c, "Enter / Esc / Start — resume", W / 2, H / 2 + 10, 20, "#ddd", "center");
    S.text(c, "R — restart     Q — quit to character select", W / 2, H / 2 + 40, 20, "#ddd", "center");
    S.text(c, "` — show hitboxes", W / 2, H / 2 + 70, 16, "#999", "center");
  }

  // ------------------------------------------------------------ placeholder content
  // Lets each content file be developed alone: if no fighters/stages are registered, use these.
  function ensureContent() {
    if (!S.FIGHTER_ORDER.length) {
      S.registerFighter({ id: "dummy", name: "Sandbag", short: "Sandbag", color: "#c8b48a", slug: "chris", draw: S.drawDummy });
      S.registerFighter({ id: "dummy2", name: "Sandbag 2", short: "Sandbag 2", color: "#8ab4c8", slug: "chris", draw: S.drawDummy });
    }
    if (!S.STAGE_ORDER.length) {
      S.registerStage({
        id: "test", name: "Test Stage", slug: "the-court",
        platforms: [{ x1: -400, x2: 400, y: 0, solid: true, depth: 120 }, { x1: -260, x2: -100, y: -130, pass: true }, { x1: 100, x2: 260, y: -130, pass: true }],
        blast: { left: -1150, right: 1150, top: -950, bottom: 650 },
        spawns: [{ x: -240, y: -10 }, { x: 240, y: -10 }, { x: -90, y: -10 }, { x: 90, y: -10 }],
        respawn: { x: 0, y: -280 },
      });
    }
  }

  // ------------------------------------------------------------ loop / boot
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(320, window.innerWidth); H = Math.max(240, window.innerHeight);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
  }

  let acc = 0, last = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!last) last = now;
    acc += Math.min(250, now - last); last = now;
    let steps = 0;
    while (acc >= S.TICK && steps < 5) {
      if (S.scene) { try { S.scene.update(); } catch (e) { console.error(e); S.lastError = e; } }
      acc -= S.TICK; steps++;
    }
    if (steps === 5) acc = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (S.scene) { try { S.scene.render(ctx, W, H); } catch (e) { console.error(e); S.lastError = e; } }
    if (steps) S.input.mouse.clicked = false;   // keep a click for the next update on high-refresh screens
  }

  S.quickConfig = function () {
    const q = new URLSearchParams(location.search);
    if (!q.get("quick")) return null;
    const ids = q.get("quick").split(",").map((s) => s.trim()).filter(Boolean);
    const cpu = (q.get("cpu") || "").split(",").map((n) => +n || 0);
    const devs = [["kbA", "pad0"], ["kbB", "pad1"], ["pad2"], ["pad3"]];
    return {
      stage: q.get("stage") || S.STAGE_ORDER[0], stocks: +(q.get("stocks") || 3), seed: +(q.get("seed") || 7),
      players: ids.slice(0, 4).map((id, i) => ({ fighter: S.FIGHTERS[id] ? id : S.FIGHTER_ORDER[i % S.FIGHTER_ORDER.length], port: i, cpu: cpu[i] > 0, level: cpu[i] || 2, devices: devs[i] })),
    };
  };

  S.boot = function () {
    canvas = document.getElementById("game");
    ctx = canvas.getContext("2d");
    resize(); addEventListener("resize", resize);
    S.input.attach(canvas);
    if (S.three) S.three.init();
    ensureContent();
    const quick = S.quickConfig();
    if (quick) S.startMatch(quick);
    else if (S.ui && S.ui.title) S.ui.title();
    else S.startMatch({ stage: S.STAGE_ORDER[0], stocks: 3, seed: 1, players: [
      { fighter: S.FIGHTER_ORDER[0], port: 0, cpu: false, devices: ["kbA", "pad0"] },
      { fighter: S.FIGHTER_ORDER[1 % S.FIGHTER_ORDER.length], port: 1, cpu: !!S.AI, level: 2, devices: ["kbB", "pad1"] },
    ] });
    requestAnimationFrame(frame);
  };

  // Headless helper for tests: run a match for n ticks without rendering.
  S.simulate = function (cfg, n, padFn) {
    const g = new S.Game(cfg);
    for (let i = 0; i < n && !g.over; i++) {
      for (const f of g.fighters) {
        if (padFn) padFn(f, g, i);
        else if (f.brain) { f.brain.think(g, f.pad); S.input.finishAiPad(f.pad); }
      }
      g.step();
    }
    return g;
  };

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", S.boot); else S.boot();
})();
