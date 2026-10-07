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
  const CHRIS_FUR = "#b07d55", CHRIS_FUR_D = "#93643f";
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

  // ---- Chris in 3D: the cover dog, built on the shared humanoid with a custom dog head.
  // Chris = "Chill Guy", modelled after the cel-shaded reference: a soft boxy skull, a stubby muzzle capped by a huge
  // black oval nose, tall upright ears, small half-lidded eyes on the front of the face, thin brows and a wide smile.
  function chrisDogHead(T, K, g, r, spec, model) {
    const fur = K.mat(CHRIS_FUR), furD = K.mat(CHRIS_FUR_D), inner = K.mat("#d9a676");
    model.M.skin = fur;
    // skull: a rounded box, a bit taller than wide, face plane toward +X
    model.skull = K.superSphere(r * 0.86, r * 0.95, r * 0.8, 0.62, fur, { parent: g, p: [-r * 0.05, r * 0.08, 0], ol: 1.1 });
    // muzzle: short and thick, from the lower front of the skull
    K.capsule(r * 0.46, r * 0.75, fur, { parent: g, p: [r * 1.0, -r * 0.42, 0], r: [0, 0, -Math.PI / 2 + 0.04], s: [1.0, 1, 0.98], ol: 1 });
    // the nose: a huge black oval disc capping the muzzle
    K.sphere(r * 0.62, K.mat("#0d0d0d"), { parent: g, p: [r * 1.76, -r * 0.4, 0], r: [0, 0, 0.12], s: [0.42, 0.84, 1.0], ol: 0.8 });
    // tall upright ears, slightly splayed, set back on the crown
    [-1, 1].forEach((z) => {
      const ear = K.group({ parent: g, p: [-r * 0.32, r * 0.9, z * r * 0.34], r: [z * -0.16, 0, 0.1] });
      K.capsule(r * 0.24, r * 0.72, fur, { parent: ear, p: [0, r * 0.56, 0], s: [1, 1, 0.5], ol: 0.9 });
      K.capsule(r * 0.12, r * 0.55, inner, { parent: ear, p: [r * 0.12, r * 0.56, z * r * 0.04], s: [0.6, 1, 0.4], ol: 0 });
    });
    // small, very chill eyes high on the face, thin straight brows
    K.eyes(model, g, r, { r: 0.15, iris: "#3a2312", gap: 0.4, y: 0.48, lids: 0.42, out: 0.94 }, fur);
    K.brows(model, g, r, { color: "#2a1a10", thick: 0.035, len: 0.26, tilt: -0.06, y: 0.7, gap: 0.4 });
    // wide smile on each cheek, beside the muzzle
    const ink = K.basic("#1a1009");
    [-1, 1].forEach((z) => {   // from under the muzzle, dipping, then curling up onto the cheek
      const pts = [[1.12, -0.86, 0.36], [0.86, -0.92, 0.55], [0.6, -0.78, 0.7], [0.46, -0.56, 0.74]].map(([x, y, w]) => new T.Vector3(x * r, y * r, z * w * r));
      g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 20, r * 0.045, 6), ink));
    });
    // ribbed sweater collar (dark rib stripes like the reference)
    const col = K.torus(r * 0.6, r * 0.11, K.mat("#b3b6bc", { map: ribTex(K) }), { parent: g, p: [-r * 0.1, -r * 0.88, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.8, 1], ol: 0.7 });
    col.rotation.z = 0;
    // the halo (shown during God Ascension / Halo Flare)
    model.halo = K.torus(r * 0.75, r * 0.07, K.mat("#ffd23a", { emissive: "#c99400", emissiveIntensity: 1.2 }), { parent: g, p: [-r * 0.2, r * 2.1, 0], r: [Math.PI / 2, 0, 0], ol: 0 });
    model.haloGlow = K.glow(0xffd84a, r * 3.4, 0.8); model.haloGlow.position.set(-r * 0.2, r * 2.1, 0); g.add(model.haloGlow);
  }
  let ribT = null;
  function ribTex(K) {   // vertical dark ribs for collar / cuffs
    if (!ribT) ribT = K.tex(128, 16, (c, w, h) => { c.fillStyle = "#b3b6bc"; c.fillRect(0, 0, w, h); c.fillStyle = "#4a4d57"; for (let x = 0; x < w; x += 6) c.fillRect(x, 0, 1.6, h); });
    return ribT;
  }

  const chrisModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 66, w: 34, skin: CHRIS_FUR, bodyW: 25, headR: 16.5, belly: 0.3, chest: 1.04, shoulders: 0.96, legBulk: 1.35, armBulk: 1.1, legScale: 0.8,
        neck: { len: 1, r: 4.6, color: CHRIS_FUR },
        head: { build: chrisDogHead },
        top: { type: "sweater", color: "#aeb2b8", cuff: "#9a9ea5" },
        bottom: { type: "jeans", color: "#8dbcae", cuffs: "#cfe5dc" },
        shoes: { color: "#cf5d63", sole: "#eeeae4", laces: "#f4f1ea" },
        hands: { color: CHRIS_FUR, style: "cartoon" },
      });
      // Converse-style white toe caps on the maroon sneakers
      [m.legF, m.legB].forEach((L) => K.sphere(3.2, K.mat("#f1ece2", { roughness: 0.6 }), { parent: L.foot, p: [8.6, -1.3, 0], s: [1.05, 0.8, 1.25], ol: 0.5 }));
      m.yawAmt = 1.0;   // turned further toward the camera, like the reference art
      m.ball = K.basketball(7); m.armF.hand.add(m.ball); m.ball.position.set(1, -9, 0);
      m.bigBall = K.basketball(21); m.bigBall.position.set(0, 22, 0); m.root.add(m.bigBall);
      m.ballEyes = K.group({ parent: m.bigBall });
      K.sphere(3.6, K.mat("#ffffff", { roughness: 0.3 }), { parent: m.ballEyes, p: [19, 4, 4] });
      K.sphere(2, K.basic("#1b1b1b"), { parent: m.ballEyes, p: [21.6, 4, 4.4], ol: 0 });
      K.collectMats(m);
      return m;
    },
    update(m, f, g, P, opts) {
      const ballForm = chrisBallForm(f);
      m.inner.visible = !ballForm;
      m.bigBall.visible = ballForm;
      if (ballForm) {
        m.yaw.rotation.y = K3().yawFor(f.facing); m.yawVal = m.yaw.rotation.y;
        m.bigBall.rotation.z = -g.frame * 0.45;
        m.ballEyes.rotation.z = g.frame * 0.45;   // he keeps looking forward while rolling
        K3().applyFlash(m, f, g);
        return;
      }
      K3().poseHumanoid(m, f, P, g, opts);
      const hot = attacking(f, "uspecial") || (attacking(f, "usmash") && f.mf >= 8 && f.mf <= 20);
      m.halo.visible = m.haloGlow.visible = hot;
      const pockets = chrisPockets(f);
      m.armF.hand.visible = m.armB.hand.visible = !pockets;
      m.ball.visible = !pockets && !alive(f.data.ball);
      m.ball.rotation.z = -g.frame * 0.08;
    },
  };
  const K3 = () => S.K3;

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
    model: chrisModel,
    posePatch(f, P) { if (chrisPockets(f)) chrisPocketLook.posePatch(f, P); },
    drawFxBehind(ctx, f, g) { FRAME = g.frame; chrisLook.behind(ctx, f, null); },
    drawFx(ctx, f, g) {
      if (!chrisBallForm(f) || !f.move.aerial || f.grounded || f.mf <= 8) return;
      const R = 21, cy = -R - 1;   // falling streaks above the ball
      ctx.strokeStyle = "rgba(255,215,110,.55)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) { const len = 26 + ((g.frame + i * 5) % 9) * 3; ctx.beginPath(); ctx.moveTo(i * 11, cy - R - 2); ctx.lineTo(i * 11, cy - R - 2 - len); ctx.stroke(); }
    },
    draw(ctx, f, g) {
      FRAME = g.frame;
      if (chrisBallForm(f)) { drawChrisBall(ctx, f, g); return; }
      const R = S.drawHumanoid(ctx, f, chrisPockets(f) ? chrisPocketLook : chrisLook, g);
      chrisCuffs(ctx, f, R);
    },
  });

  // ============================================================ 3D KIT (LeBron, RFK, Steve)
  // A sculpted human head for K.humanoid (passed as spec.head.build), hair caps, arc-shaped face features,
  // a couple of painted textures, and the 2D rig maths so def.drawFx effects line up with the 2D hitboxes.

  // Where the 2D rig puts the shoulder / front hand (same maths as S.drawHumanoid, without drawing).
  function rig2d(f, g, look) {
    const P = S.pose(f, g);
    if (look && look.posePatch) look.posePatch(f, P, g);
    const h = f.h, armLen = h * 0.17 * ((look && look.armScale) || 1);
    const hip = { x: P.lean * 3, y: -h * 0.43 + P.bob + P.crouch * h * 0.18 };
    const sh = { x: hip.x + P.lean * 6, y: hip.y - h * 0.3 };
    const armF = S.limb({ x: sh.x + 2, y: sh.y + 3 }, P.armF[0], P.armF[1], armLen, armLen);
    return { P, hip, sh, armF };
  }
  // A torus arc through a chord of width o.w (× r) with sagitta o.sag (> 0 bows down like a smile, < 0 bows up),
  // centred at (o.x, o.y, o.z) × r on the face (which looks along +X). Mouths, lips, moustaches, teeth, creases.
  function faceArc(K, g, r, mat, o) {
    const w = o.w * r, sag = Math.max(0.002 * r, Math.abs(o.sag) * r), up = o.sag < 0;
    const R = (w * w / 4 + sag * sag) / (2 * sag), A = 2 * Math.asin(Math.min(1, w / (2 * R)));
    const m = K.torus(R, o.t * r, mat, { parent: g, p: [o.x * r, o.y * r + (up ? -R : R), (o.z || 0) * r], r: [o.rx || 0, Math.PI / 2 + (o.ry || 0), 0], arc: A, ol: 0, rs: 8, ts: 14 });
    m.rotation.z = (up ? Math.PI / 2 : -Math.PI / 2) - A / 2;
    if (o.s) m.scale.set(o.s[0], o.s[1], o.s[2]);
    return m;
  }
  // Hair cap: the top of a sphere slightly larger than the skull, tipped back by `tilt` (raises the front hairline).
  function hairCap(K, g, r, mat, k, thL, tilt, o = {}) {
    return K.sphere(r * k, mat, Object.assign({ parent: g, thL, r: [0, 0, tilt], s: [1.0, 1.06, 0.9], ol: 0.7 }, o));
  }
  // Canvas noise (stubble, terry cloth, denim): base colour + speckles; lines = [{ color, step, w, slope }].
  function noiseTex(K, w, h, base, specks, lines) {
    return K.tex(w, h, (c) => {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);   // texture only: deterministic, not sim
      (lines || []).forEach((L) => { c.strokeStyle = L.color; c.lineWidth = L.w || 1; for (let x = -h; x < w + h; x += L.step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + h * (L.slope || 0), h); c.stroke(); } });
      (specks || []).forEach((sp) => { c.fillStyle = sp.color; for (let i = 0; i < sp.n; i++) c.fillRect(rnd() * w, rnd() * h, sp.size || 1, (sp.size || 1) * (sp.stretch || 1)); });
    });
  }
  /* Sculpted head (looks along +X). o = { skin, skull: [sx, sy, sz], jawW, jawL, jawCorners, chin: { r, x, y, w, cleft },
     cheeks (cheekbone size), nose: { x, y, tip, wing, w, bridge }, eyes (K.eyes opts), brows (K.brows opts),
     lips: { color, w, sag, y, lower, teeth }, creases (nasolabial folds), ears }. Returns { skD }. */
  function sculptHead(K, model, g, r, o) {
    const sk = model.M.skin;
    const skD = K.mat(S.shade(o.skin, -0.1), { roughness: 0.62 });
    const sq = o.skull || [1, 1.05, 0.9];
    model.skull = K.sphere(r, sk, { parent: g, p: [0, r * (o.skullY || 0), 0], s: sq, ol: 0.9 });
    K.sphere(r * 0.84, sk, { parent: g, p: [-r * 0.2, r * 0.1, 0], s: [1, 1.04, sq[2] * 1.08], ol: 0.8 });     // back of the skull
    const jw = o.jawW || 1, jl = o.jawL || 1;
    K.sphere(r * (o.jawR || 0.7), sk, { parent: g, p: [r * (o.jawX || 0.3), -r * 0.42 * jl, 0], s: [1, 0.85 * jl, jw], ol: 0.7 });        // face / jaw mass
    if (o.jawCorners) [-1, 1].forEach((z) => K.sphere(r * 0.3, sk, { parent: g, p: [r * 0.02, -r * 0.56 * jl, z * r * 0.48 * jw], s: [1.35, 0.85, 0.8], ol: 0 }));
    const ch = o.chin || {};
    K.sphere(r * (ch.r || 0.24), sk, { parent: g, p: [r * (ch.x || 0.76), -r * (ch.y || 0.74) * jl, 0], s: [0.9, 0.85, ch.w || 1.25], ol: 0 });
    if (ch.cleft) K.capsule(r * 0.018, r * 0.1, skD, { parent: g, p: [r * ((ch.x || 0.76) + (ch.r || 0.24) * 0.88), -r * (ch.y || 0.74) * jl - r * 0.04, 0], ol: 0 });
    const cb = o.cheeks != null ? o.cheeks : 0.25;
    if (cb > 0) [-1, 1].forEach((z) => K.sphere(r * cb, sk, { parent: g, p: [r * 0.58, -r * 0.1, z * r * 0.44], s: [0.8, 0.62, 1], ol: 0 }));   // cheekbones
    K.capsule(r * 0.1, r * 0.58, sk, { parent: g, p: [r * 0.84, r * 0.27, 0], r: [Math.PI / 2, 0, 0], ol: 0 });                     // brow ridge
    // ears
    [-1, 1].forEach((z) => {
      const ear = K.sphere(r * 0.25 * (o.ears || 1), sk, { parent: g, p: [-r * 0.06, -r * 0.08, z * r * 0.86], r: [0, 0, 0.16], s: [0.62, 1.15, 0.36], ol: 0.5 });
      K.sphere(r * 0.14 * (o.ears || 1), skD, { parent: ear, p: [r * 0.03, 0, z * r * 0.05], s: [0.8, 1, 0.5], ol: 0 });
    });
    // nose: bridge capsule from between the eyes to the tip, tip ball, nostril wings
    const n = Object.assign({ x: 1.02, y: -0.2, tip: 0.13, wing: 0.1, w: 1, bridge: 0.085 }, o.nose || {});
    const bx = r * 0.9, by = r * 0.16, tx = r * n.x, ty = r * n.y, len = Math.hypot(tx - bx, ty - by);
    K.capsule(r * n.bridge, len * 0.8, sk, { parent: g, p: [(bx + tx) / 2, (by + ty) / 2, 0], r: [0, 0, Math.atan2(-(tx - bx), ty - by) + Math.PI], ol: 0.4 });
    K.sphere(r * n.tip, sk, { parent: g, p: [tx, ty, 0], s: [1, 0.9, 1.05], ol: 0.45 });
    [-1, 1].forEach((z) => K.sphere(r * n.wing, sk, { parent: g, p: [tx - r * 0.09, ty - r * 0.03, z * r * 0.1 * n.w], s: [1, 0.85, 0.9], ol: 0.35 }));
    // eyes + brows (shared toolkit pieces)
    K.eyes(model, g, r, Object.assign({ r: 0.165, iris: "#4a3020", gap: 0.37, y: 0.08, lids: 0.2, out: 0.86 }, o.eyes || {}), sk);
    // the toolkit's glossy irises mirror the blue fill light and read grey-blue at ¾ view: matte them
    model.eyes.forEach((e) => e.g.traverse((m) => { if (m.isMesh && m.geometry.type === "CircleGeometry" && m.material.isMeshStandardMaterial) m.material.roughness = 0.85; }));
    K.brows(model, g, r, Object.assign({ color: "#2a1a10", thick: 0.07, len: 0.3, tilt: 0.04, y: 0.34, gap: 0.37 }, o.brows || {}));
    // mouth: a dark line, a fuller lower lip, optional teeth
    const L = Object.assign({ color: S.shade(o.skin, -0.22), w: 0.36, sag: 0.04, y: -0.45, x: 0.98, lower: 1 }, o.lips || {});
    const lipM = K.mat(L.color, { roughness: 0.5 });
    if (L.teeth) {
      faceArc(K, g, r, K.mat("#f6f3ea", { roughness: 0.3 }), { x: L.x - 0.03, y: L.y - 0.015, w: L.w * 0.86, sag: L.sag * 0.9, t: 0.05, s: [1, 1.25, 1] });
      faceArc(K, g, r, K.mat("#3a1512"), { x: L.x - 0.04, y: L.y - 0.07, w: L.w * 0.7, sag: L.sag * 0.6, t: 0.03 });
    }
    model.mouth = faceArc(K, g, r, K.mat(S.shade(L.color, -0.25), { roughness: 0.6 }), { x: L.x, y: L.y + (L.teeth ? 0.045 : 0), w: L.w, sag: L.sag, t: 0.026 });
    if (L.lower) faceArc(K, g, r, lipM, { x: L.x - 0.03, y: L.y - 0.075 - (L.teeth ? 0.05 : 0), w: L.w * 0.62, sag: L.sag * 0.4, t: 0.05 * L.lower });
    if (o.creases) [-1, 1].forEach((z) => faceArc(K, g, r, skD, { x: 0.86, y: -0.38, z: z * 0.27, w: 0.3, sag: z * 0.05, t: 0.022, ry: -z * 0.5, rx: Math.PI / 2 }));
    return { skD };
  }
  // The toolkit's jersey puts a trim ring round each shoulder; the painted armholes read better without it.
  function dropSleeveRings(m) {
    [m.armF, m.armB].forEach((A) => A.sh.children.slice().forEach((o) => { if (o.isMesh && o.geometry.type === "TorusGeometry") A.sh.remove(o); }));
  }
  // A thin capsule from point a to point b (glasses arms, straps).
  function rod(K, parent, mat, a, b, rad) {
    const T = K.T, A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
    const m = K.capsule(rad, Math.max(0.01, len - rad * 2), mat, { parent, ol: 0, seg: 6 });
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return m;
  }
  // A white gripping hand needs props on a stable point: this marker sits in the fist (hand-local, -Y = along the forearm).
  function fistPoint(K, model) { return K.group({ parent: model.armF.hand, p: [0.6 * model.s, -2.6 * model.s, 0] }); }

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
      if (attacking(f, "sspecial") && f.mf >= 6 && f.mf <= 24) {   // Chase-Down Charge: speed streaks trailing the armor
        const k = f.mf > 22 ? 0.4 : 1;
        ctx.strokeStyle = `rgba(217,199,255,${0.55 * k})`; ctx.lineWidth = 2.5; ctx.lineCap = "round";
        for (let i = 0; i < 5; i++) {
          const y = -f.h * (0.2 + i * 0.16), len = 22 + ((FRAME * 3 + i * 13) % 20);
          ctx.beginPath(); ctx.moveTo(-f.w * 0.45, y); ctx.lineTo(-f.w * 0.45 - len, y); ctx.stroke();
        }
      }
      if (!attacking(f, "dspecial")) return;
      const m = f.move;
      if (f.mf >= m.counter[0] && f.mf <= m.counter[1]) {   // counter stance shimmer
        const a = 0.35 + 0.25 * Math.sin(FRAME * 0.6);
        ctx.strokeStyle = `rgba(253,185,39,${a})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(0, -f.h * 0.5, f.w * 0.9, f.h * 0.62, 0, 0, TAU); ctx.stroke();
      }
    },
  };

  // ---- LeBron in 3D: tall and broad, close crop + full trimmed beard, white headband, purple #23 road jersey,
  // purple shorts with gold side panels, white crew socks, high-top signature sneakers, wristbands, the ball.
  const LBJ_SKIN = "#70432a";
  function lbjHead(T, K, g, r, spec, model) {
    sculptHead(K, model, g, r, {
      skin: LBJ_SKIN, skull: [1.0, 1.08, 0.9], jawW: 1.06, jawL: 1.06, jawCorners: true, chin: { r: 0.25, w: 1.35 }, cheeks: 0,
      nose: { x: 1.0, y: -0.2, tip: 0.13, wing: 0.11, w: 1.35, bridge: 0.09 },
      eyes: { r: 0.165, iris: "#3a2414", lids: 0.22, gap: 0.37, y: 0.07 },
      brows: { color: "#140d09", thick: 0.06, len: 0.28, tilt: 0.06, y: 0.33 },
      lips: { color: "#5a3322", w: 0.36, sag: 0.025, y: -0.5, x: 1.06, lower: 1.3 },
    });
    const hairM = K.mat("#16100c", { roughness: 0.97 });
    // close crop with a crisp lined-up hairline
    hairCap(K, g, r, hairM, 1.04, Math.PI * 0.4, 0.42);
    hairCap(K, g, r, hairM, 1.03, Math.PI * 0.5, 1.2, { s: [1.0, 1.05, 0.98] });
    [-1, 1].forEach((z) => K.sphere(r * 0.4, hairM, { parent: g, p: [-r * 0.12, r * 0.32, z * r * 0.74], s: [1.0, 0.6, 0.4], ol: 0.4 }));
    // full, dense, trimmed beard: jaw shell, chin, sideburns, moustache (lips stay visible in front of it)
    const bM = K.mat(0xffffff, { roughness: 1, map: noiseTex(K, 128, 64, "#1c140f", [{ color: "rgba(90,60,40,.5)", n: 700 }, { color: "rgba(0,0,0,.6)", n: 700 }]) });
    K.sphere(r * 0.72, bM, { parent: g, p: [r * 0.3, -r * 0.45, 0], s: [1.0, 0.92, 1.08], th0: Math.PI * 0.42, thL: Math.PI * 0.58, ol: 0.5 });
    K.sphere(r * 0.27, bM, { parent: g, p: [r * 0.74, -r * 0.82, 0], s: [0.95, 0.85, 1.35], ol: 0.5 });
    [-1, 1].forEach((z) => {
      K.sphere(r * 0.3, bM, { parent: g, p: [r * 0.2, -r * 0.06, z * r * 0.82], s: [0.55, 1.75, 0.3], r: [0, 0, -0.2], ol: 0.4 });   // sideburn → jaw
      K.sphere(r * 0.26, bM, { parent: g, p: [r * 0.56, -r * 0.4, z * r * 0.42], s: [0.8, 0.62, 0.8], ol: 0 });                       // cheek line
    });
    faceArc(K, g, r, bM, { x: 1.03, y: -0.39, w: 0.44, sag: -0.08, t: 0.05 });   // moustache
    // terry-cloth headband on the hairline
    const terry = noiseTex(K, 128, 32, "#f7f7f5", [{ color: "rgba(0,0,0,.08)", n: 900, size: 1.5 }]);
    K.torus(r * 0.99, r * 0.13, K.mat(0xffffff, { map: terry, roughness: 1 }), { parent: g, p: [-r * 0.02, r * 0.5, 0], r: [Math.PI / 2, 0.18, 0], s: [1.04, 0.95, 1.45], ol: 0.6, rs: 10, ts: 36 });
  }
  function lbjJerseyPaint(c, w, h, fx, bx) {
    // white inner piping inside the gold neck and arm trim
    c.strokeStyle = "#ffffff"; c.lineWidth = 2.5;
    c.beginPath(); c.ellipse(fx, 0, w * 0.07 + 5, h * 0.16 + 5, 0, 0, Math.PI); c.stroke();
    [0, 0.5, 1].forEach((u) => { c.beginPath(); c.ellipse(w * u, h * 0.05, w * 0.09 + 5, h * 0.24 + 5, 0, 0, TAU); c.stroke(); });
    c.strokeStyle = LBJ_GOLD; c.lineWidth = 6; c.beginPath(); c.ellipse(bx, 0, w * 0.06, h * 0.08, 0, 0, Math.PI); c.stroke();
    // numbers: gold with a white outline, front and back; name on the back
    c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
    const num = (x, y, size) => { c.font = `900 ${size}px Arial Black, Arial`; c.lineWidth = 9; c.strokeStyle = "#ffffff"; c.strokeText("23", x, y); c.lineWidth = 4; c.strokeStyle = "#2c1050"; c.strokeText("23", x, y); c.fillStyle = LBJ_GOLD; c.fillText("23", x, y); };
    num(fx, h * 0.5, h * 0.3); num(bx, h * 0.48, h * 0.34);
    c.font = `900 ${h * 0.08}px Arial Black, Arial`; c.fillStyle = LBJ_GOLD; c.fillText("JAMES", bx, h * 0.24);
    // side panels
    c.fillStyle = "rgba(0,0,0,.12)"; [0, 0.5, 1].forEach((u) => c.fillRect(w * u - 6, h * 0.3, 12, h * 0.5));
  }
  const lbjModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 80, w: 38, skin: LBJ_SKIN, bodyW: 27, headR: 9.5, shoulders: 1.2, chest: 1.1, armBulk: 1.15, legBulk: 1.1, legScale: 1.1, armScale: 1.06,
        neck: { len: 6, r: 5.0 },
        head: { build: lbjHead },
        top: { type: "jersey", color: LBJ_PURPLE, color2: LBJ_GOLD, trim: LBJ_GOLD, paint: lbjJerseyPaint },
        bottom: { type: "shorts", color: LBJ_PURPLE, socks: "#ffffff" },
        shoes: { color: "#24123c", sole: "#f4f4f4", accent: LBJ_GOLD, laces: "#ffffff" },
      });
      const s = m.s;
      // shorts: purple with gold-and-white side panels and a gold hem
      const shortsTex = K.tex(256, 128, (c, w, h) => {
        c.fillStyle = LBJ_PURPLE; c.fillRect(0, 0, w, h);
        [0, 0.5, 1].forEach((u) => { c.fillStyle = LBJ_GOLD; c.fillRect(w * u - 14, 0, 28, h); c.fillStyle = "#ffffff"; c.fillRect(w * u - 18, 0, 3, h); c.fillRect(w * u + 15, 0, 3, h); });
        c.fillStyle = LBJ_GOLD; c.fillRect(0, h - 12, w, 12);
      });
      const shortsM = K.mat(0xffffff, { map: shortsTex, roughness: 0.7 });
      [m.legF, m.legB].forEach((L) => {
        L.hip.children.forEach((o) => { if (o.isMesh && o.geometry.type === "CylinderGeometry") o.material = shortsM; });
        const sh = 1.12 * 4.0 * s;
        // high-top collar and a gold heel tab
        K.cyl(sh * 1.12, sh * 1.22, 5 * s, m.M.shoe, { parent: L.ankle, p: [0.2 * s, 0.8 * s, 0], ol: 0.6 });
        K.cyl(sh * 1.24, sh * 1.24, 1.2 * s, K.mat(LBJ_GOLD, { roughness: 0.4 }), { parent: L.ankle, p: [0.2 * s, 3.1 * s, 0], ol: 0 });
      });
      // white wristbands
      const band = K.mat(0xffffff, { map: noiseTex(K, 64, 16, "#f5f5f3", [{ color: "rgba(0,0,0,.08)", n: 200 }]), roughness: 1 });
      [m.armF, m.armB].forEach((A) => K.cyl(3.2 * 1.18 * s * 1.2, 3.2 * 1.18 * s * 1.25, 3.4 * s, band, { parent: A.el, p: [0, -m.armL * 0.8, 0], ol: 0.5 }));
      dropSleeveRings(m);
      m.hipLift = 2 * m.h * 0.22 * 0.1;
      m.ball = K.basketball(8); m.armF.hand.add(m.ball); m.ball.position.set(1.5, -10.5, 0);
      K.collectMats(m);
      return m;
    },
    update(m, f, g, P, opts) {
      K3().poseHumanoid(m, f, P, g, opts);
      m.hips.position.y += m.hipLift;
      m.ball.visible = lbjBallOut(f);
      m.ball.rotation.z = -g.frame * 0.05;
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
            model3d(T, K, p) {
              const o = K.group(); o.userData.ball = K.basketball(p.r); o.add(o.userData.ball);
              const tr = K.glow(0xfdb927, 1, 0.75); tr.scale.set(46, 16, 1); tr.position.z = -6; o.add(tr); o.userData.trail = tr;
              return o;
            },
            update3d(o, p) { o.userData.ball.rotation.z = -p.t * 0.35 * p.facing; o.userData.trail.position.x = -p.vx * 1.2; },
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
    model: lbjModel,
    drawFxBehind(ctx, f, g) { FRAME = g.frame; lbjLook.behind(ctx, f, null); },
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

  // ---- RFK in 3D: lean and weathered, long strong jaw, thick swept-back salt-and-pepper hair, blue-grey eyes, a big grin,
  // navy suit with lapels and a flag pin, white shirt, dark tie, black oxfords; a green lightsaber, syringe and energy can.
  const RFK_SKIN = "#e0b08e";
  function rfkHead(T, K, g, r, spec, model) {
    sculptHead(K, model, g, r, {
      skin: RFK_SKIN, skull: [0.98, 1.03, 0.84], skullY: 0.1, jawW: 0.92, jawL: 1.16, jawR: 0.64, jawX: 0.36, chin: { r: 0.19, w: 1.6, x: 0.78, y: 0.76 }, cheeks: 0.2,
      nose: { x: 1.08, y: -0.17, tip: 0.105, wing: 0.08, w: 1.0, bridge: 0.09 },
      eyes: { r: 0.15, iris: "#5f84a6", lids: 0.34, gap: 0.37, y: 0.07 },
      brows: { color: "#4d4038", thick: 0.07, len: 0.31, tilt: -0.05, y: 0.33 },
      lips: { color: "#b9776a", w: 0.42, sag: 0.045, y: -0.48, x: 1.0, teeth: true, lower: 0.9 },
    });
    // thick hair, combed straight back with volume on top; darker on top, silver at the temples
    const hairTex = (base, light) => K.tex(128, 64, (c, w, h) => {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 64; i++) { c.strokeStyle = i % 3 ? light : "rgba(0,0,0,.22)"; c.lineWidth = 1; const x = (i * 37) % w; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 3, h * 0.3, x - 3, h * 0.6, x + 1, h); c.stroke(); }
    });
    const hairM = K.mat(0xffffff, { map: hairTex("#6a5d53", "rgba(200,192,182,.45)"), roughness: 0.8 });
    const silver = K.mat(0xffffff, { map: hairTex("#a59d94", "rgba(235,232,226,.6)"), roughness: 0.8 });
    hairCap(K, g, r, hairM, 1.07, Math.PI * 0.42, 0.45);
    hairCap(K, g, r, hairM, 1.05, Math.PI * 0.4, 1.0, { s: [1.0, 1.04, 0.97] });
    K.sphere(r * 1.03, hairM, { parent: g, p: [0, r * 0.1, 0], thL: Math.PI * 0.3, r: [0, 0, 1.9], s: [0.98, 1.03, 0.86], ol: 0.6 });   // nape
    [-1, 1].forEach((z) => K.sphere(r * 0.44, hairM, { parent: g, p: [-r * 0.42, -r * 0.08, z * r * 0.6], s: [1.1, 1.25, 0.6], r: [z * 0.5, 0, 0], ol: 0.5 }));   // behind the ears
    K.sphere(r * 0.84 * 1.05, hairM, { parent: g, p: [-r * 0.2, r * 0.1, 0], thL: Math.PI * 0.47, r: [0, 0, 1.25], s: [1, 1.04, 0.84 * 1.1], ol: 0.6 });   // back of the head
    K.sphere(r * 0.7, hairM, { parent: g, p: [r * 0.04, r * 0.8, 0], s: [1.42, 0.55, 1.08], r: [0, 0, 0.1], ol: 0.6 });   // swept volume on top
    K.sphere(r * 0.4, hairM, { parent: g, p: [r * 0.6, r * 0.8, 0], s: [0.85, 0.6, 1.6], r: [0, 0, -0.3], ol: 0.6 });     // the front lift
    [-1, 1].forEach((z) => K.sphere(r * 0.38, silver, { parent: g, p: [-r * 0.12, r * 0.24, z * r * 0.78], s: [1.5, 0.62, 0.36], r: [0, 0, 0.2], ol: 0.4 }));   // silver temples, combed back
  }
  // The saber is built along +Y from the grip point: pommel −5, emitter +8, blade 8 → 8 + L (the 2D drawSaber layout).
  function rfkSaber(K, h) {
    const L = h * SABER_LEN, sab = K.group();
    const chrome = K.mat("#d4d8e0", { metalness: 0.85, roughness: 0.25 }), black = K.mat("#1d1f25", { roughness: 0.45, metalness: 0.4 });
    K.cyl(1.6, 1.6, 9.5, chrome, { parent: sab, p: [0, 0.6, 0], ol: 0.4 });
    for (let i = 0; i < 4; i++) K.cyl(1.85, 1.85, 0.9, black, { parent: sab, p: [0, -2.4 + i * 1.9, 0], ol: 0, seg: 14 });   // grip ridges
    K.cyl(2.3, 1.7, 2.6, chrome, { parent: sab, p: [0, 7, 0], ol: 0.4 });                                                       // emitter shroud
    K.cyl(1.9, 1.5, 1.6, black, { parent: sab, p: [0, -4.6, 0], ol: 0.3 });                                                      // pommel
    K.box(1.2, 1.6, 0.8, K.mat("#d02a2a", { emissive: "#600000" }), { parent: sab, p: [0, 3.8, 1.7], ol: 0 });                  // activator
    const blade = K.group({ parent: sab, p: [0, 8 + L / 2, 0] });
    K.capsule(1.05, L - 1, K.basic("#f2fff4"), { parent: blade, ol: 0, seg: 10 });
    K.capsule(2.2, L - 1.5, K.glowMat(0x3dff6e, 0.55), { parent: blade, ol: 0, seg: 12 });
    K.capsule(3.8, L - 2, K.glowMat(0x22ff55, 0.2), { parent: blade, ol: 0, seg: 12 });
    const gl = K.glow(0x36ff6a, 16, 0.7); gl.position.set(0, 8.5, 0); sab.add(gl);
    const gl2 = K.glow(0x36ff6a, L * 1.1, 0.22); gl2.position.set(0, 8 + L / 2, 0); sab.add(gl2);
    sab.userData.blade = blade;
    return sab;
  }
  function syringe3d(K, sc) {
    const o = K.group();   // along +X, needle at +X
    const barrel = K.mat("#eef3f7", { transparent: true, opacity: 0.7, roughness: 0.15 });
    K.cyl(2.5 * sc, 2.5 * sc, 13 * sc, barrel, { parent: o, r: [0, 0, -Math.PI / 2], ol: 0.4 });
    K.cyl(1.9 * sc, 1.9 * sc, 8 * sc, K.mat("#66e05e", { emissive: "#1f6b1a", roughness: 0.3 }), { parent: o, p: [2 * sc, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0 });
    K.cyl(2.2 * sc, 1.2 * sc, 2 * sc, K.mat("#d8dde3", { roughness: 0.3 }), { parent: o, p: [7.4 * sc, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0 });
    K.cyl(0.32 * sc, 0.32 * sc, 7 * sc, K.mat("#b8c0c8", { metalness: 0.9, roughness: 0.2 }), { parent: o, p: [11.5 * sc, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0, seg: 6 });
    K.cyl(0.8 * sc, 0.8 * sc, 5 * sc, K.mat("#c9ced6"), { parent: o, p: [-8.5 * sc, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0, seg: 8 });
    K.cyl(2.8 * sc, 2.8 * sc, 0.8 * sc, K.mat("#c9ced6"), { parent: o, p: [-11 * sc, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0.3 });
    K.box(1 * sc, 6.5 * sc, 1.2 * sc, K.mat("#e9edf2"), { parent: o, p: [-6.5 * sc, 0, 0], ol: 0.3 });   // finger flange
    return o;
  }
  function energyCan(K) {
    const tex = K.tex(128, 64, (c, w, h) => {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) { c.fillStyle = (i + j) % 2 ? "#2b4c9b" : "#c4cbd6"; c.fillRect(i * w / 8, j * h / 4, w / 8, h / 4); }
      c.fillStyle = "#c4cbd6"; c.fillRect(w * 0.1, 0, w * 0.3, h); c.fillStyle = "#2b4c9b"; c.fillRect(w * 0.6, 0, w * 0.3, h);
      c.fillStyle = "#ffd23a"; c.beginPath(); c.arc(w * 0.25, h * 0.5, h * 0.24, 0, TAU); c.fill();
      c.fillStyle = "#e3343a"; c.beginPath(); c.arc(w * 0.25, h * 0.5, h * 0.17, 0, TAU); c.fill();
    });
    const o = K.group();
    K.cyl(2.6, 2.6, 9, K.mat(0xffffff, { map: tex, metalness: 0.5, roughness: 0.35 }), { parent: o, ol: 0.4 });
    K.cyl(2.2, 2.6, 0.9, K.mat("#d6dbe2", { metalness: 0.9, roughness: 0.2 }), { parent: o, p: [0, 4.9, 0], ol: 0 });
    return o;
  }
  const rfkModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 74, w: 32, skin: RFK_SKIN, bodyW: 21.5, headR: 9.4, shoulders: 1.14, chest: 0.98, armBulk: 0.98, legBulk: 0.92, legScale: 1.08, armScale: 1.04,
        neck: { len: 6.5, r: 3.7 },
        head: { build: rfkHead },
        top: { type: "suit", color: "#252b3d", shirt: "#f5f5f2", tie: "#4a1826", pin: true, pocketSquare: "#f4f4f2", cuff: "#f2f2ee" },
        bottom: { type: "slacks", color: "#252b3d" },
        shoes: { type: "dress", color: "#141414", sole: "#0b0b0b" },
      });
      const s = m.s;
      // shirt collar points either side of the knot
      const collarM = K.mat("#f7f7f4", { roughness: 0.6 });
      [-1, 1].forEach((z) => K.extrude([[0, 0], [z * 3.2 * s, 0.6 * s], [z * 1.2 * s, -3.4 * s]], 0.6 * s, collarM, { parent: K.group({ parent: m.torso, p: [4.6 * s, m.torsoLen * 1.08, z * 0.6 * s], r: [0, Math.PI / 2, 0] }), r: [-0.5, 0, 0], ol: 0.35 }));
      m.hipLift = 2 * m.h * 0.22 * 0.08;
      m.torso.traverse((o) => { if (o.isMesh && o.geometry.type === "SphereGeometry" && o.material.color.getHexString() === "4a1826") o.scale.multiplyScalar(0.62); });   // smaller tie knot
      m.fist = fistPoint(K, m);
      m.saber = rfkSaber(K, m.h); m.root.add(m.saber);
      m.syringe = syringe3d(K, 0.8); m.fist.add(m.syringe); m.syringe.position.set(1, 0, 0);
      m.can = energyCan(K); m.fist.add(m.can); m.can.position.set(1.2, 0.5, 0); m.can.rotation.z = -Math.PI / 2 - 0.4;
      m._v = new T.Vector3(); m._d = new T.Vector3(); m._up = new T.Vector3(0, 1, 0);
      K.collectMats(m);
      return m;
    },
    update(m, f, g, P, opts) {
      const K = K3();
      // 4 Red Bulls: the 2D arm angles put a 3D hand behind the ear; lift the can to the mouth instead
      if (attacking(f, "dspecial")) { const v = kf(f.mf, [[0, 0.4, 0.4], [10, 1.45, 1.6], [40, 1.45, 1.68], [46, 0.6, 0.5]]); P.armF = [v[0], v[1]]; }
      K.poseHumanoid(m, f, P, g, opts);
      m.hips.position.y += m.hipLift;
      // Saber Spin: a real twirl instead of the 2D squash
      const spin = attacking(f, "uspecial") && f.mf >= 4 && f.mf <= 30;
      const th = spin ? (f.mf - 4) * 0.8 : 0;
      if (spin) { const base = K.yawFor(f.facing); m.yaw.rotation.y = base + th; m.yawVal = base + Math.atan2(Math.sin(th), Math.cos(th)); }
      m.syringe.visible = P.hold === "syringe";
      m.can.visible = P.hold === "can";
      const sab = !P.hold || (P.hold !== "can" && P.hold !== "syringe" && P.hold !== "none");
      m.saber.visible = sab;
      if (!sab) return;
      // grip in the fist; the blade lies in the screen plane at the 2D angle, so it covers the 2D hitboxes exactly
      m.root.updateMatrixWorld(true);
      m.fist.getWorldPosition(m._v); m.root.worldToLocal(m._v);
      const a = P.armF[0] + P.armF[1] + (P.blade != null ? P.blade : 1.3) - (P.rot || 0);
      m._d.set(f.facing * Math.sin(a) * Math.cos(th), -Math.cos(a), -f.facing * Math.sin(a) * Math.sin(th)).normalize();
      m.saber.position.copy(m._v);
      m.saber.quaternion.setFromUnitVectors(m._up, m._d);
      m.saber.userData.blade.scale.x = m.saber.userData.blade.scale.z = 0.92 + 0.08 * Math.sin(g.frame * 0.9);   // hum
    },
  };
  function rfkFx(ctx, f, g, R) {
    if (attacking(f, "uspecial") && f.mf >= 4 && f.mf <= 30) {
      ctx.save(); ctx.shadowColor = "#36ff6a"; ctx.shadowBlur = 12;
      ctx.strokeStyle = "rgba(120,255,150,.6)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, -f.h * 0.7, f.h * 0.95, 10, 0, 0, TAU); ctx.stroke(); ctx.restore();
    } else saberTrail(ctx, f, R);
  }

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
            model3d(T, K) { return syringe3d(K, 1); },
            update3d(o, p) { o.rotation.z = -Math.atan2(p.vy, p.vx); },
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
      if (spin) ctx.restore();
      rfkFx(ctx, f, g, R);
    },
    model: rfkModel,
    drawFxBehind(ctx, f, g) { FRAME = g.frame; rfkLook.behind(ctx, f, null); },
    drawFx(ctx, f, g) { FRAME = g.frame; rfkFx(ctx, f, g, rig2d(f, g, rfkLook)); },
  });

  // ============================================================ STEVE JOBS
  // Zoner: Igun pellets, a long FaceTime beam, the Inav for recovery and a keynote trap.
  function steveLaser(f, g) {
    g.spawn({
      owner: f, x: f.x + f.facing * 32, y: f.y - f.h * 0.68, vx: f.facing * 15, r: 6, dmg: 3, angle: 25, bkb: 8, kbg: 35, life: 42, solid: false,
      model3d(T, K, p) {   // a glowing bolt: white core, cyan sheath, bright head
        const o = K.group(), L = Math.abs(p.vx) * 1.5;
        K.capsule(1.3, L, K.basic("#ffffff"), { parent: o, p: [-p.facing * L / 2, 0, 0], r: [0, 0, Math.PI / 2], ol: 0, seg: 8 });
        K.capsule(3.2, L, K.glowMat(0x7fe9ff, 0.55), { parent: o, p: [-p.facing * L / 2, 0, 0], r: [0, 0, Math.PI / 2], ol: 0, seg: 10 });
        o.add(K.glow(0x7fe9ff, 22, 0.9));
        return o;
      },
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
      model3d(T, K) {   // the keynote device: a glossy black cube, a countdown ring of lights, "…" above
        const o = K.group(), body = K.group({ parent: o, r: [0.25, -0.5, 0] });
        K.rbox(18, 18, 18, 3.5, K.mat("#121214", { roughness: 0.18, metalness: 0.3 }), { parent: body, ol: 0.7 });
        const seam = K.basic("#e6e6e6");
        K.box(0.7, 18.2, 0.4, seam, { parent: body, p: [0, 0, 9.05], ol: 0 }); K.box(18.2, 0.7, 0.4, seam, { parent: body, p: [0, 0, 9.05], ol: 0 });
        o.add(K.glow(0xffffff, 56, 0.35));
        o.userData.dots = [];
        for (let i = 0; i < 16; i++) {
          const a = Math.PI / 2 - (i / 16) * TAU;   // clockwise from the top, like the 2D ring
          o.userData.dots.push(K.sphere(1.3, K.basic("#7fd8ff"), { parent: o, p: [Math.cos(a) * 15, Math.sin(a) * 15, 12], ol: 0, ws: 8, hs: 6 }));
        }
        for (let i = -1; i <= 1; i++) K.sphere(1.3, K.basic("#ffffff"), { parent: o, p: [i * 4, 17, 0], ol: 0, ws: 8, hs: 6 });
        return o;
      },
      update3d(o, p, g) {
        const k = p.life / 96, blink = p.life < 30 && (g.frame >> 2) % 2 === 0;
        o.userData.dots.forEach((d, i) => { d.visible = i / 16 < k; d.material.color.set(blink ? "#ff5a48" : "#7fd8ff"); });
      },
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
  function drawInav(ctx, f, trailOnly) {
    const d = f.data.inav || { x: 0, y: -1 }, lx = d.x * f.facing;
    ctx.save(); ctx.translate(0, 5); ctx.rotate(clamp(lx * 0.3 + (d.y > 0 ? 0.15 * Math.sign(lx || 1) : 0), -0.45, 0.45));
    if (f.mf >= 8 && f.mf <= 38) {   // exhaust
      const tr = ctx.createLinearGradient(0, 0, -lx * 60, -d.y * 60);
      tr.addColorStop(0, "rgba(111,211,255,.65)"); tr.addColorStop(1, "rgba(111,211,255,0)");
      ctx.strokeStyle = tr; ctx.lineWidth = 10; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-lx * 60, 2 - d.y * 60); ctx.stroke();
    }
    if (trailOnly) { ctx.restore(); return; }
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

  // ---- Steve in 3D: slim, receding close-cropped greying hair, grey stubble beard, round rimless glasses,
  // black mock turtleneck, faded blue 501s, grey running shoes; the Igun, the phone and the Inav board.
  const SJ_SKIN = "#e6c2a2";
  function steveHead(T, K, g, r, spec, model) {
    sculptHead(K, model, g, r, {
      skin: SJ_SKIN, skull: [0.98, 1.05, 0.84], skullY: 0.1, jawW: 0.86, jawL: 1.12, jawR: 0.62, jawX: 0.36, chin: { r: 0.2, w: 1.3, x: 0.76, y: 0.76 }, cheeks: 0,
      nose: { x: 1.1, y: -0.17, tip: 0.105, wing: 0.08, w: 0.95, bridge: 0.085 },
      eyes: { r: 0.15, iris: "#4b3526", lids: 0.3, gap: 0.37, y: 0.07 },
      brows: { color: "#4f4740", thick: 0.055, len: 0.3, tilt: 0.0, y: 0.32 },
      lips: { color: "#a87a6c", w: 0.34, sag: 0.02, y: -0.48, x: 1.02, lower: 0.9 },
    });
    // receding, close-cropped, greying: a short cap well back from the temples, darker at the sides
    const hairM = K.mat(0xffffff, { roughness: 1, map: noiseTex(K, 128, 64, "#6c655e", [{ color: "rgba(30,26,22,.55)", n: 900 }, { color: "rgba(200,195,188,.5)", n: 600 }]) });
    hairCap(K, g, r, hairM, 1.03, Math.PI * 0.4, 0.52, { p: [0, r * 0.1, 0], s: [1.06, 1.06, 0.87] });
    K.sphere(r * 1.03, hairM, { parent: g, p: [0, r * 0.1, 0], thL: Math.PI * 0.3, r: [0, 0, 1.9], s: [0.98, 1.05, 0.86], ol: 0.6 });   // nape
    [-1, 1].forEach((z) => K.sphere(r * 0.42, hairM, { parent: g, p: [-r * 0.34, r * 0.06, z * r * 0.56], s: [1.15, 1.1, 0.45], r: [z * 0.55, 0, 0], ol: 0.3 }));   // sides behind the ears
    // short grey stubble over the jaw, chin and upper lip
    const stub = K.mat(0xffffff, { roughness: 1, map: noiseTex(K, 256, 128, "#a28c7d", [{ color: "rgba(70,62,56,.45)", n: 5000 }, { color: "rgba(225,218,210,.35)", n: 2500 }]) });
    K.sphere(r * 0.645, stub, { parent: g, p: [r * 0.36, -r * 0.47, 0], s: [1.0, 0.97, 0.88], th0: Math.PI * 0.44, thL: Math.PI * 0.56, ol: 0 });
    K.sphere(r * 0.205, stub, { parent: g, p: [r * 0.77, -r * 0.85, 0], s: [0.92, 0.86, 1.32], ol: 0 });
    [-1, 1].forEach((z) => K.sphere(r * 0.22, stub, { parent: g, p: [r * 0.1, -r * 0.12, z * r * 0.73], s: [0.6, 1.4, 0.32], r: [0, 0, -0.2], ol: 0 }));
    faceArc(K, g, r, stub, { x: 1.03, y: -0.395, w: 0.36, sag: -0.05, t: 0.045 });   // moustache
    // round rimless glasses: thin wire rims, faint blue lenses, a bridge and temple arms back to the ears
    const wire = K.mat("#8a8f96", { metalness: 0.9, roughness: 0.25 }), lens = K.mat("#cfe6ff", { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.2, depthWrite: false });
    const ey = 0.07, gap = 0.37, rr = r * 0.21, out = r * 1.04;
    [-1, 1].forEach((z) => {
      const az = z * gap;
      const ring = K.torus(rr, r * 0.026, wire, { parent: g, p: [Math.cos(az) * out, Math.sin(ey) * r + r * 0.02, Math.sin(az) * out], r: [0, Math.PI / 2 - az, 0], ol: 0, rs: 6, ts: 24 });
      K.mesh(new T.CircleGeometry(rr, 20), lens, { parent: ring, ol: 0 });
      rod(K, g, wire, [Math.cos(az) * out - r * 0.04, r * 0.1, Math.sin(az) * out + z * rr * 0.95], [-r * 0.02, r * 0.04, z * r * 0.84], r * 0.02);   // temple arm
    });
    K.capsule(r * 0.022, r * 0.14, wire, { parent: g, p: [out * 1.0, r * 0.12, 0], r: [Math.PI / 2, 0, 0], ol: 0, seg: 6 });
  }
  function igun3d(K) {
    const o = K.group();   // along +X (the muzzle)
    K.rbox(15, 7, 6, 2.6, K.mat("#f4f5f7", { roughness: 0.3 }), { parent: o, p: [4.5, 0, 0], ol: 0.5 });
    K.cyl(1.6, 1.9, 5, K.mat("#a7adb6", { metalness: 0.85, roughness: 0.25 }), { parent: o, p: [13.5, 0, 0], r: [0, 0, -Math.PI / 2], ol: 0.4 });
    K.box(6, 1.4, 0.4, K.basic("#7fe9ff"), { parent: o, p: [3.5, 1.4, 3.05], ol: 0 });
    K.sphere(1.1, K.mat("#c9ced6", { metalness: 0.6, roughness: 0.3 }), { parent: o, p: [-0.5, -0.6, 3.0], s: [1, 1, 0.3], ol: 0 });
    K.rbox(4, 7, 4.5, 1.6, K.mat("#e3e5e9", { roughness: 0.35 }), { parent: o, p: [0, -4.5, 0], r: [0, 0, 0.25], ol: 0.4 });   // grip
    const gl = K.glow(0x7fe9ff, 9, 0.8); gl.position.set(16.5, 0, 0); o.add(gl); o.userData.glow = gl;
    return o;
  }
  function phone3d(K) {
    const o = K.group();   // long axis along -Y (along the forearm), screen facing +X
    K.rbox(1.2, 12, 6, 1.0, K.mat("#1a1a1c", { metalness: 0.5, roughness: 0.3 }), { parent: o, ol: 0.4 });
    o.userData.screen = K.box(0.2, 10.4, 4.6, K.basic("#3c4a5a"), { parent: o, p: [0.62, 0, 0], ol: 0 });
    return o;
  }
  function inav3d(K) {
    const o = K.group();
    K.rbox(60, 7, 16, 3.4, K.mat("#eef1f5", { roughness: 0.3, metalness: 0.1 }), { parent: o, ol: 0.8 });
    K.rbox(52, 1.6, 14, 0.7, K.mat("#b9c1cb", { metalness: 0.6, roughness: 0.3 }), { parent: o, p: [0, -3.8, 0], ol: 0 });
    K.box(40, 1.2, 10, K.basic("#6fd3ff"), { parent: o, p: [0, -4.9, 0], ol: 0 });
    K.rbox(11, 0.6, 5, 1.2, K.basic("#1c2430"), { parent: o, p: [18, 3.6, 0], ol: 0 });
    [-1, 1].forEach((x) => K.cyl(4.5, 3.5, 2.2, K.mat("#2b3440", { metalness: 0.5 }), { parent: o, p: [x * 19, -5, 0], ol: 0 }));
    const gl = K.glow(0x6fd3ff, 70, 0.55); gl.position.set(0, -6, 0); gl.scale.set(80, 26, 1); o.add(gl);
    return o;
  }
  const steveModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 72, w: 32, skin: SJ_SKIN, bodyW: 19.5, headR: 9.2, shoulders: 1.0, chest: 0.95, armBulk: 0.9, legBulk: 0.88, legScale: 1.08, armScale: 1.04,
        neck: { len: 6.5, r: 3.6, color: "#151515" },
        head: { build: steveHead },
        top: { type: "turtleneck", color: "#151515", cuff: "#121212", tucked: false },
        bottom: { type: "jeans", color: "#4d6f9c" },
        shoes: { color: "#9a9ea5", sole: "#f1f0ec", accent: "#6c727b", laces: "#c9ccd1" },
      });
      const s = m.s;
      // mock-neck collar: a folded tube up the neck
      const knit = K.mat(0xffffff, { roughness: 0.95, map: K.tex(64, 32, (c, w, h) => { c.fillStyle = "#151515"; c.fillRect(0, 0, w, h); c.strokeStyle = "rgba(255,255,255,.07)"; c.lineWidth = 1.5; for (let x = 0; x < w; x += 4) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); } }) });
      K.cyl(4.6 * s, 5.4 * s, 5.2 * s, knit, { parent: m.neck, p: [0, 1.4 * s, 0], ol: 0.6 });
      K.torus(4.7 * s, 0.9 * s, knit, { parent: m.neck, p: [0, 4.0 * s, 0], r: [Math.PI / 2, 0, 0], ol: 0 });
      // denim: twill + fade on the jeans
      const denim = noiseTex(K, 128, 128, "#ffffff", [{ color: "rgba(0,0,0,.12)", n: 2600 }, { color: "rgba(255,255,255,.5)", n: 1200 }], [{ color: "rgba(0,0,0,.08)", step: 4, w: 1.2, slope: 0.6 }]);
      denim.wrapS = denim.wrapT = T.RepeatWrapping; denim.repeat.set(2, 2);
      m.M.pants.map = denim; m.M.pants.color.set("#55789f"); m.M.pants.needsUpdate = true;
      // the "N" on the running shoes
      const nTex = K.tex(64, 64, (c) => { c.font = "900 50px Arial Black, Arial"; c.textAlign = "center"; c.textBaseline = "middle"; c.lineWidth = 7; c.strokeStyle = "#f4f4f4"; c.strokeText("N", 32, 34); c.fillStyle = "#40464f"; c.fillText("N", 32, 34); });
      [m.legF, m.legB].forEach((L) => K.mesh(new T.PlaneGeometry(4.6 * s, 4.6 * s), K.basic(0xffffff, { map: nTex, transparent: true }), { parent: L.foot, p: [2.4 * s, -0.4 * s, 4.42 * s], r: [0, 0, -0.12], ol: 0 }));
      m.hipLift = 2 * m.h * 0.22 * 0.08;
      m.fist = fistPoint(K, m);
      m.igun = igun3d(K); m.fist.add(m.igun); m.igun.position.set(4, 0.5, 0); m.igun.rotation.z = -Math.PI / 2;   // barrel along the forearm, grip in the fist
      m.phone = phone3d(K); m.fist.add(m.phone); m.phone.position.set(4, -1.6, 0); m.phone.rotation.set(-0.6, 0, -Math.PI / 2);   // held up, screen toward the target
      m.board = inav3d(K); m.yaw.add(m.board);
      K.collectMats(m);
      return m;
    },
    update(m, f, g, P, opts) {
      K3().poseHumanoid(m, f, P, g, opts);
      m.hips.position.y += m.hipLift;
      m.igun.visible = P.hold === "igun";
      m.igun.userData.glow.visible = attacking(f, "nspecial") && f.mf >= 6 && f.mf <= 10;
      m.phone.visible = P.hold === "phone";
      const lit = attacking(f, "sspecial") && f.mf >= 12 && f.mf <= 32;
      m.phone.userData.screen.material.color.set(lit ? "#7dffa0" : "#3c4a5a");
      const ride = attacking(f, "uspecial") && f.mf >= 3 && f.mf <= 42;
      m.board.visible = ride;
      if (ride) {
        const d = f.data.inav || { x: 0, y: -1 }, lx = d.x * f.facing;
        m.board.position.set(0, -5 + Math.sin(g.frame * 0.4) * 0.8, 0);
        m.board.rotation.z = -clamp(lx * 0.3 + (d.y > 0 ? 0.15 * Math.sign(lx || 1) : 0), -0.45, 0.45);
      }
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
      steveFx(ctx, f, R.armF.end);
    },
    model: steveModel,
    drawFxBehind(ctx, f, g) {
      if (attacking(f, "uspecial") && f.mf >= 3 && f.mf <= 42) drawInav(ctx, f, true);
      steveFx(ctx, f, null, "behind");
    },
    drawFx(ctx, f, g) { FRAME = g.frame; steveFx(ctx, f, rig2d(f, g, steveLook).armF.end, "front"); },
  });
  // Charge glow + FaceTime beam, the Ibeam and the Spotlight (drawn over the body in 2D and 3D).
  // layer: "front" (over the 3D body), "behind" (the Spotlight, so it doesn't wash the model out) or undefined (2D: all).
  function steveFx(ctx, f, hand, layer) {
    if (layer === "behind" ? !attacking(f, "nair") : layer === "front" && attacking(f, "nair")) return;
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
  }
})();
