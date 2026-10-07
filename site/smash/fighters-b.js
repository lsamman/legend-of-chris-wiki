/* Super Smash Ballers — roster B: Plankton, Barack Obama, Mark Zuckerberg, Hank Hill.
   Each fighter overrides the generic moveset where it matters; sim logic only uses g.rng(). */
(function () {
  "use strict";
  const S = window.Smash;
  const { hb, clamp, sign } = S;
  const TAU = Math.PI * 2;

  // ------------------------------------------------------------ shared helpers
  // Multi-hit: forget who this move already hit every `every` frames.
  const rehit = (f, every) => { if (f.mf % every === 0) f.hitSet.clear(); };
  const alive = (f) => f && !f.out && f.state !== "dead";
  // Rotate the canvas so +x runs along a forearm (hand.ang is measured from straight down).
  const alongArm = (ctx, hand) => { ctx.translate(hand.x, hand.y); ctx.rotate(Math.PI / 2 - hand.ang); };
  const inMove = (f, name) => f.state === "attack" && f.moveName === name;
  function puff(g, x, y, vx, vy, color, size, life) {
    g.particles.push({ x, y, vx, vy, life, max: life, color, size });
  }
  function glow(ctx, x, y, r, color, a) {
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color); grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = a; ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }
  // Re-applies the rig's tumble rotation so post-drawn details line up with drawHumanoid's limbs.
  function withRigRot(ctx, f, rig, fn) {
    ctx.save();
    if (rig.P.rot) { ctx.translate(0, -f.h / 2); ctx.rotate(rig.P.rot); ctx.translate(0, f.h / 2); }
    fn(); ctx.restore();
  }

  // ================================================================= PLANKTON
  const PL_GREEN = "#4f9d3a", PL_DARK = "#2c5e22", METAL = "#a3aab1", METAL_D = "#5f666d";
  const chairless = (f) => !!(f.data.chairOut || f.data.chairCD > 0);

  // Folded metal chair, drawn along +x from the grip (the top of the backrest).
  function drawChair(ctx, s) {
    ctx.save(); ctx.scale(s, s);
    ctx.lineCap = "round";
    ctx.strokeStyle = METAL_D; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-5, -5.5); ctx.lineTo(21, -5.5); ctx.moveTo(-5, 5.5); ctx.lineTo(21, 5.5); ctx.stroke();
    ctx.strokeStyle = METAL; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-5, -5.5); ctx.lineTo(21, -5.5); ctx.moveTo(-5, 5.5); ctx.lineTo(21, 5.5); ctx.stroke();
    ctx.fillStyle = "#7c838a"; S.roundRect(ctx, 7, -5, 9, 10, 1.5); ctx.fill();                       // folded seat
    ctx.fillStyle = METAL; S.roundRect(ctx, -7, -7, 9, 14, 2.5); ctx.fill();                          // backrest
    ctx.strokeStyle = METAL_D; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-5, 4); ctx.stroke();
    ctx.fillStyle = "#26292c"; ctx.fillRect(20, -7, 3, 3); ctx.fillRect(20, 4, 3, 3);                 // rubber feet
    ctx.restore();
  }

  function drawPlankton(ctx, f, g) {
    const P = S.pose(f, g), t = g ? g.frame : 0;
    const copter = inMove(f, "uspecial") && f.mf < 60;
    ctx.save();
    if (P.rot) { ctx.translate(0, -20); ctx.rotate(P.rot); ctx.translate(0, 20); }
    const hip = { x: P.lean * 1.5, y: -10 + P.bob * 0.6 + P.crouch * 4 };
    const c = { x: hip.x + P.lean * 2, y: hip.y - 13 };   // body centre
    const legF = P.legF.slice(), legB = P.legB.slice();
    if (P.crouch) { legF[0] += P.crouch * 0.6; legF[1] -= P.crouch * 1.2; legB[1] -= P.crouch; }
    const lF = S.limb({ x: hip.x + 2, y: hip.y }, legF[0], legF[1], 5, 5.5);
    const lB = S.limb({ x: hip.x - 2, y: hip.y }, legB[0], legB[1], 5, 5.5);
    const sh = { x: c.x, y: c.y - 2 };
    const aF = S.limb({ x: sh.x + 6, y: sh.y }, P.armF[0], P.armF[1], 6, 6);
    const aB = S.limb({ x: sh.x - 6, y: sh.y }, P.armB[0], P.armB[1], 6, 6);
    const shoe = (L, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(L.end.x + 1.2, L.end.y, 3, 1.8, 0, 0, TAU); ctx.fill(); };
    // back limbs
    S.strokeLimb(ctx, lB, PL_DARK, 2.4); shoe(lB, "#1d3a17");
    S.strokeLimb(ctx, aB, PL_DARK, 2.2);
    // body: a tall bean, slightly fatter at the bottom
    const grd = ctx.createLinearGradient(c.x - 9, 0, c.x + 9, 0);
    grd.addColorStop(0, "#3c8530"); grd.addColorStop(0.55, PL_GREEN); grd.addColorStop(1, "#6fbf55");
    ctx.fillStyle = grd; ctx.strokeStyle = PL_DARK; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 15);
    ctx.bezierCurveTo(c.x + 10, c.y - 15, c.x + 10.5, c.y + 11, c.x + 1, c.y + 13);
    ctx.bezierCurveTo(c.x - 9.5, c.y + 14, c.x - 9.5, c.y - 15, c.x, c.y - 15);
    ctx.fill(); ctx.stroke();
    // antennae (a rotor while copter-ing)
    const top = { x: c.x + 0.5, y: c.y - 14.5 };
    ctx.strokeStyle = PL_DARK; ctx.lineWidth = 1.3; ctx.lineCap = "round";
    if (copter) {
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 7); ctx.stroke();
      const sp = t * 0.9;
      for (let k = 0; k < 2; k++) {
        const w = Math.cos(sp + k * Math.PI / 2) * 15;
        ctx.strokeStyle = "rgba(44,94,34,.85)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(top.x - w, top.y - 7 + k); ctx.lineTo(top.x + w, top.y - 7 - k); ctx.stroke();
      }
      ctx.fillStyle = "rgba(160,220,140,.25)"; ctx.beginPath(); ctx.ellipse(top.x, top.y - 7, 16, 3, 0, 0, TAU); ctx.fill();
    } else {
      const sway = Math.sin(t * 0.13 + f.port) * 1.5 - f.vx * 0.3;
      for (const d of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(top.x + d * 2, top.y + 1);
        ctx.quadraticCurveTo(top.x + d * 4 + sway, top.y - 7, top.x + d * 7 + sway * 1.4, top.y - 11);
        ctx.stroke();
      }
    }
    // one big eye
    const ex = c.x + 3, ey = c.y - 5;
    const hurt = f.state === "hitstun" || f.state === "tumble";
    ctx.fillStyle = "#fbf9e8"; ctx.strokeStyle = "#a8a27a"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(ex, ey, 5.6, 6.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const look = hurt ? 0 : 1.6;
    ctx.fillStyle = "#d1202b"; ctx.beginPath(); ctx.arc(ex + look, ey + 0.3, hurt ? 2.2 : 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(ex + look + 0.3, ey + 0.3, hurt ? 1 : 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex + look - 0.9, ey - 1, 0.8, 0, TAU); ctx.fill();
    // scheming brow + mouth
    ctx.strokeStyle = "#173312"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(ex - 5.5, ey - 8.2); ctx.lineTo(ex + 5.5, ey - 5.4); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (hurt) ctx.arc(c.x + 3, c.y + 6.5, 2, 0, TAU);
    else { ctx.moveTo(c.x - 1.5, c.y + 5); ctx.quadraticCurveTo(c.x + 3, c.y + 7.5, c.x + 7, c.y + 4.2); }
    ctx.stroke();
    // front leg, arm and the chair
    S.strokeLimb(ctx, lF, PL_DARK, 2.4); shoe(lF, "#1d3a17");
    if (!chairless(f)) {
      ctx.save(); alongArm(ctx, { x: aF.end.x, y: aF.end.y, ang: aF.ang2 }); ctx.translate(2, 0); drawChair(ctx, 1); ctx.restore();
    }
    S.strokeLimb(ctx, aF, PL_DARK, 2.2);
    ctx.fillStyle = PL_GREEN; ctx.beginPath(); ctx.arc(aF.end.x, aF.end.y, 1.8, 0, TAU); ctx.fill();
    ctx.restore();
    // swing streak on chair smashes
    if (f.state === "attack" && !chairless(f) && /smash|dspecial|fair/.test(f.moveName) && P.reach && P.reach.active) {
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -20, Math.hypot(P.reach.x, P.reach.y + 20) + 4, Math.atan2(P.reach.y + 20, P.reach.x) - 0.7, Math.atan2(P.reach.y + 20, P.reach.x) + 0.2); ctx.stroke();
    }
  }

  // Chair moves come in two flavours: with the chair, and bare-handed while it's away.
  function chairHB(withChair, without) { return (f) => (chairless(f) ? without : withChair); }

  S.registerFighter({
    id: "plankton", slug: "plankton", name: "Plankton", short: "Plankton",
    tagline: "Orphan. Strategist. Folding-chair enjoyer.",
    color: "#4f9d3a",
    stats: { weight: 62, walk: 3.2, run: 6.6, dashInit: 7.0, traction: 0.6, airSpeed: 4.6, airAccel: 0.34, airFriction: 0.1,
      gravity: 0.34, fallSpeed: 6.6, fastFall: 10.5, jump: 11.5, shortHop: 7.2, airJump: 10.2, jumps: 3, jumpsquat: 3, width: 24, height: 40 },
    reach: 0.6, power: 0.9,
    moveNames: { nspecial: "Chair Toss", sspecial: "Tiny Scuttle", uspecial: "Antenna Copter", dspecial: "Folding Chair Slam" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "usmash", "dspecial"] },
    init(f) { f.data.chairOut = null; f.data.chairCD = 0; },
    tick(f) { if (f.data.chairCD > 0) f.data.chairCD--; },
    draw: drawPlankton,
    moves: {
      ftilt: { frames: 24, hitboxes: chairHB([hb(6, 9, 26, -20, 12, 8, 35, 12, 95)], [hb(5, 8, 16, -20, 8, 5, 35, 10, 90)]) },
      fsmash: { frames: 50, charge: 8, hitboxes: chairHB(
        [hb(16, 19, 34, -22, 17, 17, 40, 30, 100), hb(16, 19, 16, -22, 12, 14, 40, 30, 100)],
        [hb(14, 17, 18, -20, 9, 9, 40, 25, 90)]) },
      usmash: { frames: 46, charge: 6, hitboxes: chairHB(
        [hb(12, 17, 4, -52, 17, 15, 88, 30, 100), hb(12, 17, 0, -32, 12, 12, 90, 30, 95)],
        [hb(11, 15, 0, -46, 10, 9, 88, 25, 90)]) },
      dsmash: { frames: 48, charge: 4, crouch: true, hitboxes: chairHB(
        [hb(10, 12, 28, -6, 15, 14, 25, 28, 95), hb(16, 18, -28, -6, 15, 14, 155, 28, 95)],
        [hb(9, 11, 16, -6, 9, 8, 25, 20, 85), hb(14, 16, -16, -6, 9, 8, 155, 20, 85)]) },
      fair: { frames: 38, air: true, landingLag: 16, hitboxes: chairHB(
        [hb(9, 13, 24, -22, 14, 12, 40, 20, 95)], [hb(8, 11, 15, -22, 9, 8, 45, 15, 85)]) },
      nspecial: {
        frames: 36,
        start(f) { f.data.tossed = false; if (chairless(f)) f.mf = 14; },   // bare-handed: a quick fist shake
        hitboxes: (f) => (f.data.tossed || !chairless(f) ? [] : [hb(17, 19, 15, -22, 8, 3, 45, 20, 40)]),
        update(f, g, mf) {
          if (mf !== 12 || chairless(f)) return;
          f.data.tossed = true;
          f.data.chairOut = g.spawn({
            owner: f, x: f.x + f.facing * 14, y: f.y - 30, vx: f.facing * 6.5, vy: -6.5, gravity: 0.36, r: 12,
            dmg: 9, angle: 50, bkb: 30, kbg: 70, life: 110, facing: f.facing,
            onExpire(p, g) {
              if (f.data.chairOut === p) { f.data.chairOut = null; f.data.chairCD = 24; }
              S.fx.spark(g, p.x, p.y, "#cfd5da", 8); S.audio && S.audio.thud && S.audio.thud();
            },
            draw(ctx, p) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 0.38 * p.facing); ctx.translate(-8, 0); drawChair(ctx, 1.15); ctx.restore(); },
          });
        },
        pose(f, P) { const k = f.mf < 12 ? f.mf / 12 : 1; P.armF = [-0.8 + k * 3.2, 0.2]; P.lean = f.mf < 12 ? -0.5 : 0.6; },
      },
      sspecial: {
        frames: 36, keepMomentum: true,
        hitboxes: [hb(5, 17, 10, -9, 12, 7, 30, 35, 55)],
        start(f) { if (!f.grounded) f.vy = Math.min(f.vy, -2); },
        update(f, g, mf) {
          if (mf >= 4 && mf <= 18) { f.vx = f.facing * 10.5; if (mf % 3 === 0) S.fx.spark(g, f.x - f.facing * 8, f.y - 2, "#d9e8c0", 1); }
          else if (f.grounded) f.vx *= 0.8;
          if (!f.grounded && mf <= 18) f.vy = Math.min(f.vy, 1.5);
        },
        pose(f, P) {
          const ph = f.mf * 1.2;
          P.lean = 1.2; P.crouch = 0.35;
          P.legF = [Math.sin(ph) * 1.1, -0.6]; P.legB = [-Math.sin(ph) * 1.1, -0.6];
          P.armF = [1.3, 0.2]; P.armB = [-1.2, 0.3];
        },
      },
      uspecial: {
        frames: 72, helpless: true, ledgeGrab: true, noAirControl: true, noGravity: [1, 56],
        hitboxes: [
          hb(3, 52, 0, -46, 15, 2, 88, 38, 8),
          hb(53, 56, 0, -46, 18, 4, 80, 55, 85),
        ],
        start(f) { f.leaveGround(); f.vy = -2; },
        update(f, g, mf, pad) {
          if (mf <= 56) { f.vy = Math.max(-4.8, f.vy - 0.6); rehit(f, 6); }
          f.vx += (pad.x * 3.4 - f.vx) * 0.15;
          if (mf % 4 === 0 && mf < 56) S.fx.spark(g, f.x, f.y - 50, "#bfe8a8", 1);
        },
        pose(f, P) { P.armF = [2.7, 0.2]; P.armB = [-2.6, -0.2]; P.legF = [0.25, -0.2]; P.legB = [-0.25, -0.2]; P.bob = Math.sin(f.mf * 0.5); },
      },
      dspecial: {
        frames: 50,
        hitboxes: chairHB(
          [hb(18, 21, 22, -8, 20, 15, 70, 42, 82), hb(18, 20, -8, -8, 13, 11, 110, 35, 80)],
          [hb(16, 18, 14, -8, 10, 8, 70, 30, 70)]),
        update(f, g, mf) { if (mf === 18) { g.shake = Math.max(g.shake, chairless(f) ? 2 : 6); S.fx.spark(g, f.x + f.facing * 24, f.y, "#d8dde2", 8); S.fx.ring(g, f.x + f.facing * 22, f.y, "#ffffff"); } },
        pose(f, P) { const k = clamp(f.mf / 18, 0, 1); P.armF = [3.0 - k * 2.0, 0.1]; P.armB = [2.8 - k * 2.0, 0.2]; P.lean = -0.6 + k * 1.4; P.crouch = k * 0.5; },
      },
      dspecialAir: {
        frames: 44, air: true, landingLag: 18,
        hitboxes: chairHB(
          [hb(10, 16, 4, 2, 15, 12, -90, 25, 78), hb(17, 26, 4, 0, 12, 7, 60, 20, 60)],
          [hb(10, 15, 2, 2, 9, 7, -90, 15, 50)]),
        update(f, g, mf) { if (mf === 8) { f.vy = Math.max(f.vy, 4); } },
        pose(f, P) { const k = clamp(f.mf / 10, 0, 1); P.armF = [2.8 - k * 2.8, 0.1]; P.legF = [0.8, -1.2]; P.legB = [-0.2, -0.8]; },
      },
    },
  });

  // ================================================================= BARACK OBAMA
  const EMERALDS = ["#2fd35a", "#ff3b47", "#2f7bff", "#ffd93b", "#38e1ff", "#c04bff", "#eef2f5"];
  function drawEmerald(ctx, x, y, s, color, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot || 0); ctx.scale(s, s);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(-2.5, -5); ctx.lineTo(2.5, -5); ctx.lineTo(5, -2); ctx.lineTo(0, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.beginPath(); ctx.moveTo(-2.5, -5); ctx.lineTo(2.5, -5); ctx.lineTo(1.5, -2); ctx.lineTo(-1.5, -2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.lineWidth = 0.6; ctx.beginPath();
    ctx.moveTo(-5, -2); ctx.lineTo(-2.5, -5); ctx.lineTo(2.5, -5); ctx.lineTo(5, -2); ctx.lineTo(0, 6); ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  const OB_SKIN = "#8a5a3c", OB_SUIT = "#23262e";
  let obBox = null;
  const obamaLook = {
    skin: OB_SUIT, shirt: OB_SUIT, pants: "#22252d", shoes: "#0d0d0f",
    head(ctx, f, P, r) {
      // ear, face, close-cropped greying hair
      ctx.fillStyle = S.shade(OB_SKIN, -0.05); ctx.beginPath(); ctx.ellipse(-r * 0.18, r * 0.05, r * 0.24, r * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = OB_SKIN; ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.95, r * 1.05, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = S.shade(OB_SKIN, -0.07); ctx.beginPath(); ctx.ellipse(-r * 0.18, r * 0.05, r * 0.17, r * 0.25, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#1e1a17";
      ctx.beginPath(); ctx.ellipse(r * 0.05, -r * 0.48, r * 0.95, r * 0.6, 0, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.fillRect(-r * 0.85, -r * 0.62, r * 0.5, r * 0.55);
      // eyes, brow, nose, smile
      ctx.fillStyle = "#1a1210"; ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.12, r * 0.1, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#1e1a17"; ctx.lineWidth = r * 0.12; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(r * 0.38, -r * 0.34); ctx.lineTo(r * 0.75, -r * 0.32); ctx.stroke();
      ctx.strokeStyle = S.shade(OB_SKIN, -0.2); ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.moveTo(r * 0.95, -r * 0.05); ctx.lineTo(r * 1.08, r * 0.22); ctx.lineTo(r * 0.92, r * 0.28); ctx.stroke();
      const hurt = f.state === "hitstun" || f.state === "tumble";
      ctx.strokeStyle = "#3a1e14"; ctx.lineWidth = r * 0.11;
      ctx.beginPath();
      if (hurt) { ctx.moveTo(r * 0.5, r * 0.55); ctx.lineTo(r * 0.85, r * 0.5); }
      else ctx.arc(r * 0.62, r * 0.36, r * 0.27, 0.25, 1.75);
      ctx.stroke();
    },
    torso(ctx, f, P, b) {
      obBox = b;
      const cx = b.x + b.w * 0.58;
      // shirt V, tie, lapels, flag pin
      ctx.fillStyle = "#f4f4f2";
      ctx.beginPath(); ctx.moveTo(cx - b.w * 0.28, b.y); ctx.lineTo(cx + b.w * 0.28, b.y); ctx.lineTo(cx, b.y + b.h * 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#2a5db0";
      ctx.beginPath(); ctx.moveTo(cx - 2.2, b.y + 1); ctx.lineTo(cx + 2.2, b.y + 1); ctx.lineTo(cx + 3, b.y + b.h * 0.5); ctx.lineTo(cx, b.y + b.h * 0.58); ctx.lineTo(cx - 3, b.y + b.h * 0.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#11141a"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx - b.w * 0.3, b.y); ctx.lineTo(cx - 1, b.y + b.h * 0.46); ctx.moveTo(cx + b.w * 0.3, b.y); ctx.lineTo(cx + 1, b.y + b.h * 0.46); ctx.stroke();
      ctx.fillStyle = "#11141a"; ctx.beginPath(); ctx.arc(cx, b.y + b.h * 0.66, 1.2, 0, TAU); ctx.fill();
      const px = cx + b.w * 0.2, py = b.y + b.h * 0.2;
      ctx.fillStyle = "#c8202f"; ctx.fillRect(px, py, 4.5, 3);
      ctx.fillStyle = "#fff"; ctx.fillRect(px, py + 1, 4.5, 0.8);
      ctx.fillStyle = "#1f3f8f"; ctx.fillRect(px, py, 2, 1.6);
    },
    behind(ctx, f, P) { if (inMove(f, "uspecial")) ascentEmeralds(ctx, f, true); },
  };
  function ascentEmeralds(ctx, f, back) {
    const a0 = f.mf * 0.35;
    for (let i = 0; i < 7; i++) {
      const a = a0 + (i / 7) * TAU, z = Math.sin(a);
      if ((z < 0) !== back) continue;
      const x = Math.cos(a) * 30, y = -f.h * 0.5 + z * 9;
      glow(ctx, x, y, 12, EMERALDS[i], 0.5);
      drawEmerald(ctx, x, y, 1.1, EMERALDS[i], a);
    }
  }
  // The suit has full sleeves, so hands + cuffs are drawn on top of the rig.
  function obamaHands(ctx, f, rig) {
    withRigRot(ctx, f, rig, () => {
      const w = 7 * f.h / 70;
      const hand = (L, front) => {
        const b = obBox;
        if (!front && b && L.end.x > b.x - 2 && L.end.x < b.x + b.w + 2 && L.end.y > b.y && L.end.y < b.y + b.h) return;   // hidden behind torso
        const dx = L.end.x - L.joint.x, dy = L.end.y - L.joint.y, m = Math.hypot(dx, dy) || 1;
        ctx.strokeStyle = "#f4f4f2"; ctx.lineWidth = w * 0.9; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(L.end.x - dx / m * 4, L.end.y - dy / m * 4); ctx.lineTo(L.end.x - dx / m * 2, L.end.y - dy / m * 2); ctx.stroke();
        ctx.fillStyle = front ? OB_SKIN : S.shade(OB_SKIN, -0.08);
        ctx.beginPath(); ctx.arc(L.end.x, L.end.y, w * 0.58, 0, TAU); ctx.fill();
      };
      hand(rig.armB, false); hand(rig.armF, true);
      if (inMove(f, "uspecial")) ascentEmeralds(ctx, f, false);
      // glowing fist on Chaos Punch / Chaos Spear
      if ((inMove(f, "fsmash") && f.mf >= 8 && f.mf <= 20) || (inMove(f, "nspecial") && f.mf >= 4 && f.mf <= 12)) {
        glow(ctx, rig.armF.end.x, rig.armF.end.y, 16, inMove(f, "fsmash") ? "#5dff8a" : "#ffe866", 0.8);
      }
      if (inMove(f, "usmash") && f.mf >= 8 && f.mf <= 22) {
        for (let i = 0; i < 7; i++) drawEmerald(ctx, Math.sin(i * 2.3 + f.mf * 0.3) * 12, -f.h - 6 - ((f.mf - 8) * 5 + i * 9) % 60, 1, EMERALDS[i], f.mf * 0.2 + i);
      }
    });
  }
  function drawObama(ctx, f, g) {
    const tp = inMove(f, "sspecial") ? f.mf : -1;
    let a = 1;
    if (tp >= 3 && tp < 10) a = 1 - (tp - 3) / 7;
    else if (tp >= 10 && tp < 16) a = (tp - 10) / 6;
    if (a < 1) { glow(ctx, 0, -f.h / 2, 46, "#7dffb0", 0.6 * (1 - a)); ctx.globalAlpha *= Math.max(0.05, a); }
    const rig = S.drawHumanoid(ctx, f, obamaLook, g);
    obamaHands(ctx, f, rig);
    ctx.globalAlpha = 1;
  }

  function chaosSpear(f, g) {
    g.spawn({
      owner: f, x: f.x + f.facing * 30, y: f.y - f.h * 0.6, vx: f.facing * 12.5, vy: 0, r: 9, dmg: 7, angle: 35, bkb: 22, kbg: 45,
      life: 55, facing: f.facing, solid: false,
      update(p, g) { if (p.t % 2 === 0) puff(g, p.x - p.facing * 10, p.y + g.rng.range(-3, 3), -p.facing * 0.5, -0.4, "#fff3a0", 3, 10); },
      draw(ctx, p) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.facing, 1);
        glow(ctx, 0, 0, 22, "#fff17a", 0.7);
        ctx.fillStyle = "#fffbe0";
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-4, -5); ctx.lineTo(0, 0); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#ffd23a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(4, 0); ctx.stroke();
        ctx.restore();
      },
    });
  }

  function spawnOrbit(f, g) {
    const shared = new Set();
    f.data.orbit = [];
    for (let i = 0; i < 7; i++) {
      f.data.orbit.push(g.spawn({
        owner: f, x: f.x, y: f.y - f.h / 2, r: 10, dmg: 3, angle: 361, bkb: 38, kbg: 40, life: 240,
        pierce: true, solid: false, hits: shared, idx: i,
        knockDir: (p, T) => sign(T.x - f.x) || f.facing,
        update(p, g) {
          if (!alive(f)) { p.life = 1; return; }
          if (p.idx === 0 && p.t % 30 === 0) shared.clear();
          const a = g.frame * 0.085 + (p.idx / 7) * TAU, R = 48;
          p.x = f.x + Math.cos(a) * R; p.y = f.y - f.h / 2 + Math.sin(a) * R * 0.75;
          p.behind = Math.sin(a * 2) < -0.6;   // cosmetic depth
        },
        draw(ctx, p) {
          const fade = Math.min(1, p.life / 20, p.t / 8);
          ctx.globalAlpha = fade; glow(ctx, p.x, p.y, 16, EMERALDS[p.idx], 0.55 * fade);
          ctx.globalAlpha = fade; drawEmerald(ctx, p.x, p.y, 1.35, EMERALDS[p.idx], p.t * 0.05); ctx.globalAlpha = 1;
        },
      }));
    }
  }

  S.registerFighter({
    id: "barack-obama", slug: "barack-obama", name: "Barack Obama", short: "Obama",
    tagline: "Obamna. Holder of the 7 Chaos Emeralds.",
    color: "#2a5db0",
    stats: { weight: 100, walk: 4.0, run: 7.2, dashInit: 7.6, airSpeed: 4.9, gravity: 0.5, fallSpeed: 9, jump: 13.5, airJump: 12.5, width: 34, height: 72 },
    reach: 1.02, power: 1,
    moveNames: { nspecial: "Chaos Spear", sspecial: "Chaos Control", uspecial: "Emerald Ascent", dspecial: "Emerald Orbit" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "usmash", "fair"] },
    init(f) { f.data.orbitCD = 0; f.data.orbit = null; },
    tick(f) { if (f.data.orbitCD > 0) f.data.orbitCD--; },
    onKO(f) { f.data.orbitCD = 0; },
    draw: drawObama,
    moves: {
      // Chaos Punch: emerald-charged straight right.
      fsmash: { frames: 48, charge: 7, pose: "punch",
        hitboxes: [hb(14, 17, 46, -44, 17, 16, 38, 32, 98), hb(14, 17, 24, -44, 13, 14, 38, 30, 95)],
        onHit(f, T, g) { S.fx.burst(g, T.x, T.y - T.h / 2, EMERALDS[g.frame % 7], 10); } },
      usmash: { frames: 44, charge: 5, pose: "both",
        hitboxes: [hb(10, 16, 4, -92, 22, 15, 88, 32, 100), hb(10, 16, 2, -56, 15, 12, 92, 30, 96)] },
      // Executive spin: emeralds flicker round him.
      nair: { frames: 38, air: true, landingLag: 10, pose: (f, P) => { const a = f.mf * 0.5; P.armF = [1.6 + Math.sin(a), 0.2]; P.armB = [-1.6 + Math.cos(a), 0.2]; P.legF = [0.7, -0.6]; P.legB = [-0.7, -0.4]; },
        hitboxes: [hb(4, 9, 0, -38, 30, 10, 45, 18, 88), hb(10, 22, 0, -38, 26, 6, 50, 12, 70)] },
      uair: { frames: 30, air: true, landingLag: 10, pose: "kick", hitboxes: [hb(5, 9, 4, -86, 19, 11, 82, 22, 96)] },
      fthrow: { frames: 32, throwHit: { frame: 11, dmg: 9, angle: 40, bkb: 58, kbg: 70 } },
      nspecial: {
        frames: 36, pose: "punch",
        hitboxes: [],
        update(f, g, mf) { if (mf === 11) { chaosSpear(f, g); S.fx.spark(g, f.x + f.facing * 30, f.y - f.h * 0.6, "#fff17a", 5); } },
        pose(f, P) { P.armF = [f.mf < 10 ? 0.5 + f.mf * 0.1 : 1.6, 0.05]; P.armB = [-0.6, 0.4]; P.lean = 0.4; },
      },
      sspecial: {
        frames: 42, invuln: [3, 15], noGravity: [1, 18], noAirControl: true,
        hitboxes: [hb(11, 14, 6, -38, 30, 9, 45, 42, 66)],
        start(f, g) { f.vy = Math.min(f.vy, 0) * 0.2; f.vx *= 0.3; f.data.ccFrom = f.x; S.fx.ring(g, f.x, f.y, "#7dffb0"); },
        update(f, g, mf) {
          if (!f.grounded && mf <= 18) f.vy = 0;
          if (mf === 10) {
            S.fx.burst(g, f.x, f.y - f.h / 2, "#7dffb0", 10);
            f.x += f.facing * 160; f.px = f.x;
            if (f.grounded && f.plat && (f.x < f.plat.x1 || f.x > f.plat.x2)) { f.leaveGround(); f.vy = 0; }
            S.fx.burst(g, f.x, f.y - f.h / 2, "#ffffff", 12); S.fx.text(g, f.x, f.y - f.h - 14, "CHAOS CONTROL!", "#7dffb0");
          }
          f.vx = 0;
        },
        pose(f, P) { P.armF = [2.4, 0.4]; P.armB = [1.6, 0.6]; },
      },
      uspecial: {
        frames: 52, helpless: true, ledgeGrab: true, noAirControl: true, noGravity: [1, 30],
        hitboxes: [hb(3, 26, 0, -36, 32, 2, 85, 40, 6), hb(27, 30, 0, -44, 32, 5, 85, 50, 88)],
        start(f, g) { f.leaveGround(); f.vy = -3; S.fx.ring(g, f.x, f.y, "#ffffff"); },
        update(f, g, mf, pad) {
          if (mf <= 30) { f.vy = Math.max(-8.6, f.vy - 1.2); rehit(f, 5); }
          f.vx += (pad.x * 4.6 - f.vx) * 0.2;
        },
        pose(f, P) { P.armF = [3.0, 0.1]; P.armB = [2.8, 0.1]; P.legF = [0.3, -0.5]; P.legB = [-0.2, -0.3]; },
      },
      dspecial: {
        frames: 30,
        start(f) { if (f.data.orbitCD > 0 || (f.data.orbit && f.data.orbit.some((p) => !p.dead))) f.mf = 18; },
        hitboxes: [],
        update(f, g, mf) {
          if (mf === 9) { spawnOrbit(f, g); f.data.orbitCD = 240 + 210; S.fx.burst(g, f.x, f.y - f.h / 2, "#ffffff", 14); }
          if (!f.grounded) f.vy = Math.min(f.vy, 2);
        },
        pose(f, P) { P.armF = [2.6, 0.3]; P.armB = [2.4, 0.3]; P.lean = -0.2; },
      },
    },
  });

  // ================================================================= MARK ZUCKERBERG
  const ZK_SKIN = "#f2cdaa", FB_BLUE = "#1877f2";
  function blueHand(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = FB_BLUE; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    S.roundRect(ctx, -5, -2, 7, 7, 2); ctx.fill();          // fist
    S.roundRect(ctx, 1, -1.6, 7, 2.6, 1.3); ctx.fill();     // pointing finger
    ctx.restore();
  }
  function thumbsUp(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = FB_BLUE; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = "#fff";
    S.roundRect(ctx, -4, -1, 9, 8, 2); ctx.fill();
    S.roundRect(ctx, -2, -8, 3.6, 8, 1.6); ctx.fill();
    ctx.fillRect(-7, -1, 2.5, 8);
    ctx.restore();
  }
  const zuckLook = {
    skin: ZK_SKIN, shirt: "#8b8f95", pants: "#3f5f8c", shoes: "#2a2b2e",
    head(ctx, f, P, r) {
      ctx.fillStyle = ZK_SKIN; ctx.beginPath(); ctx.ellipse(r * 0.08, 0, r * 0.95, r * 1.02, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = S.shade(ZK_SKIN, -0.08); ctx.beginPath(); ctx.ellipse(-r * 0.2, r * 0.08, r * 0.16, r * 0.24, 0, 0, TAU); ctx.fill();
      // short curly hair: a cap of little curls
      ctx.fillStyle = "#5b3a22";
      ctx.beginPath(); ctx.ellipse(-r * 0.05, -r * 0.5, r * 0.92, r * 0.52, 0, Math.PI, TAU); ctx.fill();
      ctx.fillRect(-r * 0.92, -r * 0.55, r * 0.45, r * 0.5);
      for (let i = 0; i < 7; i++) { const a = Math.PI * (1.0 + i / 6.5); ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.82, -r * 0.42 + Math.sin(a) * r * 0.62, r * 0.22, 0, TAU); ctx.fill(); }
      ctx.fillStyle = "#6e4a2e"; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(-r * 0.4 + i * r * 0.32, -r * 0.82, r * 0.12, 0, TAU); ctx.fill(); }
      if (inMove(f, "uspecial")) {
        // metaverse headset
        ctx.fillStyle = "#f2f2f2"; S.roundRect(ctx, r * 0.15, -r * 0.42, r * 0.95, r * 0.6, r * 0.18); ctx.fill();
        ctx.fillStyle = "#1c1e22"; S.roundRect(ctx, r * 0.55, -r * 0.34, r * 0.55, r * 0.44, r * 0.1); ctx.fill();
        ctx.strokeStyle = "#444"; ctx.lineWidth = r * 0.14; ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.15); ctx.lineTo(-r * 0.85, -r * 0.2); ctx.stroke();
      } else {
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(r * 0.55, -r * 0.12, r * 0.17, r * 0.13, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#3a5a6e"; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.12, r * 0.09, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#7a5a40"; ctx.lineWidth = r * 0.09; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(r * 0.38, -r * 0.34); ctx.lineTo(r * 0.75, -r * 0.33); ctx.stroke();
      }
      ctx.strokeStyle = S.shade(ZK_SKIN, -0.22); ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.moveTo(r * 0.98, -r * 0.02); ctx.lineTo(r * 1.07, r * 0.22); ctx.lineTo(r * 0.95, r * 0.27); ctx.stroke();
      ctx.strokeStyle = "#a0604a"; ctx.lineWidth = r * 0.09;
      ctx.beginPath(); ctx.moveTo(r * 0.5, r * 0.5); ctx.quadraticCurveTo(r * 0.7, r * 0.58, r * 0.88, r * 0.48); ctx.stroke();
    },
    torso(ctx, f, P, b) {
      ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b.x + b.w * 0.6, b.y, b.w * 0.2, 0.2, Math.PI - 0.2); ctx.stroke();   // crew neck
    },
    behind(ctx, f, P, j) {
      if (!inMove(f, "uspecial")) return;
      // server-rack jetpack
      const x = j.sh.x - 22, y = j.sh.y - 2;
      ctx.fillStyle = "#2b2f36"; S.roundRect(ctx, x, y, 14, 30, 2); ctx.fill();
      ctx.strokeStyle = "#5a606a"; ctx.lineWidth = 1; ctx.stroke();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = "#3a404a"; ctx.fillRect(x + 2, y + 3 + i * 5.4, 10, 3.6);
        ctx.fillStyle = (f.mf + i * 3) % 8 < 4 ? "#3cff7a" : "#2aa0ff"; ctx.fillRect(x + 9, y + 4 + i * 5.4, 2, 1.6);
      }
      if (f.mf <= 38) {
        const fl = 14 + ((f.mf * 7) % 6);
        const grd = ctx.createLinearGradient(0, y + 30, 0, y + 30 + fl);
        grd.addColorStop(0, "#bfe6ff"); grd.addColorStop(0.4, FB_BLUE); grd.addColorStop(1, "rgba(24,119,242,0)");
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.moveTo(x + 2, y + 30); ctx.lineTo(x + 12, y + 30); ctx.lineTo(x + 7, y + 30 + fl); ctx.closePath(); ctx.fill();
      }
    },
  };
  function drawZuck(ctx, f, g) {
    const rig = S.drawHumanoid(ctx, f, zuckLook, g);
    withRigRot(ctx, f, rig, () => {
      const hand = rig.armF.end;
      if (inMove(f, "sspecial") && f.mf >= 4 && f.mf <= 16) blueHand(ctx, hand.x + 6, hand.y, 1);
      if (inMove(f, "fsmash") && f.mf >= 12 && f.mf <= 20) thumbsUp(ctx, hand.x + 8, hand.y - 4, 1.1 + (f.mf - 12) * 0.05);
      if (inMove(f, "nspecial") && f.mf >= 8 && f.mf <= 34) dataBeam(ctx, f, g, hand);
      if (inMove(f, "dspecial") && f.data.snapT && f.mf - f.data.snapAt >= 4 && f.mf - f.data.snapAt <= 12) {
        glow(ctx, hand.x, hand.y, 22, "#ffffff", 0.9 - (f.mf - f.data.snapAt - 4) * 0.1);
      }
    });
  }
  function dataBeam(ctx, f, g, hand) {
    const len = 118, t = g ? g.frame : 0;
    const grd = ctx.createLinearGradient(hand.x, 0, hand.x + len, 0);
    grd.addColorStop(0, "rgba(120,190,255,.75)"); grd.addColorStop(1, "rgba(24,119,242,.12)");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(hand.x, hand.y - 3); ctx.lineTo(hand.x + len, -38 - 24); ctx.lineTo(hand.x + len, -38 + 24); ctx.lineTo(hand.x, hand.y + 3); ctx.closePath(); ctx.fill();
    ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
    for (let i = 0; i < 9; i++) {
      const k = 1 - ((t * 0.045 + i * 0.37) % 1);
      const x = hand.x + k * len, y = hand.y + (-38 - hand.y) * k + Math.sin(i * 7.1) * 16 * k;
      ctx.fillStyle = i % 3 ? "#d6ecff" : "#7cc4ff";
      ctx.fillText(i % 2 ? "1" : "0", x, y);
    }
  }

  // The Snap: a command grab. Held targets are frozen, crumble to dust, then get launched.
  function snapGrab(A, T, g) {
    if (!A.grounded || A.data.snapT) return;
    A.grabbed = T; T.grabbedBy = A;
    if (T.grabbed) { const U = T.grabbed; U.grabbedBy = null; U.setState("air"); T.grabbed = null; }
    T.setState("grabbed"); T.kbx = T.kby = T.vx = T.vy = 0; T.hitstun = 0; T.pendingLaunch = null;
    A.data.snapT = T; A.data.snapAt = A.mf;
    g.spawn({
      owner: A, x: T.x, y: T.y - T.h / 2, r: 1, life: 44, harmless: true, solid: false, target: T,
      update(p) { p.x = T.x; p.y = T.y; },
      draw(ctx, p, g) {
        // grey ash eating through the victim, bottom-up
        const k = clamp((p.t - 8) / 34, 0, 1), h = T.h;
        if (k <= 0 || !alive(T)) return;
        ctx.save();
        for (let i = 0; i < 60; i++) {
          const rx = ((i * 73) % 97) / 97, ry = ((i * 41) % 89) / 89;
          if (ry > k) continue;
          const x = p.x + (rx - 0.5) * T.w * 1.1, y = p.y - h * ry;
          ctx.globalAlpha = 0.85; ctx.fillStyle = i % 3 ? "#6d655c" : "#9a9087";
          const s = 3 + (i % 4);
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
        }
        ctx.restore();
      },
    });
  }
  function snapRelease(f) {
    const T = f.data.snapT;
    f.data.snapT = null;
    if (T && T.grabbedBy === f) { T.grabbedBy = null; if (T.state === "grabbed") T.setState("air"); }
    if (f.grabbed === T) f.grabbed = null;
    return T;
  }

  S.registerFighter({
    id: "mark-zuckerberg", slug: "mark-zuckerberg", name: "Mark Zuckerberg", short: "Zuck",
    tagline: "Snapper of fingers. Chill on the porch. Lowkey did not care.",
    color: "#1877f2",
    stats: { weight: 85, walk: 4.4, run: 8.0, dashInit: 8.3, traction: 0.6, airSpeed: 5.3, airAccel: 0.42, gravity: 0.52, fallSpeed: 9.4, fastFall: 13.5,
      jump: 13.4, shortHop: 8.4, airJump: 12.4, jumpsquat: 3, width: 32, height: 68 },
    reach: 0.98, power: 0.92,
    moveNames: { nspecial: "Data Harvest", sspecial: "Poke", uspecial: "Server Lift", dspecial: "The Snap" },
    ai: { ranged: false, recover: "uspecial", killMoves: ["fsmash", "dspecial", "usmash"] },
    init(f) { f.data.snapT = null; },
    tick(f) {
      // never leave someone frozen if the Snap got interrupted
      if (f.data.snapT && !inMove(f, "dspecial")) snapRelease(f);
    },
    draw: drawZuck,
    moves: {
      jab: { frames: 14, iasa: 10, pose: "punch", hitboxes: [hb(2, 4, 26, -40, 12, 3, 45, 10, 45)] },
      dtilt: { frames: 18, crouch: true, pose: "kick", hitboxes: [hb(4, 6, 34, -6, 13, 7, 75, 22, 70)] },
      // "Like": a thumbs-up haymaker
      fsmash: { frames: 46, charge: 6, pose: "punch",
        hitboxes: [hb(13, 16, 44, -42, 18, 15, 40, 30, 98), hb(13, 16, 22, -40, 13, 13, 40, 28, 95)],
        onHit(f, T, g) { S.fx.text(g, T.x, T.y - T.h - 10, "Liked!", "#8cc4ff"); } },
      usmash: { frames: 42, charge: 5, pose: "punch", hitboxes: [hb(9, 14, 10, -86, 19, 14, 86, 28, 100), hb(9, 14, 8, -54, 14, 11, 90, 28, 96)] },
      fair: { frames: 34, air: true, landingLag: 12, hitboxes: [hb(7, 10, 34, -40, 16, 11, 45, 18, 92)] },
      nspecial: {
        frames: 44,
        hitboxes: [
          hb(10, 30, 44, -40, 16, 1, 180, 34, 0), hb(10, 30, 74, -40, 19, 1, 180, 40, 0), hb(10, 30, 104, -40, 21, 1, 180, 46, 0),
          hb(31, 33, 30, -40, 20, 3, 45, 30, 40),
        ],
        update(f, g, mf) { rehit(f, 7); if (!f.grounded) f.vy = Math.min(f.vy, 1.5); },
        pose(f, P) { P.armF = [1.5, 0.05]; P.armB = [0.6, 0.6]; P.lean = -0.2; },
      },
      sspecial: {
        frames: 30, keepMomentum: true,
        hitboxes: [hb(4, 14, 28, -40, 15, 6, 40, 38, 52), hb(4, 14, 8, -38, 13, 5, 40, 36, 50)],
        update(f, g, mf) {
          if (mf >= 3 && mf <= 13) f.vx = f.facing * 11.5;
          else if (f.grounded) f.friction(f.stats, 1.6);
          if (!f.grounded && mf <= 14) f.vy = Math.min(f.vy, 0.5);
        },
        onHit(f, T, g) { S.fx.text(g, T.x, T.y - T.h - 8, "POKE!", "#8cc4ff"); },
        pose(f, P) { P.armF = [1.55, 0.05]; P.armB = [-0.7, 0.4]; P.lean = 1; P.legF = [0.7, -0.4]; P.legB = [-0.8, -0.3]; },
      },
      uspecial: {
        frames: 54, helpless: true, ledgeGrab: true, noAirControl: true, noGravity: [1, 36],
        hitboxes: [hb(3, 34, -6, -6, 18, 2, 80, 40, 6), hb(35, 37, 0, -40, 26, 5, 82, 50, 80)],
        start(f) { f.leaveGround(); f.vy = -3; },
        update(f, g, mf, pad) {
          if (mf <= 36) { f.vy = Math.max(-7.4, f.vy - 1); rehit(f, 6); if (mf % 2 === 0) puff(g, f.x - f.facing * 15, f.y - 26, g.rng.range(-0.6, 0.6), 3, "#8cc4ff", 4, 12); }
          f.vx += (pad.x * 4.8 - f.vx) * 0.18;
        },
        pose(f, P) { P.armF = [0.9, 1.2]; P.armB = [0.6, 1.2]; P.legF = [0.2, -0.4]; P.legB = [-0.2, -0.3]; },
      },
      dspecial: {
        frames: 72,
        hitboxes: [hb(12, 15, 30, -38, 17, 0, 0, 0, 0, { grab: true, onGrab: snapGrab })],
        start(f) { f.data.snapT = null; f.data.snapAt = 0; },
        update(f, g, mf) {
          const T = f.data.snapT;
          if (!T) return;
          if (!alive(T) || T.state !== "grabbed" || T.grabbedBy !== f) { snapRelease(f); return; }
          const k = mf - f.data.snapAt;
          T.x = f.x + f.facing * (f.w / 2 + T.w / 2 - 2); T.y = f.y; T.facing = -f.facing;
          if (k === 6) {
            S.fx.text(g, f.x + f.facing * 10, f.y - f.h - 12, "*snap*", "#ffffff");
            S.fx.ring(g, f.x + f.facing * 14, f.y - f.h * 0.8, "#ffffff"); g.shake = Math.max(g.shake, 4);
          }
          if (k > 8 && k % 2 === 0) {
            puff(g, T.x + g.rng.range(-T.w / 2, T.w / 2), T.y - g.rng.range(0, T.h), g.rng.range(0.5, 2.2) * f.facing, g.rng.range(-2.4, -0.6), g.rng() < 0.5 ? "#7a7066" : "#a59a8e", 3, 28);
          }
          if (k === 42) {
            const V = snapRelease(f);
            S.applyHit(g, f, V, { dmg: 18, angle: 42, bkb: 14, kbg: 80, throw: true }, f.facing, 1);
            S.fx.burst(g, V.x, V.y - V.h / 2, "#a59a8e", 16);
            f.mf = Math.max(f.mf, 72 - 16);
          }
        },
        end(f) { snapRelease(f); },
        pose(f, P) {
          if (f.data.snapT) { const k = f.mf - f.data.snapAt; P.armF = k < 6 ? [2.4, 1.0] : [2.0, 1.6]; P.armB = [0.2, 0.4]; P.lean = -0.2; }
          else if (f.mf < 16) { P.armF = [0.4 + f.mf * 0.08, 0.1]; P.lean = 0.5; }
          else { P.armF = [1.0, 0.2]; P.lean = 0.2; P.crouch = 0.15; }
        },
      },
    },
  });

  // ================================================================= HANK HILL
  const HK_SKIN = "#efc6a0";
  const PROPANE_LINE = "What in the ever loving propane yo?";
  function drawScar(ctx) {
    // origin = grip, +x = muzzle
    const gold = ctx.createLinearGradient(0, -7, 0, 6);
    gold.addColorStop(0, "#fff0a8"); gold.addColorStop(0.45, "#e2b23a"); gold.addColorStop(1, "#8f6512");
    ctx.save(); ctx.translate(4, -4);
    ctx.fillStyle = gold; ctx.strokeStyle = "#6f4e0e"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(-26, -2); ctx.lineTo(-12, -3); ctx.lineTo(-12, 4); ctx.lineTo(-26, 6); ctx.closePath(); ctx.fill(); ctx.stroke();   // stock
    ctx.beginPath(); ctx.rect(-12, -4, 30, 7); ctx.fill(); ctx.stroke();                                                                  // receiver
    ctx.fillStyle = "#b8871e"; ctx.fillRect(18, -2.4, 16, 3); ctx.fillStyle = "#6f4e0e"; ctx.fillRect(33, -3, 3, 4);                     // barrel
    ctx.fillStyle = gold; ctx.beginPath(); ctx.moveTo(3, 3); ctx.lineTo(9, 3); ctx.lineTo(11, 12); ctx.lineTo(5, 12); ctx.closePath(); ctx.fill(); ctx.stroke();   // mag
    ctx.beginPath(); ctx.moveTo(-6, 3); ctx.lineTo(-2, 3); ctx.lineTo(-3, 10); ctx.lineTo(-7, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); // grip
    ctx.fillStyle = "#3b3326"; ctx.fillRect(-6, -7, 14, 3);                                                                                 // optic
    ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-10, -2.6); ctx.lineTo(16, -2.6); ctx.stroke();
    ctx.restore();
  }
  function drawTank(ctx, s) {
    // small propane tank, origin at the valve, body hanging along +y
    ctx.save(); ctx.scale(s, s);
    ctx.fillStyle = "#e9ecef"; S.roundRect(ctx, -7, 2, 14, 18, 6); ctx.fill();
    ctx.strokeStyle = "#8d949b"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#9aa1a8"; ctx.fillRect(-7, 9, 14, 1.4);
    ctx.fillStyle = "#c0392b"; ctx.fillRect(-2, -1, 4, 4);
    ctx.restore();
  }
  const hankLook = {
    skin: HK_SKIN, shirt: "#f5f5f0", pants: "#3e5f8c", shoes: "#4a3322",
    head(ctx, f, P, r) {
      // a squarish head, flat-top, big glasses
      ctx.fillStyle = HK_SKIN; S.roundRect(ctx, -r * 0.85, -r * 1.0, r * 1.95, r * 2.05, r * 0.55); ctx.fill();
      ctx.fillStyle = S.shade(HK_SKIN, -0.08); ctx.beginPath(); ctx.ellipse(-r * 0.3, r * 0.05, r * 0.18, r * 0.26, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = "#6b4a2b";
      ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.2); ctx.lineTo(-r * 0.9, -r * 0.95); ctx.quadraticCurveTo(-r * 0.85, -r * 1.12, -r * 0.5, -r * 1.12);
      ctx.lineTo(r * 0.8, -r * 1.12); ctx.quadraticCurveTo(r * 1.05, -r * 1.1, r * 1.0, -r * 0.8); ctx.lineTo(r * 0.2, -r * 0.72); ctx.lineTo(-r * 0.5, -r * 0.6); ctx.lineTo(-r * 0.6, -r * 0.2); ctx.closePath(); ctx.fill();
      // glasses
      ctx.strokeStyle = "#3a2a1c"; ctx.lineWidth = r * 0.12;
      ctx.fillStyle = "rgba(200,225,240,.55)";
      S.roundRect(ctx, r * 0.28, -r * 0.42, r * 0.62, r * 0.42, r * 0.1); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(r * 0.28, -r * 0.3); ctx.lineTo(-r * 0.3, -r * 0.28); ctx.stroke();
      ctx.fillStyle = "#1b1b1b"; ctx.beginPath(); ctx.arc(r * 0.64, -r * 0.2, r * 0.08, 0, TAU); ctx.fill();
      // nose, mouth, jaw shadow
      ctx.strokeStyle = S.shade(HK_SKIN, -0.25); ctx.lineWidth = r * 0.1;
      ctx.beginPath(); ctx.moveTo(r * 1.05, -r * 0.05); ctx.lineTo(r * 1.14, r * 0.25); ctx.lineTo(r * 1.0, r * 0.3); ctx.stroke();
      ctx.strokeStyle = "#7a4a36"; ctx.beginPath();
      if (f.state === "hitstun" || f.state === "tumble") { ctx.ellipse(r * 0.75, r * 0.58, r * 0.12, r * 0.16, 0, 0, TAU); }
      else { ctx.moveTo(r * 0.5, r * 0.55); ctx.lineTo(r * 0.95, r * 0.55); }
      ctx.stroke();
    },
    torso(ctx, f, P, b) {
      // brown belt with a buckle
      ctx.fillStyle = "#5b3a1e"; ctx.fillRect(b.x, b.y + b.h - 6, b.w, 4);
      ctx.fillStyle = "#c9a54a"; ctx.fillRect(b.x + b.w * 0.62, b.y + b.h - 6.5, 5, 5);
      ctx.strokeStyle = "rgba(0,0,0,.12)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b.x + b.w * 0.6, b.y, b.w * 0.18, 0.2, Math.PI - 0.2); ctx.stroke();
    },
    prop(ctx, f, P, hand) {
      ctx.save(); alongArm(ctx, hand);
      if (inMove(f, "sspecial")) { ctx.rotate(-Math.PI / 2); drawTank(ctx, 1); ctx.fillStyle = "#555"; ctx.fillRect(-1, -9, 2, 8); ctx.rotate(Math.PI / 2); ctx.fillStyle = "#333"; ctx.fillRect(0, -1.5, 12, 3); }
      else drawScar(ctx);
      ctx.restore();
    },
    behind(ctx, f, P, j) {
      if (!inMove(f, "uspecial")) return;
      ctx.save(); ctx.translate(j.sh.x - 16, j.sh.y + 2); drawTank(ctx, 1.25); ctx.restore();
      if (f.mf <= 32) {
        const fl = 22 + ((f.mf * 5) % 9), x = j.sh.x - 16, y = j.sh.y + 28;
        const grd = ctx.createLinearGradient(0, y, 0, y + fl);
        grd.addColorStop(0, "#9fd0ff"); grd.addColorStop(0.35, "#ffb02e"); grd.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + fl); ctx.closePath(); ctx.fill();
      }
    },
  };
  function drawHank(ctx, f, g) {
    S.drawHumanoid(ctx, f, hankLook, g);
  }

  function scarRound(f, g) {
    const y = f.y - f.h * 0.6;
    g.spawn({
      owner: f, x: f.x + f.facing * 48, y, vx: f.facing * 19, vy: 0, r: 5, dmg: 3, angle: 25, bkb: 14, kbg: 32, life: 26, facing: f.facing,
      draw(ctx, p) {
        ctx.strokeStyle = "rgba(255,220,120,.85)"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(p.x - p.facing * 18, p.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        ctx.fillStyle = "#fff6c8"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, TAU); ctx.fill();
      },
    });
    puff(g, f.x + f.facing * 46, y, f.facing * 1.5, -0.5, "#fff2a0", 7, 5);
    S.fx.spark(g, f.x + f.facing * 46, y, "#ffd23a", 3);
    S.audio && S.audio.shot && S.audio.shot();
  }

  function grillBoom(f, g, x, y) {
    S.fx.burst(g, x, y, "#ff9a2a", 14); S.fx.burst(g, x, y, "#7fc8ff", 8);
    for (let i = 0; i < 10; i++) puff(g, x + g.rng.range(-20, 20), y + g.rng.range(-20, 6), g.rng.range(-2, 2), g.rng.range(-4, -1), g.rng() < 0.5 ? "#ffb02e" : "#ff5a1f", 9, 22);
    g.shake = Math.max(g.shake, 8);
    S.audio && S.audio.boom && S.audio.boom();
    g.spawn({
      owner: f, x, y: y - 10, r: 50, dmg: 14, angle: 65, bkb: 45, kbg: 82, life: 6, pierce: true, solid: false,
      knockDir: (p, T) => sign(T.x - p.x) || 1,
      onHit(p, T, g) { S.fx.text(g, T.x, T.y - T.h - 20, PROPANE_LINE, "#ffcf6a"); },
      draw(ctx, p) {
        const k = p.t / 6;
        glow(ctx, p.x, p.y, 40 + k * 30, "#ffcf6a", 0.9 - k * 0.5);
        glow(ctx, p.x, p.y, 24 + k * 20, "#ffffff", 0.7 - k * 0.5);
      },
    });
  }
  function placeGrill(f, g) {
    f.data.grill = g.spawn({
      owner: f, x: f.x + f.facing * 36, y: f.y - 12, r: 12, gravity: 0.5, ground: true, harmless: true, life: 600, facing: f.facing,
      update(p, g) {
        if (p.t < 30 || !p.onGround) return;
        for (const T of g.fighters) {
          if (T === f || !alive(T) || T.invuln > 0 || T.state === "respawn") continue;
          if (S.circleRect(p.x, p.y, p.r + 6, T.hurtbox())) { p.life = 1; return; }
        }
        if (p.t % 12 === 0) puff(g, p.x + g.rng.range(-6, 6), p.y - 14, 0, -1.2, "rgba(200,200,200,.8)", 4, 26);
      },
      onExpire(p, g) {
        if (f.data.grill === p) f.data.grill = null;
        if (p.y < g.stage.blast.bottom - 5) grillBoom(f, g, p.x, p.y);
      },
      draw(ctx, p, g) {
        ctx.save(); ctx.translate(p.x, p.y + p.r); ctx.scale(1.35, 1.35);
        const armed = p.t >= 30, blink = armed && p.life < 120 && (p.t >> 2) % 2;
        ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-7, -12); ctx.moveTo(10, 0); ctx.lineTo(7, -12); ctx.stroke();
        ctx.fillStyle = "#1f1f22"; ctx.beginPath(); ctx.ellipse(0, -15, 14, 7, 0, 0, Math.PI); ctx.fill();
        ctx.fillStyle = "#3a3a40"; ctx.fillRect(-14, -17, 28, 3);
        ctx.strokeStyle = "#888"; ctx.lineWidth = 1; ctx.beginPath(); for (let i = -10; i <= 10; i += 5) { ctx.moveTo(i, -18); ctx.lineTo(i, -16); } ctx.stroke();
        ctx.fillStyle = "#e9ecef"; S.roundRect(ctx, 9, -9, 7, 9, 3); ctx.fill();                   // tank
        ctx.fillStyle = blink ? "#ff3b2f" : armed ? "#45d36a" : "#888"; ctx.beginPath(); ctx.arc(-8, -11, 1.8, 0, TAU); ctx.fill();
        if (armed) glow(ctx, 0, -18, 10, "#5cb3ff", 0.35 + 0.15 * Math.sin(g.frame * 0.3));
        ctx.restore();
      },
    });
  }

  S.registerFighter({
    id: "hank-hill", slug: "hank-hill", name: "Hank Hill", short: "Hank",
    tagline: "Propane magnate. Fugitive. Casino security.",
    color: "#d9a72b",
    stats: { weight: 122, walk: 3.4, run: 6.1, dashInit: 6.7, traction: 0.5, airSpeed: 4.1, airAccel: 0.3, airFriction: 0.1,
      gravity: 0.6, fallSpeed: 10.5, fastFall: 15, jump: 14.6, shortHop: 9.2, airJump: 13.2, jumpsquat: 6, width: 40, height: 76 },
    reach: 1.08, power: 1.12,
    moveNames: { nspecial: "Golden SCAR", sspecial: "Propane Burst", uspecial: "Propane Rocket", dspecial: "Grill Trap" },
    ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash", "usmash", "dspecial"] },
    init(f) { f.data.grill = null; },
    draw: drawHank,
    moves: {
      // Rifle-butt jab forward
      ftilt: { frames: 30, pose: "punch", hitboxes: [hb(8, 11, 44, -44, 16, 11, 35, 16, 100), hb(8, 11, 22, -44, 13, 9, 35, 16, 95)] },
      // Overhead rifle swing
      fsmash: { frames: 56, charge: 10, pose: "punch",
        hitboxes: [hb(19, 22, 50, -40, 20, 19, 38, 30, 94), hb(19, 22, 26, -46, 15, 16, 38, 28, 92)],
        onHit(f, T, g) { if (f.charging >= 40) S.fx.text(g, T.x, T.y - T.h - 20, PROPANE_LINE, "#ffcf6a"); } },
      // Propane flare straight up
      usmash: { frames: 50, charge: 6, pose: "both",
        hitboxes: [hb(13, 20, 0, -98, 24, 16, 88, 30, 100), hb(13, 20, 0, -62, 18, 13, 90, 30, 96)],
        update(f, g, mf) { if (mf >= 12 && mf <= 20) for (let i = 0; i < 2; i++) puff(g, f.x + g.rng.range(-10, 10), f.y - 80 - g.rng.range(0, 30), g.rng.range(-1, 1), g.rng.range(-5, -2), g.rng() < 0.4 ? "#7fc8ff" : "#ffb02e", 7, 16); } },
      dair: { frames: 42, air: true, landingLag: 22, pose: "kick", hitboxes: [hb(12, 16, 0, 4, 19, 14, -90, 22, 88), hb(17, 24, 0, 0, 17, 8, 70, 15, 80)] },
      bair: { frames: 34, air: true, landingLag: 14, pose: "kick", hitboxes: [hb(8, 12, -40, -40, 18, 14, 145, 18, 98)] },
      nspecial: {
        frames: 46, gravityMult: 0.5,
        hitboxes: [],
        update(f, g, mf) { if (mf === 12 || mf === 17 || mf === 22) scarRound(f, g); },
        pose(f, P) { const kick = (f.mf === 12 || f.mf === 17 || f.mf === 22 || f.mf === 13 || f.mf === 18 || f.mf === 23) ? -0.15 : 0; P.armF = [1.55 + kick, 0.05]; P.armB = [1.3, 0.5]; P.lean = -0.1; },
      },
      sspecial: {
        frames: 52,
        hitboxes: [hb(12, 34, 48, -44, 16, 2, 30, 34, 4), hb(12, 34, 78, -46, 20, 2, 30, 34, 4), hb(35, 38, 70, -46, 24, 5, 40, 45, 72)],
        update(f, g, mf) {
          rehit(f, 5);
          if (!f.grounded) f.vy = Math.min(f.vy, 2);
          if (mf >= 11 && mf <= 38) for (let i = 0; i < 2; i++) {
            const c = g.rng();
            puff(g, f.x + f.facing * 40, f.y - 44 + g.rng.range(-3, 3), f.facing * g.rng.range(5, 9), g.rng.range(-1.6, 0.2), c < 0.35 ? "#6fb6ff" : c < 0.75 ? "#ffb02e" : "#ffe36a", 8, 12);
          }
        },
        pose(f, P) { P.armF = [1.55, 0.05]; P.armB = [1.1, 0.8]; P.lean = 0.2; },
      },
      uspecial: {
        frames: 56, helpless: true, ledgeGrab: true, noAirControl: true, noGravity: [1, 32],
        hitboxes: [hb(2, 6, 0, -20, 36, 10, 80, 50, 70), hb(8, 30, 0, -40, 24, 4, 80, 40, 40)],
        start(f, g) {
          f.leaveGround(); f.vy = -10.5;
          S.fx.burst(g, f.x, f.y, "#ffb02e", 12); S.fx.ring(g, f.x, f.y, "#ffffff"); g.shake = Math.max(g.shake, 5);
          S.audio && S.audio.boom && S.audio.boom();
        },
        update(f, g, mf, pad) {
          if (mf <= 32) { f.vy = -10.5 + mf * 0.12; if (mf % 2 === 0) puff(g, f.x - f.facing * 16, f.y - 20, g.rng.range(-0.8, 0.8), 4, g.rng() < 0.5 ? "#ffb02e" : "#6fb6ff", 7, 14); }
          f.vx += (pad.x * 5 - f.vx) * 0.2;
        },
        pose(f, P) { P.armF = [2.9, 0.1]; P.armB = [2.7, 0.2]; P.legF = [0.15, -0.2]; P.legB = [-0.15, -0.2]; },
      },
      dspecial: {
        frames: 36,
        hitboxes: [],
        start(f) { f.data.detonate = !!(f.data.grill && !f.data.grill.dead); if (f.data.detonate) f.mf = 16; },
        update(f, g, mf) {
          if (mf === 20 && f.data.detonate && f.data.grill) { f.data.grill.life = 1; S.fx.text(g, f.x, f.y - f.h - 10, "click", "#ffcf6a"); }
          if (mf === 16 && !f.data.detonate) placeGrill(f, g);
        },
        pose(f, P) { if (f.data.detonate) { P.armF = [1.4, 0.6]; } else { const k = clamp(f.mf / 16, 0, 1); P.crouch = 0.4 * k; P.armF = [0.6 + k * 0.6, 0.3]; P.armB = [0.5 + k * 0.6, 0.3]; P.lean = 0.5 * k; } },
      },
    },
  });
})();
