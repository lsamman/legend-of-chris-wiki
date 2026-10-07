/* Super Smash Ballers — roster part A: Chris, LeBron James, RFK, Steve Jobs.
   Each fighter overrides its specials plus a few signature normals; everything else comes from S.genericMoves.
   Sim code here only uses g.rng() for randomness; drawing code animates off g.frame. */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp, lerp } = S;
  const hb = S.hb;
  const TAU = Math.PI * 2;
  let FRAME = 0;   // g.frame of the fighter being drawn (rig callbacks don't get g)

  // ------------------------------------------------------------ shared helpers
  const alive = (p) => !!p && !p.dead;
  const attacking = (f, name) => f.state === "attack" && f.moveName === name;

  // Keyframes [[frame, v0, v1, ...], ...] → values at frame t (linear).
  function kf(t, list) {
    if (t <= list[0][0]) return list[0].slice(1);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (t <= b[0]) { const k = (t - a[0]) / Math.max(1, b[0] - a[0]); return a.slice(1).map((v, j) => lerp(v, b[j + 1], k)); }
    }
    return list[list.length - 1].slice(1);
  }
  function airLegs(f, P) { if (!f.grounded) { P.legF = [0.8, -1.2]; P.legB = [-0.2, -0.8]; } }
  // Pose function from keyframed limbs: { armF, armB: [[t, ang, bend]], lean, crouch: [[t, v]], legs: [[t, fA, fB, bA, bB]], extra(f, P, t) }
  function animPose(o) {
    return function (f, P) {
      const t = f.mf;
      if (o.armF) { const v = kf(t, o.armF); P.armF = [v[0], v[1]]; }
      if (o.armB) { const v = kf(t, o.armB); P.armB = [v[0], v[1]]; }
      if (o.lean) P.lean = kf(t, o.lean)[0];
      if (o.crouch) P.crouch = kf(t, o.crouch)[0];
      if (o.legs) { const v = kf(t, o.legs); P.legF = [v[0], v[1]]; P.legB = [v[2], v[3]]; } else airLegs(f, P);
      if (o.extra) o.extra(f, P, t);
    };
  }
  // Overhand throw that releases on frame `rel`.
  function throwPose(rel, extra) {
    return animPose({
      armF: [[0, 0.4, 0.4], [rel - 3, 3.6, 0.7], [rel, 1.5, 0], [rel + 10, 1.3, 0.1], [rel + 22, 0.35, 0.45]],
      armB: [[0, -0.2, 0.35], [rel - 3, 0.9, 0.4], [rel, -0.5, 0.3], [rel + 16, -0.2, 0.35]],
      lean: [[0, 0], [rel - 3, -0.45], [rel, 0.6], [rel + 14, 0]],
      extra,
    });
  }
  // Rotate so local +x runs along the forearm (hand.ang is measured from straight down).
  function alongArm(ctx, hand) { ctx.translate(hand.x, hand.y); ctx.rotate(Math.PI / 2 - hand.ang); }
  // Text on a jersey stays readable when the fighter faces left.
  function jerseyText(ctx, f, txt, x, y, size, fill, stroke) {
    ctx.save(); ctx.translate(x, y); ctx.scale(f.facing < 0 ? -1 : 1, 1);
    ctx.font = `900 ${size}px ${S.FONT_BIG || "Arial Black, Arial, sans-serif"}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (stroke) { ctx.lineWidth = Math.max(1.5, size / 6); ctx.strokeStyle = stroke; ctx.lineJoin = "round"; ctx.strokeText(txt, 0, 0); }
    ctx.fillStyle = fill; ctx.fillText(txt, 0, 0);
    ctx.restore();
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, r), 0, TAU); }
  // Side-on face basics shared by the grown-ups: skin, nose, ear, eye, brow.
  function faceBase(ctx, r, skin, brow) {
    ctx.fillStyle = skin; circle(ctx, 0, 0, r); ctx.fill();
    ctx.beginPath(); ctx.moveTo(r * 0.86, -r * 0.18); ctx.quadraticCurveTo(r * 1.2, r * 0.12, r * 0.86, r * 0.26); ctx.fill();
    ctx.fillStyle = S.shade(skin, -0.07); ctx.beginPath(); ctx.ellipse(-r * 0.14, r * 0.06, r * 0.17, r * 0.24, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#1b1b1b"; ctx.beginPath(); ctx.ellipse(r * 0.52, -r * 0.08, r * 0.09, r * 0.12, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = brow; ctx.lineWidth = Math.max(1, r * 0.11); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.34, -r * 0.34); ctx.lineTo(r * 0.72, -r * 0.31); ctx.stroke();
  }
  // Basketball kit: the rig paints whole legs in the shorts colour; repaint shins as skin + socks + shoes.
  function bareShins(ctx, f, R, skin, sock, shoe, hem) {
    const s = f.h / 70, w = 7 * s;
    ctx.save();
    if (R.P.rot) { ctx.translate(0, -f.h / 2); ctx.rotate(R.P.rot); ctx.translate(0, f.h / 2); }
    ctx.lineCap = "round";
    [[R.legB, -0.1], [R.legF, 0]].forEach(([L, d]) => {
      const j = L.joint, e = L.end;
      const k = (t) => ({ x: lerp(j.x, e.x, t), y: lerp(j.y, e.y, t) });
      const a = k(0.12), m = k(0.62);
      ctx.strokeStyle = S.shade(skin, d); ctx.lineWidth = w * 0.95;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
      ctx.strokeStyle = S.shade(sock, d); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      if (hem) {   // baggy shorts hem at the knee
        const t0 = { x: lerp(L.from.x, j.x, 0.55), y: lerp(L.from.y, j.y, 0.55) };
        ctx.strokeStyle = S.shade(hem, d); ctx.lineWidth = w * 1.45;
        ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(j.x, j.y); ctx.stroke();
      }
      ctx.fillStyle = S.shade(shoe, d);
      ctx.beginPath(); ctx.ellipse(e.x + 3 * s, e.y, w * 0.95, w * 0.55, 0, 0, TAU); ctx.fill();
    });
    ctx.restore();
  }

  function drawBall(ctx, x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0);
    ctx.fillStyle = "#e8742a"; circle(ctx, 0, 0, r); ctx.fill();
    ctx.strokeStyle = "#3a1d0a"; ctx.lineWidth = Math.max(1, r * 0.11);
    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    ctx.beginPath(); ctx.arc(-r * 1.25, 0, r * 0.85, -0.75, 0.75); ctx.stroke();
    ctx.beginPath(); ctx.arc(r * 1.25, 0, r * 0.85, Math.PI - 0.75, Math.PI + 0.75); ctx.stroke();
    circle(ctx, 0, 0, r); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.22)"; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.42, r * 0.38, r * 0.22, -0.5, 0, TAU); ctx.fill();
  }
  function ballInHand(ctx, hand, r) {
    drawBall(ctx, hand.x + Math.sin(hand.ang) * r * 0.75, hand.y + Math.cos(hand.ang) * r * 0.75, r, FRAME * 0.05);
  }
  function halo(ctx, x, y, rx, glow) {
    ctx.save();
    ctx.shadowColor = "#ffd84a"; ctx.shadowBlur = 6 + glow * 14;
    ctx.strokeStyle = "#ffcf3a"; ctx.lineWidth = 2.8;
    ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#fff6c4"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.3, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // ============================================================ CHRIS
  // Balanced all-rounder. The basketball is his projectile, his prop and (via Ball Form) himself.
  function chrisBall(f, g) {
    return g.spawn({
      owner: f, x: f.x + f.facing * 22, y: f.y - f.h * 0.62, vx: f.facing * 6.5, vy: -5, gravity: 0.42,
      bounces: 5, bounce: 0.86, r: 9, dmg: 7, angle: 55, bkb: 28, kbg: 55, life: 170,
      draw(ctx, p) { drawBall(ctx, p.x, p.y, p.r, p.t * 0.22 * p.facing); },
      onBounce(p, g) { S.fx.spark(g, p.x, p.y + p.r, "#ffb36b", 2); },
    });
  }
  function chrisWave(f, g, dir) {
    g.spawn({
      owner: f, x: f.x + dir * 26, y: f.y - 12, vx: dir * 7, r: 13, dmg: 6, angle: 80, bkb: 40, kbg: 40, life: 20,
      solid: false, pierce: true, facing: dir,
      draw(ctx, p) {
        const a = clamp(p.life / 14, 0, 1);
        ctx.fillStyle = `rgba(255,205,80,${0.25 * a})`; ctx.strokeStyle = `rgba(255,226,120,${a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y + 12, 9 + (20 - p.life) * 0.4, 18, 0, Math.PI, TAU); ctx.fill(); ctx.stroke();
      },
    });
  }
  function chrisBallForm(f) {
    if (f.state !== "attack" || !f.move) return false;
    const t = f.mf;
    if (f.moveName === "nair") return t >= 2 && t <= 26;
    if (f.moveName === "dspecial") return f.move.aerial ? t >= 3 && t <= 50 : t >= 4 && t <= 30;
    return false;
  }
  // Idle Chris stands like the cover: hands in his pockets.
  function chrisPockets(f) { return f.state === "idle" || f.state === "respawn"; }
  function chrisCuffs(ctx, f, R) {
    const s = f.h / 70;
    ctx.save();
    if (R.P.rot) { ctx.translate(0, -f.h / 2); ctx.rotate(R.P.rot); ctx.translate(0, f.h / 2); }
    [[R.legB, -0.1], [R.legF, 0]].forEach(([L, d]) => {
      const j = L.joint, e = L.end, t = 0.62;
      const m = { x: lerp(j.x, e.x, t), y: lerp(j.y, e.y, t) };
      ctx.strokeStyle = S.shade("#c4e4e1", d); ctx.lineWidth = 9.5 * s; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(lerp(j.x, e.x, 0.82), lerp(j.y, e.y, 0.82)); ctx.stroke();
      ctx.fillStyle = S.shade("#c8322b", d); ctx.fillRect(e.x - 3 * s, e.y - 2.4 * s, 8 * s, 1.8 * s);   // red sneaker stripe
      ctx.fillStyle = S.shade("#9a2a22", d); ctx.fillRect(e.x - 4 * s, e.y + 2 * s, 12 * s, 1.6 * s);    // sole
    });
    ctx.restore();
  }

  function drawChrisBall(ctx, f, g) {
    const R = 21, cy = -R - 1;
    if (f.move.aerial && !f.grounded && f.mf > 8) {   // falling streaks
      ctx.strokeStyle = "rgba(255,215,110,.55)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) { const len = 26 + ((FRAME + i * 5) % 9) * 3; ctx.beginPath(); ctx.moveTo(i * 11, cy - R - 2); ctx.lineTo(i * 11, cy - R - 2 - len); ctx.stroke(); }
    }
    drawBall(ctx, 0, cy, R, g.frame * 0.45);
    // he is still in there
    ctx.fillStyle = "#fff"; circle(ctx, R * 0.42, cy - R * 0.22, 3.6); ctx.fill();
    ctx.fillStyle = "#1b1b1b"; circle(ctx, R * 0.48, cy - R * 0.2, 2); ctx.fill();
    halo(ctx, 0, cy - R - 7, 12, 0.8);
  }

  // Chris is the dog from the MASTER FILE cover: tan fur, long snout, big black nose, grey sweater,
  // pale rolled-up jeans, red-and-white sneakers, and (when he can) his hands in his pockets.
  const CHRIS_FUR = "#c8955c", CHRIS_FUR_D = "#a8743f";
  function dogHead(ctx, r, f, hot) {
    // ear (behind the skull), tall and rounded, tipping back
    ctx.fillStyle = CHRIS_FUR_D;
    ctx.beginPath(); ctx.ellipse(-r * 0.12, -r * 1.2, r * 0.34, r * 0.78, -0.18, 0, TAU); ctx.fill();
    ctx.fillStyle = CHRIS_FUR; ctx.beginPath(); ctx.ellipse(r * 0.22, -r * 1.12, r * 0.3, r * 0.72, 0.12, 0, TAU); ctx.fill();
    ctx.fillStyle = "#e3b98a"; ctx.beginPath(); ctx.ellipse(r * 0.24, -r * 1.08, r * 0.13, r * 0.46, 0.12, 0, TAU); ctx.fill();
    // skull + long snout
    ctx.fillStyle = CHRIS_FUR; circle(ctx, 0, 0, r); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 0.2, -r * 0.5);
    ctx.quadraticCurveTo(r * 1.1, -r * 0.42, r * 1.62, -r * 0.18);
    ctx.quadraticCurveTo(r * 1.9, r * 0.1, r * 1.55, r * 0.44);
    ctx.quadraticCurveTo(r * 1.0, r * 0.66, r * 0.25, r * 0.7);
    ctx.closePath(); ctx.fill();
    // lower jaw shadow + smug little smile
    ctx.fillStyle = CHRIS_FUR_D; ctx.beginPath(); ctx.ellipse(r * 0.9, r * 0.56, r * 0.55, r * 0.12, 0.05, 0, Math.PI); ctx.fill();
    ctx.strokeStyle = "#5a3418"; ctx.lineWidth = Math.max(1, r * 0.08); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.55, r * 0.42); ctx.quadraticCurveTo(r * 0.85, r * 0.52, r * 1.12, r * 0.4); ctx.stroke();
    // the big black nose
    ctx.fillStyle = "#151515"; ctx.beginPath(); ctx.ellipse(r * 1.62, -r * 0.02, r * 0.36, r * 0.3, -0.25, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.ellipse(r * 1.55, -r * 0.14, r * 0.12, r * 0.06, -0.3, 0, TAU); ctx.fill();
    // half-lidded, very chill eye
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(r * 0.42, -r * 0.24, r * 0.2, r * 0.17, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#2a1a0e"; circle(ctx, r * 0.5, -r * 0.2, r * 0.09); ctx.fill();
    const lid = f.state === "hitstun" || f.state === "tumble" ? 0.1 : 0.62;
    ctx.fillStyle = CHRIS_FUR_D; ctx.beginPath(); ctx.ellipse(r * 0.42, -r * 0.24, r * 0.22, r * 0.19, 0, Math.PI, Math.PI + Math.PI * lid * 1.6, false); ctx.lineTo(r * 0.42, -r * 0.24); ctx.fill();
    ctx.beginPath(); ctx.rect(r * 0.2, -r * 0.45, r * 0.44, r * 0.19 * (lid > 0.5 ? 1.15 : 0.2)); ctx.fill();
    ctx.strokeStyle = "#5a3418"; ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.24 + (lid > 0.5 ? -r * 0.02 : -r * 0.18)); ctx.lineTo(r * 0.64, -r * 0.24 + (lid > 0.5 ? -r * 0.02 : -r * 0.18)); ctx.stroke();
    if (hot) halo(ctx, 0, -r * 2.1, r * 0.78, 1);   // the god shows through only when he ascends
  }

  const chrisLook = {
    skin: CHRIS_FUR, shirt: "#a7abb2", sleeve: "#a7abb2", forearm: "#a7abb2", pants: "#a9d3d0", shoes: "#f3f1ec",
    headR: 13.5, bodyW: 24,
    head(ctx, f, P, r) {
      const hot = attacking(f, "uspecial") || (attacking(f, "usmash") && f.mf >= 8 && f.mf <= 20);
      dogHead(ctx, r, f, hot);
    },
    torso(ctx, f, P, b) {
      // cable-knit sweater: ribbed collar and hem
      ctx.strokeStyle = "#8d9198"; ctx.lineWidth = 1.2;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(b.x + (b.w * i) / 4, b.y + 4); ctx.lineTo(b.x + (b.w * i) / 4, b.y + b.h - 6); ctx.stroke(); }
      ctx.fillStyle = "#94989f"; ctx.fillRect(b.x + 1, b.y + b.h - 6, b.w - 2, 4); ctx.fillRect(b.x + b.w * 0.25, b.y - 1, b.w * 0.55, 3);
    },
    prop(ctx, f, P, hand) {
      if (alive(f.data.ball) || chrisPockets(f)) return;
      if (f.state === "walk") {   // dribble
        const u = 1 - Math.abs(Math.cos(FRAME * 0.11));
        drawBall(ctx, hand.x + 5, lerp(hand.y + 7, -7, u), 7, FRAME * 0.08);
      } else ballInHand(ctx, hand, 7);
    },
    behind(ctx, f, P) {
      if (!attacking(f, "uspecial")) return;
      const k = clamp(f.mf / 6, 0, 1) * (f.mf > 32 ? Math.max(0, 1 - (f.mf - 32) / 12) : 1);
      const cy = -f.h * 0.55;
      const grd = ctx.createRadialGradient(0, cy, 4, 0, cy, 58);
      grd.addColorStop(0, `rgba(255,240,150,${0.8 * k})`); grd.addColorStop(1, "rgba(255,200,60,0)");
      ctx.fillStyle = grd; circle(ctx, 0, cy, 58); ctx.fill();
      ctx.strokeStyle = `rgba(255,236,160,${0.55 * k})`; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + FRAME * 0.06;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 28, cy + Math.sin(a) * 28); ctx.lineTo(Math.cos(a) * 52, cy + Math.sin(a) * 52); ctx.stroke();
      }
      if (f.mf >= 6 && f.mf <= 30) {   // golden contrail
        const tr = ctx.createLinearGradient(0, 0, 0, 70);
        tr.addColorStop(0, `rgba(255,220,110,${0.6 * k})`); tr.addColorStop(1, "rgba(255,220,110,0)");
        ctx.fillStyle = tr; ctx.fillRect(-12, -6, 24, 76);
      }
    },
  };

  // Same look, but the arms are tucked into the jeans pockets (drawn short, hands hidden).
  const chrisPocketLook = Object.assign({}, chrisLook, {
    skin: "#a7abb2", armScale: 0.8,   // hands vanish into the pockets
    posePatch(f, P) { P.armF = [-0.32, 0.5]; P.armB = [-0.45, 0.45]; P.lean = -0.25; },
  });

  S.registerFighter({
    id: "chris", slug: "chris", name: "Chris", short: "Chris",
    tagline: "Baby. Baller. Corpse. Ball. God.",
    color: "#c8955c",
    stats: { weight: 95, walk: 4.3, run: 7.5, dashInit: 7.9, airSpeed: 5.1, jump: 13.6, airJump: 12.8, width: 34, height: 66 },
    reach: 1, power: 1,
    moveNames: { nspecial: "Ball Bounce", sspecial: "Baller Dash", uspecial: "God Ascension", dspecial: "Ball Form", fsmash: "Slam Dunk", usmash: "Halo Flare", nair: "Ball Roll" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "usmash"] },
    moves: {
      ftilt: { frames: 27, pose: "punch", hitboxes: [hb(7, 10, 40, -34, 15, 10, 38, 12, 98), hb(7, 10, 20, -34, 12, 8, 38, 12, 95)] },
      fsmash: {
        frames: 48, charge: 7,
        hitboxes: [hb(15, 18, 40, -30, 19, 17, 38, 30, 97), hb(15, 18, 18, -42, 14, 14, 40, 30, 95)],
        pose: animPose({
          armF: [[0, 0.4, 0.4], [7, 3.4, 0.4], [13, 3.6, 0.2], [16, 1.3, 0], [30, 1.1, 0.2], [48, 0.3, 0.45]],
          armB: [[0, -0.2, 0.35], [7, 3.2, 0.4], [13, 3.4, 0.2], [16, 1.2, 0], [30, 1.0, 0.2], [48, -0.2, 0.35]],
          lean: [[0, 0], [7, -0.4], [16, 0.9], [48, 0]],
        }),
      },
      usmash: {
        frames: 44, charge: 6,
        hitboxes: [hb(11, 16, 0, -84, 24, 15, 88, 32, 100), hb(11, 16, 0, -54, 16, 12, 90, 30, 95)],
        pose: animPose({
          armF: [[0, 0.3, 0.4], [10, 2.9, 0.1], [30, 2.9, 0.1], [44, 0.3, 0.4]], armB: [[0, -0.2, 0.3], [10, 2.7, 0.1], [30, 2.7, 0.1], [44, -0.2, 0.3]],
          crouch: [[0, 0], [6, 0.4], [11, 0]],
        }),
      },
      nair: { frames: 34, air: true, landingLag: 10, hitboxes: [hb(3, 7, 0, -28, 27, 11, 45, 18, 90), hb(8, 24, 0, -28, 24, 6, 50, 10, 70)] },

      // Ball Bounce: one ball on the court at a time.
      nspecial: {
        frames: 32, gravityMult: 0.6, hitboxes: [], pose: throwPose(10),
        update(f, g, mf) { if (mf === 10 && !alive(f.data.ball)) f.data.ball = chrisBall(f, g); },
      },
      // Baller Dash: fast lunge; once per airtime (the engine tracks usedSide).
      sspecial: {
        frames: 38, keepMomentum: true, noGravity: [5, 18],
        hitboxes: [hb(6, 18, 22, -30, 18, 10, 45, 35, 70)],
        pose: animPose({ armF: [[0, 0.4, 0.4], [5, 1.6, 0], [20, 1.6, 0], [38, 0.4, 0.4]], lean: [[0, 0], [5, 1.2], [20, 1.2], [38, 0]], legs: [[0, 0.14, -0.06, -0.14, -0.06], [5, 0.6, -0.3, -0.9, -0.6], [20, 0.6, -0.3, -0.9, -0.6], [38, 0.14, -0.06, -0.14, -0.06]] }),
        start(f) { f.vx *= 0.3; if (!f.grounded) f.vy = Math.min(f.vy, 0); },
        update(f, g, mf) {
          if (mf >= 5 && mf <= 18) { f.vx = f.facing * 11; if (!f.grounded) f.vy = 0; if (mf % 3 === 0) S.fx.spark(g, f.x - f.facing * 14, f.y - 6, "#ffb36b", 1); }
          else f.vx *= mf < 5 ? 0.8 : 0.86;
        },
      },
      // God Ascension: golden rising multi-hit, then helpless.
      uspecial: {
        frames: 44, helpless: true, ledgeGrab: true, noGravity: [1, 30], noAirControl: true, keepMomentum: true,
        hitboxes: [hb(7, 28, 0, -36, 27, 2, 90, 55, 10), hb(29, 32, 0, -58, 30, 6, 82, 55, 95)],
        pose: animPose({ armF: [[0, 0.3, 0.4], [6, 3.0, 0.1]], armB: [[0, -0.2, 0.3], [6, 2.8, 0.1]], legs: [[0, 0.15, -0.2, -0.1, -0.25]] }),
        start(f) { f.leaveGround(); f.vy = 0; f.vx *= 0.4; },
        update(f, g, mf, pad) {
          if (mf < 6) { f.vy = 0; f.vx *= 0.8; return; }
          if (mf <= 30) {
            if (f.grounded) f.leaveGround();
            f.vy = -9; f.vx = clamp(pad.x, -1, 1) * 4.6;
            if (mf % 4 === 0) f.hitSet.clear();
          }
        },
        onLand(f) { if (f.mf > 8) { f.setState("land"); f.lag = 16; } },
      },
      // Ball Form (ground): curl up, shockwave both ways.
      dspecial: {
        frames: 42,
        hitboxes: [hb(11, 14, 24, -16, 22, 8, 65, 40, 70), hb(11, 14, -24, -16, 22, 8, 115, 40, 70)],
        pose: animPose({ crouch: [[0, 0], [4, 0.6], [30, 0.6], [42, 0]] }),
        update(f, g, mf) {
          if (mf === 11) { chrisWave(f, g, 1); chrisWave(f, g, -1); S.fx.ring(g, f.x, f.y, "#ffd84a"); g.shake = Math.max(g.shake, 3); }
        },
      },
      // Ball Form (air): hop, then plummet as a spiking ball; landing makes a small shockwave.
      dspecialAir: {
        aerial: true, frames: 60, noAirControl: true, keepMomentum: true, noGravity: [9, 44],
        hitboxes: [hb(9, 43, 0, -20, 22, 12, -90, 20, 72), hb(45, 48, 26, -14, 22, 7, 60, 45, 55), hb(45, 48, -26, -14, 22, 7, 120, 45, 55)],
        pose: animPose({ crouch: [[0, 0.5]] }),
        start(f) { f.vx *= 0.3; f.vy = -4; f.fastfall = false; },
        update(f, g, mf) {
          if (mf <= 8) { f.vx *= 0.9; return; }
          if (mf < 44 && !f.grounded) { f.vy = 15; f.vx = 0; }
          else if (mf === 44 && !f.grounded) f.setState("air");   // never landed: uncurl
        },
        onLand(f, g) {
          if (f.mf >= 44) return;
          f.mf = 44; f.vx = 0;
          S.fx.ring(g, f.x, f.y, "#ffd84a"); S.fx.spark(g, f.x, f.y, "#ffcf6a", 6); g.shake = Math.max(g.shake, 5);
        },
      },
    },
    draw(ctx, f, g) {
      FRAME = g.frame;
      if (chrisBallForm(f)) { drawChrisBall(ctx, f, g); return; }
      const R = S.drawHumanoid(ctx, f, chrisPockets(f) ? chrisPocketLook : chrisLook, g);
      chrisCuffs(ctx, f, R);
    },
  });

  // ============================================================ LEBRON JAMES
  // Heavy rushdown: fast, tall, armored charge, a dunk recovery and a counter.
  const LBJ_GOLD = "#fdb927", LBJ_PURPLE = "#552583";
  function lbjBallOut(f) {
    if (f.state !== "attack") return false;
    const n = f.moveName, t = f.mf;
    return n === "fsmash" || (n === "uspecial" && t < 34) || (n === "nspecial" && t < 9 && !alive(f.data.pass)) || n === "fthrow";
  }
  const lbjLook = {
    skin: "#7b4b2a", shirt: LBJ_PURPLE, pants: LBJ_PURPLE, shoes: "#1b1b1b", shortSleeves: true,
    headR: 10.6, bodyW: 26,
    head(ctx, f, P, r) {
      faceBase(ctx, r, lbjLook.skin, "#140d09");
      ctx.save(); circle(ctx, 0, 0, r); ctx.clip();
      ctx.fillStyle = "#17100c";
      ctx.beginPath(); ctx.arc(-r * 0.1, -r * 0.22, r * 1.02, Math.PI * 0.98, Math.PI * 1.98); ctx.fill();   // close crop
      ctx.beginPath(); ctx.ellipse(r * 0.28, r * 0.66, r * 0.92, r * 0.5, 0, 0, TAU); ctx.fill();          // trimmed beard
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-r * 1.1, -r * 0.66, r * 2.2, r * 0.3);                    // headband
      ctx.restore();
      ctx.fillStyle = S.shade(lbjLook.skin, -0.07); ctx.beginPath(); ctx.ellipse(-r * 0.14, r * 0.06, r * 0.17, r * 0.24, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(r * 0.52, -r * 0.08, r * 0.14, r * 0.11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1b1009"; circle(ctx, r * 0.57, -r * 0.08, r * 0.075); ctx.fill();
    },
    torso(ctx, f, P, b) {
      ctx.strokeStyle = LBJ_GOLD; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(b.x + b.w * 0.55, b.y + 1, b.w * 0.26, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      ctx.fillStyle = LBJ_GOLD; ctx.fillRect(b.x, b.y + b.h - 7, b.w, 2.4);
      jerseyText(ctx, f, "23", b.x + b.w * 0.5, b.y + b.h * 0.54, b.h * 0.38, LBJ_GOLD, "#ffffff");
    },
    prop(ctx, f, P, hand) { if (lbjBallOut(f)) ballInHand(ctx, hand, 8); },
    behind(ctx, f, P) {
      if (!attacking(f, "dspecial")) return;
      const m = f.move;
      if (f.mf >= m.counter[0] && f.mf <= m.counter[1]) {   // counter stance shimmer
        const a = 0.35 + 0.25 * Math.sin(FRAME * 0.6);
        ctx.strokeStyle = `rgba(253,185,39,${a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, -f.h * 0.5, f.w * 0.9, f.h * 0.62, 0, 0, TAU); ctx.stroke();
      }
    },
  };

  S.registerFighter({
    id: "lebron-james", slug: "lebron-james", name: "LeBron James", short: "LeBron",
    tagline: "Balled into the sky. Cannot abide cringe.",
    color: LBJ_PURPLE,
    stats: {
      weight: 112, walk: 4.5, run: 8.6, dashInit: 8.8, traction: 0.6, airSpeed: 5.2, airAccel: 0.4,
      gravity: 0.55, fallSpeed: 10, fastFall: 14.5, jump: 14.8, shortHop: 9, airJump: 13.2, jumpsquat: 5, width: 38, height: 80,
    },
    reach: 1.1, power: 1.06,
    moveNames: { nspecial: "Chest Pass", sspecial: "Chase-Down Charge", uspecial: "Balled Into the Sky", dspecial: "Cannot Abide Cringe", fsmash: "Tomahawk", fair: "Posterizer" },
    ai: { ranged: false, recover: "uspecial", killMoves: ["fsmash", "fair", "uair"], counter: "dspecial" },
    moves: {
      dash: {
        frames: 36, hitboxes: [hb(6, 15, 28, -42, 20, 11, 55, 35, 72)],
        pose: animPose({ armF: [[0, 0.5, 0.5], [5, 1.3, 0.3], [20, 1.3, 0.3], [36, 0.4, 0.4]], lean: [[0, 0.8], [5, 1.4], [20, 1.4], [36, 0]] }),
        update(f, g, mf) { if (mf < 16) f.vx = f.facing * Math.max(Math.abs(f.vx), 5) * 0.97; },
      },
      fsmash: {
        frames: 52, charge: 8,
        hitboxes: [hb(17, 20, 46, -36, 22, 17, 38, 32, 95), hb(17, 20, 22, -54, 17, 14, 45, 30, 93)],
        pose: animPose({
          armF: [[0, 0.4, 0.4], [8, 3.7, 0.3], [15, 3.8, 0.2], [18, 1.2, 0], [32, 1.0, 0.2], [52, 0.3, 0.45]],
          armB: [[0, -0.2, 0.35], [8, 3.5, 0.3], [15, 3.6, 0.2], [18, 1.0, 0], [32, 0.9, 0.2], [52, -0.2, 0.35]],
          lean: [[0, 0], [8, -0.5], [18, 1.0], [52, 0]],
        }),
      },
      dtilt: { frames: 22, crouch: true, pose: "kick", hitboxes: [hb(5, 8, 40, -8, 15, 8, 75, 25, 70)] },
      fair: { frames: 40, air: true, landingLag: 18, pose: "both", hitboxes: [hb(11, 15, 34, -46, 20, 14, 45, 22, 94), hb(11, 15, 14, -46, 14, 11, 50, 20, 90)] },
      uair: { frames: 32, air: true, landingLag: 12, hitboxes: [hb(5, 10, 4, -96, 22, 11, 85, 22, 95), hb(5, 10, -12, -84, 16, 9, 90, 20, 90)] },

      // Chest Pass: a fast straight ball, one at a time.
      nspecial: {
        frames: 32, gravityMult: 0.6, hitboxes: [],
        pose: animPose({ armF: [[0, 0.4, 0.4], [6, 0.9, 1.8], [9, 1.57, 0], [20, 1.5, 0.1], [32, 0.4, 0.4]], armB: [[0, -0.2, 0.35], [6, 0.8, 1.8], [9, 1.45, 0], [20, 1.4, 0.1], [32, -0.2, 0.35]], lean: [[0, 0], [6, -0.3], [9, 0.6], [32, 0]] }),
        update(f, g, mf) {
          if (mf !== 9 || alive(f.data.pass)) return;
          f.data.pass = g.spawn({
            owner: f, x: f.x + f.facing * 30, y: f.y - f.h * 0.62, vx: f.facing * 14.5, vy: 0, gravity: 0.04,
            r: 10, dmg: 8, angle: 32, bkb: 35, kbg: 45, life: 42,
            draw(ctx, p) {
              ctx.fillStyle = "rgba(253,185,39,.28)";
              ctx.beginPath(); ctx.ellipse(p.x - p.vx * 1.2, p.y, 22, p.r * 0.8, 0, 0, TAU); ctx.fill();
              drawBall(ctx, p.x, p.y, p.r, p.t * 0.35 * p.facing);
            },
          });
        },
      },
      // Chase-Down Charge: armored shoulder charge.
      sspecial: {
        frames: 46, armor: [6, 22], armorKB: 150, keepMomentum: true, gravityMult: 0.35,
        hitboxes: [hb(7, 22, 22, -46, 21, 12, 42, 45, 72)],
        pose: animPose({ armF: [[0, 0.4, 0.4], [6, 0.9, 1.6], [24, 0.9, 1.6], [46, 0.4, 0.4]], armB: [[0, -0.2, 0.35], [6, -0.6, 1.2], [24, -0.6, 1.2], [46, -0.2, 0.35]], lean: [[0, 0], [6, 1.5], [24, 1.5], [46, 0]] }),
        start(f) { f.vx *= 0.4; if (!f.grounded) f.vy = Math.min(f.vy, -2); },
        update(f, g, mf) {
          if (mf < 6) f.vx *= 0.7;
          else if (mf <= 22) { f.vx = f.facing * 10.5; if (mf % 3 === 0) S.fx.spark(g, f.x - f.facing * 16, f.y - 4, "#d9c7ff", 1); }
          else f.vx *= 0.85;
        },
      },
      // Balled Into the Sky: huge leap, dunk on the way up, helpless after.
      uspecial: {
        frames: 60, helpless: true, ledgeGrab: true, noAirControl: true, keepMomentum: true,
        hitboxes: [hb(6, 14, 6, -60, 24, 7, 85, 45, 55), hb(26, 31, 28, -42, 24, 12, 290, 30, 70)],
        pose: animPose({
          armF: [[0, 0.4, 0.4], [5, 1.0, 0.6], [7, 3.0, 0.1], [24, 3.4, 0.2], [27, 1.4, 0], [36, 0.9, 0.2]],
          armB: [[0, -0.2, 0.35], [5, -0.6, 0.4], [7, 2.8, 0.1], [24, 3.2, 0.2], [27, 1.2, 0], [36, 0.6, 0.3]],
          crouch: [[0, 0], [5, 0.6], [6, 0]],
          legs: [[0, 0.15, -0.1, -0.15, -0.1], [5, 0.7, -1.3, -0.4, -1.0], [8, 0.3, -0.2, -0.2, -0.6], [26, 0.9, -1.4, -0.1, -0.9]],
        }),
        start(f) { f.vx *= 0.5; },
        update(f, g, mf, pad) {
          if (mf < 6) { f.vx *= 0.8; if (!f.grounded) f.vy = Math.min(f.vy, 1); return; }
          if (mf === 6) { f.leaveGround(); f.vy = -19; f.vx = pad.x * 3; S.fx.ring(g, f.x, f.y, LBJ_GOLD); }
          f.vx += clamp(pad.x * 4.5 - f.vx, -0.45, 0.45);
          if (mf === 27) S.fx.spark(g, f.x + f.facing * 28, f.y - 40, LBJ_GOLD, 5);
        },
        onLand(f) { if (f.mf > 8) { f.setState("land"); f.lag = 18; } },
      },
      // Cannot Abide Cringe: counter.
      dspecial: {
        frames: 52, counter: [5, 24], counterHit: 34, gravityMult: 0.4, hitboxes: [],
        counterCfg: {
          mult: 1.2, min: 8, angle: 38, bkb: 40, kbg: 62,
          onCounter(me, A, g) { me.data.counterId = me.moveId; S.fx.text(g, me.x, me.y - me.h - 26, "CRINGE.", LBJ_GOLD); },
        },
        pose(f, P) {
          const hit = f.data.counterId === f.moveId && f.mf >= 34;
          if (hit) { const k = clamp((f.mf - 34) / 4, 0, 1); P.armF = [lerp(1.0, 1.6, k), lerp(1.5, 0, k)]; P.armB = [lerp(0.8, 1.45, k), 0.1]; P.lean = 0.9 * k; }
          else if (f.mf <= 28) { P.armF = [1.65, 1.0]; P.armB = [-0.3, 0.5]; P.lean = -0.35; }
          else { const k = clamp((f.mf - 28) / 20, 0, 1); P.armF = [lerp(1.65, 0.4, k), lerp(1.0, 0.4, k)]; P.lean = lerp(-0.35, 0, k); }
          airLegs(f, P);
        },
        start(f) { f.vx *= 0.5; if (!f.grounded) f.vy = Math.min(f.vy, 1); },
      },
    },
    draw(ctx, f, g) {
      FRAME = g.frame;
      const R = S.drawHumanoid(ctx, f, lbjLook, g);
      bareShins(ctx, f, R, lbjLook.skin, "#ffffff", lbjLook.shoes, LBJ_PURPLE);
    },
  });

  // ============================================================ RFK
  // Swordfighter: the lightsaber is the hitbox on most normals (disjointed, long reach, tipper).
  const SABER_LEN = 0.62;   // × height
  function saberShoulder(f, lean, crouch) { return { x: 2 + lean * 9, y: -f.h * 0.73 + 3 + crouch * f.h * 0.18 }; }
  function saberBoxes(f, a, o) {
    const sh = saberShoulder(f, o.lean || 0, o.crouch || 0), dx = Math.sin(a), dy = Math.cos(a);
    const base = f.h * 0.34 + 8, L = f.h * SABER_LEN;
    const at = (k) => [sh.x + dx * (base + L * k), sh.y + dy * (base + L * k)];
    const [x1, y1] = at(0.18), [x2, y2] = at(0.52), [x3, y3] = at(0.86);
    return [
      hb(o.s, o.e, x1, y1, 11, o.dmg, o.angle, o.bkb, o.kbg),
      hb(o.s, o.e, x2, y2, 11, o.dmg, o.angle, o.bkb, o.kbg),
      hb(o.s, o.e, x3, y3, 12, o.tip || o.dmg, o.tipAngle != null ? o.tipAngle : o.angle, o.bkb, o.kbg),
    ];
  }
  // A saber swing: the arm sweeps a0 → a1 (angles from down, + forward) during frames s..e and the blade carries the hitboxes.
  function saberMove(o) {
    const rest = o.a1 > Math.PI ? TAU + 0.5 : o.a1 < -0.5 ? -0.3 : 0.6;
    const swing = (t) => {
      if (t < o.s) return lerp(0.6, o.a0, Math.min(1, t / Math.max(1, o.s - 1)));
      if (t <= o.e) { const k = (t - o.s) / Math.max(1, o.e - o.s); return lerp(o.a0, o.a1, 1 - (1 - k) * (1 - k)); }
      return lerp(o.a1, rest, clamp((t - o.e - 4) / 12, 0, 1));
    };
    o.swing = swing;
    return Object.assign({
      frames: o.frames, saber: o,
      hitboxes: (f) => (f.mf >= o.s && f.mf <= o.e ? saberBoxes(f, swing(f.mf), o) : []),
      pose(f, P) {
        P.armF = [swing(f.mf), 0]; P.blade = 0; P.lean = o.lean || 0; P.armB = [-0.5, 0.6];
        if (o.crouch) P.crouch = o.crouch;
        airLegs(f, P);
      },
    }, o.extra || {});
  }
  function drawSaber(ctx, x, y, a, L) {
    const dx = Math.sin(a), dy = Math.cos(a);
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1e2026"; ctx.lineWidth = 4.2;
    ctx.beginPath(); ctx.moveTo(x - dx * 4, y - dy * 4); ctx.lineTo(x + dx * 5, y + dy * 5); ctx.stroke();
    ctx.strokeStyle = "#c3c8d2"; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(x + dx * 5, y + dy * 5); ctx.lineTo(x + dx * 8, y + dy * 8); ctx.stroke();
    const bx = x + dx * 8, by = y + dy * 8, ex = x + dx * (8 + L), ey = y + dy * (8 + L);
    ctx.save();
    ctx.shadowColor = "#36ff6a"; ctx.shadowBlur = 14;
    ctx.strokeStyle = "rgba(70,255,120,.55)"; ctx.lineWidth = 7.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = "#effff2"; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
  }
  // Translucent arc behind a swinging blade.
  function saberTrail(ctx, f, R) {
    const m = f.move, o = m && m.saber;
    if (!o || f.mf < o.s || f.mf > o.e + 2) return;
    const sh = R.armF.from, r1 = f.h * 0.34 + 8, r2 = r1 + f.h * SABER_LEN;
    const a1 = o.swing(Math.max(o.s, f.mf - 4)), a2 = o.swing(Math.min(f.mf, o.e));
    if (Math.abs(a2 - a1) < 0.05) return;
    const t1 = Math.PI / 2 - a1, t2 = Math.PI / 2 - a2, ccw = t2 < t1;
    ctx.fillStyle = "rgba(140,255,165,.28)";
    ctx.beginPath(); ctx.arc(sh.x, sh.y, r2, t1, t2, ccw); ctx.arc(sh.x, sh.y, r1, t2, t1, !ccw); ctx.closePath(); ctx.fill();
  }
  function drawSyringe(ctx, x, y, rot, s) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(13, 0); ctx.stroke();   // needle
    ctx.fillStyle = "#f4f7fa"; ctx.fillRect(-7, -2.6, 14, 5.2);
    ctx.fillStyle = "#6fe36a"; ctx.fillRect(-2, -1.8, 8, 3.6);     // dose
    ctx.strokeStyle = "#6b7480"; ctx.lineWidth = 0.8; ctx.strokeRect(-7, -2.6, 14, 5.2);
    ctx.fillStyle = "#c9ced6"; ctx.fillRect(-11, -0.9, 4, 1.8); ctx.fillRect(-12, -3, 1.6, 6);   // plunger
    ctx.restore();
  }
  function drawCan(ctx, hand, tilt) {
    ctx.save(); alongArm(ctx, hand); ctx.rotate(tilt);
    ctx.fillStyle = "#2b4c9b"; ctx.fillRect(-3, -6, 6, 6);
    ctx.fillStyle = "#c4cbd6"; ctx.fillRect(-3, 0, 6, 6);
    ctx.fillStyle = "#e3343a"; circle(ctx, 0, 0, 1.6); ctx.fill();
    ctx.fillStyle = "#e8e8e8"; ctx.fillRect(-3, -7, 6, 1.2);
    ctx.restore();
  }
  // Hantavirus Vaccine poison: a harmless follower projectile ticks 1% every 30 frames for 3 s.
  function poison(owner, T, g) {
    for (const p of g.projectiles) if (p.poisonOf === T && !p.dead) { p.life = 181; return; }
    g.spawn({
      owner, poisonOf: T, harmless: true, solid: false, x: T.x, y: T.y - T.h - 10, r: 4, dmg: 0, life: 181,
      update(p, g) {
        const T = p.poisonOf;
        if (T.out || T.state === "dead" || T.state === "respawn") { p.dead = true; return; }
        p.x = T.x; p.y = T.y - T.h - 10;
        T.buffs.poison = p.life;
        if (p.t % 30 === 0) {
          T.damage = Math.min(999, T.damage + 1); T.dmgTaken += 1;
          if (p.owner && p.owner !== T) p.owner.dmgDealt += 1;
          S.fx.spark(g, T.x, T.y - T.h * 0.6, "#7dff6a", 3);
        }
      },
      draw(ctx, p, g) {
        for (let i = 0; i < 3; i++) {
          const ph = (g.frame * 0.04 + i / 3) % 1;
          ctx.fillStyle = `rgba(110,240,90,${0.75 * (1 - ph)})`;
          circle(ctx, p.x + Math.sin((g.frame + i * 40) * 0.1) * 8, p.y + 6 - ph * 22, 2.4 + i * 0.6); ctx.fill();
        }
      },
    });
  }

  const rfkLook = {
    skin: "#eac3a2", shirt: "#262a35", pants: "#262a35", shoes: "#111111", sleeve: "#2b3040",
    headR: 9.8, bodyW: 21,
    head(ctx, f, P, r) {
      faceBase(ctx, r, rfkLook.skin, "#3b3029");
      // swept-back hair, greying at the temple
      ctx.fillStyle = "#4b3e33";
      ctx.beginPath(); ctx.moveTo(r * 0.78, -r * 0.6);
      ctx.quadraticCurveTo(r * 0.25, -r * 1.38, -r * 0.75, -r * 0.88);
      ctx.quadraticCurveTo(-r * 1.25, -r * 0.2, -r * 0.72, r * 0.36);
      ctx.quadraticCurveTo(-r * 0.42, -r * 0.3, r * 0.78, -r * 0.6); ctx.fill();
      ctx.strokeStyle = "#a29a90"; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.82); ctx.quadraticCurveTo(-r * 0.1, -r * 1.12, -r * 0.7, -r * 0.62); ctx.stroke();
      ctx.fillStyle = S.shade(rfkLook.skin, -0.07); ctx.beginPath(); ctx.ellipse(-r * 0.14, r * 0.06, r * 0.17, r * 0.24, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = S.shade(rfkLook.skin, -0.25); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r * 0.58, r * 0.5); ctx.lineTo(r * 0.8, r * 0.46); ctx.stroke();
    },
    torso(ctx, f, P, b) {
      const cx = b.x + b.w * 0.62;
      ctx.fillStyle = "#f4f4f2"; ctx.beginPath(); ctx.moveTo(cx - 5, b.y); ctx.lineTo(cx + 5, b.y); ctx.lineTo(cx, b.y + b.h * 0.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#8c1f2e"; ctx.lineWidth = 2.6; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(cx, b.y + 1); ctx.lineTo(cx, b.y + b.h * 0.47); ctx.stroke();
      ctx.strokeStyle = "#3d4456"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx - 5.5, b.y); ctx.lineTo(cx - 1, b.y + b.h * 0.55); ctx.moveTo(cx + 5.5, b.y); ctx.lineTo(cx + 1, b.y + b.h * 0.55); ctx.stroke();
      ctx.fillStyle = "#11141b"; circle(ctx, cx, b.y + b.h * 0.7, 1.1); ctx.fill();
    },
    prop(ctx, f, P, hand) {
      if (P.hold === "can") { drawCan(ctx, hand, -0.4); return; }
      if (P.hold === "syringe") { ctx.save(); alongArm(ctx, hand); drawSyringe(ctx, 2, 0, -Math.PI / 2, 0.8); ctx.restore(); return; }
      if (P.hold === "none") return;
      drawSaber(ctx, hand.x, hand.y, hand.ang + (P.blade != null ? P.blade : 1.3), f.h * SABER_LEN);
    },
    behind(ctx, f, P) {
      const b = f.buffs.dmgBoost || 0;
      if (b <= 0) return;
      const flick = b < 90 && (FRAME >> 2) % 2 === 0 ? 0.4 : 1;
      const pulse = 0.5 + 0.5 * Math.sin(FRAME * 0.25), cy = -f.h * 0.5;
      const grd = ctx.createRadialGradient(0, cy, 6, 0, cy, f.h * 0.75);
      grd.addColorStop(0, "rgba(255,70,70,0)"); grd.addColorStop(0.6, `rgba(255,70,70,${(0.16 + 0.1 * pulse) * flick})`); grd.addColorStop(1, "rgba(60,110,255,0)");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(0, cy, f.w * 1.3, f.h * 0.75, 0, 0, TAU); ctx.fill();
      for (let i = 0; i < 4; i++) {   // rising energy flecks
        const ph = (FRAME * 0.03 + i / 4) % 1;
        ctx.fillStyle = i % 2 ? `rgba(80,140,255,${(1 - ph) * flick})` : `rgba(255,90,80,${(1 - ph) * flick})`;
        ctx.fillRect(Math.sin(i * 2.3 + FRAME * 0.05) * f.w * 0.8, -ph * f.h * 1.1, 3, 6);
      }
    },
  };

  S.registerFighter({
    id: "rfk", slug: "rfk", name: "RFK", short: "RFK",
    tagline: "Dark Knight. Last senator. Drinker of G Fuel. Licker of rain.",
    color: "#2e7d4f",
    stats: { weight: 100, walk: 4.2, run: 7.6, dashInit: 7.9, airSpeed: 5.0, jump: 13.6, airJump: 12.6, width: 32, height: 74 },
    reach: 1.05, power: 1,
    moveNames: { nspecial: "Hantavirus Vaccine", sspecial: "Lightsaber Lunge", uspecial: "Saber Spin", dspecial: "4 Red Bulls", fsmash: "Senate Cleaver" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "fair", "usmash"], buff: "dspecial" },
    tick(f) {
      const fast = f.buffs.speedBoost > 0;   // engine handles air speed; ground speed lives here
      f.stats.run = fast ? 8.9 : 7.6; f.stats.dashInit = fast ? 9.2 : 7.9; f.stats.walk = fast ? 5 : 4.2;
    },
    moves: {
      jab: saberMove({ frames: 20, s: 3, e: 5, a0: 1.25, a1: 1.6, dmg: 4, angle: 361, bkb: 12, kbg: 50, extra: { iasa: 15 } }),
      ftilt: saberMove({ frames: 30, s: 7, e: 10, a0: 2.4, a1: 0.9, dmg: 9, tip: 11, angle: 38, bkb: 14, kbg: 95 }),
      utilt: saberMove({ frames: 30, s: 6, e: 12, a0: 1.3, a1: 4.6, dmg: 8, tip: 9, angle: 92, bkb: 25, kbg: 102 }),
      dtilt: saberMove({ frames: 24, s: 6, e: 8, a0: 1.05, a1: 1.45, crouch: 0.45, lean: 0.4, dmg: 7, angle: 80, bkb: 22, kbg: 72, extra: { crouch: true } }),
      dash: saberMove({ frames: 36, s: 7, e: 13, a0: 1.35, a1: 1.65, lean: 0.8, dmg: 9, tip: 10, angle: 50, bkb: 30, kbg: 72,
        extra: { update(f, g, mf) { if (mf < 16) f.vx = f.facing * Math.max(Math.abs(f.vx), 4) * 0.97; } } }),
      fsmash: saberMove({ frames: 52, s: 14, e: 17, a0: 3.1, a1: 0.7, dmg: 15, tip: 17, angle: 40, tipAngle: 36, bkb: 30, kbg: 96, extra: { charge: 8 } }),
      usmash: saberMove({ frames: 46, s: 12, e: 17, a0: 1.6, a1: 3.7, dmg: 13, tip: 15, angle: 88, bkb: 32, kbg: 98, extra: { charge: 6 } }),
      nair: saberMove({ frames: 34, s: 5, e: 16, a0: 0.4, a1: TAU + 0.4, dmg: 10, angle: 45, bkb: 18, kbg: 85, extra: { air: true, landingLag: 10 } }),
      fair: saberMove({ frames: 36, s: 6, e: 10, a0: 3.0, a1: 0.6, dmg: 11, tip: 12, angle: 45, bkb: 18, kbg: 92, extra: { air: true, landingLag: 14 } }),
      bair: saberMove({ frames: 36, s: 7, e: 10, a0: -0.6, a1: -2.8, dmg: 12, tip: 13, angle: 140, bkb: 18, kbg: 96, extra: { air: true, landingLag: 14 } }),
      uair: saberMove({ frames: 32, s: 5, e: 11, a0: 1.0, a1: 5.2, dmg: 10, tip: 11, angle: 85, bkb: 22, kbg: 92, extra: { air: true, landingLag: 12 } }),

      // Hantavirus Vaccine: lobbed syringe; a hit poisons (1% every half second for 3 s).
      nspecial: {
        frames: 36, gravityMult: 0.6, hitboxes: [],
        pose: throwPose(12, (f, P, t) => { P.hold = t < 12 ? "syringe" : t < 26 ? "none" : null; }),
        update(f, g, mf) {
          if (mf !== 12) return;
          g.spawn({
            owner: f, x: f.x + f.facing * 18, y: f.y - f.h * 0.78, vx: f.facing * 7.5, vy: -6.5, gravity: 0.38,
            r: 7, dmg: 3, angle: 45, bkb: 18, kbg: 25, life: 100,
            draw(ctx, p) { drawSyringe(ctx, p.x, p.y, Math.atan2(p.vy, p.vx), 1); },
            onHit(p, T, g) { poison(p.owner, T, g); },
          });
        },
      },
      // Lightsaber Lunge: thrust that travels; once per airtime.
      sspecial: Object.assign(saberMove({ frames: 40, s: 7, e: 18, a0: 1.57, a1: 1.57, lean: 0.9, dmg: 11, tip: 12, angle: 40, bkb: 40, kbg: 70 }), {
        keepMomentum: true, noGravity: [6, 18],
        start(f) { f.vx *= 0.3; if (!f.grounded) f.vy = Math.min(f.vy, 0); },
        update(f, g, mf) {
          if (mf >= 6 && mf <= 18) { f.vx = f.facing * 12; if (!f.grounded) f.vy = 0; if (mf % 3 === 0) S.fx.spark(g, f.x - f.facing * 12, f.y - f.h * 0.5, "#8dffaa", 1); }
          else f.vx *= mf < 6 ? 0.8 : 0.85;
        },
      }),
      // Saber Spin: rising multi-hit twirl, helpless after.
      uspecial: {
        frames: 46, helpless: true, ledgeGrab: true, noGravity: [1, 28], noAirControl: true, keepMomentum: true,
        hitboxes: [hb(4, 25, 0, -40, 30, 2, 88, 50, 10), hb(26, 29, 0, -56, 34, 5, 80, 55, 100)],
        pose(f, P) { P.armF = [f.mf < 30 ? 1.57 : lerp(1.57, 2.6, clamp((f.mf - 30) / 6, 0, 1)), 0]; P.blade = 0; P.armB = [-1.2, 0.3]; P.legF = [0.2, -0.3]; P.legB = [-0.2, -0.3]; },
        start(f) { f.leaveGround(); f.vy = 0; f.vx *= 0.4; },
        update(f, g, mf, pad) {
          if (mf < 4) { f.vy = 0; f.vx *= 0.8; return; }
          if (mf <= 28) {
            if (f.grounded) f.leaveGround();
            f.vy = -8.8; f.vx = clamp(pad.x, -1, 1) * 4.2;
            if (mf % 5 === 0) f.hitSet.clear();
          }
        },
        onLand(f) { if (f.mf > 6) { f.setState("land"); f.lag = 16; } },
      },
      // 4 Red Bulls: drink, then ~10 s of speed, jump and damage boosts.
      dspecial: {
        frames: 52, gravityMult: 0.6, hitboxes: [],
        pose: animPose({
          armF: [[0, 0.4, 0.4], [10, 1.9, 2.0], [40, 1.9, 2.1], [46, 0.6, 0.5]],
          lean: [[0, 0], [12, -0.5], [40, -0.5], [48, 0]],
          extra(f, P, t) { P.hold = t < 46 ? "can" : null; },
        }),
        update(f, g, mf) {
          if (mf === 40) {
            f.buffs.speedBoost = 600; f.buffs.jumpBoost = 600; f.buffs.dmgBoost = 600;
            S.fx.text(g, f.x, f.y - f.h - 26, "4 RED BULLS!", "#ff5252");
            S.fx.burst(g, f.x, f.y - f.h / 2, "#3a6dff", 14);
          }
        },
      },
    },
    draw(ctx, f, g) {
      FRAME = g.frame;
      const spin = attacking(f, "uspecial") && f.mf >= 4 && f.mf <= 30;
      if (spin) {   // fake a 3D twirl by squashing x
        const c = Math.cos(f.mf * 0.8);
        ctx.save(); ctx.scale(Math.abs(c) < 0.2 ? (c < 0 ? -0.2 : 0.2) : c, 1);
      }
      const R = S.drawHumanoid(ctx, f, rfkLook, g);
      if (spin) {
        ctx.restore();
        ctx.save(); ctx.shadowColor = "#36ff6a"; ctx.shadowBlur = 12;
        ctx.strokeStyle = "rgba(120,255,150,.6)"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.ellipse(0, -f.h * 0.7, f.h * 0.95, 10, 0, 0, TAU); ctx.stroke(); ctx.restore();
      } else saberTrail(ctx, f, R);
    },
  });

  // ============================================================ STEVE JOBS
  // Zoner: Igun pellets, a long FaceTime beam, the Inav for recovery and a keynote trap.
  function steveLaser(f, g) {
    g.spawn({
      owner: f, x: f.x + f.facing * 32, y: f.y - f.h * 0.68, vx: f.facing * 15, r: 6, dmg: 3, angle: 25, bkb: 8, kbg: 35, life: 42, solid: false,
      draw(ctx, p) {
        ctx.save(); ctx.lineCap = "round";
        ctx.shadowColor = "#7fe9ff"; ctx.shadowBlur = 10;
        ctx.strokeStyle = "rgba(127,233,255,.8)"; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(p.x - p.vx * 1.6, p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.shadowBlur = 0; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.x - p.vx * 1.4, p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.restore();
      },
    });
  }
  function steveBoom(f, g, x, y) {
    g.spawn({
      owner: f, x, y, r: 46, dmg: 13, angle: 72, bkb: 42, kbg: 76, life: 8, pierce: true, solid: false,
      knockDir: (p, T) => (T.x < p.x ? -1 : 1),
      draw(ctx, p) {
        const k = 1 - p.life / 8, rr = p.r * (0.55 + 0.6 * k);
        const grd = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, rr);
        grd.addColorStop(0, `rgba(255,255,255,${1 - k * 0.6})`); grd.addColorStop(0.45, `rgba(140,220,255,${0.8 - k * 0.6})`); grd.addColorStop(1, "rgba(80,140,255,0)");
        ctx.fillStyle = grd; circle(ctx, p.x, p.y, rr); ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3; circle(ctx, p.x, p.y, rr * 1.1); ctx.stroke();
      },
    });
    S.fx.burst(g, x, y, "#bfe8ff", 14); S.fx.text(g, x, y - 40, "ONE MORE THING", "#ffffff");
    g.shake = Math.max(g.shake, 6);
  }
  function steveThing(f, g) {
    return g.spawn({
      owner: f, harmless: true, ground: true, x: f.x + f.facing * 30, y: f.y - 16, vx: f.facing * 1.5, vy: -2, gravity: 0.4, r: 9, life: 96,
      update(p) { if (p.onGround) p.vx = 0; },
      onExpire(p, g) { if (p.y < g.stage.blast.bottom - 20) steveBoom(p.owner, g, p.x, p.y - 6); },
      draw(ctx, p, g) {
        const k = p.life / 96, blink = p.life < 30 && (g.frame >> 2) % 2 === 0;
        ctx.save(); ctx.translate(p.x, p.y);
        const grd = ctx.createRadialGradient(0, 0, 2, 0, 0, 28);
        grd.addColorStop(0, "rgba(255,255,255,.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd; circle(ctx, 0, 0, 28); ctx.fill();
        ctx.fillStyle = "#111"; S.roundRect(ctx, -9, -9, 18, 18, 3); ctx.fill();
        ctx.strokeStyle = "#e6e6e6"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
        ctx.strokeStyle = blink ? "#ff5a48" : "#7fd8ff"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 14, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
        ctx.fillStyle = "#fff"; for (let i = -1; i <= 1; i++) { circle(ctx, i * 4, -17, 1.3); ctx.fill(); }
        ctx.restore();
      },
    });
  }
  function drawInav(ctx, f) {
    const d = f.data.inav || { x: 0, y: -1 }, lx = d.x * f.facing;
    ctx.save(); ctx.translate(0, 5); ctx.rotate(clamp(lx * 0.3 + (d.y > 0 ? 0.15 * Math.sign(lx || 1) : 0), -0.45, 0.45));
    if (f.mf >= 8 && f.mf <= 38) {   // exhaust
      const tr = ctx.createLinearGradient(0, 0, -lx * 60, -d.y * 60);
      tr.addColorStop(0, "rgba(111,211,255,.65)"); tr.addColorStop(1, "rgba(111,211,255,0)");
      ctx.strokeStyle = tr; ctx.lineWidth = 10; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-lx * 60, 2 - d.y * 60); ctx.stroke();
    }
    ctx.shadowColor = "#6fd3ff"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#e9edf2"; S.roundRect(ctx, -30, -4, 60, 9, 4.5); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#c3cad3"; ctx.fillRect(-26, 3, 52, 2);
    ctx.fillStyle = "#6fd3ff"; ctx.fillRect(-20, 5, 40, 2.5);
    ctx.fillStyle = "#1c2430"; S.roundRect(ctx, 13, -2.5, 11, 4, 1.5); ctx.fill();
    ctx.restore();
  }
  function drawIgun(ctx, hand) {
    ctx.save(); alongArm(ctx, hand); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#f2f3f5"; S.roundRect(ctx, -3, -3, 15, 7, 3); ctx.fill();
    ctx.fillStyle = "#9aa1aa"; ctx.fillRect(10, -1.5, 5, 3);
    ctx.fillStyle = "#7fe9ff"; ctx.fillRect(1, -1, 5, 1.6);
    ctx.restore();
  }
  function drawPhone(ctx, hand, lit) {
    ctx.save(); alongArm(ctx, hand); ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#1a1a1a"; S.roundRect(ctx, -2, -6, 6, 12, 1.8); ctx.fill();
    ctx.fillStyle = lit ? "#7dffa0" : "#3c4a5a"; ctx.fillRect(-1, -5, 4, 10);
    ctx.restore();
  }
  const BEAM = { x0: 40, x1: 360, step: 32 };
  const steveLook = {
    skin: "#eccaa9", shirt: "#141414", pants: "#3e5c85", shoes: "#a9a9a9", sleeve: "#161616",
    headR: 9.6, bodyW: 19,
    head(ctx, f, P, r) {
      faceBase(ctx, r, steveLook.skin, "#6f6a63");
      ctx.save(); circle(ctx, 0, 0, r); ctx.clip();
      ctx.fillStyle = "rgba(95,90,85,.32)"; ctx.beginPath(); ctx.ellipse(r * 0.32, r * 0.72, r * 0.85, r * 0.46, 0, 0, TAU); ctx.fill();   // stubble
      ctx.restore();
      ctx.fillStyle = "#615b54";   // receding: back and sides only
      ctx.beginPath(); ctx.arc(0, 0, r * 1.04, Math.PI * 0.62, Math.PI * 1.42); ctx.arc(r * 0.12, 0, r * 0.72, Math.PI * 1.42, Math.PI * 0.62, true); ctx.fill();
      ctx.fillStyle = S.shade(steveLook.skin, -0.07); ctx.beginPath(); ctx.ellipse(-r * 0.12, r * 0.06, r * 0.16, r * 0.23, 0, 0, TAU); ctx.fill();
      // round glasses
      ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = Math.max(1, r * 0.09);
      circle(ctx, r * 0.52, -r * 0.08, r * 0.26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.27, -r * 0.1); ctx.lineTo(-r * 0.06, -r * 0.02); ctx.stroke();
      ctx.fillStyle = "rgba(200,230,255,.25)"; circle(ctx, r * 0.52, -r * 0.08, r * 0.22); ctx.fill();
      // rolled turtleneck collar
      ctx.fillStyle = "#141414"; ctx.beginPath(); ctx.ellipse(-r * 0.05, r * 1.02, r * 0.64, r * 0.27, 0, 0, TAU); ctx.fill();
    },
    torso(ctx, f, P, b) {
      ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(b.x + 2, b.y + (b.h * i) / 4); ctx.lineTo(b.x + b.w - 2, b.y + (b.h * i) / 4); ctx.stroke(); }
    },
    prop(ctx, f, P, hand) {
      if (P.hold === "igun") drawIgun(ctx, hand);
      else if (P.hold === "phone") drawPhone(ctx, hand, attacking(f, "sspecial") && f.mf >= 12 && f.mf <= 32);
    },
  };

  S.registerFighter({
    id: "steve-jobs", slug: "steve-jobs", name: "Steve Jobs", short: "Steve",
    tagline: "Turtleneck of algorithms and starlight. One more thing.",
    color: "#2b2b2b",
    stats: { weight: 90, walk: 4.0, run: 7.0, dashInit: 7.4, airSpeed: 4.7, gravity: 0.48, fallSpeed: 8.6, jump: 13.3, airJump: 12.4, width: 32, height: 72 },
    reach: 1, power: 0.95,
    moveNames: { nspecial: "Igun", sspecial: "FaceTime Laser", uspecial: "Inav", dspecial: "One More Thing", fsmash: "Ibeam", nair: "Spotlight" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "usmash"], trap: "dspecial" },
    tick(f) { if (f.data.igunCD > 0) f.data.igunCD--; },
    moves: {
      ftilt: { frames: 24, pose: "punch", hitboxes: [hb(6, 9, 44, -42, 10, 8, 30, 15, 95), hb(6, 9, 24, -42, 11, 7, 30, 15, 95)] },
      fsmash: {
        frames: 50, charge: 8,
        hitboxes: [hb(16, 20, 30, -48, 13, 15, 36, 30, 98), hb(16, 20, 56, -48, 13, 14, 36, 30, 96), hb(16, 20, 82, -48, 12, 12, 38, 28, 92)],
        pose: animPose({ armF: [[0, 0.4, 0.4], [8, 1.0, 1.4], [15, 1.0, 1.4], [16, 1.57, 0], [30, 1.57, 0], [50, 0.4, 0.4]], lean: [[0, 0], [8, -0.3], [16, 0.4], [50, 0]], extra(f, P, t) { P.hold = "igun"; } }),
      },
      nair: { frames: 34, air: true, landingLag: 10, hitboxes: [hb(3, 6, 0, -36, 28, 9, 50, 18, 85), hb(7, 20, 0, -36, 24, 5, 55, 10, 60)],
        pose: animPose({ armF: [[0, 0.4, 0.4], [3, 2.0, 0.1], [20, 2.0, 0.1], [34, 1.2, 0.3]], armB: [[0, -0.4, 0.3], [3, -2.0, 0.1], [20, -2.0, 0.1], [34, -1.0, 0.3]] }) },

      // Igun: quick pellet, rate-limited by a cooldown.
      nspecial: {
        frames: 22, iasa: 18, gravityMult: 0.5, hitboxes: [],
        pose: animPose({ armF: [[0, 0.4, 0.4], [5, 1.57, 0], [16, 1.57, 0], [22, 0.5, 0.4]], extra(f, P) { P.hold = "igun"; } }),
        update(f, g, mf) { if (mf === 7 && !(f.data.igunCD > 0)) { steveLaser(f, g); f.data.igunCD = 26; } },
      },
      // FaceTime Laser: long beam (a row of hitboxes), big endlag.
      sspecial: {
        frames: 66, noGravity: [1, 34], noAirControl: true, shieldMult: 1.4,
        hitboxes: (function () {
          const list = [];
          for (let x = BEAM.x0; x <= BEAM.x1; x += BEAM.step) list.push(hb(20, 31, x, -50, 15, 9, 32, 45, 62, { shieldMult: 1.4 }));
          return list;
        })(),
        pose: animPose({ armF: [[0, 0.4, 0.4], [10, 1.57, 0], [52, 1.57, 0], [66, 0.4, 0.4]], lean: [[0, 0], [18, 0.1], [21, -0.35], [32, -0.3], [48, 0]], extra(f, P) { P.hold = "phone"; } }),
        start(f) { f.vx *= 0.3; if (!f.grounded) f.vy = 0; },
        update(f) { f.vx *= 0.85; },
      },
      // Inav: 8-way ride for 30 frames, contact damage, helpless after.
      uspecial: {
        frames: 46, helpless: true, ledgeGrab: true, noGravity: [1, 38], noAirControl: true, keepMomentum: true,
        hitboxes: [hb(8, 37, 0, -30, 30, 8, 65, 50, 60)],
        pose: animPose({ armF: [[0, 0.4, 0.4], [6, 0.9, 0.3]], armB: [[0, -0.2, 0.3], [6, -0.7, 0.3]], legs: [[0, 0.12, -0.05, -0.12, -0.05]] }),
        start(f) { f.vx *= 0.3; if (!f.grounded) f.vy = 0; f.data.inav = { x: 0, y: -1 }; },
        update(f, g, mf, pad) {
          if (mf < 8) { f.vx *= 0.8; if (!f.grounded) f.vy = 0; return; }
          if (mf === 8) {
            let x = pad.x, y = pad.y;
            if (Math.hypot(x, y) < 0.3) { x = 0; y = -1; }
            const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4);
            let dx = Math.round(Math.cos(a) * 1000) / 1000, dy = Math.round(Math.sin(a) * 1000) / 1000;
            if (f.grounded && dy > 0) { dy = 0; dx = dx ? Math.sign(dx) : f.facing; }   // can't drive into the floor
            f.data.inav = { x: dx, y: dy };
            if (dx) f.facing = Math.sign(dx);
            S.fx.ring(g, f.x, f.y, "#6fd3ff");
          }
          if (mf <= 37) {
            const d = f.data.inav;
            if (f.grounded && d.y < 0) f.leaveGround();
            f.vx = d.x * 10; f.vy = d.y * 10;
          } else if (mf === 38) { f.vx *= 0.7; f.vy = Math.min(f.vy, 0) * 0.3; }
        },
        onLand(f) { if (f.mf > 10) { f.setState("land"); f.lag = 14; } },
      },
      // One More Thing: place a keynote trap; press again (or wait ~1.5 s) to detonate.
      dspecial: {
        frames: 30, hitboxes: [],
        pose: animPose({ armF: [[0, 0.4, 0.4], [8, 1.0, 0.3], [20, 1.0, 0.3], [30, 0.4, 0.4]], crouch: [[0, 0], [8, 0.35], [20, 0.35], [30, 0]], extra(f, P) { if (alive(f.data.thing) || f.mf > 10) P.hold = "phone"; } }),
        update(f, g, mf) {
          if (mf !== 10) return;
          const T = f.data.thing;
          if (alive(T)) { T.dead = true; steveBoom(f, g, T.x, T.y - 6); f.data.thing = null; }
          else f.data.thing = steveThing(f, g);
        },
      },
    },
    draw(ctx, f, g) {
      FRAME = g.frame;
      const ride = attacking(f, "uspecial") && f.mf >= 3 && f.mf <= 42;
      if (ride) drawInav(ctx, f);
      const R = S.drawHumanoid(ctx, f, steveLook, g);
      const hand = R.armF.end;
      if (attacking(f, "sspecial")) {
        const t = f.mf;
        if (t >= 10 && t < 20) {   // charging
          const k = (t - 10) / 10;
          ctx.fillStyle = `rgba(125,255,160,${0.3 + 0.5 * k})`; circle(ctx, hand.x + 4, hand.y, 3 + k * 7); ctx.fill();
        } else if (t >= 20 && t <= 32) {
          const fade = t > 31 ? 0.4 : 1, w = 11 + Math.sin(FRAME * 1.3) * 3;
          ctx.save(); ctx.globalAlpha = fade;
          const grd = ctx.createLinearGradient(hand.x, 0, BEAM.x1 + 20, 0);
          grd.addColorStop(0, "rgba(140,255,170,.95)"); grd.addColorStop(1, "rgba(60,220,120,.35)");
          ctx.shadowColor = "#4dff88"; ctx.shadowBlur = 18;
          ctx.fillStyle = grd; ctx.fillRect(hand.x, hand.y - w, BEAM.x1 + 20 - hand.x, w * 2);
          ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.fillRect(hand.x, hand.y - w * 0.3, BEAM.x1 + 16 - hand.x, w * 0.6);
          ctx.restore();
        }
      } else if (attacking(f, "fsmash") && f.mf >= 16 && f.mf <= 21) {   // Ibeam
        const k = 1 - (f.mf - 16) / 6;
        ctx.save(); ctx.shadowColor = "#7fe9ff"; ctx.shadowBlur = 16;
        ctx.fillStyle = `rgba(127,233,255,${0.75 * k})`; ctx.fillRect(hand.x, hand.y - 9, 96 - hand.x, 18);
        ctx.fillStyle = `rgba(255,255,255,${k})`; ctx.fillRect(hand.x, hand.y - 3, 94 - hand.x, 6);
        ctx.restore();
      } else if (attacking(f, "nair") && f.mf >= 3 && f.mf <= 20) {   // Spotlight
        const k = f.mf <= 6 ? 1 : 1 - (f.mf - 6) / 15;
        const grd = ctx.createRadialGradient(0, -36, 4, 0, -36, 40);
        grd.addColorStop(0, `rgba(255,255,255,${0.5 * k})`); grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd; circle(ctx, 0, -36, 40); ctx.fill();
      }
    },
  });
})();
