/* Super Smash Ballers — stages. Five code-drawn stages, ids = wiki slugs.
   Sim code (init/update) is deterministic: it only uses g.frame and g.rng. Drawing may use anything.
   Background layers are drawn in screen space with a parallax transform (see layer()). */
(function () {
  "use strict";
  const S = window.Smash;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const FONT = 'Arial, "Arimo", Helvetica, sans-serif';
  const FONT_BIG = '"Arial Black", "Arimo", Arial, sans-serif';

  // ------------------------------------------------------------ drawing helpers
  function lin(c, x0, y0, x1, y1, stops) {
    const gr = c.createLinearGradient(x0, y0, x1, y1);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  }
  function radial(c, x, y, r0, r1, stops) {
    const gr = c.createRadialGradient(x, y, r0, x, y, r1);
    for (const [o, col] of stops) gr.addColorStop(o, col);
    return gr;
  }
  function glow(c, x, y, r, col, a = 1) {
    c.save(); c.globalAlpha *= a;
    c.fillStyle = radial(c, x, y, 0, r, [[0, col], [1, "rgba(0,0,0,0)"]]);
    c.fillRect(x - r, y - r, r * 2, r * 2);
    c.restore();
  }
  function rrect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function txt(c, s, x, y, size, col, align = "center", font = FONT_BIG, outline) {
    c.font = `900 ${size}px ${font}`; c.textAlign = align; c.textBaseline = "middle";
    if (outline) { c.lineWidth = Math.max(2, size / 7); c.strokeStyle = outline; c.lineJoin = "round"; c.strokeText(s, x, y); }
    c.fillStyle = col; c.fillText(s, x, y);
  }
  function screenGrad(c, W, H, stops) { c.fillStyle = lin(c, 0, 0, 0, H, stops); c.fillRect(0, 0, W, H); }
  // Parallax layer: f = 0 is fixed to the screen, 1 moves with the world. Layer units: the screen is ~600 tall.
  // At the default camera (x 0, y -150) the layer origin is the screen centre.
  function layer(c, cam, W, H, f, fn) {
    c.save();
    const k = (H / 600) * (1 + (cam.zoom - 0.8) * f * 0.6);
    c.translate(W / 2, H / 2); c.scale(k, k); c.translate(-cam.x * f, -(cam.y + 150) * f);
    try { fn(W / 2 / k, H / 2 / k); } finally { c.restore(); }
  }
  const camOr = (cam) => cam || { x: 0, y: -150, zoom: 0.8 };
  // Generic "slab" stage: a top face (perspective strip) + front face + tapered underside.
  function slabPath(c, P, inset, d) {
    c.beginPath(); c.moveTo(P.x1, P.y); c.lineTo(P.x2, P.y);
    c.lineTo(P.x2 - inset, P.y + d); c.lineTo(P.x1 + inset, P.y + d); c.closePath();
  }
  // Stage-select thumbnails reuse the real draw functions with a fake game.
  function makeThumb(def, view) {
    let fake = null;
    return function (c, w, h) {
      if (!fake) {
        fake = { frame: view.frame || 120, rng: S.makeRng(5), state: {}, projectiles: [], particles: [], fighters: [], stageDef: def,
          platforms: def.platforms.map((p) => Object.assign({ dx: 0, dy: 0 }, p)) };
        fake.stage = Object.assign({}, def);
        if (def.init) def.init(fake.stage, fake);
        if (view.setup) view.setup(fake);
      }
      const cam = { x: view.x, y: view.y, zoom: Math.min(h / view.h, w / (view.h * 1.78)) };
      c.save();
      c.beginPath(); c.rect(0, 0, w, h); c.clip();
      try {
        def.drawBg(c, fake.stage, fake, cam, w, h);
        c.translate(w / 2, h / 2); c.scale(cam.zoom, cam.zoom); c.translate(-cam.x, -cam.y);
        if (def.drawMid) def.drawMid(c, fake.stage, fake, cam);
        def.drawPlatforms(c, fake.stage, fake);
      } catch (e) { if (!fake.err) { fake.err = true; console.error(e); } }
      c.restore();
    };
  }
  // Moving-platform helper: move P so its centre is (cx, y) with width w; record the carry deltas.
  function placePlat(P, cx, y, w) {
    const ocx = P._cx != null ? P._cx : (P.x1 + P.x2) / 2, oy = P.y;
    P.x1 = cx - w / 2; P.x2 = cx + w / 2; P.y = y; P._cx = cx;
    P.dx = cx - ocx; P.dy = y - oy;
  }
  // Seeded random tables for decoration (never touches g.rng).
  function table(seed, n, fn) { const r = S.makeRng(seed); const out = []; for (let i = 0; i < n; i++) out.push(fn(r, i)); return out; }
  function offscreen(w, h) { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; return cv; }

  // =================================================================== 1. THE COURT
  const CROWD = { cv: [] };
  const crowdCols = ["#552583", "#fdb927", "#e03a3e", "#1d428a", "#ffffff", "#2b2b2b", "#007a33", "#ce1141", "#f58426", "#c4ced4"];
  function crowdCanvas(v) {
    if (CROWD.cv[v]) return CROWD.cv[v];
    const w = 2400, h = 300, cv = offscreen(w, h), c = cv.getContext("2d");
    const r = S.makeRng(11);
    // tiers
    for (let row = 0; row < 11; row++) {
      const y = 20 + row * 25;
      c.fillStyle = row % 2 ? "#1a1630" : "#211b3a"; c.fillRect(0, y - 10, w, 25);
      for (let x = 6 + (row % 2) * 9; x < w; x += 18) {
        const col = crowdCols[Math.floor(r() * crowdCols.length)];
        const skin = ["#f1c9a5", "#c68e64", "#8d5a3b", "#5a3825", "#e8b98d"][Math.floor(r() * 5)];
        const bob = (v && r() < 0.45) ? -4 : 0, arms = v && r() < 0.18;
        if (r() < 0.06) { r(); continue; }
        c.fillStyle = col; c.beginPath(); c.ellipse(x, y + 9 + bob, 7, 9, 0, 0, TAU); c.fill();
        c.fillStyle = skin; c.beginPath(); c.arc(x, y - 3 + bob, 5, 0, TAU); c.fill();
        if (arms) { c.strokeStyle = skin; c.lineWidth = 2.5; c.beginPath(); c.moveTo(x - 5, y + 5); c.lineTo(x - 9, y - 12); c.moveTo(x + 5, y + 5); c.lineTo(x + 9, y - 12); c.stroke(); }
      }
      c.fillStyle = "rgba(0,0,0,.35)"; c.fillRect(0, y + 12, w, 3);
    }
    // aisles
    c.fillStyle = "#0e0b1c"; for (let x = 150; x < w; x += 330) c.fillRect(x, 0, 14, h);
    // haze
    c.fillStyle = lin(c, 0, 0, 0, h, [[0, "rgba(10,8,25,.75)"], [0.5, "rgba(10,8,25,.15)"], [1, "rgba(10,8,25,0)"]]); c.fillRect(0, 0, w, h);
    CROWD.cv[v] = cv;
    return cv;
  }
  const flashes = table(21, 40, (r) => ({ x: r.range(-1150, 1150), y: r.range(-140, 120), t: r.int(0, 400) }));

  function drawHoop(c, x, y, dir, s) {
    c.save(); c.translate(x, y); c.scale(dir * s, s);
    // stanchion
    c.fillStyle = "#1c1f2b"; c.beginPath(); c.moveTo(-70, 210); c.lineTo(10, 210); c.lineTo(0, 170); c.lineTo(-60, 170); c.fill();
    c.fillStyle = "#e03a3e"; c.fillRect(-65, 172, 70, 26);
    c.strokeStyle = "#2a2e3d"; c.lineWidth = 14; c.lineCap = "round";
    c.beginPath(); c.moveTo(-35, 172); c.lineTo(-35, 20); c.quadraticCurveTo(-35, -10, 0, -12); c.lineTo(28, -12); c.stroke();
    // backboard
    c.fillStyle = "rgba(200,230,255,.28)"; c.fillRect(26, -70, 10, 0); rrect(c, 28, -78, 8, 80, 2); c.fill();
    c.fillStyle = "rgba(220,240,255,.35)"; c.fillRect(28, -78, 8, 80);
    c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(28, -78, 8, 80);
    // rim + net
    c.strokeStyle = "#ff6a1a"; c.lineWidth = 4; c.beginPath(); c.ellipse(60, -20, 24, 6, 0, 0, TAU); c.stroke();
    c.strokeStyle = "rgba(255,255,255,.75)"; c.lineWidth = 1.5;
    for (let i = 0; i <= 6; i++) { const a = -24 + i * 8; c.beginPath(); c.moveTo(60 + a, -18); c.lineTo(60 + a * 0.55, 18); c.stroke(); }
    for (let k = 0; k < 3; k++) { const yy = -10 + k * 10, w = 22 - k * 3.5; c.beginPath(); c.moveTo(60 - w, yy); c.lineTo(60 + w, yy); c.stroke(); }
    c.restore();
  }

  function courtBg(c, st, g, cam, W, H) {
    cam = camOr(cam);
    const t = g.frame || 0;
    screenGrad(c, W, H, [[0, "#06071a"], [0.55, "#151033"], [1, "#0c0a1c"]]);
    // ceiling + spotlights
    layer(c, cam, W, H, 0.04, (hw) => {
      c.strokeStyle = "rgba(120,130,190,.16)"; c.lineWidth = 3;
      for (let i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(i * 90, -420); c.lineTo(i * 140, -260); c.stroke(); }
      c.beginPath(); c.moveTo(-hw - 50, -330); c.lineTo(hw + 50, -330); c.moveTo(-hw - 50, -380); c.lineTo(hw + 50, -380); c.stroke();
      c.save(); c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const sx = -450 + i * 300, a = Math.sin(t * 0.008 + i * 1.7) * 0.35;
        c.save(); c.translate(sx, -360); c.rotate(a);
        c.fillStyle = lin(c, 0, 0, 0, 700, [[0, "rgba(255,240,200,.16)"], [1, "rgba(255,240,200,0)"]]);
        c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.lineTo(110, 700); c.lineTo(-110, 700); c.fill();
        c.restore();
        glow(c, sx, -360, 26, "rgba(255,245,220,.9)");
      }
      c.restore();
    });
    // crowd
    layer(c, cam, W, H, 0.14, () => {
      const cv = crowdCanvas((t >> 4) % 2);
      c.drawImage(cv, -1200, -170, 2400, 300);
      c.fillStyle = "rgba(6,6,20,.55)"; c.fillRect(-1200, -170, 2400, 300);
      c.drawImage(cv, -1200, -470, 2400, 300);
      c.fillStyle = "rgba(6,6,20,.7)"; c.fillRect(-1200, -470, 2400, 300);
      // upper-deck rail and banners
      c.fillStyle = "#2c2550"; c.fillRect(-1200, -176, 2400, 10);
      c.fillStyle = "#552583"; c.fillRect(-1200, -166, 2400, 18);
      txt(c, "WHERE CHRIS MUST BE BEATEN  •  BALL IS LIFE  •  STILL YOU ON THE COURT  •  WHERE CHRIS MUST BE BEATEN  •  BALL IS LIFE", ((-t * 0.6) % 600) , -157, 12, "#fdb927", "center", FONT);
      // camera flashes
      c.save(); c.globalCompositeOperation = "lighter";
      for (const fl of flashes) { const p = (t + fl.t) % 400; if (p < 6) glow(c, fl.x, fl.y, 14, "rgba(255,255,255,.95)", 1 - p / 6); }
      c.restore();
      // floor edge
      c.fillStyle = lin(c, 0, 128, 0, 600, [[0, "#3a2414"], [1, "#120a06"]]); c.fillRect(-1300, 128, 2600, 600);
      c.fillStyle = "#e03a3e"; c.fillRect(-1300, 128, 2600, 6);
    });
    // jumbotron scoreboard
    layer(c, cam, W, H, 0.08, () => {
      const y = -255;
      c.strokeStyle = "#333a55"; c.lineWidth = 3; c.beginPath(); c.moveTo(-90, y - 80); c.lineTo(-60, y - 300); c.moveTo(90, y - 80); c.lineTo(60, y - 300); c.stroke();
      c.fillStyle = "#14161f"; rrect(c, -170, y - 80, 340, 150, 10); c.fill();
      c.fillStyle = "#1e2130"; c.fillRect(-160, y - 72, 320, 134);
      c.fillStyle = "#05060a"; c.fillRect(-150, y - 64, 300, 80);
      txt(c, "CHRIS", -82, y - 50, 15, "#fdb927", "center", FONT);
      txt(c, "YOU", 82, y - 50, 15, "#9fd8ff", "center", FONT);
      txt(c, "99", -82, y - 18, 34, "#ff3b30", "center");
      txt(c, "0", 82, y - 18, 34, "#ff3b30", "center");
      const secs = 59 - Math.floor(t / 60) % 60;
      txt(c, "4TH", 0, y - 48, 11, "#ddd", "center", FONT);
      txt(c, "0:" + String(secs).padStart(2, "0"), 0, y - 24, 18, "#ffe14a", "center");
      // LED ticker
      c.save(); c.beginPath(); c.rect(-150, y + 24, 300, 32); c.clip();
      c.fillStyle = "#0a0c14"; c.fillRect(-150, y + 24, 300, 32);
      const msg = "THE PROPHECY: ONLY IF, DESPITE EVERYTHING, ON THE COURT, IT'S STILL YOU   ★   ";
      c.font = `bold 16px ${FONT}`; const mw = c.measureText(msg).width;
      const off = (t * 1.2) % mw;
      c.fillStyle = "#ff9a1a"; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText(msg, 150 - off - mw, y + 40); c.fillText(msg, 150 - off, y + 40);
      c.restore();
      glow(c, 0, y - 10, 220, "rgba(255,140,60,.10)");
    });
    // hoops at both ends
    layer(c, cam, W, H, 0.3, () => {
      drawHoop(c, -640, -60, 1, 1.1);
      drawHoop(c, 640, -60, -1, 1.1);
    });
  }

  function courtPlatforms(c, st, g) {
    for (const P of g.platforms) {
      if (P.solid) {
        const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2;
        // underside: arena-bowl block
        c.fillStyle = lin(c, 0, P.y, 0, P.y + P.depth, [[0, "#26213f"], [1, "#0c0a18"]]);
        slabPath(c, P, 70, P.depth); c.fill();
        c.fillStyle = "#552583"; c.beginPath(); c.moveTo(P.x1 + 6, P.y + 26); c.lineTo(P.x2 - 6, P.y + 26); c.lineTo(P.x2 - 14, P.y + 46); c.lineTo(P.x1 + 14, P.y + 46); c.fill();
        txt(c, "THE  COURT", cx, P.y + 36, 13, "#fdb927", "center", FONT_BIG);
        c.fillStyle = "rgba(255,255,255,.06)";
        for (let i = 1; i < 6; i++) { const yy = P.y + 46 + i * 18; const ins = 14 + (yy - P.y) * 70 / P.depth; c.fillRect(P.x1 + ins, yy, w - ins * 2, 2); }
        // front edge of the floor
        c.fillStyle = lin(c, 0, P.y + 8, 0, P.y + 26, [[0, "#b5793f"], [1, "#6a4120"]]);
        c.fillRect(P.x1, P.y + 8, w, 18);
        // top face (hardwood)
        c.save();
        c.beginPath(); c.moveTo(P.x1 + 14, P.y - 16); c.lineTo(P.x2 - 14, P.y - 16); c.lineTo(P.x2, P.y + 8); c.lineTo(P.x1, P.y + 8); c.closePath();
        c.fillStyle = lin(c, 0, P.y - 16, 0, P.y + 8, [[0, "#c98f55"], [1, "#e4ae6e"]]); c.fill();
        c.clip();
        c.strokeStyle = "rgba(110,60,20,.25)"; c.lineWidth = 1;
        for (let x = P.x1; x < P.x2; x += 22) { c.beginPath(); c.moveTo(x, P.y - 16); c.lineTo(x + (x - cx) * 0.05, P.y + 8); c.stroke(); }
        for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(P.x1, P.y - 10 + k * 6); c.lineTo(P.x2, P.y - 10 + k * 6); c.stroke(); }
        // painted lines: centre circle, keys, sideline
        c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2;
        c.beginPath(); c.ellipse(cx, P.y - 4, 46, 9, 0, 0, TAU); c.stroke();
        c.beginPath(); c.moveTo(cx, P.y - 16); c.lineTo(cx, P.y + 8); c.stroke();
        c.fillStyle = "rgba(85,37,131,.75)";
        c.beginPath(); c.moveTo(P.x1 + 14, P.y - 13); c.lineTo(P.x1 + 92, P.y - 13); c.lineTo(P.x1 + 92, P.y + 5); c.lineTo(P.x1 + 4, P.y + 5); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(P.x2 - 14, P.y - 13); c.lineTo(P.x2 - 92, P.y - 13); c.lineTo(P.x2 - 92, P.y + 5); c.lineTo(P.x2 - 4, P.y + 5); c.fill(); c.stroke();
        c.beginPath(); c.ellipse(P.x1 + 92, P.y - 4, 10, 9, 0, -Math.PI / 2, Math.PI / 2); c.stroke();
        c.beginPath(); c.ellipse(P.x2 - 92, P.y - 4, 10, 9, 0, Math.PI / 2, Math.PI * 1.5); c.stroke();
        c.fillStyle = "rgba(255,240,200,.18)"; c.beginPath(); c.ellipse(cx, P.y - 4, 30, 5, 0, 0, TAU); c.fill();
        c.restore();
        c.strokeStyle = "#fdb927"; c.lineWidth = 2; c.beginPath(); c.moveTo(P.x1, P.y + 8); c.lineTo(P.x2, P.y + 8); c.stroke();
      } else {
        // glass backboard platforms
        const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2;
        c.fillStyle = "rgba(170,215,255,.22)"; rrect(c, P.x1, P.y - 3, w, 16, 3); c.fill();
        c.strokeStyle = "rgba(255,255,255,.85)"; c.lineWidth = 2; rrect(c, P.x1, P.y - 3, w, 16, 3); c.stroke();
        c.strokeStyle = "#ff6a1a"; c.lineWidth = 3; c.beginPath(); c.moveTo(P.x1 + 3, P.y - 2); c.lineTo(P.x2 - 3, P.y - 2); c.stroke();
        c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 1.5; c.strokeRect(cx - 18, P.y + 1, 36, 9);
        c.fillStyle = "rgba(255,255,255,.25)"; c.beginPath(); c.moveTo(P.x1 + 10, P.y + 12); c.lineTo(P.x1 + 24, P.y - 2); c.lineTo(P.x1 + 32, P.y - 2); c.lineTo(P.x1 + 18, P.y + 12); c.fill();
        glow(c, cx, P.y + 30, 50, "rgba(255,120,40,.10)");
      }
    }
  }

  const COURT = {
    id: "the-court", slug: "the-court", name: "The Court", tagline: "Where Chris must be beaten.",
    platforms: [
      { x1: -340, x2: 340, y: 0, solid: true, depth: 150 },
      { x1: -285, x2: -100, y: -136, pass: true },
      { x1: 100, x2: 285, y: -136, pass: true },
      { x1: -94, x2: 94, y: -272, pass: true },
    ],
    blast: { left: -1120, right: 1120, top: -1000, bottom: 600 },
    spawns: [{ x: -200, y: -10 }, { x: 200, y: -10 }, { x: -70, y: -10 }, { x: 70, y: -10 }],
    respawn: { x: 0, y: -360 },
    drawBg: courtBg,
    drawPlatforms: courtPlatforms,
  };
  COURT.thumb = makeThumb(COURT, { x: 0, y: -150, h: 560 });

  // =================================================================== 2. THE SHADOW REALM
  const srStars = table(31, 160, (r) => ({ x: r.range(-1200, 1200), y: r.range(-700, 700), s: r.range(0.6, 2), t: r.range(0, TAU), c: r() < 0.3 ? "#d7b6ff" : "#ffffff" }));
  const srUniverses = table(32, 9, (r, i) => ({
    x: r.range(-1300, 1300), y: r.range(-420, 260), r: r.range(28, 80), sp: r.range(0.04, 0.12) * (r() < 0.5 ? -1 : 1),
    kind: i % 3, hue: Math.floor(r.range(170, 330)), rot: r.range(0, TAU), rs: r.range(0.0008, 0.003) * (r() < 0.5 ? -1 : 1), f: r.range(0.06, 0.2),
  }));
  const galaxyPts = table(33, 220, (r) => { const arm = r.int(0, 2), d = Math.pow(r(), 0.7); return { a: arm * TAU / 3 + d * 4.2 + r.range(-0.25, 0.25), d, s: r.range(0.5, 1.6) }; });
  const srEyes = table(34, 7, (r) => ({ x: r.range(-900, 900), y: r.range(-380, 320), s: r.range(0.6, 1.4), off: r.int(0, 900), per: r.int(700, 1300) }));
  const shards = table(35, 9, (r) => ({ x: r.range(-380, 380), y: r.range(260, 420), s: r.range(10, 26), ph: r.range(0, TAU) }));

  function drawUniverse(c, u, t) {
    c.save(); c.translate(u.x, u.y);
    const rot = u.rot + t * u.rs;
    if (u.kind === 0) {
      // spiral galaxy
      c.rotate(rot); c.scale(1, 0.55);
      glow(c, 0, 0, u.r * 0.7, `hsla(${u.hue},90%,80%,.55)`);
      c.globalCompositeOperation = "lighter";
      for (const p of galaxyPts) { c.fillStyle = `hsla(${u.hue + p.d * 60},80%,${60 + 30 * (1 - p.d)}%,${0.7 - p.d * 0.4})`; c.fillRect(Math.cos(p.a) * p.d * u.r, Math.sin(p.a) * p.d * u.r, p.s, p.s); }
    } else if (u.kind === 1) {
      // a whole universe in a bubble
      c.fillStyle = radial(c, -u.r * 0.3, -u.r * 0.3, u.r * 0.1, u.r, [[0, `hsla(${u.hue},70%,35%,.55)`], [0.8, `hsla(${u.hue + 40},70%,18%,.45)`], [1, `hsla(${u.hue + 40},90%,70%,.35)`]]);
      c.beginPath(); c.arc(0, 0, u.r, 0, TAU); c.fill();
      c.strokeStyle = `hsla(${u.hue},90%,80%,.35)`; c.lineWidth = 2; c.stroke();
      c.rotate(rot); c.globalCompositeOperation = "lighter";
      for (let i = 0; i < 40; i++) { const p = galaxyPts[i * 5]; c.fillStyle = "rgba(255,255,255,.6)"; c.fillRect(Math.cos(p.a * 3) * p.d * u.r * 0.85, Math.sin(p.a * 3) * p.d * u.r * 0.85, 1.4, 1.4); }
      c.fillStyle = "rgba(255,255,255,.25)"; c.beginPath(); c.ellipse(-u.r * 0.4, -u.r * 0.45, u.r * 0.25, u.r * 0.12, -0.6, 0, TAU); c.fill();
    } else {
      // ringed exile-planet
      c.rotate(rot * 0.3);
      c.fillStyle = radial(c, -u.r * 0.25, -u.r * 0.25, 2, u.r * 0.6, [[0, `hsl(${u.hue},50%,45%)`], [1, `hsl(${u.hue},50%,12%)`]]);
      c.beginPath(); c.arc(0, 0, u.r * 0.55, 0, TAU); c.fill();
      c.strokeStyle = `hsla(${u.hue + 30},80%,75%,.5)`; c.lineWidth = 3; c.beginPath(); c.ellipse(0, 0, u.r, u.r * 0.25, 0, 0, TAU); c.stroke();
    }
    c.restore();
  }

  function drawClub(c, t) {
    // Club Shadowban: one nightclub room, adrift.
    c.save(); c.translate(0, Math.sin(t * 0.01) * 8); c.rotate(Math.sin(t * 0.004) * 0.05);
    c.fillStyle = "#1d1430"; c.beginPath(); c.moveTo(-60, -30); c.lineTo(10, -52); c.lineTo(80, -30); c.lineTo(10, -8); c.fill();     // roof
    c.fillStyle = "#130d22"; c.beginPath(); c.moveTo(-60, -30); c.lineTo(10, -8); c.lineTo(10, 50); c.lineTo(-60, 28); c.fill();      // left wall
    c.fillStyle = "#0d0918"; c.beginPath(); c.moveTo(10, -8); c.lineTo(80, -30); c.lineTo(80, 28); c.lineTo(10, 50); c.fill();       // right wall
    // door with light leaking out
    const fl = 0.6 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.031);
    c.fillStyle = `rgba(255,70,200,${0.5 + 0.4 * fl})`; c.beginPath(); c.moveTo(30, 0); c.lineTo(50, -6); c.lineTo(50, 34); c.lineTo(30, 40); c.fill();
    glow(c, 40, 22, 60, `rgba(255,60,200,${0.25 * fl})`);
    // neon sign
    c.save(); c.transform(1, 0.31, 0, 1, -54, 0);
    c.shadowColor = "#3cf"; c.shadowBlur = 8;
    txt(c, "CLUB", 30, -2, 10, `rgba(120,230,255,${0.6 + 0.4 * fl})`, "center", FONT_BIG);
    c.shadowColor = "#f4c"; txt(c, "SHADOWBAN", 30, 10, 7, `rgba(255,120,220,${0.5 + 0.5 * fl})`, "center", FONT_BIG);
    c.restore();
    // dust motes / outlines of feet: a lone disco sparkle
    c.globalCompositeOperation = "lighter";
    for (let i = 0; i < 3; i++) glow(c, 40 + Math.sin(t * 0.05 + i) * 6, 12 + i * 8, 4, "rgba(255,255,255,.8)", 0.5 + 0.5 * Math.sin(t * 0.2 + i * 2));
    c.restore();
  }

  function drawEye(c, e, t) {
    const p = (t + e.off) % e.per;
    // opens slowly, holds, blinks, closes
    let open = p < 60 ? p / 60 : p < 260 ? 1 : p < 320 ? 1 - (p - 260) / 60 : 0;
    if (p > 140 && p < 150) open = Math.abs(p - 145) / 5;
    if (open <= 0.02) return;
    c.save(); c.translate(e.x, e.y); c.scale(e.s, e.s);
    const look = Math.sin(t * 0.01 + e.off) * 3;
    for (const sx of [-14, 14]) {
      glow(c, sx, 0, 26, "rgba(170,40,255,.18)", open);
      c.fillStyle = `rgba(230,200,255,${0.75 * open})`;
      c.beginPath(); c.ellipse(sx, 0, 9, 4.5 * open, 0, 0, TAU); c.fill();
      c.fillStyle = `rgba(30,0,40,${open})`; c.beginPath(); c.ellipse(sx + look, 0, 2, 3.6 * open, 0, 0, TAU); c.fill();
    }
    c.restore();
  }

  function shadowBg(c, st, g, cam, W, H) {
    cam = camOr(cam);
    const t = g.frame || 0;
    c.fillStyle = "#04020a"; c.fillRect(0, 0, W, H);
    c.fillStyle = radial(c, W / 2, H * 0.45, 0, Math.max(W, H) * 0.75, [[0, "#2a0f4a"], [0.45, "#150828"], [1, "#04020a"]]);
    c.fillRect(0, 0, W, H);
    layer(c, cam, W, H, 0.02, () => {
      for (const s of srStars) { c.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.03 + s.t)); c.fillStyle = s.c; c.fillRect(s.x, s.y, s.s, s.s); }
      c.globalAlpha = 1;
      // nebula veils
      glow(c, -420, -180, 420, "rgba(120,30,180,.22)");
      glow(c, 480, 120, 380, "rgba(60,20,140,.25)");
      glow(c, 60, -380, 300, "rgba(200,40,160,.12)");
    });
    // drifting exiled universes
    for (const u of srUniverses) {
      layer(c, cam, W, H, u.f, () => {
        const span = 2800, x = ((u.x + t * u.sp) % span + span * 1.5) % span - span / 2;
        drawUniverse(c, Object.assign({}, u, { x }), t);
      });
    }
    layer(c, cam, W, H, 0.06, () => { c.save(); c.translate(-400, -190); c.scale(1.15, 1.15); drawClub(c, t); c.restore(); });
    layer(c, cam, W, H, 0.12, () => { for (const e of srEyes) drawEye(c, e, t); });
    // low void fog
    layer(c, cam, W, H, 0.25, () => {
      for (let i = 0; i < 5; i++) glow(c, -800 + i * 400 + Math.sin(t * 0.004 + i) * 80, 330, 320, "rgba(90,30,140,.20)");
    });
  }

  function shadowPlatforms(c, st, g) {
    const t = g.frame || 0;
    for (const P of g.platforms) {
      const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2, d = P.depth || 200;
      // hanging shards
      for (const s of shards) {
        const y = P.y + s.y - 120 + Math.sin(t * 0.02 + s.ph) * 6;
        c.fillStyle = "#1a0f2c"; c.beginPath(); c.moveTo(cx + s.x, y - s.s); c.lineTo(cx + s.x + s.s * 0.5, y); c.lineTo(cx + s.x, y + s.s * 1.4); c.lineTo(cx + s.x - s.s * 0.5, y); c.fill();
        c.strokeStyle = "rgba(190,110,255,.5)"; c.lineWidth = 1.2; c.stroke();
      }
      // underside: an inverted obsidian wedge
      c.fillStyle = lin(c, 0, P.y, 0, P.y + d, [[0, "#1d1233"], [1, "#07040e"]]);
      c.beginPath(); c.moveTo(P.x1, P.y + 10); c.lineTo(P.x2, P.y + 10); c.lineTo(P.x2 - 90, P.y + d * 0.55); c.lineTo(cx + 30, P.y + d); c.lineTo(cx - 30, P.y + d); c.lineTo(P.x1 + 90, P.y + d * 0.55); c.closePath(); c.fill();
      // glowing veins
      c.save(); c.clip();
      c.strokeStyle = `rgba(180,90,255,${0.45 + 0.2 * Math.sin(t * 0.04)})`; c.lineWidth = 2;
      c.shadowColor = "#b05cff"; c.shadowBlur = 10;
      c.beginPath();
      c.moveTo(cx - 300, P.y + 30); c.lineTo(cx - 180, P.y + 70); c.lineTo(cx - 60, P.y + 60); c.lineTo(cx, P.y + 140); c.lineTo(cx + 50, P.y + 70); c.lineTo(cx + 190, P.y + 80); c.lineTo(cx + 320, P.y + 30);
      c.moveTo(cx - 180, P.y + 70); c.lineTo(cx - 140, P.y + 110); c.moveTo(cx + 190, P.y + 80); c.lineTo(cx + 150, P.y + 120);
      c.stroke();
      c.restore();
      // front lip
      c.fillStyle = lin(c, 0, P.y + 4, 0, P.y + 14, [[0, "#3b2463"], [1, "#160c28"]]); c.fillRect(P.x1, P.y + 4, w, 10);
      // top face
      c.fillStyle = lin(c, 0, P.y - 14, 0, P.y + 4, [[0, "#140b22"], [1, "#2c1a4a"]]);
      c.beginPath(); c.moveTo(P.x1 + 12, P.y - 14); c.lineTo(P.x2 - 12, P.y - 14); c.lineTo(P.x2, P.y + 4); c.lineTo(P.x1, P.y + 4); c.closePath(); c.fill();
      c.strokeStyle = "rgba(200,140,255,.25)"; c.lineWidth = 1;
      for (let x = P.x1 + 60; x < P.x2 - 30; x += 70) { c.beginPath(); c.moveTo(x, P.y - 14); c.lineTo(x + (x - cx) * 0.04, P.y + 4); c.stroke(); }
      // edge glow line
      c.save(); c.shadowColor = "#c77dff"; c.shadowBlur = 12;
      c.strokeStyle = "#d9a8ff"; c.lineWidth = 2; c.beginPath(); c.moveTo(P.x1, P.y + 4); c.lineTo(P.x2, P.y + 4); c.stroke();
      c.restore();
      glow(c, cx, P.y + d + 10, 120, "rgba(150,60,255,.18)");
    }
  }

  const SHADOW = {
    id: "shadow-realm", slug: "shadow-realm", name: "The Shadow Realm", tagline: "Where light doesn't exist and the universes go.",
    platforms: [{ x1: -430, x2: 430, y: 0, solid: true, depth: 220 }],
    blast: { left: -1230, right: 1230, top: -950, bottom: 680 },
    spawns: [{ x: -250, y: -10 }, { x: 250, y: -10 }, { x: -90, y: -10 }, { x: 90, y: -10 }],
    respawn: { x: 0, y: -300 },
    drawBg: shadowBg,
    drawPlatforms: shadowPlatforms,
  };
  SHADOW.thumb = makeThumb(SHADOW, { x: 0, y: -110, h: 620, frame: 200 });

  // =================================================================== 3. THE VENDING MACHINE LABYRINTH
  const snackKinds = [
    { k: "bag", c: "#f2a20c", l: "#c0392b" }, { k: "bag", c: "#d7263d", l: "#fff" }, { k: "bag", c: "#1b98e0", l: "#ffe14a" },
    { k: "can", c: "#3fae2a", l: "#e8f5c8" }, { k: "can", c: "#c0c6d0", l: "#d7263d" }, { k: "bar", c: "#5b3a1e", l: "#ffcc00" },
    { k: "bar", c: "#7a1fa2", l: "#fff" }, { k: "bag", c: "#ff7a00", l: "#222" },
  ];
  const vmFar = table(41, 120, (r) => snackKinds[r.int(0, snackKinds.length - 1)]);
  const vmNear = table(42, 80, (r) => snackKinds[r.int(0, snackKinds.length - 1)]);

  function drawSnack(c, s, x, y, sc) {
    c.save(); c.translate(x, y); c.scale(sc, sc);
    if (s.k === "bag") {
      c.fillStyle = s.c; rrect(c, -14, -36, 28, 36, 4); c.fill();
      c.fillStyle = "rgba(255,255,255,.25)"; c.fillRect(-14, -36, 28, 4);
      c.fillStyle = s.l; c.beginPath(); c.ellipse(0, -18, 9, 6, 0, 0, TAU); c.fill();
    } else if (s.k === "can") {
      c.fillStyle = s.c; rrect(c, -9, -30, 18, 30, 3); c.fill();
      c.fillStyle = s.l; c.fillRect(-9, -20, 18, 8);
      c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(-6, -29, 3, 28);
    } else {
      c.fillStyle = s.c; rrect(c, -16, -14, 32, 14, 2); c.fill();
      c.fillStyle = s.l; c.fillRect(-9, -10, 18, 6);
    }
    c.restore();
  }
  function drawCoilSide(c, x1, x2, y, r, col, lw) {
    c.strokeStyle = col; c.lineWidth = lw;
    c.beginPath();
    for (let x = x1; x <= x2; x += 2) { const a = (x - x1) / 13 * Math.PI; const yy = y + Math.sin(a) * r; if (x === x1) c.moveTo(x, yy); else c.lineTo(x, yy); }
    c.stroke();
  }
  function shelfRows(c, kinds, x0, cols, rows, cw, rh, y0, sc, alpha, t, f) {
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * rh;
      // back light
      c.fillStyle = `rgba(150,200,255,${0.07 * alpha})`; c.fillRect(x0 - 10, y - rh + 14, cols * cw + 20, rh - 10);
      for (let k = 0; k < cols; k++) {
        const x = x0 + k * cw + cw / 2, s = kinds[i++ % kinds.length];
        c.globalAlpha = alpha;
        drawSnack(c, s, x, y - 6 * sc, sc);
        drawCoilSide(c, x - cw * 0.42, x + cw * 0.42, y - 3 * sc, 3 * sc, "rgba(200,210,225,.7)", 1.4 * sc);
        c.globalAlpha = 1;
        // price tag
        if (sc > 0.9) {
          c.fillStyle = "rgba(10,14,22,.9)"; c.fillRect(x - 14, y + 4, 28, 11);
          c.fillStyle = "#9fe870"; c.font = `bold 8px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText(String.fromCharCode(65 + r) + (k % 9 + 1) + " $1.25", x, y + 10);
        }
      }
      c.fillStyle = `rgba(170,180,200,${0.55 * alpha})`; c.fillRect(x0 - 10, y, cols * cw + 20, 4 * sc);
    }
  }

  function vendingBg(c, st, g, cam, W, H) {
    cam = camOr(cam);
    const t = g.frame || 0;
    screenGrad(c, W, H, [[0, "#070b14"], [0.6, "#0d1626"], [1, "#05070d"]]);
    // the far wall and the crack in the door
    layer(c, cam, W, H, 0.03, () => {
      c.save();
      const pts = [[420, -420], [432, -330], [418, -250], [436, -150], [424, -60], [440, 40], [428, 160], [438, 300]];
      c.globalCompositeOperation = "lighter";
      glow(c, 430, -60, 260, "rgba(255,240,190,.10)");
      c.strokeStyle = "rgba(255,245,210,.95)"; c.lineWidth = 3; c.shadowColor = "#fff2c0"; c.shadowBlur = 18;
      c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.stroke();
      c.restore();
      txt(c, "ENTER THROUGH THE CRACK", 430, 330, 10, "rgba(255,240,200,.25)", "center", FONT);
    });
    // far aisles
    layer(c, cam, W, H, 0.08, () => {
      shelfRows(c, vmFar, -1100, 34, 6, 64, 90, -300, 0.6, 0.35, t);
      c.fillStyle = "rgba(7,11,20,.45)"; c.fillRect(-1200, -420, 2400, 900);
    });
    // Mountain Dew pipes
    layer(c, cam, W, H, 0.14, () => {
      for (const [y, a] of [[-370, 0.7], [250, 0.55]]) {
        c.fillStyle = lin(c, 0, y - 12, 0, y + 12, [[0, "#1e5d16"], [0.4, "#6fe04a"], [1, "#143f0f"]]); c.globalAlpha = a;
        c.fillRect(-1300, y - 12, 2600, 24);
        for (let x = -1300; x < 1300; x += 260) { c.fillStyle = "#0f2d0b"; c.fillRect(x, y - 15, 16, 30); }
        c.globalAlpha = 1;
      }
      // dew flowing
      c.fillStyle = "rgba(200,255,120,.5)";
      for (let x = -1300 + (t * 2) % 80; x < 1300; x += 80) c.fillRect(x, -372, 18, 3);
    });
    // AISLE 3 sign
    layer(c, cam, W, H, 0.12, () => {
      const x = -260, y = -255 + Math.sin(t * 0.02) * 3;
      c.strokeStyle = "#556"; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 60, y - 110); c.lineTo(x - 60, y - 22); c.moveTo(x + 60, y - 110); c.lineTo(x + 60, y - 22); c.stroke();
      glow(c, x, y, 160, "rgba(60,255,140,.16)");
      c.fillStyle = "#0b3d22"; rrect(c, x - 96, y - 24, 192, 56, 6); c.fill();
      c.strokeStyle = "#5dff9c"; c.lineWidth = 3; rrect(c, x - 90, y - 18, 180, 44, 4); c.stroke();
      c.save(); c.shadowColor = "#5dff9c"; c.shadowBlur = 10;
      txt(c, "AISLE 3", x - 12, y + 4, 26, "#d9ffe8");
      c.fillStyle = "#d9ffe8"; c.beginPath(); c.moveTo(x + 62, y - 8); c.lineTo(x + 80, y + 4); c.lineTo(x + 62, y + 16); c.fill();
      c.restore();
      txt(c, "CALL OF DUTY HQ  →", x, y + 46, 9, "rgba(200,255,220,.45)", "center", FONT);
    });
    // near aisles, backlit
    layer(c, cam, W, H, 0.22, () => {
      shelfRows(c, vmNear, -1150, 26, 2, 92, 120, -160, 1.15, 0.5, t);
      c.fillStyle = "rgba(5,8,15,.45)"; c.fillRect(-1300, -320, 2600, 400);
      // LCD price/selection display
      c.fillStyle = "#0a0f0a"; rrect(c, 330, -330, 130, 40, 4); c.fill();
      c.fillStyle = "#9fe870"; c.font = `bold 18px "Courier New", monospace`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText((t >> 5) % 2 ? "B4  $1.25" : "INSERT $$", 395, -310);
    });
    // glass reflections (screen space)
    c.save(); c.globalCompositeOperation = "lighter";
    const sh = ((cam.x * 0.4) % W + W) % W;
    for (const [x0, w0] of [[0.1, 0.06], [0.18, 0.02], [0.62, 0.08], [0.74, 0.015]]) {
      const x = ((x0 * W - sh) % (W * 1.4) + W * 1.4) % (W * 1.4) - W * 0.2;
      c.fillStyle = "rgba(180,220,255,.035)";
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + w0 * W, 0); c.lineTo(x + w0 * W - H * 0.4, H); c.lineTo(x - H * 0.4, H); c.fill();
    }
    c.restore();
  }

  function vendingPlatforms(c, st, g) {
    const t = g.frame || 0;
    for (const P of g.platforms) {
      const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2;
      if (P.solid) {
        const d = P.depth;
        // machine block underneath
        c.fillStyle = lin(c, 0, P.y, 0, P.y + d, [[0, "#2b3240"], [1, "#0d1017"]]); slabPath(c, P, 40, d); c.fill();
        c.fillStyle = "rgba(0,0,0,.4)";
        for (let i = 0; i < 6; i++) c.fillRect(cx - 150 + i * 14, P.y + 70, 8, 40);
        // coin slot + return
        c.fillStyle = "#1a1f29"; rrect(c, cx + 80, P.y + 60, 60, 70, 6); c.fill();
        c.fillStyle = "#0a0c10"; c.fillRect(cx + 106, P.y + 70, 8, 22);
        glow(c, cx + 110, P.y + 80, 20, "rgba(255,200,60,.4)", 0.6 + 0.4 * Math.sin(t * 0.06));
        c.fillStyle = "#0a0c10"; rrect(c, cx + 92, P.y + 100, 36, 18, 4); c.fill();
        // front lip with labels
        c.fillStyle = lin(c, 0, P.y + 6, 0, P.y + 34, [[0, "#c9d0db"], [0.5, "#8b94a3"], [1, "#4b5260"]]); c.fillRect(P.x1, P.y + 6, w, 28);
        c.fillStyle = "#0a0f0a";
        const n = 6;
        for (let i = 0; i < n; i++) {
          const x = P.x1 + (i + 0.5) * w / n;
          c.fillStyle = "#0b100c"; c.fillRect(x - 22, P.y + 12, 44, 15);
          c.fillStyle = "#9fe870"; c.font = `bold 10px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("C" + (i + 1) + " $1.25", x, P.y + 20);
        }
        // top face: steel tray with coils
        c.beginPath(); c.moveTo(P.x1 + 10, P.y - 14); c.lineTo(P.x2 - 10, P.y - 14); c.lineTo(P.x2, P.y + 6); c.lineTo(P.x1, P.y + 6); c.closePath();
        c.fillStyle = lin(c, 0, P.y - 14, 0, P.y + 6, [[0, "#3a4252"], [1, "#6e7889"]]); c.fill();
        c.save(); c.clip();
        for (let x = P.x1 + 4; x < P.x2; x += 100) drawCoilSide(c, x, x + 92, P.y - 4, 5, "rgba(220,228,240,.55)", 2);
        c.restore();
        c.strokeStyle = "#dfe6f0"; c.lineWidth = 2; c.beginPath(); c.moveTo(P.x1, P.y + 6); c.lineTo(P.x2, P.y + 6); c.stroke();
      } else {
        // a spiral coil shelf
        c.fillStyle = lin(c, 0, P.y - 3, 0, P.y + 8, [[0, "#e6ebf2"], [1, "#7c8594"]]); rrect(c, P.x1, P.y - 3, w, 10, 3); c.fill();
        // coil hanging under (rotating helix)
        const ph = t * 0.12;
        c.lineWidth = 2.5;
        for (let x = P.x1 + 8; x < P.x2 - 8; x += 3) {
          const a = (x - P.x1) / 14 * Math.PI + ph;
          const back = Math.cos(a) < 0;
          c.strokeStyle = back ? "rgba(140,150,165,.8)" : "#eef2f8";
          c.beginPath(); c.moveTo(x, P.y + 18 + Math.sin(a) * 9); c.lineTo(x + 3, P.y + 18 + Math.sin(a + 0.67) * 9); c.stroke();
        }
        // a snack stuck in the coil (classic)
        drawSnack(c, snackKinds[(P.id || 0) ? 2 : 0], cx + 20, P.y + 34, 0.7);
        c.fillStyle = "#0b100c"; c.fillRect(cx - 24, P.y + 8, 30, 10);
        c.fillStyle = "#9fe870"; c.font = `bold 8px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(P.id ? "A3" : "B3", cx - 9, P.y + 13);
      }
    }
  }

  const VM_W = 150;
  function vmPos(i, frame) {
    const a = frame * TAU / 620;
    const s = i ? -1 : 1;
    return { x: s * (-205 + 125 * Math.sin(a)), y: -140 + s * 52 * Math.sin(2 * a) };
  }
  const VENDING = {
    id: "vending-machine-labyrinth", slug: "vending-machine-labyrinth", name: "The Vending Machine Labyrinth",
    tagline: "Enter through the crack in the door. Proceed to aisle 3.",
    platforms: [
      { x1: -300, x2: 300, y: 0, solid: true, depth: 160 },
      { x1: -280, x2: -130, y: -140, pass: true, id: 0, moving: true },
      { x1: 130, x2: 280, y: -140, pass: true, id: 1, moving: true },
    ],
    blast: { left: -1100, right: 1100, top: -950, bottom: 620 },
    spawns: [{ x: -190, y: -10 }, { x: 190, y: -10 }, { x: -70, y: -10 }, { x: 70, y: -10 }],
    respawn: { x: 0, y: -320 },
    init(st, g) {
      for (const P of g.platforms) if (P.moving) { const p = vmPos(P.id, g.frame || 0); placePlat(P, p.x, p.y, VM_W); P.dx = P.dy = 0; }
    },
    update(st, g) {
      for (const P of g.platforms) if (P.moving) { const p = vmPos(P.id, g.frame); placePlat(P, p.x, p.y, VM_W); }
    },
    drawBg: vendingBg,
    drawPlatforms: vendingPlatforms,
  };
  VENDING.thumb = makeThumb(VENDING, { x: 0, y: -140, h: 560, frame: 620 });

  // =================================================================== 4. THE STAIRWAY TO HEAVEN
  const STEP_N = 5, STEP_W = 112, STEP_TOP = -480, STEP_BOT = -70, STEP_SPEED = 0.38;
  const STEP_CYCLE = (STEP_BOT - STEP_TOP) / STEP_SPEED;    // frames for one step to travel top → bottom
  function stepPos(i, frame) {
    let s = (frame / STEP_CYCLE + i / STEP_N) % 1;
    const y = STEP_TOP + s * (STEP_BOT - STEP_TOP);
    const x = 215 * Math.sin(TAU * (s * 1.15 + 0.12));
    // grows in at the top, shrinks away (dropping riders) before wrapping
    const w = STEP_W * smooth(s / 0.07) * smooth((1 - s) / 0.1);
    return { x, y, w, s };
  }
  const clouds = table(51, 18, (r) => ({ x: r.range(-1200, 1200), y: r.range(-560, -180), w: r.range(90, 240), sp: r.range(0.05, 0.2) }));
  const embers = table(52, 50, (r) => ({ x: r.range(-900, 900), y0: r.range(0, 700), sp: r.range(0.3, 0.9), s: r.range(1, 3), ph: r.range(0, TAU) }));

  function stairBg(c, st, g, cam, W, H) {
    cam = camOr(cam);
    const t = g.frame || 0;
    c.fillStyle = "#2a0606"; c.fillRect(0, 0, W, H);
    // heaven above, the vault below: one tall gradient with real parallax
    layer(c, cam, W, H, 0.35, (hw) => {
      c.fillStyle = lin(c, 0, -900, 0, 900, [[0, "#fffbe8"], [0.22, "#ffe9a8"], [0.4, "#f6b860"], [0.55, "#c4583a"], [0.7, "#6e1a1a"], [0.85, "#2a0606"], [1, "#100202"]]);
      c.fillRect(-hw * 2 - 600, -1400, hw * 4 + 1200, 2800);
    });
    // god rays from the top
    layer(c, cam, W, H, 0.2, () => {
      c.save(); c.globalCompositeOperation = "lighter"; c.translate(0, -620);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI + Math.sin(t * 0.003 + i) * 0.04;
        c.fillStyle = `rgba(255,248,210,${0.05 + 0.03 * Math.sin(t * 0.01 + i * 1.3)})`;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a - 0.04) * 1400, Math.sin(a - 0.04) * 1400); c.lineTo(Math.cos(a + 0.04) * 1400, Math.sin(a + 0.04) * 1400); c.fill();
      }
      glow(c, 0, 0, 300, "rgba(255,255,230,.8)");
      c.restore();
    });
    // clouds (upper)
    layer(c, cam, W, H, 0.18, () => {
      for (const cl of clouds) {
        const span = 2600, x = ((cl.x + t * cl.sp) % span + span * 1.5) % span - span / 2;
        c.fillStyle = "rgba(255,250,235,.55)";
        for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(x + (k - 1.5) * cl.w * 0.3, cl.y - (k % 2) * cl.w * 0.12, cl.w * 0.32, cl.w * 0.16, 0, 0, TAU); c.fill(); }
      }
    });
    // the far spiral staircase, going down, and the vault
    layer(c, cam, W, H, 0.28, () => {
      const off = (t * 0.25) % 40;
      for (let k = -2; k < 30; k++) {
        const y = -520 + k * 40 + off, s = (y + 520) / 1250;
        const x = Math.sin(y * 0.006) * 240;
        const dark = clamp(s, 0, 1);
        c.fillStyle = `rgba(${Math.round(255 - 160 * dark)},${Math.round(235 - 200 * dark)},${Math.round(200 - 180 * dark)},${0.22 - dark * 0.1})`;
        c.fillRect(x - 30, y, 60, 5);
        c.fillStyle = `rgba(40,0,0,${0.08 + dark * 0.12})`; c.fillRect(x - 30, y + 5, 60, 9);
      }
      // the vault
      const vx = 0, vy = 700;
      glow(c, vx, vy, 360, "rgba(255,40,20,.25)");
      c.fillStyle = "#3b3f48"; c.beginPath(); c.arc(vx, vy, 170, 0, TAU); c.fill();
      c.strokeStyle = "#20232a"; c.lineWidth = 16; c.stroke();
      c.strokeStyle = "#6b7280"; c.lineWidth = 6; c.beginPath(); c.arc(vx, vy, 120, 0, TAU); c.stroke();
      c.save(); c.translate(vx, vy); c.rotate(t * 0.002);
      for (let i = 0; i < 6; i++) { c.rotate(TAU / 6); c.fillStyle = "#8a919c"; c.fillRect(-6, -110, 12, 70); }
      c.fillStyle = "#9aa1ab"; c.beginPath(); c.arc(0, 0, 30, 0, TAU); c.fill();
      c.restore();
      // the relic: the 3 year contract
      const ry = vy - 230 + Math.sin(t * 0.03) * 6;
      glow(c, vx, ry, 90, "rgba(255,60,40,.55)");
      c.save(); c.translate(vx, ry); c.rotate(Math.sin(t * 0.02) * 0.08);
      c.fillStyle = "#fff4e0"; c.fillRect(-26, -34, 52, 68);
      c.fillStyle = "#cd040b"; c.fillRect(-26, -34, 52, 14);
      txt(c, "VERIZON", 0, -27, 8, "#fff", "center", FONT);
      c.fillStyle = "#888"; for (let i = 0; i < 6; i++) c.fillRect(-18, -12 + i * 7, i === 5 ? 20 : 36, 2);
      c.restore();
      txt(c, "THE VAULT", vx, vy + 210, 18, "rgba(255,120,90,.5)");
    });
    // embers rising from below
    layer(c, cam, W, H, 0.4, () => {
      c.save(); c.globalCompositeOperation = "lighter";
      for (const e of embers) {
        const y = 650 - ((e.y0 + t * e.sp) % 700), a = clamp((y - 0) / 400, 0, 1);
        c.fillStyle = `rgba(255,${120 + Math.round(80 * Math.sin(t * 0.1 + e.ph))},40,${0.6 * a})`;
        c.fillRect(e.x + Math.sin(t * 0.02 + e.ph) * 14, y, e.s, e.s);
      }
      c.restore();
    });
  }

  function stairMid(c, st, g) {
    // the ironic sign
    const x = -232, y = 0;
    c.fillStyle = "#6b4a2a"; c.fillRect(x - 3, y - 70, 6, 70);
    c.save(); c.translate(x, y - 66); c.rotate(-0.04);
    c.fillStyle = "#f4e6c4"; rrect(c, -52, -14, 104, 28, 4); c.fill();
    c.strokeStyle = "#b8893a"; c.lineWidth = 2; c.stroke();
    txt(c, "HEAVEN ↓", 0, 1, 14, "#7a1a1a", "center", FONT_BIG);
    c.restore();
  }

  function marbleStep(c, x1, x2, y, a, warm) {
    const w = x2 - x1;
    if (w <= 2) return;
    c.save(); c.globalAlpha *= a;
    c.fillStyle = "rgba(0,0,0,.18)"; c.beginPath(); c.ellipse((x1 + x2) / 2, y + 30, w * 0.45, 5, 0, 0, TAU); c.fill();
    c.fillStyle = lin(c, 0, y - 8, 0, y + 16, [[0, "#fffaf0"], [0.45, warm], [1, "#a99d8a"]]);
    c.beginPath(); c.moveTo(x1 + 6, y - 8); c.lineTo(x2 - 6, y - 8); c.lineTo(x2, y + 2); c.lineTo(x2, y + 16); c.lineTo(x1, y + 16); c.lineTo(x1, y + 2); c.closePath(); c.fill();
    c.strokeStyle = "#e5b84a"; c.lineWidth = 3; c.beginPath(); c.moveTo(x1, y + 2); c.lineTo(x2, y + 2); c.stroke();
    c.strokeStyle = "rgba(150,140,125,.4)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x1 + w * 0.2, y + 6); c.quadraticCurveTo(x1 + w * 0.4, y + 14, x1 + w * 0.65, y + 9); c.stroke();
    c.restore();
  }

  function stairPlatforms(c, st, g) {
    for (const P of g.platforms) {
      if (P.solid) {
        const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2, d = P.depth;
        // underside: marble crumbling into red rock
        c.fillStyle = lin(c, 0, P.y, 0, P.y + d, [[0, "#d9cdb8"], [0.35, "#9a5a44"], [1, "#3a0a08"]]);
        c.beginPath(); c.moveTo(P.x1, P.y + 10);
        c.lineTo(P.x2, P.y + 10); c.lineTo(P.x2 - 20, P.y + 60); c.lineTo(P.x2 - 60, P.y + 90); c.lineTo(P.x2 - 70, P.y + 130);
        c.lineTo(cx + 80, P.y + d - 20); c.lineTo(cx + 20, P.y + d); c.lineTo(cx - 40, P.y + d - 10); c.lineTo(cx - 110, P.y + d - 40);
        c.lineTo(P.x1 + 60, P.y + 110); c.lineTo(P.x1 + 24, P.y + 70); c.closePath(); c.fill();
        // columns carved in the front
        c.fillStyle = "rgba(255,255,255,.18)";
        for (let i = 0; i < 7; i++) { const x = P.x1 + 40 + i * (w - 80) / 6; c.fillRect(x - 7, P.y + 22, 14, 34); }
        c.fillStyle = "#c79a2e"; c.fillRect(P.x1, P.y + 14, w, 6);
        // front face
        c.fillStyle = lin(c, 0, P.y + 4, 0, P.y + 16, [[0, "#f3ead8"], [1, "#b9ab92"]]); c.fillRect(P.x1, P.y + 4, w, 12);
        // top face (marble)
        c.beginPath(); c.moveTo(P.x1 + 12, P.y - 14); c.lineTo(P.x2 - 12, P.y - 14); c.lineTo(P.x2, P.y + 4); c.lineTo(P.x1, P.y + 4); c.closePath();
        c.fillStyle = lin(c, 0, P.y - 14, 0, P.y + 4, [[0, "#efe6d4"], [1, "#fffaf0"]]); c.fill();
        c.save(); c.clip();
        c.strokeStyle = "rgba(160,150,135,.35)"; c.lineWidth = 1;
        for (let x = P.x1 + 50; x < P.x2; x += 64) { c.beginPath(); c.moveTo(x, P.y - 14); c.lineTo(x + (x - cx) * 0.05, P.y + 4); c.stroke(); }
        c.beginPath(); c.moveTo(P.x1 + 80, P.y - 8); c.quadraticCurveTo(cx - 40, P.y - 2, cx + 30, P.y - 10); c.stroke();
        c.restore();
        c.strokeStyle = "#e5b84a"; c.lineWidth = 3; c.beginPath(); c.moveTo(P.x1, P.y + 4); c.lineTo(P.x2, P.y + 4); c.stroke();
      } else if (P.step) {
        const s = P._s || 0;
        const warm = `rgb(${Math.round(245 - 40 * s)},${Math.round(232 - 90 * s)},${Math.round(205 - 120 * s)})`;
        const cx = P._cx, hw = P._w / 2;
        if (P._w > 2) {
          glow(c, cx, P.y + 4, 80, `rgba(255,${Math.round(230 - 150 * s)},120,.18)`);
          marbleStep(c, cx - hw, cx + hw, P.y, 1, warm);
        }
      }
    }
  }

  const STAIR_PLATS = [{ x1: -260, x2: 260, y: 0, solid: true, depth: 170 }];
  for (let i = 0; i < STEP_N; i++) STAIR_PLATS.push({ x1: -50, x2: 50, y: -200, pass: true, step: true, idx: i });
  const STAIR = {
    id: "stairway-to-heaven", slug: "stairway-to-heaven", name: "The Stairway to Heaven", tagline: "It goes down, actually.",
    platforms: STAIR_PLATS,
    blast: { left: -1080, right: 1080, top: -1000, bottom: 620 },
    spawns: [{ x: -170, y: -10 }, { x: 170, y: -10 }, { x: -60, y: -10 }, { x: 60, y: -10 }],
    respawn: { x: 0, y: -330 },
    init(st, g) { for (const P of g.platforms) if (P.step) { stairPlace(P, g.frame || 0); P.dx = P.dy = 0; } },
    update(st, g) { for (const P of g.platforms) if (P.step) stairPlace(P, g.frame); },
    drawBg: stairBg,
    drawMid: stairMid,
    drawPlatforms: stairPlatforms,
  };
  function stairPlace(P, frame) {
    const p = stepPos(P.idx, frame);
    const ocx = P._cx != null ? P._cx : p.x, oy = P.y;
    const wrapped = P._s != null && p.s < P._s;   // jumped back to the top this frame
    P._cx = p.x; P._w = p.w; P._s = p.s; P.y = p.y;
    if (p.w < 14) { P.x1 = p.x + 20; P.x2 = p.x - 20; }        // inverted = nobody stands on it
    else { P.x1 = p.x - p.w / 2; P.x2 = p.x + p.w / 2; }
    P.dx = wrapped ? 0 : p.x - ocx; P.dy = wrapped ? 0 : p.y - oy;
  }
  STAIR.thumb = makeThumb(STAIR, { x: 0, y: -190, h: 600, frame: 300 });

  // =================================================================== 5. THE 6 7 CASINO
  // Slot symbols: 0 "6", 1 "7", 2 cherry, 3 BAR, 4 oil drop, 5 chip
  const SYMS = 6, SPIN_FIRST = 420, SPIN_EVERY = 960, REEL_STOP = [80, 100, 120, 140];
  const JACKPOT = [0, 1, 0, 1];   // 6 7 6 7
  const WARN = 80, RAIN = 240;
  const chipCols = ["#d7263d", "#1b6fe0", "#1fa84a", "#111111", "#7a1fa2"];

  function drawSym(c, s, x, y, k) {
    c.save(); c.translate(x, y); c.scale(k, k);
    if (s === 0 || s === 1) txt(c, s ? "7" : "6", 0, 2, 44, s ? "#e3121b" : "#1b4fd8", "center", FONT_BIG, "#2a1a00");
    else if (s === 2) {
      c.strokeStyle = "#2b7a1f"; c.lineWidth = 3; c.beginPath(); c.moveTo(-8, -6); c.quadraticCurveTo(0, -24, 10, -22); c.moveTo(8, -4); c.quadraticCurveTo(6, -18, 10, -22); c.stroke();
      c.fillStyle = "#d7101e"; c.beginPath(); c.arc(-9, 6, 10, 0, TAU); c.arc(9, 8, 10, 0, TAU); c.fill();
      c.fillStyle = "rgba(255,255,255,.6)"; c.beginPath(); c.arc(-12, 3, 3, 0, TAU); c.fill();
    } else if (s === 3) {
      c.fillStyle = "#111"; rrect(c, -24, -12, 48, 24, 3); c.fill();
      txt(c, "BAR", 0, 1, 15, "#ffd84a", "center", FONT_BIG);
    } else if (s === 4) {
      c.fillStyle = "#14110d"; c.beginPath(); c.moveTo(0, -22); c.quadraticCurveTo(18, 2, 14, 10); c.arc(0, 8, 14, 0.15, Math.PI - 0.15); c.quadraticCurveTo(-18, 2, 0, -22); c.fill();
      c.fillStyle = "rgba(255,255,255,.45)"; c.beginPath(); c.ellipse(-5, 6, 3, 6, 0.3, 0, TAU); c.fill();
    } else {
      drawChip(c, 0, 0, 16, 0, "#1fa84a");
    }
    c.restore();
  }
  function drawChip(c, x, y, r, rot, col) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    c.strokeStyle = "#fff"; c.lineWidth = r * 0.28; c.setLineDash([r * 0.45, r * 0.45]);
    c.beginPath(); c.arc(0, 0, r * 0.84, 0, TAU); c.stroke(); c.setLineDash([]);
    c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, r * 0.55, 0, TAU); c.stroke();
    c.fillStyle = "#fff"; c.font = `900 ${Math.round(r * 0.55)}px ${FONT_BIG}`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("67", 0, 1);
    c.restore();
  }

  function slotSym(sl, i, frame) {
    // what reel i shows (and the scroll offset) at this frame
    if (sl.spinStart < 0) return { s: sl.reels[i], off: 0 };
    const el = frame - sl.spinStart;
    if (el >= REEL_STOP[i]) {
      const since = el - REEL_STOP[i];
      return { s: sl.reels[i], off: since < 8 ? Math.sin(since / 8 * Math.PI) * -0.25 : 0 };
    }
    const pos = el * (0.45 - 0.0) + i * 1.7;
    return { s: Math.floor(pos) % SYMS, off: pos % 1, spinning: true };
  }

  function casinoUpdate(st, g) {
    const sl = g.state.slot;
    if (!sl) return;
    if (g.frame === sl.next) {
      sl.spinStart = g.frame;
      sl.jackpot = g.rng() < 0.45;
      if (sl.jackpot) sl.reels = JACKPOT.slice();
      else {
        do { sl.reels = [0, 1, 2, 3].map(() => Math.floor(g.rng() * SYMS)); } while (sl.reels.join() === JACKPOT.join());
      }
      sl.next = g.frame + SPIN_EVERY;
      const done = g.frame + REEL_STOP[3];
      sl.result = done;
      if (sl.jackpot) { sl.warnStart = done; sl.rainStart = done + WARN; sl.rainEnd = done + WARN + RAIN; }
    }
    if (sl.jackpot && g.frame >= sl.rainStart && g.frame < sl.rainEnd && (g.frame - sl.rainStart) % 7 === 0) {
      const x = g.rng.range(-560, 560);
      const col = Math.floor(g.rng() * chipCols.length);
      g.spawn({
        owner: null, chip: true, x, y: -820, vx: g.rng.range(-0.5, 0.5), vy: 2.5, gravity: 0.11, r: 13,
        dmg: 3, angle: 70, bkb: 30, kbg: 30, life: 300, solid: true, bounces: 1, bounce: 0.35, col, spin: g.rng.range(-0.2, 0.2),
        knockDir: (p, T) => (T.x >= p.x ? 1 : -1),
        onBounce: (p) => { p.harmless = true; p.life = Math.min(p.life, 24); },
        draw: (c, p, gg) => { c.save(); c.globalAlpha = p.harmless ? Math.min(1, p.life / 24) : 1; c.translate(p.x, p.y); c.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(p.t * 0.15))); drawChip(c, 0, 0, p.r, p.t * p.spin, chipCols[p.col]); c.restore(); },
      });
    }
  }

  function casinoBg(c, st, g, cam, W, H) {
    cam = camOr(cam);
    const t = g.frame || 0;
    const sl = g.state.slot || { reels: JACKPOT, spinStart: -1 };
    screenGrad(c, W, H, [[0, "#12062b"], [0.45, "#3d1150"], [0.75, "#a4385b"], [1, "#f29e4c"]]);
    // stars
    layer(c, cam, W, H, 0.01, () => { c.fillStyle = "rgba(255,255,255,.6)"; for (const s of srStars.slice(0, 60)) if (s.y < -100) c.fillRect(s.x, s.y, s.s, s.s); });
    // oil derricks & pumpjacks on the horizon
    layer(c, cam, W, H, 0.06, () => {
      c.fillStyle = "#1a0b24";
      c.fillRect(-1400, 150, 2800, 500);
      c.strokeStyle = "#1a0b24"; c.lineWidth = 3;
      for (const [x, h] of [[-820, 170], [-560, 120], [600, 190], [900, 140], [-1100, 150], [1150, 120]]) {
        c.beginPath(); c.moveTo(x - h * 0.22, 152); c.lineTo(x, 152 - h); c.lineTo(x + h * 0.22, 152);
        for (let k = 1; k < 5; k++) { const yy = 152 - h * k / 5, ww = h * 0.22 * (1 - k / 5); c.moveTo(x - ww, yy); c.lineTo(x + ww, yy - h / 5); c.moveTo(x + ww, yy); c.lineTo(x - ww, yy - h / 5); }
        c.stroke();
        // gas flare
        glow(c, x, 140 - h, 22, "rgba(255,170,60,.8)", 0.7 + 0.3 * Math.sin(t * 0.3 + x));
      }
      for (const [x, ph] of [[-330, 0], [350, 1.6], [760, 3]]) {
        const a = Math.sin(t * 0.035 + ph) * 0.35;
        c.fillStyle = "#1a0b24"; c.fillRect(x - 4, 110, 8, 42);
        c.save(); c.translate(x, 110); c.rotate(a); c.fillRect(-60, -5, 100, 10); c.beginPath(); c.arc(-60, 0, 13, 0, TAU); c.fill(); c.restore();
        c.fillRect(x - 64, 110 + Math.sin(a) * -60, 4, 42 - Math.sin(a) * -60);
      }
    });
    // the casino towers: taller than the wideness of the tall
    layer(c, cam, W, H, 0.12, () => {
      for (const [x, w, h] of [[-470, 150, 1200], [520, 120, 1000]]) {
        c.fillStyle = lin(c, x - w / 2, 0, x + w / 2, 0, [[0, "#c9b48e"], [1, "#8f7a5a"]]);
        c.fillRect(x - w / 2, 150 - h, w, h);
        c.fillStyle = "rgba(90,60,30,.25)"; for (let y = 150 - h; y < 150; y += 10) c.fillRect(x - w / 2, y, w, 1);
        for (let y = 150 - h + 30; y < 130; y += 34) for (let k = 0; k < 4; k++) {
          const lit = ((y * 7 + k * 13 + (t >> 6)) % 11) > 3;
          c.fillStyle = lit ? "rgba(255,214,120,.85)" : "rgba(40,20,30,.7)";
          c.fillRect(x - w / 2 + 12 + k * (w - 24) / 4, y, (w - 24) / 4 - 8, 16);
        }
      }
      // vertical neon "6 7" on the left tower
      c.save(); c.shadowColor = "#ff3df2"; c.shadowBlur = 16;
      const on = (t >> 4) % 6 !== 0;
      txt(c, "6", -470, -420, 70, on ? "#ff7af5" : "#7a2a73", "center", FONT_BIG);
      txt(c, "7", -470, -340, 70, on ? "#ff7af5" : "#7a2a73", "center", FONT_BIG);
      c.shadowColor = "#3df2ff"; txt(c, "CASINO", 520, -380, 30, "#9af7ff", "center", FONT_BIG);
      c.restore();
    });
    // giant slot machine
    layer(c, cam, W, H, 0.3, () => {
      c.save(); c.translate(0, -105); c.scale(0.62, 0.62);
      const X = 0, Y = -40;
      const jackFlash = sl.jackpot && sl.result != null && t >= sl.result && t < (sl.rainEnd || 0);
      glow(c, X, Y, 420, jackFlash && (t >> 3) % 2 ? "rgba(255,220,80,.35)" : "rgba(255,80,160,.18)");
      // cabinet
      c.fillStyle = lin(c, X - 250, 0, X + 250, 0, [[0, "#4a0810"], [0.5, "#8e1222"], [1, "#4a0810"]]);
      rrect(c, X - 250, Y - 200, 500, 470, 30); c.fill();
      c.strokeStyle = "#e5b84a"; c.lineWidth = 8; c.stroke();
      // marquee with chasing bulbs
      c.fillStyle = "#2a0710"; rrect(c, X - 210, Y - 180, 420, 90, 14); c.fill();
      for (let i = 0; i < 26; i++) {
        const bx = X - 200 + (i % 13) * 33.3, by = i < 13 ? Y - 172 : Y - 98;
        const on = ((i + (t >> 3)) % 4 === 0) || jackFlash;
        c.fillStyle = on ? "#fff3a0" : "#7a5a20"; c.beginPath(); c.arc(bx, by, 4, 0, TAU); c.fill();
      }
      c.save(); c.shadowColor = "#ffd84a"; c.shadowBlur = 14;
      txt(c, jackFlash ? "JACKPOT!" : "6 7 SLOTS", X, Y - 135, 40, jackFlash && (t >> 2) % 2 ? "#fff" : "#ffd84a", "center", FONT_BIG, "#5a1000");
      c.restore();
      // reels
      c.fillStyle = "#1a0408"; rrect(c, X - 220, Y - 70, 440, 150, 12); c.fill();
      for (let i = 0; i < 4; i++) {
        const rx = X - 165 + i * 110, ry = Y + 5;
        c.save(); rrect(c, rx - 48, ry - 66, 96, 132, 8); c.clip();
        c.fillStyle = lin(c, 0, ry - 66, 0, ry + 66, [[0, "#9a9a9a"], [0.25, "#fff"], [0.75, "#fff"], [1, "#9a9a9a"]]); c.fillRect(rx - 48, ry - 66, 96, 132);
        const r = slotSym(sl, i, t);
        for (let k = -1; k <= 1; k++) {
          const s = ((r.s + k) % SYMS + SYMS) % SYMS;
          drawSym(c, s, rx, ry + (k + r.off) * 62 * (r.spinning ? 1 : 1), 1);
        }
        if (r.spinning) { c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(rx - 48, ry - 66, 96, 132); }
        c.fillStyle = lin(c, 0, ry - 66, 0, ry + 66, [[0, "rgba(0,0,0,.45)"], [0.3, "rgba(0,0,0,0)"], [0.7, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,.45)"]]); c.fillRect(rx - 48, ry - 66, 96, 132);
        c.restore();
      }
      c.strokeStyle = jackFlash ? "#fff36a" : "rgba(255,80,80,.7)"; c.lineWidth = 3; c.beginPath(); c.moveTo(X - 220, Y + 5); c.lineTo(X + 220, Y + 5); c.stroke();
      // lever (pulled when a spin starts)
      const pull = sl.spinStart >= 0 ? clamp(1 - Math.abs(t - sl.spinStart - 10) / 12, 0, 1) : 0;
      c.strokeStyle = "#c9ccd6"; c.lineWidth = 10; c.lineCap = "round";
      c.beginPath(); c.moveTo(X + 262, Y + 40); c.lineTo(X + 300, Y + 40); c.lineTo(X + 300, Y - 60 + pull * 130); c.stroke();
      c.fillStyle = "#e3121b"; c.beginPath(); c.arc(X + 300, Y - 70 + pull * 130, 20, 0, TAU); c.fill();
      // coin tray
      c.fillStyle = "#e5b84a"; rrect(c, X - 140, Y + 200, 280, 30, 8); c.fill();
      c.fillStyle = "#3a0a10"; rrect(c, X - 120, Y + 120, 240, 60, 6); c.fill();
      txt(c, "INSERT OIL", X, Y + 150, 18, "#e5b84a", "center", FONT_BIG);
      c.restore();
    });
  }

  function casinoPlatforms(c, st, g) {
    const t = g.frame || 0;
    for (const P of g.platforms) {
      const w = P.x2 - P.x1, cx = (P.x1 + P.x2) / 2;
      if (P.solid) {
        const d = P.depth;
        // velvet base with gold trim
        c.fillStyle = lin(c, 0, P.y, 0, P.y + d, [[0, "#5a0c1a"], [1, "#1a0308"]]); slabPath(c, P, 60, d); c.fill();
        c.strokeStyle = "#e5b84a"; c.lineWidth = 3;
        c.beginPath(); c.moveTo(P.x1 + 22, P.y + 50); c.lineTo(P.x2 - 22, P.y + 50); c.stroke();
        txt(c, "THE 6 7 CASINO", cx, P.y + 78, 18, "#e5b84a", "center", FONT_BIG);
        // marquee bulbs on the front
        for (let i = 0; i < 22; i++) {
          const x = P.x1 + 20 + i * (w - 40) / 21, on = (i + (t >> 3)) % 3 === 0;
          c.fillStyle = on ? "#fff3a0" : "#8a6a28"; c.beginPath(); c.arc(x, P.y + 40, 3.5, 0, TAU); c.fill();
          if (on) glow(c, x, P.y + 40, 10, "rgba(255,230,120,.6)");
        }
        // padded wooden rail
        c.fillStyle = lin(c, 0, P.y + 4, 0, P.y + 30, [[0, "#6b3a1c"], [0.5, "#a0602e"], [1, "#4a250f"]]);
        rrect(c, P.x1 - 4, P.y + 4, w + 8, 26, 10); c.fill();
        c.strokeStyle = "#e5b84a"; c.lineWidth = 2; c.beginPath(); c.moveTo(P.x1, P.y + 28); c.lineTo(P.x2, P.y + 28); c.stroke();
        // green felt top
        c.beginPath(); c.moveTo(P.x1 + 14, P.y - 16); c.lineTo(P.x2 - 14, P.y - 16); c.lineTo(P.x2, P.y + 6); c.lineTo(P.x1, P.y + 6); c.closePath();
        c.fillStyle = lin(c, 0, P.y - 16, 0, P.y + 6, [[0, "#0d5a2e"], [1, "#16804a"]]); c.fill();
        c.save(); c.clip();
        c.strokeStyle = "rgba(255,240,180,.55)"; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(cx, P.y - 5, w * 0.36, 9, 0, 0, TAU); c.stroke();
        for (const k of [-2, -1, 0, 1, 2]) { c.strokeRect(cx + k * 70 - 18, P.y - 11, 36, 11); }
        txt(c, "6 7", cx, P.y - 5, 10, "rgba(255,240,180,.7)", "center", FONT_BIG);
        c.restore();
        // chip stacks sitting on the rail ends
        for (const [x, n, col] of [[P.x1 + 26, 5, 0], [P.x2 - 30, 7, 1], [P.x2 - 52, 3, 3]]) {
          for (let k = 0; k < n; k++) { c.fillStyle = chipCols[col]; c.beginPath(); c.ellipse(x, P.y + 2 - k * 3, 9, 3.5, 0, 0, TAU); c.fill(); c.strokeStyle = "rgba(255,255,255,.6)"; c.lineWidth = 1; c.stroke(); }
        }
      } else {
        // floating gold tray with chips stacked underneath
        for (let i = 0; i < 6; i++) {
          const x = P.x1 + 16 + i * (w - 32) / 5, n = 3 + ((i * 7) % 4);
          for (let k = 0; k < n; k++) { c.fillStyle = chipCols[(i + k) % chipCols.length]; c.beginPath(); c.ellipse(x, P.y + 12 + k * 4, 10, 3.5, 0, 0, TAU); c.fill(); }
        }
        c.fillStyle = lin(c, 0, P.y - 3, 0, P.y + 9, [[0, "#ffe9a0"], [0.5, "#e5b84a"], [1, "#8a6420"]]);
        rrect(c, P.x1, P.y - 3, w, 12, 5); c.fill();
        c.fillStyle = "rgba(255,255,255,.5)"; c.fillRect(P.x1 + 8, P.y - 2, w - 16, 2);
        glow(c, cx, P.y + 20, 70, "rgba(255,80,200,.15)");
      }
    }
    // telegraph: shadows under falling chips
    for (const p of g.projectiles) {
      if (!p.chip || p.harmless) continue;
      let top = null;
      for (const P of g.platforms) if (p.x >= P.x1 && p.x <= P.x2 && P.y > p.y && (top === null || P.y < top)) top = P.y;
      if (top === null) continue;
      const k = clamp(1 - (top - p.y) / 800, 0.15, 1);
      c.fillStyle = `rgba(0,0,0,${0.15 + 0.35 * k})`; c.beginPath(); c.ellipse(p.x, top - 1, 6 + 10 * k, 3 + 2 * k, 0, 0, TAU); c.fill();
      c.strokeStyle = `rgba(255,60,60,${0.5 * k})`; c.lineWidth = 2; c.beginPath(); c.ellipse(p.x, top - 1, 8 + 12 * k, 4 + 2 * k, 0, 0, TAU); c.stroke();
    }
  }

  function casinoFg(c, st, g, cam) {
    const sl = g.state.slot;
    if (!sl || !sl.jackpot || g.frame < sl.warnStart || g.frame >= sl.rainEnd) return;
    // world-space banner pinned to the top of the view
    const Hh = (S.view && S.view.H) || 540;
    const z = cam ? cam.zoom : 0.8;
    const top = (cam ? cam.y : -150) - Hh / 2 / z + Hh * 0.3 / z;
    const warn = g.frame < sl.rainStart;
    const blink = (g.frame >> 3) % 2 === 0;
    c.save(); c.translate(cam ? cam.x : 0, top); c.scale(1 / z, 1 / z);
    c.globalAlpha = warn ? (blink ? 1 : 0.55) : 0.85;
    c.fillStyle = warn ? "rgba(120,0,0,.8)" : "rgba(60,10,40,.75)"; rrect(c, -190, -22, 380, 44, 10); c.fill();
    c.strokeStyle = "#ffd84a"; c.lineWidth = 3; c.stroke();
    txt(c, warn ? "⚠ JACKPOT! CHIP RAIN INCOMING ⚠" : "★ CHIP RAIN ★", 0, 1, 20, "#ffd84a", "center", FONT_BIG, "#000");
    c.restore();
    if (warn) {
      // red warning stripes along the stage edge
      c.save(); c.globalAlpha = blink ? 0.5 : 0.2;
      c.fillStyle = "#ff2a2a";
      for (const P of g.platforms) c.fillRect(P.x1, P.y - 4, P.x2 - P.x1, 4);
      c.restore();
    }
  }

  const CASINO = {
    id: "the-67-casino", slug: "the-67-casino", name: "The 6 7 Casino", tagline: "Taller than the wideness of the tall.",
    platforms: [
      { x1: -360, x2: 360, y: 0, solid: true, depth: 160 },
      { x1: -290, x2: -120, y: -140, pass: true },
      { x1: 120, x2: 290, y: -140, pass: true },
    ],
    blast: { left: -1160, right: 1160, top: -1080, bottom: 640 },
    spawns: [{ x: -230, y: -10 }, { x: 230, y: -10 }, { x: -80, y: -10 }, { x: 80, y: -10 }],
    respawn: { x: 0, y: -320 },
    init(st, g) { g.state.slot = { reels: [0, 1, 0, 1], spinStart: -1, next: SPIN_FIRST, jackpot: false, result: null, warnStart: 1e9, rainStart: 1e9, rainEnd: -1 }; },
    update: casinoUpdate,
    drawBg: casinoBg,
    drawPlatforms: casinoPlatforms,
    drawFg: casinoFg,
  };
  CASINO.thumb = makeThumb(CASINO, { x: 0, y: -150, h: 560, frame: 200 });

  // ------------------------------------------------------------ register (stage-select order)
  for (const st of [COURT, SHADOW, VENDING, STAIR, CASINO]) S.registerStage(st);
})();
