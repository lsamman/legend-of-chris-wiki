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

  // ------------------------------------------------------------ 3D helpers (see render3d.js; K = S.K3)
  const K3 = () => S.K3;
  // Where a 3D anchor ended up, in def.draw space (origin = feet, +x forward, y down). Call after posing;
  // the result is stashed on the fighter so def.drawFx can put 2D effects exactly on the 3D hand/back/etc.
  function fxAnchor(m, obj, f, out) {
    const v = m._v || (m._v = new (K3().T.Vector3)());
    obj.getWorldPosition(v); m.root.worldToLocal(v);
    out = out || {};
    out.x = v.x * (f.facing >= 0 ? 1 : -1); out.y = -v.y;
    return out;
  }
  // A flat shape facing +X (drawn in the z/y plane), bent round a cylinder of radius R so it hugs a face.
  function faceDecal(K, pts, mat, R, o = {}) {
    const T = K.T;
    const geo = new T.ShapeGeometry(new T.Shape(pts.map((p) => new T.Vector2(p[0], p[1]))), 6);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const u = pos.getX(i), v = pos.getY(i); pos.setXYZ(i, -(u * u) / (2 * R) - (o.Rv ? (v * v) / (2 * o.Rv) : 0), v, u); }
    geo.computeVertexNormals();
    mat.side = T.DoubleSide;
    return K.mesh(geo, mat, Object.assign({ ol: 0 }, o));
  }
  // Points along a curve y(t) for t in [-1, 1] (for smiles, brows, hairlines).
  function curvePts(n, fn) { const a = []; for (let i = 0; i <= n; i++) { const t = -1 + (2 * i) / n; a.push(fn(t)); } return a; }
  // Faceted cut gem (Chaos Emerald): flat-shaded lathe, emissive, with a soft additive glow.
  function gemMesh(K, size, color, o = {}) {
    const T = K.T;
    const pts = [[0.001, -6], [3.2, -1.2], [5, 1.4], [5, 2.2], [2.7, 4.6], [0.001, 4.6]].map(([x, y]) => new T.Vector2(x * size / 5, y * size / 5));
    const mat = K.mat(color, { flatShading: true, roughness: 0.12, metalness: 0.15, emissive: color, emissiveIntensity: 0.45, transparent: !!o.fade });
    const g = K.group();
    g.gem = K.mesh(new T.LatheGeometry(pts, 8), mat, { parent: g, ol: o.ol != null ? o.ol : 0.45 });
    // table facet highlight
    K.mesh(new T.CircleGeometry(size * 0.5, 8), K.basic("#ffffff", { transparent: true, opacity: 0.55 }), { parent: g.gem, p: [0, size * 0.93, 0], r: [-Math.PI / 2, 0, 0], ol: 0 });
    if (o.glow !== false) { g.glow = K.glow(color, size * (o.glowK || 4.2), 0.75); g.add(g.glow); }
    g.mat = mat;
    g.gem.traverse((c) => { if (c.userData.isOutline) { g.olMat = c.material; if (o.fade) c.material.transparent = true; } });
    return g;
  }
  // Fade a whole model (materials + outline hulls) for teleports; restore with a = 1.
  function fadeModel(m, a) {
    if (!m._olMats) { m._olMats = []; m.root.traverse((o) => { if (o.isMesh && o.userData.isOutline && !m._olMats.includes(o.material)) m._olMats.push(o.material); }); }
    if (a >= 1) { if (m._faded) { m._faded = false; m._flashKey = null; for (const om of m._olMats) { om.transparent = false; om.opacity = 1; } } return; }
    m._faded = true;
    for (const mt of m.mats) { mt.transparent = true; mt.opacity = a * (mt.userData.baseOpacity != null ? mt.userData.baseOpacity : 1); }
    for (const om of m._olMats) { om.transparent = true; om.opacity = a; }
  }
  // ---- sculpted heads. A unit sphere (front = +X) is pushed through shape(x, y, z) -> [x, y, z] and scaled by r.
  // UVs stay those of the sphere, so features can be painted by angle: az (toward +Z), el (up from the equator).
  //   paint(c, w, h, P) where P(az, el) -> [canvasX, canvasY].  Returns { mesh, surf(az, el, k) -> [x,y,z] }.
  function sculptHead(K, g, r, mat, shape, o = {}) {
    const T = K.T;
    const geo = new T.SphereGeometry(1, o.ws || 48, o.hs || 36);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const q = shape(pos.getX(i), pos.getY(i), pos.getZ(i)); pos.setXYZ(i, q[0] * r, q[1] * r, q[2] * r); }
    geo.computeVertexNormals();
    const mesh = K.mesh(geo, mat, Object.assign({ parent: g, ol: 0.9 }, o));
    const surf = (az, el, k = 1) => { const q = shape(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)); return [q[0] * r * k, q[1] * r * k, q[2] * r * k]; };
    return { mesh, surf };
  }
  const paintMap = (w, h) => (az, el) => [(0.5 - az / TAU) * w, (0.5 - el / Math.PI) * h];
  function headTex(K, skin, paint, w = 1024, h = 512) {
    return K.tex(w, h, (c) => { c.fillStyle = skin; c.fillRect(0, 0, w, h); paint(c, w, h, paintMap(w, h)); });
  }
  // A smooth closed path through (az, el) points, painted onto a head texture.
  function pathAE(c, P, pts, close) {
    c.beginPath();
    pts.forEach((q, i) => { const [x, y] = P(q[0], q[1]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    if (close) c.closePath();
  }
  // Hair cap: the head's shape pushed out by `thick`, with vertices below the hairline edge(az) (polar angle from
  // the crown) pulled up onto it, so the cap ends in a real hairline. vcol(x,y,z) -> [r,g,b] for streaks/greying.
  function hairCap(K, g, r, shape, edge, mat, o = {}) {
    const T = K.T;
    const geo = new T.SphereGeometry(1, o.ws || 48, o.hs || 30);
    const pos = geo.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const az = Math.atan2(z, x), th = Math.acos(Math.max(-1, Math.min(1, y))), lim = edge(az);
      if (th > lim) { const s = Math.sin(lim) / (Math.sin(th) || 1e-6); x *= s; z *= s; y = Math.cos(lim); }
      const q = shape(x, y, z), k = (o.thick ? o.thick(x, y, z, az) : 1.04);
      pos.setXYZ(i, q[0] * r * k, q[1] * r * k, q[2] * r * k);
      if (o.vcol) col.push(...o.vcol(x, y, z, az, th, lim));
    }
    if (o.vcol) { geo.setAttribute("color", new T.Float32BufferAttribute(col, 3)); mat.vertexColors = true; }
    geo.computeVertexNormals();
    return K.mesh(geo, mat, Object.assign({ parent: g, ol: 0.5 }, o.mesh || {}));
  }
  // Hair is matte (no specular sheen, which reads as grey on dark hair); collectAll also picks these up for flashing.
  const hairMat = (K, o = {}) => new K.T.MeshLambertMaterial(Object.assign({ color: 0xffffff }, o));
  function collectAll(K, m) {
    K.collectMats(m);
    m.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline && o.material && o.material.isMeshLambertMaterial && !m.mats.includes(o.material)) m.mats.push(o.material); });
  }
  // Smooth periodic hairline from control points [[az, polar], ...] (az in -PI..PI, sorted).
  function hairline(pts) {
    return (az) => {
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n], a0 = a[0], a1 = i + 1 < n ? b[0] : b[0] + TAU;
        let x = az; if (x < pts[0][0]) x += TAU;
        if (x >= a0 && x <= a1) { const k = (x - a0) / (a1 - a0), s = k * k * (3 - 2 * k); return a[1] + (b[1] - a[1]) * s; }
      }
      return pts[0][1];
    };
  }
  // Brows sitting on a sculpted surface. b = { color, thick, len, tilt, y, gap, out }
  function surfBrows(K, model, g, r, surf, b) {
    model.brows = [];
    const mat = K.mat(b.color, { roughness: 0.9 });
    [-1, 1].forEach((side) => {
      const p = surf(side * b.gap, b.y, b.out || 1.02);
      const holder = K.group({ parent: g, p, r: [0, -side * b.gap, 0] });
      model.brows.push(K.capsule(r * b.thick, r * b.len, mat, { parent: holder, r: [Math.PI / 2 + side * b.tilt, 0, b.arch || 0], s: [b.flat || 0.7, 1, 1], ol: 0 }));
    });
  }
  // Small helpers for heads facing +X.
  function earPair(K, g, r, mat, innerMat, o = {}) {
    [-1, 1].forEach((z) => {
      const eg = K.group({ parent: g, p: [o.x != null ? o.x : -r * 0.06, o.y != null ? o.y : -r * 0.06, z * r * (o.z || 0.9)], r: [0, z * (o.out || 0.25), 0] });
      const er = r * (o.r || 0.25);
      K.sphere(er, mat, { parent: eg, s: [0.62, 1.2, 0.34], ol: 0.45 });
      K.sphere(er * 0.62, innerMat, { parent: eg, p: [er * 0.05, -er * 0.05, z * er * 0.13], s: [0.62, 1.05, 0.3], ol: 0 });
      K.sphere(er * 0.3, mat, { parent: eg, p: [er * 0.2, -er * 0.95, 0], s: [0.8, 1, 0.6], ol: 0 });   // lobe
    });
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

  // ---- Plankton in 3D: fully custom (not the humanoid). A green bean with one big eye, the unibrow, antennae,
  // stick limbs driven from S.pose (same conventions as drawPlankton above) and a real folding chair.
  // Folding chair built along +X from the grip (top of the backrest); width along Y, thickness along Z.
  function buildChair(K) {
    const g = K.group();
    const metal = K.mat(METAL, { metalness: 0.45, roughness: 0.32 }), metalD = K.mat(METAL_D, { metalness: 0.5, roughness: 0.4 });
    const panel = K.mat("#8d949b", { metalness: 0.35, roughness: 0.4 }), rubber = K.mat("#26292c", { roughness: 0.85 }), rivet = K.mat("#d8dde2", { metalness: 0.7, roughness: 0.25 });
    const tube = (x0, y0, z0, x1, y1, z1, r, mat) => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, len = Math.hypot(dx, dy, dz);
      const m = K.cyl(r, r, len, mat, { parent: g, p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], seg: 10, ol: 0.35 });
      m.quaternion.setFromUnitVectors(new K.T.Vector3(0, 1, 0), new K.T.Vector3(dx / len, dy / len, dz / len));
      return m;
    };
    [-1, 1].forEach((sd) => {
      tube(-6.2, sd * 5.6, 0, 21.2, sd * 5.6, 0, 0.78, metal);                                   // front legs running up into the back uprights
      K.sphere(0.8, metal, { parent: g, p: [-6.2, sd * 5.6, 0], ol: 0 });                       // rounded tops
      tube(7.4, sd * 4.5, 1.9, 21.2, sd * 4.5, -2.2, 0.7, metalD);                             // rear legs, crossing the front ones
      K.cyl(1.0, 1.15, 1.6, rubber, { parent: g, p: [22, sd * 5.6, 0], r: [0, 0, Math.PI / 2], ol: 0 });       // rubber feet
      K.cyl(0.95, 1.1, 1.6, rubber, { parent: g, p: [22, sd * 4.5, -2.25], r: [0, 0, Math.PI / 2], ol: 0 });
      for (const [x, y, z] of [[7.4, sd * 4.95, 1.4], [14.3, sd * 5.1, 0.1], [7, sd * 5.6, 0.8]]) K.sphere(0.6, rivet, { parent: g, p: [x, y, z], ol: 0 });   // rivets at the pivots
    });
    tube(18.6, -5.6, 0, 18.6, 5.6, 0, 0.5, metal);                                               // cross braces
    tube(19.6, -4.5, -1.6, 19.6, 4.5, -1.6, 0.45, metalD);
    K.rbox(9, 13.4, 1.3, 1.6, metal, { parent: g, p: [-2.4, 0, 0.1], ol: 0.45 });               // backrest
    K.rbox(6.4, 10, 0.5, 1.2, panel, { parent: g, p: [-2.4, 0, 0.75], ol: 0 });                  // stamped inset
    const seat = K.group({ parent: g, p: [7, 0, 0.9], r: [0, -0.16, 0] });                       // seat folded up on its hinge
    K.rbox(10, 10.6, 1.0, 1.4, panel, { parent: seat, p: [5, 0, 0], ol: 0.45 });
    K.rbox(8, 8.4, 0.4, 1.0, metal, { parent: seat, p: [5, 0, 0.55], ol: 0 });
    return g;
  }
  function plShape(x, y, z) {
    const w = 10.1 - 1.5 * y;
    return [x * w + 0.9 * (1 - y * y) * Math.max(0, x), y > 0 ? y * 15 : y * 13, z * w];
  }
  function plPaint(hurt) {
    return (c, w, h, P) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, "#5aab42"); gr.addColorStop(0.55, PL_GREEN); gr.addColorStop(1, "#3a7a2c");
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) { c.fillStyle = i % 4 ? "rgba(30,70,20,.16)" : "rgba(170,230,140,.16)"; c.beginPath(); c.arc(Math.random() * w, Math.random() * h, 0.8 + Math.random() * 2.2, 0, TAU); c.fill(); }
      c.strokeStyle = "rgba(40,90,30,.12)"; c.lineWidth = 3; for (let x = 0; x < w; x += 23) { c.beginPath(); c.moveTo(x, h * 0.15); c.lineTo(x + 6, h * 0.92); c.stroke(); }
      const px = w / 1024;
      if (hurt) { c.fillStyle = "#1c3a14"; const [x, y] = P(0.05, -0.44); c.beginPath(); c.ellipse(x, y, 22 * px, 26 * px, 0, 0, TAU); c.fill(); c.fillStyle = "#6a1e1e"; c.beginPath(); c.ellipse(x, y + 6 * px, 14 * px, 14 * px, 0, 0, TAU); c.fill(); return; }
      // the scheming smirk: lifts on one side
      c.fillStyle = "#3c7a2e"; pathAE(c, P, curvePts(12, (t) => [t * 0.42 + 0.04, -0.38 + 0.04 * t * t - 0.05 * t]).concat(curvePts(12, (t) => [-t * 0.4 + 0.04, -0.46 + 0.05 * t * t + 0.035 * t])), true); c.fill();
      c.strokeStyle = "#173312"; c.lineWidth = 9 * px; c.lineCap = "round";
      pathAE(c, P, curvePts(16, (t) => [t * 0.44 + 0.04, -0.42 + 0.06 * t * t - 0.07 * t])); c.stroke();
      c.lineWidth = 6 * px; pathAE(c, P, [[-0.42, -0.36], [-0.47, -0.31]]); c.stroke();
    };
  }
  const plModel = {
    build(T, K) {
      const m = { root: K.group(), yawVal: null };
      m.yaw = K.group({ parent: m.root });
      m.body = K.group({ parent: m.yaw, p: [0, 20, 0] });
      m.inner = K.group({ parent: m.body, p: [0, -20, 0] });
      m.hips = K.group({ parent: m.inner, p: [0, 10, 0] });
      m.torso = K.group({ parent: m.hips });
      const skinA = headTex(K, PL_GREEN, plPaint(false)), skinB = headTex(K, PL_GREEN, plPaint(true));
      m.skin = K.mat(0xffffff, { map: skinA, roughness: 0.5 }); m.skinTex = [skinA, skinB];
      const green = K.mat(PL_GREEN, { roughness: 0.55 }), dark = K.mat(PL_DARK, { roughness: 0.6 });
      const bean = sculptHead(K, K.group({ parent: m.torso, p: [0, 13, 0] }), 1, m.skin, plShape, { ol: 0.7 });
      const surf = bean.surf, C = 13;
      // the eye: sclera, red iris, pupil, glint, and a lid that blinks
      const eyeAt = surf(0, 0.35); 
      m.eye = K.group({ parent: m.torso, p: [eyeAt[0] - 3.4, C + eyeAt[1], 0], s: [0.78, 1.1, 1] });
      const er = 6.2;
      K.sphere(er, K.mat("#fbf9e8", { roughness: 0.25 }), { parent: m.eye, ol: 0.5 });
      const red = K.mat("#d1202b", { roughness: 0.3 }), blk = K.basic("#0e0e0e"), wht = K.basic("#ffffff");
      m.irises = [0.62, 0.4].map((k) => {
        const ir = K.group({ parent: m.eye, r: [0, 0, -Math.PI / 2] });
        K.sphere(er * 1.008, red, { parent: ir, thL: k, ws: 24, hs: 6, ol: 0 });
        K.sphere(er * 1.014, blk, { parent: ir, thL: k * 0.46, ws: 20, hs: 4, ol: 0 });
        K.sphere(er * 0.12, wht, { parent: ir, p: [-er * 0.2, er * 1.0, er * 0.18], ol: 0 });
        return ir;
      });
      m.lid = K.group({ parent: m.eye });
      K.sphere(er * 1.07, green, { parent: m.lid, thL: Math.PI * 0.5, ol: 0.4 });
      // the famous angry unibrow: a thick dark bar dipping in the middle
      const browPts = [[-6.5, 8.3], [-3.2, 7.2], [0, 6.2], [3.2, 7.2], [6.5, 8.3]].map(([z, y]) => {
        const az = Math.atan2(z, 8), q = surf(az, Math.asin(Math.min(0.99, (y + 5 - 1) / 15)), 1.0);
        return new T.Vector3(Math.max(q[0], eyeAt[0] - 3.2 + 4.2 * 0.78) + 0.5, C + y + 5.2 - 5, z);
      });
      m.brow = K.group({ parent: m.torso });
      const browM = K.mat("#173312", { roughness: 0.8 });
      K.mesh(new T.TubeGeometry(new T.CatmullRomCurve3(browPts), 16, 1.2, 8, false), browM, { parent: m.brow, ol: 0 });
      browPts.slice(0, 1).concat(browPts.slice(-1)).forEach((q) => K.sphere(1.2, browM, { parent: m.brow, p: [q.x, q.y, q.z], ol: 0 }));
      // antennae with little bulbs (and the copter rotor that replaces them)
      m.ants = [];
      [-1, 1].forEach((sd) => {
        const a = K.group({ parent: m.torso, p: [0.4, C + 14.6, sd * 1.8] });
        const curve = new T.QuadraticBezierCurve3(new T.Vector3(0, 0, 0), new T.Vector3(1.2, 6.5, sd * 1.5), new T.Vector3(2.2, 11, sd * 5.2));
        K.mesh(new T.TubeGeometry(curve, 12, 0.5, 6, false), dark, { parent: a, ol: 0 });
        K.sphere(1.15, green, { parent: a, p: [2.2, 11, sd * 5.2], ol: 0.35 });
        m.ants.push(a);
      });
      m.rotor = K.group({ parent: m.torso, p: [0.4, C + 14.6, 0] });
      K.cyl(0.55, 0.55, 7, dark, { parent: m.rotor, p: [0, 3.5, 0], ol: 0 });
      m.blades = K.group({ parent: m.rotor, p: [0, 7.2, 0] });
      K.sphere(1.2, green, { parent: m.blades, ol: 0.3 });
      [0, Math.PI / 2].forEach((r) => K.box(30, 0.7, 2.6, K.mat("#3f8a30", { roughness: 0.6 }), { parent: m.blades, r: [0.14, r, 0], ol: 0.4 }));
      const disc = K.mesh(new T.CircleGeometry(16, 32), K.glowMat(0xb8f0a0, 0.3), { parent: m.rotor, p: [0, 7.2, 0], r: [-Math.PI / 2, 0, 0] });
      disc.material.side = T.DoubleSide;
      // limbs: thin green arms with little three-fingered hands, legs with pointy dark feet
      const limb = (parent, z, l1, l2, r, mat) => {
        const L = { sh: K.group({ parent, p: [0, 0, z] }) };
        K.capsule(r, l1, mat, { parent: L.sh, p: [0, -l1 / 2, 0], ol: 0.35 });
        L.el = K.group({ parent: L.sh, p: [0, -l1, 0] });
        K.sphere(r * 1.08, mat, { parent: L.el, ol: 0 });
        K.capsule(r, l2, mat, { parent: L.el, p: [0, -l2 / 2, 0], ol: 0.35 });
        L.end = K.group({ parent: L.el, p: [0, -l2, 0] });
        return L;
      };
      const arms = K.group({ parent: m.torso, p: [0, C + 2, 0] });
      m.armB = limb(arms, -8.8, 6, 6, 0.85, dark); m.armF = limb(arms, 8.8, 6, 6, 0.85, green);
      [m.armF, m.armB].forEach((A, i) => {
        const mat = i ? dark : green;
        K.sphere(1.45, mat, { parent: A.end, p: [0, -0.6, 0], s: [1, 1.1, 0.8], ol: 0.3 });
        for (let k = -1; k <= 1; k++) K.capsule(0.42, 1.3, mat, { parent: A.end, p: [0.4, -2.1, k * 0.75], r: [k * 0.35, 0, 0.15], ol: 0 });
        K.capsule(0.42, 1.0, mat, { parent: A.end, p: [1.2, -1.0, 0.7], r: [0.3, 0, -0.6], ol: 0 });
      });
      m.legB = limb(m.hips, -2.4, 5, 5.5, 1.0, dark); m.legF = limb(m.hips, 2.4, 5, 5.5, 1.0, green);
      [m.legF, m.legB].forEach((L) => { L.foot = K.group({ parent: L.end }); K.sphere(1.9, K.mat("#1d3a17", { roughness: 0.6 }), { parent: L.foot, p: [1.3, -0.1, 0], s: [1.65, 0.85, 1.05], ol: 0.35 }); });
      // the chair, gripped by the top of its backrest, running along the forearm
      m.chair = buildChair(K); m.chair.rotation.z = -Math.PI / 2; m.chair.position.set(0, -2.6, 0); m.armF.end.add(m.chair);
      K.collectMats(m);
      return m;
    },
    update(m, f, g, P, opts) {
      const K = K3(), t = g ? g.frame : 0;
      const target = K.yawFor(f.facing);
      if (m.yawVal == null || opts.snap) m.yawVal = target; else m.yawVal += (target - m.yawVal) * 0.35;
      m.yaw.rotation.y = m.yawVal;
      m.body.rotation.z = -(P.rot || 0);
      const legF = P.legF.slice(), legB = P.legB.slice();
      if (P.crouch) { legF[0] += P.crouch * 0.6; legF[1] -= P.crouch * 1.2; legB[1] -= P.crouch; }
      m.hips.position.set(P.lean * 1.5, 10 - P.bob * 0.6 - P.crouch * 4, 0);
      const tilt = Math.atan2(P.lean * 2, 13);
      m.torso.rotation.z = -tilt;
      const arm = (A, a) => { A.sh.rotation.z = a[0] + tilt; A.el.rotation.z = a[1]; };
      arm(m.armF, P.armF); arm(m.armB, P.armB);
      const leg = (L, a) => { L.sh.rotation.z = a[0]; L.el.rotation.z = a[1]; L.foot.rotation.z = f.grounded ? -(a[0] + a[1]) : -(a[0] + a[1]) * 0.4 - 0.25; };
      leg(m.legF, legF); leg(m.legB, legB);
      const hurt = f.state === "hitstun" || f.state === "tumble";
      const map = m.skinTex[hurt ? 1 : 0]; if (m.skin.map !== map) m.skin.map = map;
      const blink = (t + f.port * 37) % 190 > 183;
      m.lid.rotation.z = Math.PI / 2 - (hurt ? 0.12 : blink ? 1 : 0.3) * Math.PI;
      m.irises[0].visible = !hurt; m.irises[1].visible = hurt;
      m.brow.position.y = hurt ? 1.6 : 0;
      const copter = inMove(f, "uspecial") && f.mf < 60;
      m.rotor.visible = copter;
      for (const a of m.ants) a.visible = !copter;
      if (copter) m.blades.rotation.y = t * 0.9;
      else { const sway = Math.sin(t * 0.13 + f.port) * 1.5 - f.vx * 0.3 * (f.facing || 1); m.ants.forEach((a, i) => { a.rotation.z = -sway * 0.06; a.rotation.x = (i ? -1 : 1) * Math.sin(t * 0.11 + i) * 0.05; }); }
      m.chair.visible = !chairless(f);
      K.applyFlash(m, f, g);
    },
  };
  function chairModel(T, K, p) {
    const g = K.group(), inner = K.group({ parent: g });
    const ch = buildChair(K); ch.position.set(-8, 0, 0); inner.add(ch); inner.scale.setScalar(1.15);
    g.inner = inner; return g;
  }
  function chairUpdate(o, p) { o.inner.rotation.set(0, Math.sin(p.t * 0.09) * 0.5, -p.t * 0.38 * (p.facing || 1)); }

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
    model: plModel,
    drawFx(ctx, f, g) {
      if (f.state !== "attack" || chairless(f) || !/smash|dspecial|fair/.test(f.moveName)) return;
      const P = S.pose(f, g);
      if (!P.reach || !P.reach.active) return;
      ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, -20, Math.hypot(P.reach.x, P.reach.y + 20) + 4, Math.atan2(P.reach.y + 20, P.reach.x) - 0.7, Math.atan2(P.reach.y + 20, P.reach.x) + 0.2); ctx.stroke();
    },
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
            model3d: chairModel, update3d: chairUpdate,
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

  const OB_SKIN = "#8a5a3c", OB_SUIT = "#23262e", OB_SUIT3 = "#2e364b";
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
  // ---- Obama in 3D: tall and slim, navy suit, close-cropped hair greying at the temples, big warm smile.
  function obShape(x, y, z) {
    let X = x * 0.94, Y = y * 1.15, Z = z * 0.83;
    if (y < 0.15) { const t = Math.min(1, (0.15 - y) / 1.15); Z *= 1 - 0.27 * t * t; }      // narrower jaw toward the chin
    if (X > 0.64) X = 0.64 + (X - 0.64) * 0.52;                                             // flatter face
    if (x > 0) X += x * (0.08 * Math.exp(-((y + 0.8) ** 2) / 0.02) + 0.04 * Math.exp(-((y + 0.1) ** 2) / 0.03 - ((Math.abs(z) - 0.55) ** 2) / 0.04));   // chin, cheekbones
    if (x < 0.2 && y < -0.3) Y *= 1 - 0.18 * Math.min(1, (0.2 - x)) * Math.min(1, (-0.3 - y) / 0.5);   // tuck the nape in
    return [X, Y, Z];
  }
  function obPaintFace(hurt) {
    return (c, w, h, P) => {
      const lipC = "#5e3326", px = w / 1024;
      // soft warmth on the cheeks, shadow under the brow ridge and the jaw
      c.globalAlpha = 0.12; c.fillStyle = "#a0583a";
      [-1, 1].forEach((s) => { const [x, y] = P(s * 0.45, -0.25); c.beginPath(); c.ellipse(x, y, 34 * px, 22 * px, 0, 0, TAU); c.fill(); });
      c.globalAlpha = 1;
      // smile lines
      c.strokeStyle = "rgba(70,36,22,.38)"; c.lineWidth = 4 * px; c.lineCap = "round";
      [-1, 1].forEach((s) => { pathAE(c, P, [[s * 0.2, -0.24], [s * 0.3, -0.33], [s * 0.39, -0.44], [s * 0.41, -0.52]]); c.stroke(); });
      if (hurt) {
        c.fillStyle = lipC; pathAE(c, P, curvePts(10, (t) => [t * 0.24, -0.5 + 0.012 * t * t]).concat(curvePts(10, (t) => [-t * 0.24, -0.555 + 0.02 * t * t])), true); c.fill();
        return;
      }
      const top = (t) => -0.455 + 0.055 * t * t, bot = (t) => -0.47 - 0.14 * (1 - t * t) + 0.045 * t * t;
      c.fillStyle = "#2c120d"; pathAE(c, P, curvePts(16, (t) => [t * 0.37, top(t)]).concat(curvePts(16, (t) => [-t * 0.37, bot(t)])), true); c.fill();
      c.fillStyle = "#f6f2e8"; pathAE(c, P, curvePts(14, (t) => [t * 0.33, top(t) - 0.006]).concat(curvePts(14, (t) => [-t * 0.31, top(t) - 0.075 + 0.02 * t * t])), true); c.fill();
      c.strokeStyle = "rgba(160,150,140,.6)"; c.lineWidth = 1.2 * px;
      for (let i = -3; i <= 3; i++) { const t = i / 4.2; pathAE(c, P, [[t * 0.33, top(t) - 0.008], [t * 0.33, top(t) - 0.07]]); c.stroke(); }
      c.fillStyle = lipC; pathAE(c, P, curvePts(12, (t) => [t * 0.37, top(t) + 0.004]).concat(curvePts(12, (t) => [-t * 0.36, top(t) + 0.05 - 0.035 * t * t])), true); c.fill();       // upper lip
      c.fillStyle = "#6c3a2b"; pathAE(c, P, curvePts(12, (t) => [t * 0.33, bot(t) - 0.002]).concat(curvePts(12, (t) => [-t * 0.3, bot(t) - 0.055 + 0.04 * t * t])), true); c.fill();   // lower lip
      c.fillStyle = "rgba(255,220,200,.25)"; const [lx, ly] = P(0, bot(0) - 0.03); c.beginPath(); c.ellipse(lx, ly, 14 * px, 3 * px, 0, 0, TAU); c.fill();
    };
  }
  // Jacket front painted on the humanoid's torso lathe (front centre at fx; v runs by profile point, see render3d).
  function obSuitPaint(c, w, h, fx) {
    const lap = "#39435d", edge = "rgba(10,12,20,.75)";
    c.fillStyle = OB_SUIT3; c.fillRect(0, 0, w, h);
    // shirt V with collar points
    c.fillStyle = "#f6f6f3";
    c.beginPath(); c.moveTo(fx - w * 0.07, h * 0.1); c.lineTo(fx + w * 0.07, h * 0.1); c.lineTo(fx + w * 0.01, h * 0.53); c.lineTo(fx - w * 0.01, h * 0.53); c.closePath(); c.fill();
    // tie: knot + blade down to the belt
    c.fillStyle = "#2b5cb3";
    c.beginPath(); c.moveTo(fx - w * 0.016, h * 0.15); c.lineTo(fx + w * 0.016, h * 0.15); c.lineTo(fx + w * 0.03, h * 0.6); c.lineTo(fx, h * 0.66); c.lineTo(fx - w * 0.03, h * 0.6); c.closePath(); c.fill();
    c.strokeStyle = "rgba(255,255,255,.18)"; c.lineWidth = 2; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(fx - w * 0.03, h * (0.24 + i * 0.065)); c.lineTo(fx + w * 0.03, h * (0.2 + i * 0.065)); c.stroke(); }
    c.fillStyle = "#234d98"; c.beginPath(); c.moveTo(fx - w * 0.02, h * 0.1); c.lineTo(fx + w * 0.02, h * 0.1); c.lineTo(fx + w * 0.013, h * 0.16); c.lineTo(fx - w * 0.013, h * 0.16); c.closePath(); c.fill();
    // notched lapels
    [-1, 1].forEach((sd) => {
      c.fillStyle = lap; c.strokeStyle = edge; c.lineWidth = 2.2;
      c.beginPath();
      c.moveTo(fx + sd * w * 0.07, h * 0.1); c.lineTo(fx + sd * w * 0.135, h * 0.11); c.lineTo(fx + sd * w * 0.15, h * 0.26);
      c.lineTo(fx + sd * w * 0.118, h * 0.27); c.lineTo(fx + sd * w * 0.135, h * 0.31); c.lineTo(fx + sd * w * 0.012, h * 0.58); c.lineTo(fx + sd * w * 0.01, h * 0.53);
      c.closePath(); c.fill(); c.stroke();
    });
    // buttons, pocket flaps, breast pocket and the flag pin on his left lapel (canvas +x = the wearer's left)
    c.fillStyle = "#0e1018"; [0.64, 0.76].forEach((y) => { c.beginPath(); c.arc(fx + 3, h * y, 3.4, 0, TAU); c.fill(); });
    c.fillStyle = "rgba(0,0,0,.35)"; [-1, 1].forEach((sd) => c.fillRect(fx + sd * w * 0.13 - w * 0.03, h * 0.74, w * 0.06, 3));
    c.fillRect(fx + w * 0.1, h * 0.42, w * 0.05, 2.5);
    const px = fx + w * 0.085, py = h * 0.24;
    for (let i = 0; i < 5; i++) { c.fillStyle = i % 2 ? "#ffffff" : "#c8202f"; c.fillRect(px, py + i * 1.6, 11, 1.7); }
    c.fillStyle = "#1f3f8f"; c.fillRect(px, py, 5, 4.6);
    c.strokeStyle = "rgba(0,0,0,.2)"; c.lineWidth = 2; c.beginPath(); c.moveTo(w * 0.75, h * 0.45); c.lineTo(w * 0.75, h * 0.86); c.stroke();   // back seam
  }
  function obamaHead(T, K, g, r, spec, model) {
    const skinD = K.mat(S.shade(OB_SKIN, -0.08), { roughness: 0.6 });
    const faceA = headTex(K, OB_SKIN, obPaintFace(false)), faceB = headTex(K, OB_SKIN, obPaintFace(true));
    const faceMat = K.mat(0xffffff, { map: faceA, roughness: 0.55 });
    const head = sculptHead(K, g, r, faceMat, obShape);
    model.skull = head.mesh; model.faceMat = faceMat; model.faceTex = [faceA, faceB];
    const surf = head.surf;
    earPair(K, g, r, model.M.skin, skinD, { r: 0.31, out: 0.45, z: 0.82, x: -r * 0.08, y: -r * 0.1 });   // the famous ears
    // broad nose: bridge, rounded tip, flared wings
    const nm = K.mat(S.shade(OB_SKIN, -0.015), { roughness: 0.5 });
    const tip = surf(0, -0.2), br = surf(0, 0.02);
    K.capsule(r * 0.1, r * 0.22, nm, { parent: g, p: [(br[0] + tip[0]) / 2 + r * 0.06, (br[1] + tip[1]) / 2, 0], r: [0, 0, -0.35], ol: 0.35 });
    K.sphere(r * 0.135, nm, { parent: g, p: [tip[0] + r * 0.12, tip[1] - r * 0.02, 0], s: [0.95, 0.85, 1.05], ol: 0.4 });
    [-1, 1].forEach((z) => K.sphere(r * 0.1, nm, { parent: g, p: [tip[0] + r * 0.02, tip[1] - r * 0.06, z * r * 0.14], s: [0.9, 0.8, 1], ol: 0.25 }));
    const ep = surf(0.36, 0.1);
    K.eyes(model, g, r, { r: 0.16, iris: "#2b1a10", gap: 0.36, y: 0.1, lids: 0.3, out: Math.hypot(ep[0], ep[1], ep[2]) / r - 0.07 }, skinD);
    surfBrows(K, model, g, r, surf, { color: "#211a15", thick: 0.06, len: 0.3, tilt: -0.06, y: 0.33, gap: 0.37, out: 1.0 });
    // close-cropped hair, salt-and-pepper at the temples
    const dark = K.color("#0a0908"), grey = K.color("#7a756f");
    const edge = hairline([[-Math.PI, 2.1], [-2.5, 2.0], [-1.95, 1.5], [-1.62, 1.32], [-1.38, 1.62], [-1.15, 1.25], [-0.6, 1.0], [0, 0.95], [0.6, 1.0], [1.15, 1.25], [1.38, 1.62], [1.62, 1.32], [1.95, 1.5], [2.5, 2.0]]);
    const noise = K.tex(256, 128, (c, w, h) => { c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { c.fillStyle = `rgba(0,0,0,${0.1 + Math.random() * 0.3})`; c.fillRect(Math.random() * w, Math.random() * h, 1.3, 1.3); } });
    hairCap(K, g, r, obShape, edge, hairMat(K, { map: noise }), {
      thick: (x, y) => 1.025 + Math.max(0, y) * 0.018,
      vcol: (x, y, z, az, th, lim) => {
        const wgt = Math.exp(-((Math.abs(az) - 1.3) ** 2) / 0.18) * Math.max(0, 1 - (lim - th) / 0.6) * 0.9 + 0.05;
        const c = dark.clone().lerp(grey, Math.min(1, wgt)); return [c.r, c.g, c.b];
      },
    });
  }

  const obamaModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 72, w: 34, skin: OB_SKIN, bodyW: 21, headR: 9.6, chest: 1.02, shoulders: 1.12, armBulk: 0.95, legBulk: 0.95,
        neck: { len: 6.5, r: 3.9 },
        head: { build: obamaHead },
        top: { type: "shirt", color: OB_SUIT3, cuff: "#f6f6f3", paint: obSuitPaint },
        bottom: { type: "slacks", color: OB_SUIT3 },
        shoes: { type: "dress", color: "#0f0f11", sole: "#0a0a0a" },
      });
      // tie knot standing out of the collar (the rest of the shirt/tie/lapels is painted onto the jacket)
      const front = K.group({ parent: m.torso, r: [0, Math.PI / 2, 0] });   // local +Z = out of the chest
      K.extrude([[-1.5, 0], [1.5, 0], [1.0, -2.3], [-1.0, -2.3]], 1.5, K.mat("#2b5cb3", { roughness: 0.42 }), { parent: front, p: [0, m.torsoLen * 1.045, 8.9], r: [-0.45, 0, 0], ol: 0.3 });
      // Chaos Emerald set (Emerald Ascent ring / Executive uppercut) and the charged fist
      m.gems = EMERALDS.map((c) => { const gm = gemMesh(K, 4.8, c); gm.visible = false; m.root.add(gm); return gm; });
      m.fist = K.glow(0x5dff8a, 30, 0.9); m.armF.hand.add(m.fist); m.fist.position.set(0, -3, 0);
      collectAll(K, m);
      return m;
    },
    update(m, f, g, P, opts) {
      const K = K3();
      const tp = inMove(f, "sspecial") ? f.mf : -1;
      let a = 1;
      if (tp >= 3 && tp < 10) a = 1 - (tp - 3) / 7; else if (tp >= 10 && tp < 16) a = (tp - 10) / 6;
      if (a >= 1) fadeModel(m, 1);
      K.poseHumanoid(m, f, P, g, opts);
      if (a < 1) fadeModel(m, Math.max(0.05, a));
      const hurt = f.state === "hitstun" || f.state === "tumble";
      const map = m.faceTex[hurt ? 1 : 0]; if (m.faceMat.map !== map) m.faceMat.map = map;
      // charged fist
      const punch = inMove(f, "fsmash") && f.mf >= 8 && f.mf <= 20, spear = inMove(f, "nspecial") && f.mf >= 4 && f.mf <= 12;
      m.fist.visible = punch || spear;
      if (m.fist.visible) { m.fist.material.color.set(punch ? 0x5dff8a : 0xffe866); m.fist.scale.setScalar(26 + Math.sin(g.frame * 0.7) * 3); }
      // emeralds
      const asc = inMove(f, "uspecial"), up = inMove(f, "usmash") && f.mf >= 8 && f.mf <= 22;
      const dir = f.facing >= 0 ? 1 : -1;
      m.gems.forEach((gm, i) => {
        gm.visible = asc || up;
        if (asc) {
          const ang = f.mf * 0.35 + (i / 7) * TAU, z = Math.sin(ang);
          gm.position.set(dir * Math.cos(ang) * 30, f.h * 0.5 - z * 9, z * 30);
          gm.rotation.set(0.3, g.frame * 0.08 + i, dir * ang);
        } else if (up) {
          gm.position.set(dir * Math.sin(i * 2.3 + f.mf * 0.3) * 12, f.h + 6 + ((f.mf - 8) * 5 + i * 9) % 60, 6);
          gm.rotation.set(0, f.mf * 0.2 + i, 0.3);
        }
      });
    },
  };
  // Projectile models: the Chaos Spear and the orbiting emeralds.
  function spearModel(T, K, p) {
    const g = K.group(), inner = K.group({ parent: g });
    const gold = K.mat("#fff3a0", { emissive: "#ffd23a", emissiveIntensity: 0.9, roughness: 0.2 });
    K.cyl(1.4, 1.4, 22, gold, { parent: inner, p: [-6, 0, 0], r: [0, 0, Math.PI / 2], ol: 0.4 });
    K.cone(4.2, 14, gold, { parent: inner, p: [11, 0, 0], r: [0, 0, -Math.PI / 2], seg: 6, ol: 0.5 });
    [-1, 1].forEach((s) => K.cone(2.6, 8, gold, { parent: inner, p: [-15, s * 2.4, 0], r: [0, 0, Math.PI / 2 + s * 0.5], seg: 4, ol: 0.4 }));
    const tr = K.mesh(new T.PlaneGeometry(36, 6), K.glowMat(0xffe866, 0.55), { parent: inner, p: [-18, 0, -1] });
    tr.material.side = T.DoubleSide;
    g.add(K.glow(0xfff17a, 46, 0.85));
    g.inner = inner;
    return g;
  }
  function spearUpdate(o, p, g) { o.inner.scale.x = p.facing >= 0 ? 1 : -1; o.inner.rotation.x = g.frame * 0.35; }
  function orbitGemModel(T, K, p) { return gemMesh(K, 6.4, EMERALDS[p.idx], { fade: true, glowK: 3.6 }); }
  function orbitGemUpdate(o, p, g) {
    const fade = Math.min(1, p.life / 20, p.t / 8);
    o.position.z = p.behind ? -70 : 70;
    o.rotation.set(0.25, p.t * 0.09, Math.sin(p.t * 0.05) * 0.4);
    o.mat.opacity = fade; o.glow.material.opacity = 0.75 * fade; if (o.olMat) o.olMat.opacity = fade;
    o.scale.setScalar(0.6 + 0.4 * fade);
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
      life: 55, facing: f.facing, solid: false, model3d: spearModel, update3d: spearUpdate,
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
        pierce: true, solid: false, hits: shared, idx: i, model3d: orbitGemModel, update3d: orbitGemUpdate,
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
    model: obamaModel,
    drawFxBehind(ctx, f, g) {
      const tp = inMove(f, "sspecial") ? f.mf : -1;
      if (tp >= 3 && tp < 16) glow(ctx, 0, -f.h / 2, 46, "#7dffb0", 0.6 * (tp < 10 ? (tp - 3) / 7 : 1 - (tp - 10) / 6));
    },
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
  // ---- Zuck in 3D: slim, pale, short forward-combed curls, heather-grey tee, blue jeans, grey sneakers.
  function zkShape(x, y, z) {
    let X = x * 0.93, Y = y * 1.14, Z = z * 0.84;
    if (y < 0.15) { const t = Math.min(1, (0.15 - y) / 1.15); Z *= 1 - 0.26 * t * t; }
    if (X > 0.66) X = 0.66 + (X - 0.66) * 0.5;
    if (x > 0) X += x * (0.05 * Math.exp(-((y + 0.82) ** 2) / 0.02) + 0.03 * Math.exp(-((y + 0.25) ** 2) / 0.05 - ((Math.abs(z) - 0.5) ** 2) / 0.05));
    if (x < 0.2 && y < -0.3) Y *= 1 - 0.18 * Math.min(1, (0.2 - x)) * Math.min(1, (-0.3 - y) / 0.5);
    return [X, Y, Z];
  }
  function zkPaintFace(hurt) {
    return (c, w, h, P) => {
      const px = w / 1024;
      c.globalAlpha = 0.16; c.fillStyle = "#e89a86";
      [-1, 1].forEach((s) => { const [x, y] = P(s * 0.46, -0.28); c.beginPath(); c.ellipse(x, y, 30 * px, 18 * px, 0, 0, TAU); c.fill(); });
      c.globalAlpha = 1;
      c.strokeStyle = "rgba(170,110,90,.3)"; c.lineWidth = 3 * px; c.lineCap = "round";
      [-1, 1].forEach((s) => { pathAE(c, P, [[s * 0.17, -0.26], [s * 0.26, -0.36], [s * 0.3, -0.46]]); c.stroke(); });
      if (hurt) { c.fillStyle = "#6b2e2a"; const [x, y] = P(0, -0.5); c.beginPath(); c.ellipse(x, y, 12 * px, 9 * px, 0, 0, TAU); c.fill(); return; }
      // thin lips, a small closed-mouth half smile
      c.fillStyle = "#c2867a"; pathAE(c, P, curvePts(12, (t) => [t * 0.25, -0.475 + 0.02 * t * t]).concat(curvePts(12, (t) => [-t * 0.23, -0.5 + 0.015 * t * t])), true); c.fill();
      c.fillStyle = "#cf9488"; pathAE(c, P, curvePts(12, (t) => [t * 0.22, -0.5 + 0.015 * t * t]).concat(curvePts(12, (t) => [-t * 0.2, -0.535 + 0.025 * t * t])), true); c.fill();
      c.strokeStyle = "#7c3f36"; c.lineWidth = 2.6 * px; pathAE(c, P, curvePts(14, (t) => [t * 0.25, -0.5 + 0.022 * t * t + (t > 0 ? 0.006 * t : 0)])); c.stroke();
    };
  }
  function zuckHead(T, K, g, r, spec, model) {
    const skinD = K.mat(S.shade(ZK_SKIN, -0.07), { roughness: 0.6 });
    const faceA = headTex(K, ZK_SKIN, zkPaintFace(false)), faceB = headTex(K, ZK_SKIN, zkPaintFace(true));
    const faceMat = K.mat(0xffffff, { map: faceA, roughness: 0.55 });
    const head = sculptHead(K, g, r, faceMat, zkShape);
    model.skull = head.mesh; model.faceMat = faceMat; model.faceTex = [faceA, faceB];
    const surf = head.surf;
    earPair(K, g, r, model.M.skin, skinD, { r: 0.27, out: 0.32, z: 0.83, x: -r * 0.06, y: -r * 0.08 });
    const nm = K.mat(S.shade(ZK_SKIN, -0.02), { roughness: 0.5 });
    const tip = surf(0, -0.2), br = surf(0, 0.05);
    K.capsule(r * 0.08, r * 0.3, nm, { parent: g, p: [(br[0] + tip[0]) / 2 + r * 0.09, (br[1] + tip[1]) / 2, 0], r: [0, 0, -0.38], s: [1, 1, 0.85], ol: 0.35 });
    K.sphere(r * 0.1, nm, { parent: g, p: [tip[0] + r * 0.17, tip[1] - r * 0.02, 0], s: [1.05, 0.9, 0.9], ol: 0.35 });
    [-1, 1].forEach((z) => K.sphere(r * 0.07, nm, { parent: g, p: [tip[0] + r * 0.07, tip[1] - r * 0.06, z * r * 0.1], ol: 0 }));
    const ep = surf(0.36, 0.1);
    K.eyes(model, g, r, { r: 0.145, iris: "#6a8a8c", gap: 0.35, y: 0.1, lids: 0.3, out: Math.hypot(ep[0], ep[1], ep[2]) / r - 0.07 }, skinD);
    model.eyeGroups = model.eyes.map((e) => e.g);
    surfBrows(K, model, g, r, surf, { color: "#6a4a30", thick: 0.05, len: 0.3, tilt: 0.02, y: 0.34, gap: 0.37, out: 1.0 });
    // short, tight forward-combed curls: a bumpy cap with a ragged fringe, darker in the crevices
    const hairC = K.color("#6a4630"), hairD = K.color("#3b2617"), hairL = K.color("#8a6244");
    const bump = (x, y, z) => Math.sin(x * 19 + 1.3) * Math.sin(y * 21 + 0.4) * Math.sin(z * 18 + 2.1) + 0.5 * Math.sin(x * 33 + y * 29) * Math.sin(z * 31 - y * 7);
    const edge = hairline([[-Math.PI, 2.05], [-2.4, 1.95], [-1.9, 1.48], [-1.6, 1.3], [-1.38, 1.55], [-1.12, 1.2], [-0.55, 1.02], [0, 1.0], [0.55, 1.02], [1.12, 1.2], [1.38, 1.55], [1.6, 1.3], [1.9, 1.48], [2.4, 1.95]]);
    hairCap(K, g, r, zkShape, (az) => edge(az) + 0.05 * Math.sin(az * 15) * (Math.abs(az) < 1.2 ? 1 : 0.3), hairMat(K), {
      ws: 96, hs: 56,
      thick: (x, y, z) => 1.065 + Math.max(0, y) * 0.035 + bump(x, y, z) * 0.022,
      vcol: (x, y, z) => { const b = bump(x, y, z); const c = b > 0 ? hairC.clone().lerp(hairL, b * 0.6) : hairC.clone().lerp(hairD, -b * 0.8); return [c.r, c.g, c.b]; },
    });
  }
  const zuckModel = {
    build(T, K) {
      const heather = (c, w, h) => { for (let i = 0; i < 9000; i++) { c.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.1)" : "rgba(0,0,0,.1)"; c.fillRect(Math.random() * w, Math.random() * h * 0.86, 2, 1.2); } };
      const m = K.humanoid({
        h: 68, w: 32, skin: ZK_SKIN, bodyW: 20, headR: 9.6, chest: 0.98, shoulders: 1.0, armBulk: 0.92, legBulk: 0.95,
        neck: { len: 6, r: 3.8 },
        head: { build: zuckHead },
        top: { type: "tshirt", color: "#8e9298", paint: heather },
        bottom: { type: "jeans", color: "#3e5b86" },
        shoes: { color: "#8a8e95", sole: "#f2f2f2", accent: "#62666d", laces: "#ececec" },
      });
      m.M.sleeve.map = K.tex(128, 64, (c, w, h) => { c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, h); for (let i = 0; i < 1500; i++) { c.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.5)" : "rgba(0,0,0,.12)"; c.fillRect(Math.random() * w, Math.random() * h, 2, 1); } });   // heather the sleeves too
      m.fistAt = K.group({ parent: m.armF.hand, p: [1, -3, 0] });
      // Server Lift: metaverse headset + server-rack jetpack with two thrusters
      const white = K.mat("#f2f3f5", { roughness: 0.35 }), black = K.mat("#16181c", { roughness: 0.2, metalness: 0.3 });
      const r = m.headR;
      m.vr = K.group({ parent: m.head });
      K.rbox(r * 0.62, r * 0.66, r * 1.42, r * 0.22, white, { parent: m.vr, p: [r * 0.98, r * 0.12, 0], ol: 0.6 });
      K.rbox(r * 0.12, r * 0.5, r * 1.2, r * 0.12, black, { parent: m.vr, p: [r * 1.3, r * 0.12, 0], ol: 0 });
      K.torus(r * 0.97, r * 0.09, K.mat("#3a3d44", { roughness: 0.8 }), { parent: m.vr, p: [-r * 0.02, r * 0.18, 0], r: [Math.PI / 2, 0.08, 0], s: [1.0, 0.9, 1.4], ol: 0.4 });
      m.vrLed = K.sphere(r * 0.06, K.basic("#7fd0ff"), { parent: m.vr, p: [r * 1.32, r * 0.42, r * 0.5], ol: 0 });
      m.rack = K.group({ parent: m.torso, p: [-13.5, m.torsoLen * 0.56, 0], r: [0, 0, -0.08] });
      const rackTex = K.tex(64, 128, (c, w, h) => {
        c.fillStyle = "#2b2f36"; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 6; i++) { c.fillStyle = "#3d434d"; c.fillRect(5, 8 + i * 19, w - 10, 13); c.fillStyle = "#1b1e23"; for (let k = 0; k < 6; k++) c.fillRect(9 + k * 6, 11 + i * 19, 3, 7); }
        c.strokeStyle = "#5a606a"; c.lineWidth = 3; c.strokeRect(1.5, 1.5, w - 3, h - 3);
      });
      K.box(7, 20, 12, K.mat(0xffffff, { map: rackTex, roughness: 0.5, metalness: 0.3 }), { parent: m.rack, ol: 0.6 });
      m.leds = [];
      for (let i = 0; i < 6; i++) m.leds.push(K.box(0.6, 1.1, 1.8, K.basic("#3cff7a"), { parent: m.rack, p: [-3.6, 7.6 - i * 2.95, 3.6], ol: 0 }));
      m.flames = [];
      [-3, 3].forEach((z) => {
        K.cyl(1.6, 2.3, 3, K.mat("#50565f", { metalness: 0.6, roughness: 0.35 }), { parent: m.rack, p: [0, -11.4, z], ol: 0.4 });
        const fl = K.group({ parent: m.rack, p: [0, -13, z] }), cones = K.group({ parent: fl });
        K.cone(2.7, 1, K.glowMat(0x1877f2, 0.9), { parent: cones, p: [0, -0.5, 0], r: [Math.PI, 0, 0] });
        K.cone(1.4, 0.7, K.glowMat(0xd8f0ff, 0.95), { parent: cones, p: [0, -0.35, 0], r: [Math.PI, 0, 0] });
        const gl = K.glow(0x5aa8ff, 16, 0.8); gl.position.set(0, -4, 0); fl.add(gl);
        fl.cones = cones; m.flames.push(fl);
      });
      collectAll(K, m);
      return m;
    },
    update(m, f, g, P, opts) {
      K3().poseHumanoid(m, f, P, g, opts);
      const hurt = f.state === "hitstun" || f.state === "tumble";
      const map = m.faceTex[hurt ? 1 : 0]; if (m.faceMat.map !== map) m.faceMat.map = map;
      const lift = inMove(f, "uspecial");
      m.vr.visible = m.rack.visible = lift;
      for (const e of m.eyeGroups) e.visible = !lift;
      if (lift) {
        m.leds.forEach((l, i) => l.material.color.set((f.mf + i * 3) % 8 < 4 ? 0x3cff7a : 0x2aa0ff));
        const on = f.mf <= 38, k = 14 + ((f.mf * 7) % 6);
        m.flames.forEach((fl, i) => { fl.visible = on; fl.cones.scale.set(1, k + (i ? 2 : 0), 1); });
      }
      f._fxHand = fxAnchor(m, m.fistAt, f, f._fxHand);
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
    model: zuckModel,
    drawFx(ctx, f, g) {
      const hand = f._fxHand;
      if (!hand) return;
      if (inMove(f, "sspecial") && f.mf >= 4 && f.mf <= 16) blueHand(ctx, hand.x + 6, hand.y, 1);
      if (inMove(f, "fsmash") && f.mf >= 12 && f.mf <= 20) thumbsUp(ctx, hand.x + 8, hand.y - 4, 1.1 + (f.mf - 12) * 0.05);
      if (inMove(f, "nspecial") && f.mf >= 8 && f.mf <= 34) dataBeam(ctx, f, g, hand);
      if (inMove(f, "dspecial") && f.data.snapT && f.mf - f.data.snapAt >= 4 && f.mf - f.data.snapAt <= 12) glow(ctx, hand.x, hand.y, 22, "#ffffff", 0.9 - (f.mf - f.data.snapAt - 4) * 0.1);
    },
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
  // ---- Hank in 3D: stocky, squarish head and jaw, flat-top, rectangular glasses, white tee tucked into jeans,
  // big belt buckle, white sneakers, and a flat seat. Props: the golden SCAR, a hand-held tank, the back tank.
  function hkShape(x, y, z) {
    const p = 3.1, n = Math.pow(Math.pow(Math.abs(x), p) + Math.pow(Math.abs(y), p) + Math.pow(Math.abs(z), p), 1 / p);
    let X = (x / n) * 0.84, Y = (y / n) * 1.0, Z = (z / n) * 0.8;
    if (y > 0.2) { const t = (y - 0.2) / 0.8; Z *= 1 - 0.06 * t; X *= 1 - 0.04 * t; }                   // slightly narrower crown, wide jaw
    if (X > 0.66) X = 0.66 + (X - 0.66) * 0.45;                                                          // flat face
    if (x > 0) X += x * 0.05 * Math.exp(-((y + 0.85) ** 2) / 0.03);                                    // square chin
    if (x < 0.2 && y < -0.35) Y *= 1 - 0.16 * Math.min(1, 0.2 - x) * Math.min(1, (-0.35 - y) / 0.5);
    return [X, Y, Z];
  }
  function hkPaintFace(hurt) {
    return (c, w, h, P) => {
      const px = w / 1024;
      c.globalAlpha = 0.14; c.fillStyle = "#e08a74";
      [-1, 1].forEach((s) => { const [x, y] = P(s * 0.46, -0.24); c.beginPath(); c.ellipse(x, y, 30 * px, 20 * px, 0, 0, TAU); c.fill(); });
      c.globalAlpha = 1;
      c.strokeStyle = "rgba(150,90,60,.28)"; c.lineWidth = 3.5 * px; c.lineCap = "round";
      [-1, 1].forEach((s) => { pathAE(c, P, [[s * 0.17, -0.27], [s * 0.27, -0.38], [s * 0.31, -0.5]]); c.stroke(); });   // laugh lines
      c.strokeStyle = "rgba(150,90,60,.22)"; pathAE(c, P, [[-0.12, -0.74], [0, -0.77], [0.12, -0.74]]); c.stroke();          // chin crease
      if (hurt) { c.fillStyle = "#6b2a22"; const [x, y] = P(0, -0.52); c.beginPath(); c.ellipse(x, y, 12 * px, 16 * px, 0, 0, TAU); c.fill(); return; }
      // a firm, straight mouth
      c.fillStyle = "#c98c74"; pathAE(c, P, curvePts(10, (t) => [t * 0.22, -0.515]).concat(curvePts(10, (t) => [-t * 0.2, -0.545 - 0.01 * (1 - t * t)])), true); c.fill();
      c.strokeStyle = "#7a4436"; c.lineWidth = 3 * px; pathAE(c, P, curvePts(10, (t) => [t * 0.23, -0.512 + 0.012 * t * t])); c.stroke();
    };
  }
  // A rounded-rectangle ring (glasses frame) in the XY plane, facing +Z.
  function rectRing(K, w, h, t, d, rad, mat, o) {
    const T = K.T, rr = (sh, W, H, R) => {
      const x = -W / 2, y = -H / 2;
      sh.moveTo(x + R, y); sh.lineTo(x + W - R, y); sh.quadraticCurveTo(x + W, y, x + W, y + R); sh.lineTo(x + W, y + H - R);
      sh.quadraticCurveTo(x + W, y + H, x + W - R, y + H); sh.lineTo(x + R, y + H); sh.quadraticCurveTo(x, y + H, x, y + H - R);
      sh.lineTo(x, y + R); sh.quadraticCurveTo(x, y, x + R, y); return sh;
    };
    const outer = rr(new T.Shape(), w, h, rad), hole = rr(new T.Path(), w - t * 2, h - t * 2, Math.max(0.01, rad - t * 0.6));
    outer.holes.push(hole);
    const geo = new T.ExtrudeGeometry(outer, { depth: d, bevelEnabled: false, curveSegments: 5 });
    geo.translate(0, 0, -d / 2);
    return K.mesh(geo, mat, o);
  }
  const hkBristle = (K) => K.tex(256, 128, (c, w, h) => { c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.2})`; c.fillRect(Math.random() * w, Math.random() * h, 1, 2.5); } });
  function hankHead(T, K, g, r, spec, model) {
    const skinD = K.mat(S.shade(HK_SKIN, -0.08), { roughness: 0.6 });
    const faceA = headTex(K, HK_SKIN, hkPaintFace(false)), faceB = headTex(K, HK_SKIN, hkPaintFace(true));
    const faceMat = K.mat(0xffffff, { map: faceA, roughness: 0.55 });
    const head = sculptHead(K, g, r, faceMat, hkShape);
    model.skull = head.mesh; model.faceMat = faceMat; model.faceTex = [faceA, faceB];
    const surf = head.surf;
    earPair(K, g, r, model.M.skin, skinD, { r: 0.26, out: 0.22, z: 0.8, x: -r * 0.06, y: -r * 0.06 });
    const nm = K.mat(S.shade(HK_SKIN, -0.02), { roughness: 0.5 });
    const tip = surf(0, -0.2), br = surf(0, 0.04);
    K.capsule(r * 0.085, r * 0.2, nm, { parent: g, p: [(br[0] + tip[0]) / 2 + r * 0.06, (br[1] + tip[1]) / 2, 0], r: [0, 0, -0.4], ol: 0.35 });
    K.sphere(r * 0.13, nm, { parent: g, p: [tip[0] + r * 0.12, tip[1] - r * 0.02, 0], s: [1, 0.85, 1.0], ol: 0.4 });
    [-1, 1].forEach((z) => K.sphere(r * 0.08, nm, { parent: g, p: [tip[0] + r * 0.04, tip[1] - r * 0.06, z * r * 0.11], ol: 0 }));
    const ep = surf(0.34, 0.1);
    K.eyes(model, g, r, { r: 0.13, iris: "#3b2f25", gap: 0.34, y: 0.1, lids: 0.38, out: Math.hypot(ep[0], ep[1], ep[2]) / r - 0.06 }, skinD);
    surfBrows(K, model, g, r, surf, { color: "#5a3d22", thick: 0.06, len: 0.32, tilt: 0.1, y: 0.33, gap: 0.34, out: 1.01 });
    // rectangular glasses: two frames, lenses, bridge and temple arms back to the ears
    const fm = K.mat("#3b2b1d", { roughness: 0.35, metalness: 0.2 }), lens = K.mat("#cfe6f4", { transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1 });
    [-1, 1].forEach((sd) => {
      const p = surf(sd * 0.34, 0.1, 1.0);
      const fr = K.group({ parent: g, p: [p[0] + r * 0.13, p[1], p[2] * 1.02], r: [0, Math.PI / 2 - sd * 0.3, 0] });
      rectRing(K, r * 0.5, r * 0.36, r * 0.055, r * 0.05, r * 0.08, fm, { parent: fr, ol: 0 });
      K.mesh(new T.PlaneGeometry(r * 0.46, r * 0.32), lens, { parent: fr, ol: 0 });
      K.mesh(new T.PlaneGeometry(r * 0.1, r * 0.2), K.basic("#ffffff", { transparent: true, opacity: 0.45 }), { parent: fr, p: [-sd * r * 0.1, r * 0.03, 0.05], r: [0, 0, 0.5], ol: 0 });
      const ear = [-r * 0.05, p[1] + r * 0.02, sd * r * 0.84], hinge = [p[0] + r * 0.06, p[1] + r * 0.06, sd * r * 0.86];
      const len = Math.hypot(hinge[0] - ear[0], hinge[2] - ear[2]);
      K.capsule(r * 0.03, len, fm, { parent: g, p: [(ear[0] + hinge[0]) / 2, (ear[1] + hinge[1]) / 2, (ear[2] + hinge[2]) / 2], r: [0, Math.PI - Math.atan2(hinge[2] - ear[2], hinge[0] - ear[0]), Math.PI / 2], ol: 0 });
    });
    const bp = surf(0, 0.12, 1.0);
    K.capsule(r * 0.035, r * 0.16, fm, { parent: g, p: [bp[0] + r * 0.16, bp[1] + r * 0.02, 0], r: [Math.PI / 2, 0, 0], ol: 0 });
    // flat-top: the head shape pushed out and sheared off flat on top, short at the sides, a faint side part
    const hairC = K.color("#644326"), hairD = K.color("#412a16");
    const edge = hairline([[-Math.PI, 1.95], [-2.4, 1.85], [-1.9, 1.42], [-1.6, 1.3], [-1.38, 1.55], [-1.12, 1.2], [-0.6, 0.98], [0, 0.92], [0.6, 0.98], [1.12, 1.2], [1.38, 1.55], [1.6, 1.3], [1.9, 1.42], [2.4, 1.85]]);
    const top = 0.93;
    hairCap(K, g, r, (x, y, z) => { const q = hkShape(x, y, z), k = 1.05 + Math.max(0, y) * 0.1; return [q[0] * k, Math.min(q[1] * k, top), q[2] * k]; }, edge, hairMat(K, { map: hkBristle(K) }), {
      thick: () => 1, ws: 64, hs: 40,
      vcol: (x, y, z, az) => { const part = Math.exp(-((az + 0.75) ** 2) / 0.004) * (y > 0.45 ? 1 : 0); const c = hairC.clone().lerp(hairD, Math.min(1, part * 0.8 + (y < 0.5 ? 0.15 : 0))); return [c.r, c.g, c.b]; },
    });
  }
  // The golden SCAR, built along +X (muzzle) with +Y up; origin = the pistol grip.
  function buildScar(K) {
    const T = K.T, g = K.group();
    const gold = K.mat("#e6b73c", { metalness: 0.55, roughness: 0.3, emissive: "#4a3300", emissiveIntensity: 0.6 });
    const goldD = K.mat("#b8871e", { metalness: 0.6, roughness: 0.35, emissive: "#2a1c00", emissiveIntensity: 0.5 });
    const dark = K.mat("#3b3326", { roughness: 0.4, metalness: 0.3 });
    K.rbox(30, 6.6, 4.4, 1.2, gold, { parent: g, p: [5, 4.4, 0], ol: 0.6 });                                       // receiver
    K.box(28, 1.1, 2.4, goldD, { parent: g, p: [6, 8.2, 0], ol: 0.4 });                                            // top rail
    for (let i = 0; i < 9; i++) K.box(1.1, 0.7, 2.6, goldD, { parent: g, p: [-6 + i * 3.1, 9.0, 0], ol: 0 });       // rail teeth
    K.rbox(13, 3.6, 4.0, 1, goldD, { parent: g, p: [15.5, 1.9, 0], ol: 0.4 });                                     // lower handguard
    K.cyl(1.0, 1.0, 13, goldD, { parent: g, p: [26, 4.2, 0], r: [0, 0, Math.PI / 2], ol: 0.4 });                    // barrel
    K.cyl(1.55, 1.55, 4.2, gold, { parent: g, p: [33.5, 4.2, 0], r: [0, 0, Math.PI / 2], seg: 8, ol: 0.5 });        // muzzle brake
    K.cyl(0.7, 0.7, 4.4, dark, { parent: g, p: [33.5, 4.2, 0], r: [0, 0, Math.PI / 2], open: true, ol: 0 });
    K.box(1.2, 3.2, 1, gold, { parent: g, p: [18.5, 9.8, 0], ol: 0.3 });                                            // front sight
    K.rbox(9, 3.2, 2.8, 1, dark, { parent: g, p: [1.5, 10.4, 0], ol: 0.4 });                                       // optic
    K.cyl(1.2, 1.2, 0.4, K.basic("#8fd6ff"), { parent: g, p: [6.1, 10.4, 0], r: [0, 0, Math.PI / 2], ol: 0 });
    K.extrude([[-8, 6.8], [-23, 6.2], [-25.5, 5.4], [-25.5, -1.4], [-22.5, -1.4], [-18, 2.6], [-8, 2.6]], 3.4, gold, { parent: g, ol: 0.5 });   // folding stock
    K.extrude([[-24.5, 4.6], [-19, 4.6], [-19, 1.2], [-24.5, 0.2]], 3.8, dark, { parent: g, ol: 0 });             // butt pad / cheek riser
    K.extrude([[-2.4, 1.6], [2, 1.6], [0.6, -6.6], [-3.8, -6.6]], 3.0, goldD, { parent: g, ol: 0.4 });            // pistol grip
    K.extrude([[6.2, 1.4], [12.4, 1.4], [14.2, -9.4], [8.4, -9.4]], 2.8, gold, { parent: g, ol: 0.5 });           // magazine
    K.torus(2.1, 0.32, goldD, { parent: g, p: [3.6, 1.1, 0], arc: Math.PI, r: [0, 0, Math.PI], ol: 0 });           // trigger guard
    K.cyl(0.45, 0.45, 2.4, dark, { parent: g, p: [12, 6.2, 2.6], r: [Math.PI / 2, 0, 0], ol: 0 });                  // charging handle
    g.flash = K.glow(0xffe08a, 26, 0.95); g.flash.position.set(37, 4.2, 0); g.add(g.flash);
    return g;
  }
  // Propane tank: valve at the origin, body hanging down -Y. k scales it.
  function buildTank(K, k) {
    const g = K.group(), white = K.mat("#eceff1", { roughness: 0.35, metalness: 0.15 }), grey = K.mat("#8d949b", { roughness: 0.45, metalness: 0.4 });
    K.capsule(6.6 * k, 9 * k, white, { parent: g, p: [0, -11.5 * k, 0], ol: 0.6 });
    K.cyl(6.75 * k, 6.75 * k, 1.2 * k, grey, { parent: g, p: [0, -12 * k, 0], ol: 0 });                              // seam band
    K.torus(4.2 * k, 0.9 * k, grey, { parent: g, p: [0, -2.4 * k, 0], r: [Math.PI / 2, 0, 0], ol: 0.3 });          // collar
    K.cyl(1.1 * k, 1.4 * k, 2.6 * k, grey, { parent: g, p: [0, -1.4 * k, 0], ol: 0 });
    K.cyl(1.7 * k, 1.7 * k, 0.9 * k, K.mat("#c0392b", { roughness: 0.5 }), { parent: g, p: [0, 0.2 * k, 0], ol: 0.3 });   // red valve knob
    return g;
  }
  const hankModel = {
    build(T, K) {
      const m = K.humanoid({
        h: 76, w: 40, skin: HK_SKIN, bodyW: 27, headR: 10.2, belly: 0.3, chest: 1.04, shoulders: 1.06, bulk: 1.1, armBulk: 1.05, legBulk: 1.06,
        neck: { len: 5.5, r: 4.8 },
        head: { build: hankHead },
        top: { type: "tshirt", color: "#f3f3ee" },
        bottom: { type: "jeans", color: "#41608f", belt: { color: "#5b3a1e" } },
        shoes: { color: "#f2f2ee", sole: "#d9d9d3", laces: "#ffffff" },
      });
      const pelvis = m.hips.children[0]; pelvis.scale.x *= 0.78; pelvis.position.x += 1.4;   // the famously flat seat
      // big oval belt buckle
      const hipR = 27 * 0.5 * (1 + 0.3 * 0.12), s = 76 / 70;
      const buckleTex = K.tex(96, 64, (c, w, h) => {
        const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "#fff0b0"); gr.addColorStop(0.5, "#d6a83e"); gr.addColorStop(1, "#8a6418");
        c.fillStyle = gr; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 0, TAU); c.fill();
        c.strokeStyle = "#7a5512"; c.lineWidth = 4; c.beginPath(); c.ellipse(w / 2, h / 2, w / 2 - 8, h / 2 - 8, 0, 0, TAU); c.stroke();
        c.fillStyle = "#8a6418"; c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 7 : 16; c.lineTo(w / 2 + Math.cos(a) * rr, h / 2 + Math.sin(a) * rr); } c.fill();
      });
      const bk = K.group({ parent: m.torso, p: [hipR * 1.04 + 0.2, 1.4 * s, 0], r: [0, Math.PI / 2, 0] });
      K.mesh(new T.CircleGeometry(1, 28), K.mat(0xffffff, { map: buckleTex, transparent: true, metalness: 0.5, roughness: 0.3 }), { parent: bk, p: [0, 0, 0.45], s: [4.2, 3.0, 1], ol: 0 });
      K.cyl(1, 1, 0.8, K.mat("#a77b22", { metalness: 0.6, roughness: 0.35 }), { parent: bk, r: [Math.PI / 2, 0, 0], s: [4.3, 1, 3.1], ol: 0.4, seg: 28 });
      // props in the front hand
      m.scar = buildScar(K); m.scar.rotation.z = -Math.PI / 2; m.scar.position.set(0.6, -2.4, 0); m.armF.hand.add(m.scar);
      m.handTank = K.group({ parent: m.armF.hand, p: [1, -3, 0] });
      const ht = buildTank(K, 0.8); ht.rotation.z = Math.PI; ht.position.set(0, -2, 0); m.handTank.add(ht);   // body along the forearm
      K.cyl(0.8, 0.8, 9, K.mat("#3a3a3a", { roughness: 0.6 }), { parent: m.handTank, p: [3.2, -10, 0], ol: 0 });
      K.cyl(1.4, 0.9, 3, K.mat("#555a60", { metalness: 0.5, roughness: 0.4 }), { parent: m.handTank, p: [3.2, -15.5, 0], ol: 0.3 });
      // Propane Rocket: tank strapped to his back with a jet of flame
      m.backTank = K.group({ parent: m.torso, p: [-19.5, m.torsoLen * 1.02, 0], r: [0, 0, -0.12] });
      m.backTank.add(buildTank(K, 1.1));
      m.flame = K.group({ parent: m.backTank, p: [0, -27, 0] });
      m.flameCones = K.group({ parent: m.flame });
      K.cone(6, 1, K.glowMat(0xff8a1e, 0.9), { parent: m.flameCones, p: [0, -0.5, 0], r: [Math.PI, 0, 0] });
      K.cone(3.2, 0.75, K.glowMat(0x9fd0ff, 0.95), { parent: m.flameCones, p: [0, -0.3, 0], r: [Math.PI, 0, 0] });
      const fg = K.glow(0xffa040, 34, 0.85); fg.position.set(0, -10, 0); m.flame.add(fg);
      collectAll(K, m);
      return m;
    },
    update(m, f, g, P, opts) {
      K3().poseHumanoid(m, f, P, g, opts);
      const hurt = f.state === "hitstun" || f.state === "tumble";
      const map = m.faceTex[hurt ? 1 : 0]; if (m.faceMat.map !== map) m.faceMat.map = map;
      const burst = inMove(f, "sspecial"), rocket = inMove(f, "uspecial");
      m.scar.visible = !burst; m.handTank.visible = burst;
      m.scar.flash.visible = inMove(f, "nspecial") && [12, 13, 17, 18, 22, 23].includes(f.mf);
      m.backTank.visible = rocket;
      m.flame.visible = rocket && f.mf <= 32;
      if (m.flame.visible) m.flameCones.scale.set(1, 22 + ((f.mf * 5) % 9), 1);
    },
  };
  // Projectile models: SCAR rounds and the propane grill trap.
  function roundModel(T, K, p) {
    const g = K.group(), inner = K.group({ parent: g });
    K.capsule(1.3, 3.2, K.mat("#e9c46a", { metalness: 0.6, roughness: 0.3, emissive: "#6a4a00" }), { parent: inner, r: [0, 0, Math.PI / 2], ol: 0.3 });
    const tr = K.mesh(new T.PlaneGeometry(20, 2.6), K.glowMat(0xffdc78, 0.8), { parent: inner, p: [-10, 0, -0.5] });
    tr.material.side = T.DoubleSide;
    g.add(K.glow(0xfff6c8, 10, 0.9));
    g.inner = inner;
    return g;
  }
  function roundUpdate(o, p) { o.inner.scale.x = p.facing >= 0 ? 1 : -1; }
  function grillModel(T, K, p) {
    const g = K.group(), body = K.group({ parent: g, p: [0, -p.r, 0], s: 1.35 });
    const blk = K.mat("#222226", { roughness: 0.45, metalness: 0.35 }), steel = K.mat("#9aa1a8", { roughness: 0.35, metalness: 0.6 });
    // cart, firebox and domed lid
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => K.cyl(0.7, 0.7, 11, steel, { parent: body, p: [sx * 9, 5.5, sz * 4], ol: 0.3 })));
    K.box(19, 1, 9, blk, { parent: body, p: [0, 4, 0], ol: 0.4 });                                                  // bottom shelf
    [-1, 1].forEach((sx) => K.cyl(1.6, 1.6, 1.2, K.mat("#111", { roughness: 0.8 }), { parent: body, p: [sx * 9, 1.6, 4.6], r: [Math.PI / 2, 0, 0], ol: 0 }));   // wheels
    K.rbox(22, 5, 10, 1.2, blk, { parent: body, p: [0, 13.5, 0], ol: 0.6 });                                       // firebox
    const lid = K.cyl(5, 5, 22, blk, { parent: body, p: [0, 16, 0], r: [0, 0, Math.PI / 2], ol: 0.6, seg: 20 });
    lid.scale.set(1, 1, 1); lid.geometry.dispose(); lid.geometry = new T.CylinderGeometry(5, 5, 22, 20, 1, false, 0, Math.PI);
    lid.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    K.cyl(0.6, 0.6, 12, steel, { parent: body, p: [0, 22, 3.6], r: [0, 0, Math.PI / 2], ol: 0.3 });                // lid handle
    K.box(16, 0.6, 7, K.mat("#6c7178", { metalness: 0.7, roughness: 0.3 }), { parent: body, p: [0, 16.2, 0], ol: 0 });   // grate glimpse
    for (let i = 0; i < 3; i++) K.cyl(0.6, 0.6, 1.4, steel, { parent: body, p: [-5 + i * 5, 12.5, 5.2], r: [Math.PI / 2, 0, 0], ol: 0 });   // knobs
    const tank = buildTank(K, 0.62); tank.position.set(13.5, 10, 0); body.add(tank);                                 // side tank
    g.led = K.sphere(1.0, K.basic("#888888"), { parent: body, p: [-8, 13.5, 5.2], ol: 0 });
    g.gas = K.glow(0x5cb3ff, 26, 0.5); g.gas.position.set(0, 18 * 1.35 - p.r, 0); g.add(g.gas);
    return g;
  }
  function grillUpdate(o, p, g) {
    const armed = p.t >= 30, blink = armed && p.life < 120 && (p.t >> 2) % 2;
    o.led.material.color.set(blink ? 0xff3b2f : armed ? 0x45d36a : 0x888888);
    o.gas.visible = armed; o.gas.material.opacity = 0.35 + 0.15 * Math.sin(g.frame * 0.3);
    o.rotation.y = (p.facing || 1) * 0.35;
  }

  function drawHank(ctx, f, g) {
    S.drawHumanoid(ctx, f, hankLook, g);
  }

  function scarRound(f, g) {
    const y = f.y - f.h * 0.6;
    g.spawn({
      owner: f, x: f.x + f.facing * 48, y, vx: f.facing * 19, vy: 0, r: 5, dmg: 3, angle: 25, bkb: 14, kbg: 32, life: 26, facing: f.facing,
      model3d: roundModel, update3d: roundUpdate,
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
      model3d: grillModel, update3d: grillUpdate,
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
    model: hankModel,
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
