/* Super Smash Ballers — drawing helpers: a posable humanoid rig fighters can dress up,
   plus effects, projectiles and default stage drawing. All drawing is code: no image assets. */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp } = S;

  // ------------------------------------------------------------ pose
  // Limb angles are measured from straight DOWN; positive swings toward the fighter's front (+x).
  //   leg: [hipAngle, kneeBend]  (negative bend = foot swings back, like a real knee)
  //   arm: [shoulderAngle, elbowBend]  (positive bend = forearm swings forward/up)
  const KICKS = new Set(["dtilt", "dair", "dsmash", "getupattack", "ledgeattack"]);
  S.KICKS = KICKS;

  S.pose = function (f, g) {
    const t = g ? g.frame : 0;
    const P = {
      bob: 0, lean: 0, rot: 0, crouch: 0,
      legF: [0.14, -0.06], legB: [-0.14, -0.06],
      armF: [0.28, 0.45], armB: [-0.22, 0.35],
      reach: null,   // {x, y} local point the attack is aimed at (for props)
      phase: 0,
    };
    const st = f.state;
    const spd = Math.abs(f.vx);
    switch (st) {
      case "idle": case "skid":
        P.bob = Math.sin(t * 0.08 + f.port) * 1.3;
        P.armF = [0.3 + Math.sin(t * 0.08) * 0.05, 0.5]; P.armB = [-0.25, 0.4];
        if (st === "skid") { P.lean = -0.8; P.legF = [0.5, -0.1]; }
        break;
      case "walk": {
        const ph = t * 0.12 * (0.6 + spd / 4); P.phase = ph;
        P.legF = [Math.sin(ph) * 0.55, -0.25 - Math.max(0, Math.cos(ph)) * 0.4];
        P.legB = [-Math.sin(ph) * 0.55, -0.25 - Math.max(0, -Math.cos(ph)) * 0.4];
        P.armF = [-Math.sin(ph) * 0.45, 0.4]; P.armB = [Math.sin(ph) * 0.45, 0.4];
        P.bob = -Math.abs(Math.sin(ph)) * 2;
        break;
      }
      case "dash": case "run": {
        const ph = t * 0.32; P.phase = ph;
        P.lean = 1;
        P.legF = [Math.sin(ph) * 0.95, -0.5 - Math.max(0, Math.cos(ph)) * 1.0];
        P.legB = [-Math.sin(ph) * 0.95, -0.5 - Math.max(0, -Math.cos(ph)) * 1.0];
        P.armF = [-Math.sin(ph) * 0.9, 1.4]; P.armB = [Math.sin(ph) * 0.9, 1.4];
        P.bob = -Math.abs(Math.sin(ph)) * 3;
        break;
      }
      case "crouch": P.crouch = 0.75; P.legF = [0.9, -1.7]; P.legB = [-0.5, -1.2]; P.armF = [0.7, 0.6]; P.armB = [0.3, 0.6]; break;
      case "jumpsquat": case "land": case "tech": case "getup": P.crouch = 0.5; P.legF = [0.7, -1.3]; P.legB = [-0.4, -1.0]; break;
      case "air": case "helpless":
        if (f.vy < 0) { P.legF = [0.9, -1.5]; P.legB = [-0.1, -0.9]; P.armF = [2.3, 0.2]; P.armB = [-0.6, 0.4]; }
        else { P.legF = [0.35, -0.4]; P.legB = [-0.35, -0.25]; P.armF = [1.7, 0.3]; P.armB = [-1.1, 0.2]; }
        if (f.airJumped) P.rot = (f.airJumped / 10) * Math.PI * 2 * 0.5;
        if (st === "helpless") { P.armF = [2.9, 0.1]; P.armB = [2.7, 0.1]; P.legF = [0.2, -0.2]; P.legB = [-0.2, -0.2]; }
        break;
      case "hitstun": case "tumble": case "dizzy":
        P.armF = [2.6 + Math.sin(t * 0.5) * 0.4, 0.4]; P.armB = [-2.4 + Math.cos(t * 0.5) * 0.4, -0.4];
        P.legF = [0.6, -0.4]; P.legB = [-0.7, -0.2];
        if (st === "tumble" || (st === "hitstun" && f.tumble && !f.grounded)) P.rot = (t * 0.28) % (Math.PI * 2);
        else if (st === "dizzy") { P.lean = Math.sin(t * 0.12) * 1.2; P.armF = [0.2, 0.1]; P.armB = [-0.2, 0.1]; }
        else P.lean = -1;
        break;
      case "shield": P.crouch = 0.15; P.armF = [1.5, 1.5]; P.armB = [1.2, 1.7]; break;
      case "roll": case "spotdodge": case "airdodge": P.crouch = 0.55; P.rot = st === "roll" ? (f.stateFrame / 28) * Math.PI * 2 : 0; P.armF = [1.4, 1.8]; P.armB = [1.2, 1.8]; P.legF = [1.2, -2]; P.legB = [0.8, -2]; break;
      case "ledge": case "ledgeclimb": P.armF = [3.0, 0]; P.armB = [2.9, 0]; P.legF = [0.15, -0.3]; P.legB = [-0.1, -0.1]; break;
      case "grabbing": P.armF = [1.55, 0.1]; P.armB = [1.4, 0.4]; P.lean = 0.3; break;
      case "grabbed": P.armF = [0.4, 0.1]; P.armB = [0.2, 0.1]; P.lean = -0.5; P.rot = -0.15; break;
      case "down": P.rot = -Math.PI / 2; P.armF = [2.6, 0.2]; P.armB = [2.4, 0.2]; P.legF = [0.1, 0]; P.legB = [-0.1, 0]; break;
      case "respawn": P.armF = [2.0, 0.3]; P.armB = [-0.6, 0.3]; break;
      case "attack": attackPose(f, P); break;
    }
    return P;
  };

  function attackPose(f, P) {
    const m = f.move;
    if (!m) return;
    if (typeof m.pose === "function") { m.pose(f, P); return; }
    const list = typeof m.hitboxes === "function" ? m.hitboxes(f) : (m.hitboxes || []);
    let tgt = null, k = 1;
    for (const h of list) if (f.mf >= h.start && f.mf <= h.end) { tgt = h; break; }
    if (!tgt && list.length) {
      const first = list[0], last = list[list.length - 1];
      if (f.mf < first.start) { tgt = first; k = -0.5 * (f.mf / Math.max(1, first.start)); }       // wind-up
      else { tgt = last; k = Math.max(0, 1 - (f.mf - last.end) / 10); }                              // recovery
    }
    if (m.air) { P.legF = [0.8, -1.2]; P.legB = [-0.2, -0.8]; }
    if (m.crouch) P.crouch = 0.45;
    if (!tgt) { if (m.throwHit) { P.armF = [2.4, 0.2]; P.armB = [2.2, 0.2]; } return; }
    const kick = m.pose === "kick" || (m.pose !== "punch" && KICKS.has(f.moveName));
    const h = f.h;
    const from = kick ? { x: 0, y: -h * 0.42 } : { x: 0, y: -h * 0.72 };
    const dx = tgt.x - from.x, dy = tgt.y - from.y;
    let ang = Math.atan2(dx, dy);
    if (k < 0) ang = ang * (1 + k) + (-0.6) * -k;   // pull back during wind-up
    else ang = ang * k + (kick ? 0.14 : 0.28) * (1 - k);
    P.reach = { x: tgt.x, y: tgt.y, active: k === 1 };
    if (kick) { P.legF = [ang, -0.05]; P.lean = -0.4; }
    else { P.armF = [ang, 0.05]; P.lean = clamp(dx / 60, -0.6, 0.8); if (m.pose === "both") P.armB = [ang - 0.15, 0.05]; }
    if (f.charging) P.bob = Math.sin(f.charging * 0.9) * 1.2;
  }

  // limb endpoint helper (angles from down, + toward front)
  function seg(x, y, ang, len) { return { x: x + Math.sin(ang) * len, y: y + Math.cos(ang) * len }; }
  S.limb = function (from, a, bend, l1, l2) {
    const j = seg(from.x, from.y, a, l1);
    const e = seg(j.x, j.y, a + bend, l2);
    return { from, joint: j, end: e, ang2: a + bend };
  };

  function strokeLimb(ctx, L, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(L.from.x, L.from.y); ctx.lineTo(L.joint.x, L.joint.y); ctx.lineTo(L.end.x, L.end.y); ctx.stroke();
  }
  S.strokeLimb = strokeLimb;

  S.shade = function (hex, amt) {
    let c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map((x) => x + x).join("");
    const n = parseInt(c, 16);
    const f = (v) => clamp(Math.round(v + amt * 255), 0, 255);
    const r = f((n >> 16) & 255), gg = f((n >> 8) & 255), b = f(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1);
  };

  // ------------------------------------------------------------ humanoid rig
  // look = {
  //   skin, shirt, pants, shoes, outline?,
  //   headR (default h*0.13), bodyW (default w*0.62), limbW (default 7*scale),
  //   sleeve?: color for upper arm (defaults to shirt), forearm?: color for long sleeves (defaults to skin), shortSleeves?: bool
  //   head(ctx, f, P, r)      draw the head at (0,0) (already translated to head centre, facing +x). Default: plain skin circle + eye.
  //   torso(ctx, f, P, box)   extra torso decoration; box = {x, y, w, h} (top-left corner, local coords)
  //   prop(ctx, f, P, hand)   draw a held item; hand = {x, y, ang} front hand, ang = forearm angle (from down)
  //   backProp(ctx, f, P, hand) item in the back hand (drawn behind the body)
  //   behind(ctx, f, P)       anything behind the whole body (capes, wings, auras)
  // }
  S.drawHumanoid = function (ctx, f, look, g) {
    const P = S.pose(f, g);
    const h = f.h, s = h / 70;
    const limbW = look.limbW || 7 * s;
    const headR = look.headR || h * 0.13;
    const bodyW = look.bodyW || f.w * 0.62;
    const legLen = h * 0.22 * (look.legScale || 1), armLen = h * 0.17 * (look.armScale || 1);
    ctx.save();
    if (P.rot) { ctx.translate(0, -h / 2); ctx.rotate(P.rot); ctx.translate(0, h / 2); }
    const crouchDrop = P.crouch * h * 0.18;
    const hip = { x: P.lean * 3, y: -h * 0.43 + P.bob + crouchDrop };
    const sh = { x: hip.x + P.lean * 6, y: hip.y - h * 0.3 };
    if (P.crouch) { P.legF = [P.legF[0] + P.crouch * 0.6, P.legF[1] - P.crouch * 1.2]; P.legB = [P.legB[0] - P.crouch * 0.2, P.legB[1] - P.crouch * 1.0]; }

    const legB = S.limb(hip, P.legB[0], P.legB[1], legLen, legLen);
    const legF = S.limb(hip, P.legF[0], P.legF[1], legLen, legLen);
    const armB = S.limb({ x: sh.x - 2, y: sh.y + 3 }, P.armB[0], P.armB[1], armLen, armLen);
    const armF = S.limb({ x: sh.x + 2, y: sh.y + 3 }, P.armF[0], P.armF[1], armLen, armLen);

    if (look.behind) look.behind(ctx, f, P, { hip, sh });
    // back limbs (darker)
    const pantsD = S.shade(look.pants, -0.12), sleeveD = S.shade(look.sleeve || look.shirt, -0.12), skinD = S.shade(look.skin, -0.1);
    strokeLimb(ctx, legB, pantsD, limbW * 1.1);
    foot(ctx, legB, S.shade(look.shoes || "#222", -0.1), limbW, s);
    if (look.backProp) look.backProp(ctx, f, P, { x: armB.end.x, y: armB.end.y, ang: armB.ang2 });
    drawArm(ctx, armB, look.shortSleeves ? skinD : sleeveD, look.forearm ? S.shade(look.forearm, -0.1) : skinD, limbW, skinD);
    // torso
    ctx.fillStyle = look.shirt;
    const box = { x: Math.min(sh.x, hip.x) - bodyW / 2, y: sh.y - 2, w: bodyW, h: hip.y - sh.y + 6 };
    roundRect(ctx, box.x, box.y, box.w, box.h, Math.min(8, bodyW / 3));
    ctx.fill();
    if (look.torso) look.torso(ctx, f, P, box);
    // front leg
    strokeLimb(ctx, legF, look.pants, limbW * 1.1);
    foot(ctx, legF, look.shoes || "#222", limbW, s);
    // head
    ctx.save();
    ctx.translate(sh.x + P.lean * 2, sh.y - headR * 0.95);
    if (look.head) look.head(ctx, f, P, headR);
    else { ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(0, 0, headR, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(headR * 0.45, -headR * 0.1, headR * 0.12, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    // front arm + prop
    if (look.prop) look.prop(ctx, f, P, { x: armF.end.x, y: armF.end.y, ang: armF.ang2 });
    drawArm(ctx, armF, look.shortSleeves ? look.skin : (look.sleeve || look.shirt), look.forearm || look.skin, limbW, look.skin);
    ctx.restore();
    return { P, hip, sh, armF, armB, legF, legB, headR };
  };

  function drawArm(ctx, L, sleeve, skin, w, hand = skin) {
    ctx.lineCap = "round";
    ctx.strokeStyle = sleeve; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(L.from.x, L.from.y); ctx.lineTo(L.joint.x, L.joint.y); ctx.stroke();
    ctx.strokeStyle = skin; ctx.lineWidth = w * 0.85;
    ctx.beginPath(); ctx.moveTo(L.joint.x, L.joint.y); ctx.lineTo(L.end.x, L.end.y); ctx.stroke();
    ctx.fillStyle = hand; ctx.beginPath(); ctx.arc(L.end.x, L.end.y, w * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  function foot(ctx, L, color, w, s) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(L.end.x + 3 * s, L.end.y, w * 0.95, w * 0.55, 0, 0, Math.PI * 2); ctx.fill();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  S.roundRect = roundRect;

  // ------------------------------------------------------------ fighter overlays
  S.drawFighter = function (ctx, f, g, debug) {
    if (f.out || f.state === "dead") return;
    ctx.save();
    let ox = 0;
    if (f.hitlag > 0 && f.state === "hitstun") ox = (f.hitlag % 2 ? 2 : -2);
    ctx.translate(f.x + ox, f.y);
    // respawn platform
    if (f.respawnPlat) {
      ctx.fillStyle = S.PORT_COLORS[f.port]; ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.ellipse(0, 4, 34, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    const flash = f.invuln > 0 && (g.frame >> 2) % 2 === 0;
    if (f.state === "spotdodge" || f.state === "roll" || f.state === "airdodge") ctx.globalAlpha = f.invuln > 0 ? 0.55 : 1;
    ctx.save();
    ctx.scale(f.facing, 1);
    try { (f.def.draw || S.drawDummy)(ctx, f, g); } catch (e) { if (!f._drawErr) { console.error(e); f._drawErr = true; } S.drawDummy(ctx, f, g); }
    ctx.restore();
    if (flash) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(-f.w / 2, -f.h, f.w, f.h); ctx.globalCompositeOperation = "source-over"; }
    ctx.globalAlpha = 1;
    if (f.charging) { ctx.strokeStyle = `rgba(255,240,120,${0.3 + 0.3 * Math.sin(f.charging)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, -f.h / 2, f.h * 0.62, 0, Math.PI * 2); ctx.stroke(); }
    if (f.armor) { ctx.strokeStyle = "rgba(255,190,40,.7)"; ctx.lineWidth = 3; ctx.strokeRect(-f.w / 2 - 3, -f.h - 3, f.w + 6, f.h + 6); }
    if (f.state === "shield") {
      const r = 14 + (f.shieldHP / 60) * (f.h * 0.5);
      ctx.fillStyle = S.PORT_COLORS[f.port]; ctx.globalAlpha = 0.35 + (f.shieldStun ? 0.25 : 0);
      ctx.beginPath(); ctx.arc(0, -f.h / 2, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (f.state === "dizzy") {
      for (let i = 0; i < 3; i++) { const a = g.frame * 0.12 + i * 2.1; star(ctx, Math.cos(a) * 18, -f.h - 10 + Math.sin(a) * 5, 5, "#ffe14a"); }
    }
    // port tag
    const tag = f.cpu ? "CPU" : "P" + (f.port + 1);
    ctx.font = "bold 13px Arial, sans-serif"; ctx.textAlign = "center";
    ctx.fillStyle = S.PORT_COLORS[f.port];
    ctx.beginPath(); ctx.moveTo(-6, -f.h - 18); ctx.lineTo(6, -f.h - 18); ctx.lineTo(0, -f.h - 11); ctx.fill();
    ctx.fillText(tag, 0, -f.h - 22);
    ctx.restore();
    if (debug) {
      const hb = f.hurtbox(); ctx.strokeStyle = f.invuln ? "#0f0" : "#ff0"; ctx.lineWidth = 1; ctx.strokeRect(hb.x1, hb.y1, hb.x2 - hb.x1, hb.y2 - hb.y1);
      ctx.fillStyle = "rgba(255,0,0,.45)"; for (const b of S.activeHitboxes(f)) { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); }
      if (f.counter) { ctx.strokeStyle = "#0ff"; ctx.strokeRect(hb.x1 - 4, hb.y1 - 4, hb.x2 - hb.x1 + 8, hb.y2 - hb.y1 + 8); }
    }
  };

  function star(ctx, x, y, r, color) {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  S.star = star;

  // A plain stand-in, also used if a fighter's draw() throws.
  S.drawDummy = function (ctx, f, g) {
    S.drawHumanoid(ctx, f, { skin: "#e0b48a", shirt: f.def.color || "#888", pants: "#334", shoes: "#111" }, g);
  };

  S.drawProjectile = function (ctx, p, g) {
    if (p.draw) { try { p.draw(ctx, p, g); return; } catch (e) { if (!p._err) { console.error(e); p._err = true; } } }
    ctx.fillStyle = p.color || "#ffe14a";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  };

  S.drawParticles = function (ctx, g) {
    for (const p of g.particles) {
      const a = p.life / p.max;
      ctx.globalAlpha = Math.min(1, a * 1.3);
      if (p.text) { ctx.fillStyle = p.color; ctx.font = `bold ${p.size}px Arial`; ctx.textAlign = "center"; ctx.fillText(p.text, p.x, p.y); }
      else if (p.ring) { ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.size * (2 - a) * 1.6, p.size * (2 - a) * 0.4, 0, 0, Math.PI * 2); ctx.stroke(); }
      else if (p.star) { star(ctx, p.x, p.y, p.size * (1.3 - a * 0.3), p.color); }
      else if (p.ko) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
        const grd = ctx.createLinearGradient(0, 0, p.size, 0);
        grd.addColorStop(0, "#ffffff"); grd.addColorStop(0.3, p.color); grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(p.size * 1.6, -60 * a); ctx.lineTo(p.size * 1.6, 60 * a); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else { ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
    }
    ctx.globalAlpha = 1;
  };

  // Default platform look (stages may override with def.drawPlatforms).
  S.drawPlatformsDefault = function (ctx, g) {
    for (const P of g.platforms) {
      if (P.solid) {
        const d = P.depth || 60;
        ctx.fillStyle = "#3b3f4a"; ctx.beginPath();
        ctx.moveTo(P.x1, P.y); ctx.lineTo(P.x2, P.y); ctx.lineTo(P.x2 - 30, P.y + d); ctx.lineTo(P.x1 + 30, P.y + d); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#c9ccd6"; ctx.fillRect(P.x1, P.y - 2, P.x2 - P.x1, 6);
      } else {
        ctx.fillStyle = "#c9ccd6"; ctx.fillRect(P.x1, P.y - 2, P.x2 - P.x1, 6);
        ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(P.x1 + 6, P.y + 4, P.x2 - P.x1 - 12, 4);
      }
    }
  };
})();
