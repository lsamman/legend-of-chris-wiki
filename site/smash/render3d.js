/* Super Smash Ballers — 3D fighters (three.js, vendored as three.module.min.js and loaded by smash.html).
   Stages stay painted in 2D; fighters (and projectiles that ask for it) are real 3D models rendered with an
   orthographic camera that matches the 2D camera exactly, then composited into the 2D canvas.

   A fighter opts in with def.model = { build(T, K) -> model, update?(model, f, g, P) }.
   K (S.K3) is the modelling toolkit below: materials, primitives, painted textures, a detailed humanoid
   (K.humanoid) and its poser (K.poseHumanoid), which reads the same S.pose() angles the 2D rig uses.
   Effects that are easier in 2D go in def.drawFx / def.drawFxBehind (same coordinate space as def.draw).
   If three.js or WebGL is unavailable, everything falls back to the 2D def.draw. */
(function () {
  "use strict";
  const S = window.Smash;
  const K = (S.K3 = {});
  let T = null;
  const S3 = (S.three = { active: false, failed: false, outlines: true, toon: !/[?&]pbr=1/.test(location.search) });   // toon: cel shading + ink outlines

  // ------------------------------------------------------------ setup
  let worldR = null, portR = null, worldScene = null, portScene = null, worldCam = null, portCam = null;
  let worldLights = null, portLights = null;

  function makeLights(scene) {
    const hemi = new T.HemisphereLight(0xfff4e6, 0x3d3550, 1.6);
    const key = new T.DirectionalLight(0xffffff, 2.4); key.position.set(-260, 420, 600);
    const fill = new T.DirectionalLight(0xbcd2ff, 0.55); fill.position.set(400, 60, 300);
    const rim = new T.DirectionalLight(0xffffff, 1.5); rim.position.set(160, 260, -520);
    scene.add(hemi, key, fill, rim);
    return { hemi, key, fill, rim };
  }
  function applyStageLight(L, st) {
    const o = (st && st.light3d) || {};
    L.hemi.color.set(o.sky != null ? o.sky : 0xfff4e6); L.hemi.groundColor.set(o.ground != null ? o.ground : 0x3d3550);
    L.hemi.intensity = o.hemi != null ? o.hemi : 1.6;
    L.key.color.set(o.key != null ? o.key : 0xffffff); L.key.intensity = o.keyI != null ? o.keyI : 2.4;
    L.rim.color.set(o.rim != null ? o.rim : 0xffffff); L.rim.intensity = o.rimI != null ? o.rimI : 1.5;
  }

  S3.init = function () {
    if (S3.active || S3.failed) return S3.active;
    T = window.THREE;
    if (!T || /[?&]flat=1/.test(location.search)) { S3.failed = true; return false; }
    try {
      worldR = new T.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
      worldR.setClearColor(0x000000, 0);
      portR = new T.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
      portR.setClearColor(0x000000, 0);
      worldScene = new T.Scene(); portScene = new T.Scene();
      worldLights = makeLights(worldScene); portLights = makeLights(portScene);
      worldCam = new T.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
      portCam = new T.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
      K.T = T;
      S3.active = true;
    } catch (e) {
      console.warn("3D disabled:", e);
      S3.failed = true;
    }
    return S3.active;
  };
  S3.has = (def) => S3.active && def && def.model && !def._model3dBroken;

  // ------------------------------------------------------------ toolkit: materials & primitives
  K.color = (c) => new T.Color(c);
  // Cel-shaded by default (3 light bands, like the reference art); pass { pbr: true } or ?pbr=1 for smooth shading.
  let toonRamp = null;
  K.mat = function (color, o = {}) {
    if (S3.toon && !o.pbr) {
      if (!toonRamp) {
        toonRamp = new T.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, T.RGBAFormat);
        toonRamp.minFilter = toonRamp.magFilter = T.NearestFilter; toonRamp.needsUpdate = true;
      }
      const t = {};
      for (const k of ["map", "emissive", "emissiveIntensity", "transparent", "opacity", "side", "depthWrite", "alphaTest"]) if (o[k] !== undefined) t[k] = o[k];
      // shiny things (noses, lenses, metal) keep a specular-ish lift via a slightly brighter base
      return new T.MeshToonMaterial(Object.assign({ color, gradientMap: toonRamp }, t));
    }
    const q = Object.assign({}, o); delete q.pbr;
    return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.68, metalness: 0 }, q));
  };
  K.basic = (color, o = {}) => new T.MeshBasicMaterial(Object.assign({ color }, o));
  K.glowMat = (color, opacity = 1) => new T.MeshBasicMaterial({ color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false });

  // Inverted-hull outline: a slightly larger back-face copy in a dark shade. Cheap cartoon edges.
  K.outline = function (mesh, px = 0.9, color) {
    if (!S3.outlines || !mesh.geometry) return mesh;
    mesh.geometry.computeBoundingSphere();
    const r = Math.max(0.5, mesh.geometry.boundingSphere.radius);
    const col = color != null ? color : S3.toon ? 0x111111 : mesh.material.map ? 0x2a2a30 : darken(mesh.material.color, 0.55);
    if (S3.toon) px *= 1.7;   // bold ink lines
    const o = new T.Mesh(mesh.geometry, new T.MeshBasicMaterial({ color: col, side: T.BackSide }));
    const c = mesh.geometry.boundingSphere.center;
    const k = 1 + px / r;
    o.scale.setScalar(k);
    o.position.set(-c.x * (k - 1), -c.y * (k - 1), -c.z * (k - 1));
    o.userData.isOutline = true;
    mesh.add(o);
    return mesh;
  };
  function darken(c, k) { const x = c.clone(); x.multiplyScalar(k); return x; }

  // place: { p: [x,y,z], r: [x,y,z], s: number|[x,y,z], ol: outline px (0 = none) }
  K.place = function (obj, o = {}) {
    if (o.p) obj.position.set(o.p[0], o.p[1], o.p[2] || 0);
    if (o.r) obj.rotation.set(o.r[0] || 0, o.r[1] || 0, o.r[2] || 0);
    if (o.s != null) { if (Array.isArray(o.s)) obj.scale.set(o.s[0], o.s[1], o.s[2]); else obj.scale.setScalar(o.s); }
    if (o.parent) o.parent.add(obj);
    return obj;
  };
  K.mesh = function (geo, mat, o = {}) {
    const m = new T.Mesh(geo, mat);
    K.place(m, o);
    if (o.ol !== 0 && o.ol !== false && mat.type !== "MeshBasicMaterial") K.outline(m, o.ol || 0.9);
    return m;
  };
  K.group = (o = {}) => K.place(new T.Group(), o);
  K.sphere = (r, mat, o = {}) => K.mesh(new T.SphereGeometry(r, o.ws || 24, o.hs || 16, o.phi0 || 0, o.phiL || Math.PI * 2, o.th0 || 0, o.thL || Math.PI), mat, o);
  K.capsule = (r, len, mat, o = {}) => K.mesh(new T.CapsuleGeometry(r, Math.max(0.01, len), 6, o.seg || 14), mat, o);
  K.cyl = (rt, rb, h, mat, o = {}) => K.mesh(new T.CylinderGeometry(rt, rb, h, o.seg || 20, 1, !!o.open), mat, o);
  K.cone = (r, h, mat, o = {}) => K.mesh(new T.ConeGeometry(r, h, o.seg || 18), mat, o);
  K.torus = (r, tube, mat, o = {}) => K.mesh(new T.TorusGeometry(r, tube, o.rs || 10, o.ts || 28, o.arc || Math.PI * 2), mat, o);
  K.box = (w, h, d, mat, o = {}) => K.mesh(new T.BoxGeometry(w, h, d), mat, o);
  // Rounded box via an extruded rounded rectangle (w × h in XY, depth d along Z).
  K.rbox = function (w, h, d, rad, mat, o = {}) {
    const r = Math.min(rad, w / 2 - 0.01, h / 2 - 0.01), x = -w / 2, y = -h / 2;
    const sh = new T.Shape();
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r);
    sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r);
    sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    const bev = Math.min(r, d / 2) * 0.8;
    const geo = new T.ExtrudeGeometry(sh, { depth: Math.max(0.01, d - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 3, curveSegments: 6 });
    geo.translate(0, 0, -(d - bev * 2) / 2);
    return K.mesh(geo, mat, o);
  };
  // Super-ellipsoid: a smooth "rounded box" (e < 1 is boxier, 1 is a sphere) with clean normals for cel shading.
  // Note K.rbox's bevel grows the box by ~0.9 × rad on each side; prefer this for soft boxy shapes.
  K.superSphere = function (rx, ry, rz, e, mat, o = {}) {
    const geo = new T.SphereGeometry(1, o.ws || 40, o.hs || 28);
    const pos = geo.attributes.position, v = new T.Vector3();
    const f = (x) => Math.sign(x) * Math.pow(Math.abs(x), e);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); pos.setXYZ(i, f(v.x) * rx, f(v.y) * ry, f(v.z) * rz); }
    geo.computeVertexNormals();
    return K.mesh(geo, mat, o);
  };
  // Lathe around Y from [[radius, y], ...] (bottom → top). u = 0.25 is +X (the front), v = 1 is the top.
  K.lathe = function (pts, mat, o = {}) {
    const geo = new T.LatheGeometry(pts.map((p) => new T.Vector2(Math.max(0.001, p[0]), p[1])), o.seg || 32);
    return K.mesh(geo, mat, o);
  };
  // Flat extruded shape from 2D points (for ties, lapels, chair parts…).
  K.extrude = function (pts, depth, mat, o = {}) {
    const sh = new T.Shape(pts.map((p) => new T.Vector2(p[0], p[1])));
    const geo = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: !!o.bevel, bevelThickness: o.bevel || 0, bevelSize: o.bevel || 0, bevelSegments: 2 });
    geo.translate(0, 0, -depth / 2);
    return K.mesh(geo, mat, o);
  };
  // Canvas-painted texture. draw(ctx, w, h). For lathes: x = w*0.25 is the front centre, x = w*0.75 the back.
  K.tex = function (w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  // Additive glow sprite (soft radial).
  let glowTex = null;
  K.glow = function (color, size, opacity = 1) {
    if (!glowTex) glowTex = K.tex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.35, "rgba(255,255,255,.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
    const sp = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: T.AdditiveBlending, depthWrite: false }));
    sp.scale.set(size, size, 1);
    return sp;
  };

  // Basketball with painted seams.
  let ballTex = null;
  K.basketball = function (r, o = {}) {
    if (!ballTex) ballTex = K.tex(256, 128, (c, w, h) => {
      c.fillStyle = "#e0702a"; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 1600; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? "120,50,10" : "255,170,110"},.18)`; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }   // pebbling (texture only)
      c.strokeStyle = "#2b1406"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
      [0, 0.5].forEach((u) => { c.beginPath(); c.moveTo(w * (u + 0.25), 0); c.lineTo(w * (u + 0.25), h); c.stroke(); });
      [0, 0.5].forEach((u) => { c.beginPath(); for (let y = 0; y <= h; y += 2) { const x = w * u + Math.sin((y / h) * Math.PI) * w * 0.16; y ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); });
    });
    return K.sphere(r, K.mat(0xffffff, { map: ballTex, roughness: 0.8 }), Object.assign({ ws: 28, hs: 18 }, o));
  };

  // ------------------------------------------------------------ the humanoid
  /* spec (all sizes in px at the fighter's size; h = fighter height):
     { h, w, skin, bodyW, headR, bulk (limb thickness ×), legBulk, armBulk, belly (0..1), shoulders (×), neck: {len, r, color},
       head: { sx, sy, sz, jaw (0..1), chin, nose: { len, r, type: "round"|"pointy"|"broad"|"none" }, ears: { r, color },
               eyes: { r, iris, gap, y, lids (0 open .. 1 closed), lashes }, brows: { color, thick, tilt, y },
               mouth: { w, smile, color }, cheeks, hair: { style, color, ... }, beard: { style, color },
               glasses: { style: "round"|"rect"|"aviator", color, lens }, headband: { color, color2 }, build(T, K, headGroup, r, spec) },
       top:  { type: "tshirt"|"jersey"|"suit"|"turtleneck"|"sweater"|"shirt", color, color2, trim, text, number, tie, paint(ctx,w,h) },
       bottom: { type: "jeans"|"shorts"|"slacks", color, color2, cuffs: color, belt: { color, buckle } },
       shoes: { color, sole, accent, laces, type: "sneaker"|"dress" },
       hands: { color } (gloves) }
     Returns model { root, yaw, body, hips, torso, chest, neck, head, armF/armB: {sh, el, hand}, legF/legB: {hip, knee, ankle, foot}, mats, spec }.
     Attach props to model.armF.hand (local -Y points along the forearm toward the fingertips, +X is the knuckles/front). */
  K.humanoid = function (spec) {
    const h = spec.h || 70, s = h / 70;
    const skin = spec.skin || "#e0b48a";
    const M = {
      skin: K.mat(skin, { roughness: 0.55 }),
      top: K.mat((spec.top && spec.top.color) || "#8a8a8a", { roughness: 0.8 }),
      sleeve: K.mat((spec.top && (spec.top.sleeve || spec.top.color)) || "#8a8a8a", { roughness: 0.8 }),
      pants: K.mat((spec.bottom && spec.bottom.color) || "#334", { roughness: 0.85 }),
      shoe: K.mat((spec.shoes && spec.shoes.color) || "#222", { roughness: 0.5 }),
      sole: K.mat((spec.shoes && spec.shoes.sole) || "#f2f2f2", { roughness: 0.7 }),
      hand: K.mat((spec.hands && spec.hands.color) || skin, { roughness: 0.55 }),
    };
    const model = { spec, h, s, M, root: K.group(), yawVal: null };
    model.yaw = K.group({ parent: model.root });
    model.body = K.group({ parent: model.yaw, p: [0, h / 2, 0] });   // pivot for whole-body spins
    const inner = K.group({ parent: model.body, p: [0, -h / 2, 0] });
    model.inner = inner;

    const bodyW = spec.bodyW || (spec.w || 34) * 0.62;
    const torsoLen = h * 0.3;
    const zs = 0.64;   // torso front-to-back squash
    const top = spec.top || {}, bot = spec.bottom || {};
    const bulk = spec.bulk || 1;

    // hips (pelvis) group: legs hang from here, torso grows up from here
    model.hips = K.group({ parent: inner, p: [0, h * 0.43, 0] });
    const hipR = bodyW * 0.5 * (1 + (spec.belly || 0) * 0.12);
    // pelvis / seat of the pants
    K.sphere(hipR * 0.98, M.pants, { parent: model.hips, p: [0, -1.5 * s, 0], s: [1, 0.62, zs * 1.12] });

    // torso (lathe, painted)
    model.torso = K.group({ parent: model.hips });
    const waistR = bodyW * 0.45 * (1 + (spec.belly || 0) * 0.35), chestR = bodyW * 0.52 * (spec.chest || 1), shR = bodyW * 0.5 * (spec.shoulders || 1);
    const belly = spec.belly || 0;
    const pts = [
      [0.01, -4 * s], [hipR * 0.92, -3.5 * s], [hipR, 0], [waistR * (1 + belly * 0.3), torsoLen * 0.3], [Math.max(waistR, chestR) * (1 + belly * 0.12), torsoLen * 0.55],
      [chestR, torsoLen * 0.78], [shR, torsoLen * 0.94], [shR * 0.72, torsoLen * 1.06], [bodyW * 0.2, torsoLen * 1.12], [0.01, torsoLen * 1.13],
    ];
    const torsoTex = K.tex(512, 256, (c, w, hh) => paintTop(c, w, hh, top, bot, skin, spec));
    const torsoMat = K.mat(0xffffff, { map: torsoTex, roughness: 0.82 });
    model.chest = K.lathe(pts, torsoMat, { parent: model.torso, s: [1, 1, zs], ol: 1 });
    if (top.type === "suit" || top.type === "shirt") addTie(model, top, torsoLen, chestR, zs, s);
    if (top.type === "turtleneck") K.torus(bodyW * 0.22, 2.4 * s, K.mat(top.color, { roughness: 0.85 }), { parent: model.torso, p: [0, torsoLen * 1.1, 0], r: [Math.PI / 2, 0, 0], s: [1, zs * 1.25, 1] });
    if (top.type === "suit") addLapels(model, top, torsoLen, chestR, zs, s);
    if (bot.belt) {
      const belt = K.cyl(hipR * 1.02, hipR * 1.03, 3 * s, K.mat(bot.belt.color || "#4a2e18", { roughness: 0.5 }), { parent: model.torso, p: [0, 1.2 * s, 0], s: [1, 1, zs * 1.12], open: true, ol: 0 });
      belt.material.side = T.DoubleSide;
      if (bot.belt.buckle) K.rbox(5 * s, 3.6 * s, 1.2 * s, 0.8 * s, K.mat(bot.belt.buckle, { metalness: 0.8, roughness: 0.3 }), { parent: model.torso, p: [hipR * 1.02, 1.2 * s, 0], r: [0, Math.PI / 2, 0], ol: 0 });
    }

    // neck + head
    const nk = spec.neck || {};
    const neckR = (nk.r || 4.2) * s;
    model.neck = K.group({ parent: model.torso, p: [0, torsoLen * 1.06, 0] });
    K.cyl(neckR, neckR * 1.1, (nk.len || 7) * s, nk.color ? K.mat(nk.color) : M.skin, { parent: model.neck, p: [0, (nk.len || 7) * s * 0.4, 0], ol: 0 });
    const headR = spec.headR || h * 0.13;
    model.headR = headR;
    model.head = K.group({ parent: model.neck, p: [0, headR * 0.95 + (nk.len || 7) * s * 0.25, 0] });
    if (spec.head && spec.head.build) spec.head.build(T, K, model.head, headR, spec, model);
    else buildHead(model, model.head, headR, spec.head || {}, skin, s);

    // arms
    const armL = h * 0.17 * (spec.armScale || 1), legL = h * 0.22 * (spec.legScale || 1);
    const shZ = shR * zs + 1.2 * s;
    const longSleeve = !["tshirt", "jersey"].includes(top.type) || top.long;
    const arm = (z, dark) => {
      const A = {};
      A.sh = K.group({ parent: model.torso, p: [0, torsoLen * 0.9, z] });
      const ua = (spec.armBulk || 1) * bulk * 3.7 * s, fa = (spec.armBulk || 1) * bulk * 3.2 * s;
      // shoulder cap + upper arm
      const upperMat = top.type === "jersey" ? M.skin : M.sleeve;
      K.sphere(ua * 1.15, upperMat, { parent: A.sh, p: [0, -1 * s, 0] });
      K.capsule(ua, armL * 0.8, upperMat, { parent: A.sh, p: [0, -armL / 2, 0] });
      if (top.type === "tshirt" && !top.long) K.cyl(ua * 1.32, ua * 1.42, armL * 0.45, M.sleeve, { parent: A.sh, p: [0, -armL * 0.22, 0], ol: 0.6 });
      if (top.type === "jersey") K.torus(ua * 1.25, 0.9 * s, K.mat(top.trim || top.color2 || "#fff"), { parent: A.sh, p: [0, 0.5 * s, 0], r: [Math.PI / 2, 0, 0], ol: 0 });
      A.el = K.group({ parent: A.sh, p: [0, -armL, 0] });
      const foreMat = longSleeve ? M.sleeve : M.skin;
      K.sphere(fa * 1.05, foreMat, { parent: A.el, ol: 0 });
      K.capsule(fa, armL * 0.82, foreMat, { parent: A.el, p: [0, -armL / 2, 0] });
      if (longSleeve) K.cyl(fa * 1.18, fa * 1.18, 2.2 * s, top.cuff ? K.mat(top.cuff) : M.sleeve, { parent: A.el, p: [0, -armL + 1.6 * s, 0], ol: 0.5 });
      A.hand = K.group({ parent: A.el, p: [0, -armL, 0] });
      buildHand(A.hand, M.hand, s * (spec.handScale || 1), spec.hands && spec.hands.style);
      return A;
    };
    model.armB = arm(-shZ, true);
    model.armF = arm(shZ, false);

    // legs
    const legZ = hipR * zs * 0.55;
    const leg = (z) => {
      const L = {};
      L.hip = K.group({ parent: model.hips, p: [0, 0, z] });
      const th = (spec.legBulk || 1) * bulk * 4.7 * s, sh = (spec.legBulk || 1) * bulk * 4.0 * s;
      const shorts = bot.type === "shorts";
      K.capsule(th, legL * 0.85, M.pants, { parent: L.hip, p: [0, -legL / 2, 0] });
      if (shorts) K.cyl(th * 1.35, th * 1.55, legL * 0.75, M.pants, { parent: L.hip, p: [0, -legL * 0.45, 0], ol: 0.7 });
      L.knee = K.group({ parent: L.hip, p: [0, -legL, 0] });
      K.sphere(sh * 1.08, shorts ? M.skin : M.pants, { parent: L.knee, ol: 0 });
      K.capsule(sh, legL * 0.85, shorts ? M.skin : M.pants, { parent: L.knee, p: [0, -legL / 2, 0] });
      if (shorts && bot.socks) K.cyl(sh * 1.06, sh * 1.06, legL * 0.38, K.mat(bot.socks), { parent: L.knee, p: [0, -legL * 0.74, 0], ol: 0 });
      if (bot.cuffs) K.cyl(sh * 1.42, sh * 1.42, 3.4 * s, K.mat(bot.cuffs, { roughness: 0.85 }), { parent: L.knee, p: [0, -legL * 0.78, 0], ol: 0.6 });
      else if (!shorts) K.cyl(sh * 1.22, sh * 1.3, legL * 0.3, M.pants, { parent: L.knee, p: [0, -legL * 0.82, 0], ol: 0.6 });   // trouser flare over the shoe
      L.ankle = K.group({ parent: L.knee, p: [0, -legL, 0] });
      L.foot = buildShoe(L.ankle, spec.shoes || {}, M, s);
      return L;
    };
    model.legB = leg(-legZ);
    model.legF = leg(legZ);
    model.legL = legL; model.armL = armL; model.torsoLen = torsoLen;

    collectMats(model);
    return model;
  };

  function collectMats(model) {
    model.mats = [];
    model.root.traverse((o) => { if (o.isMesh && !o.userData.isOutline && o.material && (o.material.isMeshStandardMaterial || o.material.isMeshToonMaterial) && !model.mats.includes(o.material)) model.mats.push(o.material); });
  }
  K.collectMats = collectMats;

  // Torso texture: clothes painted onto the lathe (front centre at x = w/4, back centre at 3w/4, top at y = 0).
  function paintTop(c, w, h, top, bot, skin, spec) {
    const col = top.color || "#888", col2 = top.color2 || "#fff";
    const pantsTop = h * 0.86;   // bottom 14% is the waistband of the trousers
    c.fillStyle = col; c.fillRect(0, 0, w, h);
    const fx = w * 0.25, bx = w * 0.75;
    const shade = (y0, y1, a) => { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, `rgba(0,0,0,0)`); g.addColorStop(1, `rgba(0,0,0,${a})`); c.fillStyle = g; c.fillRect(0, y0, w, y1 - y0); };
    switch (top.type) {
      case "jersey": {
        // skin shows at the neck and through the arm holes
        c.fillStyle = skin;
        c.beginPath(); c.ellipse(fx, 0, w * 0.07, h * 0.16, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(bx, 0, w * 0.06, h * 0.08, 0, 0, Math.PI * 2); c.fill();
        [0, 0.5].forEach((u) => { c.beginPath(); c.ellipse(w * u, h * 0.05, w * 0.09, h * 0.24, 0, 0, Math.PI * 2); c.fill(); });
        c.beginPath(); c.ellipse(w, h * 0.05, w * 0.09, h * 0.24, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = top.trim || col2; c.lineWidth = 7;
        c.beginPath(); c.ellipse(fx, 0, w * 0.07, h * 0.16, 0, 0, Math.PI); c.stroke();
        [0, 0.5, 1].forEach((u) => { c.beginPath(); c.ellipse(w * u, h * 0.05, w * 0.09, h * 0.24, 0, 0, Math.PI * 2); c.stroke(); });
        c.fillStyle = top.trim || col2; c.fillRect(0, h * 0.74, w, 6);
        if (top.text) { c.font = `900 ${h * 0.09}px Arial Black, Arial`; c.textAlign = "center"; c.fillStyle = col2; c.fillText(top.text, fx, h * 0.3); }
        if (top.number) {
          c.font = `900 ${h * 0.34}px Arial Black, Arial`; c.textAlign = "center"; c.textBaseline = "middle"; c.lineJoin = "round";
          [[fx, h * 0.47], [bx, h * 0.42]].forEach(([x, y]) => { c.lineWidth = 8; c.strokeStyle = top.trim || "#fff"; c.strokeText(top.number, x, y); c.fillStyle = col2; c.fillText(top.number, x, y); });
        }
        break;
      }
      case "suit": {
        // shirt V + jacket opening; buttons; pocket square
        c.fillStyle = top.shirt || "#f4f4f2";
        c.beginPath(); c.moveTo(fx - w * 0.06, 0); c.lineTo(fx + w * 0.06, 0); c.lineTo(fx + w * 0.012, h * 0.52); c.lineTo(fx - w * 0.012, h * 0.52); c.closePath(); c.fill();
        c.strokeStyle = "rgba(0,0,0,.35)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(fx, h * 0.52); c.lineTo(fx, h * 0.84); c.stroke();
        c.fillStyle = "#151515"; [0.6, 0.72].forEach((y) => { c.beginPath(); c.arc(fx + 4, h * y, 3.5, 0, Math.PI * 2); c.fill(); });
        c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(fx + w * 0.05, h * 0.62, w * 0.05, 3);   // pocket flap
        if (top.pin) { c.fillStyle = "#b22234"; c.fillRect(fx - w * 0.075, h * 0.3, 9, 6); c.fillStyle = "#3c3b6e"; c.fillRect(fx - w * 0.075, h * 0.3, 4, 3); }
        if (top.pocketSquare) { c.fillStyle = top.pocketSquare; c.beginPath(); c.moveTo(fx - w * 0.09, h * 0.36); c.lineTo(fx - w * 0.06, h * 0.33); c.lineTo(fx - w * 0.055, h * 0.37); c.fill(); }
        c.strokeStyle = "rgba(0,0,0,.18)"; c.lineWidth = 2; c.beginPath(); c.moveTo(bx, h * 0.45); c.lineTo(bx, h * 0.86); c.stroke();   // back vent
        break;
      }
      case "shirt": {
        c.strokeStyle = "rgba(0,0,0,.25)"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx, h * 0.1); c.lineTo(fx, h * 0.86); c.stroke();
        c.fillStyle = "#e8e8e8"; for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(fx + 4, h * (0.25 + i * 0.16), 2.6, 0, Math.PI * 2); c.fill(); }
        c.fillStyle = col; c.beginPath(); c.moveTo(fx - w * 0.07, 0); c.lineTo(fx, h * 0.14); c.lineTo(fx + w * 0.07, 0); c.fill();
        break;
      }
      case "turtleneck": {
        c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 2;
        for (let x = 0; x < w; x += 8) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h * 0.86); c.stroke(); }
        break;
      }
      case "sweater": {
        c.strokeStyle = "rgba(0,0,0,.05)"; c.lineWidth = 2;
        for (let x = 4; x < w; x += 14) { c.beginPath(); for (let y = 0; y < h * 0.72; y += 6) c.lineTo(x + ((y / 6) % 2 ? 1.5 : -1.5), y); c.stroke(); }   // faint knit
        c.fillStyle = "rgba(0,0,0,.08)"; c.fillRect(0, h * 0.72, w, h * 0.14);   // ribbed hem band
        c.strokeStyle = "rgba(40,40,50,.55)"; c.lineWidth = 2;
        for (let x = 0; x < w; x += 9) { c.beginPath(); c.moveTo(x, h * 0.73); c.lineTo(x, h * 0.85); c.stroke(); }
        c.fillStyle = "rgba(40,40,50,.6)"; c.fillRect(0, h * 0.72, w, 3);
        break;
      }
      default: {   // t-shirt
        c.fillStyle = "rgba(0,0,0,.12)"; c.beginPath(); c.ellipse(fx, 0, w * 0.075, h * 0.12, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = skin; c.beginPath(); c.ellipse(fx, 0, w * 0.06, h * 0.09, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(0,0,0,.08)"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx - 30, h * 0.5); c.quadraticCurveTo(fx, h * 0.56, fx + 30, h * 0.5); c.stroke();
      }
    }
    if (top.text && top.type !== "jersey") { c.font = `900 ${h * 0.11}px Arial Black, Arial`; c.textAlign = "center"; c.fillStyle = col2; c.fillText(top.text, fx, h * 0.5); }
    if (top.paint) top.paint(c, w, h, fx, bx);
    shade(h * 0.45, h * 0.86, 0.14);
    // waistband of the trousers/shorts
    c.fillStyle = (bot && bot.color) || "#334"; c.fillRect(0, pantsTop, w, h - pantsTop);
    if (top.type === "jersey" || top.tucked === false) { c.fillStyle = col; c.fillRect(0, pantsTop, w, 6); }
    if (bot && bot.type === "jeans") { c.strokeStyle = "rgba(255,255,255,.35)"; c.setLineDash([4, 4]); c.lineWidth = 2; c.beginPath(); c.moveTo(0, pantsTop + 6); c.lineTo(w, pantsTop + 6); c.stroke(); c.setLineDash([]); }
  }

  function addTie(model, top, torsoLen, chestR, zs, s) {
    if (!top.tie) return;
    const tie = K.extrude([[-1.6, 0], [1.6, 0], [2.6, -torsoLen * 0.52], [0, -torsoLen * 0.62], [-2.6, -torsoLen * 0.52]].map(([x, y]) => [x * s, y]), 1.2 * s, K.mat(top.tie, { roughness: 0.45 }), { ol: 0.5 });
    const g = K.group({ parent: model.torso, p: [chestR * 0.98, torsoLen * 1.0, 0], r: [0, Math.PI / 2, 0] });
    g.add(tie); tie.rotation.x = -0.18;
    K.sphere(2.2 * s, tie.material, { parent: g, p: [0, -0.6 * s, 0.3 * s], s: [1, 0.8, 0.6], ol: 0.4 });
  }
  function addLapels(model, top, torsoLen, chestR, zs, s) {
    const mat = K.mat(S.shade(top.color || "#222", -0.06), { roughness: 0.7 });
    [-1, 1].forEach((side) => {
      const lap = K.extrude([[0, 0], [side * 6 * s, 0], [side * 2 * s, -torsoLen * 0.55], [side * 0.6 * s, -torsoLen * 0.55]], 0.8 * s, mat, { ol: 0.4 });
      const g = K.group({ parent: model.torso, p: [chestR * 0.96, torsoLen * 1.02, side * 2.6 * s], r: [0, Math.PI / 2, 0] });
      g.add(lap); lap.rotation.x = -0.25;
    });
  }

  function buildHand(g, mat, s, style) {
    if (style === "cartoon") {   // flat palm, four chunky fingers and a thumb (open hand, slightly curled)
      K.sphere(3.0 * s, mat, { parent: g, p: [0, -2.4 * s, 0], s: [0.75, 1.15, 1.05], ol: 0.6 });
      for (let i = 0; i < 4; i++) {
        const fg = K.group({ parent: g, p: [0.4 * s, -4.4 * s, (-1.9 + i * 1.25) * s], r: [(i - 1.5) * 0.12, 0, 0.35] });
        K.capsule(0.75 * s, 2.6 * s, mat, { parent: fg, p: [0, -1.5 * s, 0], ol: 0.5 });
      }
      K.capsule(0.8 * s, 2.0 * s, mat, { parent: g, p: [1.2 * s, -2.2 * s, 2.6 * s], r: [0.9, 0, -0.4], ol: 0.5 });
      return;
    }
    // fist: palm + knuckle row + thumb (reads as a hand even at 40px)
    K.sphere(3.0 * s, mat, { parent: g, p: [0, -2.2 * s, 0], s: [1.05, 1.15, 0.85], ol: 0.6 });
    for (let i = 0; i < 4; i++) K.sphere(1.05 * s, mat, { parent: g, p: [1.7 * s, -3.6 * s + i * 0.1 * s, (-1.6 + i * 1.05) * s], ol: 0 });
    K.capsule(0.95 * s, 2.2 * s, mat, { parent: g, p: [1.2 * s, -1.6 * s, 2.3 * s], r: [0.5, 0, -0.5], ol: 0 });
  }

  function buildShoe(ankle, sh, M, s) {
    const foot = K.group({ parent: ankle });
    const up = K.sphere(4.3 * s, M.shoe, { parent: foot, p: [2.6 * s, -0.6 * s, 0], s: [1.75, 0.92, 1.02], ol: 0.7 });
    K.sphere(4.4 * s, M.sole, { parent: foot, p: [2.6 * s, -2.4 * s, 0], s: [1.82, 0.36, 1.08], ol: 0.5 });
    if (sh.accent) K.sphere(4.36 * s, K.mat(sh.accent, { roughness: 0.5 }), { parent: foot, p: [2.4 * s, -0.9 * s, 0], s: [1.2, 0.5, 1.04], phiL: Math.PI * 2, th0: Math.PI * 0.45, thL: Math.PI * 0.12, ol: 0 });
    if (sh.laces !== false && sh.type !== "dress") for (let i = 0; i < 3; i++) K.box(0.6 * s, 0.5 * s, 3.4 * s, K.mat(sh.laces || "#ffffff"), { parent: foot, p: [(3.2 + i * 1.6) * s, 2.6 * s - i * 0.5 * s, 0], ol: 0 });
    if (sh.type === "dress") up.material.roughness = 0.25;
    return foot;
  }

  // Generic human head: skull, jaw, ears, nose, eyes (iris/pupil/glint + lids), brows, mouth, hair, beard, glasses.
  function buildHead(model, g, r, hd, skin, s) {
    const skinM = model.M.skin;
    const skull = K.sphere(r, skinM, { parent: g, s: [hd.sx || 0.98, hd.sy || 1.04, hd.sz || 0.94], ol: 0.9 });
    model.skull = skull;
    // jaw / chin
    const jaw = hd.jaw != null ? hd.jaw : 0.5;
    K.sphere(r * 0.72, skinM, { parent: g, p: [r * 0.28, -r * 0.42, 0], s: [1.0, 0.72 + jaw * 0.12, 0.92 + jaw * 0.1], ol: 0.7 });
    if (hd.chin) K.sphere(r * 0.24, skinM, { parent: g, p: [r * 0.78, -r * 0.62, 0], ol: 0 });
    // ears
    const er = (hd.ears && hd.ears.r) || r * 0.24;
    [-1, 1].forEach((z) => {
      const ear = K.sphere(er, hd.ears && hd.ears.color ? K.mat(hd.ears.color) : skinM, { parent: g, p: [-r * 0.08, -r * 0.05, z * r * 0.9], s: [0.7, 1.15, 0.38], ol: 0.5 });
      K.sphere(er * 0.55, K.mat(S.shade(skin, -0.12)), { parent: ear, p: [0.1, 0, z * er * 0.45], s: [0.8, 1, 0.5], ol: 0 });
    });
    // nose
    const n = Object.assign({ len: 0.42, r: 0.17, type: "round" }, hd.nose || {});
    if (n.type !== "none") {
      const nm = K.mat(S.shade(skin, -0.02), { roughness: 0.5 });
      if (n.type === "pointy") K.cone(r * n.r, r * n.len, nm, { parent: g, p: [r * 0.98, -r * 0.08, 0], r: [0, 0, -Math.PI / 2 - 0.35], ol: 0.5 });
      else {
        K.capsule(r * n.r * 0.8, r * n.len * 0.6, nm, { parent: g, p: [r * 0.9, -r * 0.02, 0], r: [0, 0, -0.5], ol: 0.5 });
        K.sphere(r * n.r * (n.type === "broad" ? 1.25 : 1.0), nm, { parent: g, p: [r * 1.02, -r * 0.2, 0], s: [1, 0.85, n.type === "broad" ? 1.35 : 1.1], ol: 0.5 });
      }
    }
    K.eyes(model, g, r, hd.eyes || {}, skinM);
    K.brows(model, g, r, hd.brows || {});
    // mouth
    const m = Object.assign({ w: 0.4, smile: 0.25, color: "#6a2420" }, hd.mouth || {});
    const mouth = K.torus(r * m.w * 0.5, r * 0.055, K.mat(m.color, { roughness: 0.6 }), { parent: g, p: [r * 0.97, -r * 0.4, 0], r: [0, Math.PI / 2, 0], arc: Math.PI * (0.35 + m.smile * 0.5), ol: 0 });
    mouth.rotation.z = -Math.PI / 2 - Math.PI * (0.35 + m.smile * 0.5) / 2;
    model.mouth = mouth;
    if (hd.cheeks) [-1, 1].forEach((z) => K.sphere(r * 0.13, K.mat(hd.cheeks, { transparent: true, opacity: 0.45 }), { parent: g, p: [r * 0.7, -r * 0.18, z * r * 0.48], s: [0.4, 0.7, 1], ol: 0 }));
    if (hd.hair) buildHair(model, g, r, hd.hair, s);
    if (hd.beard) buildBeard(model, g, r, hd.beard, s);
    if (hd.glasses) buildGlasses(g, r, hd.glasses, s);
    if (hd.headband) {
      const hb = K.torus(r * 0.98, r * 0.12, K.mat(hd.headband.color || "#fff", { roughness: 0.9 }), { parent: g, p: [-r * 0.06, r * 0.42, 0], r: [Math.PI / 2, 0.12, 0], s: [1, 0.96, 1.6], ol: 0.5 });
      if (hd.headband.color2) K.torus(r * 1.0, r * 0.04, K.mat(hd.headband.color2), { parent: hb, p: [0, 0, 0], ol: 0 });
    }
  }

  // Eyes on the skull surface (the head faces +X): white, iris, pupil, glint, and a skin lid that blinks.
  //   e = { r, iris, gap (azimuth from the nose line), y (elevation), lids (0 open .. 1 shut), out (surface radius ×) }
  K.eyes = function (model, g, r, eo, lidMat) {
    const e = Object.assign({ r: 0.2, iris: "#4a3020", gap: 0.38, y: 0.1, lids: 0.12, out: 0.9 }, eo);
    model.eyes = model.eyes || [];
    [-1, 1].forEach((side) => {
      const az = side * e.gap, el = e.y;
      const ex = Math.cos(el) * Math.cos(az) * r * e.out, ey = Math.sin(el) * r * e.out, ez = Math.cos(el) * Math.sin(az) * r * e.out;
      const eg = K.group({ parent: g, p: [ex, ey, ez], r: [0, -az, 0] });
      K.sphere(r * e.r, K.mat("#fbfbf7", { roughness: 0.25 }), { parent: eg, s: [0.9, 1, 1], ol: 0.4 });
      const iris = K.mesh(new T.CircleGeometry(r * e.r * 0.66, 20), K.mat(e.iris, { roughness: 0.3 }), { parent: eg, p: [r * e.r * 0.91, 0, 0], r: [0, Math.PI / 2, 0], ol: 0 });
      K.mesh(new T.CircleGeometry(r * e.r * 0.3, 16), K.basic("#0b0b0b"), { parent: iris, p: [0, 0, 0.05], ol: 0 });
      K.mesh(new T.CircleGeometry(r * e.r * 0.13, 10), K.basic("#ffffff"), { parent: iris, p: [r * e.r * 0.18, r * e.r * 0.22, 0.1], ol: 0 });
      const lid = K.group({ parent: eg });
      K.sphere(r * e.r * 1.12, lidMat, { parent: lid, thL: Math.PI * 0.5, ol: 0 });
      model.eyes.push({ g: eg, lid, base: e.lids });
    });
  };
  // Brows: short capsules lying along the face above each eye. b = { color, thick, len, tilt (+ = angry), y, gap }
  K.brows = function (model, g, r, bo) {
    const b = Object.assign({ color: "#3a2a1a", thick: 0.08, len: 0.3, tilt: 0.12, y: 0.4, gap: 0.38 }, bo);
    model.brows = [];
    [-1, 1].forEach((side) => {
      const az = side * b.gap;
      const holder = K.group({ parent: g, p: [Math.cos(az) * r * 0.93, r * b.y, Math.sin(az) * r * 0.93], r: [0, -az, 0] });
      // capsule along Y → lay it along Z (across the face), then tilt the inner end down for a frown
      const br = K.capsule(r * b.thick, r * b.len, K.mat(b.color, { roughness: 0.9 }), { parent: holder, r: [Math.PI / 2 + side * b.tilt, 0, 0], ol: 0 });
      model.brows.push(br);
    });
  };

  // Hair styles: caps cut from slightly larger spheres, plus extras.
  function buildHair(model, g, r, hr, s) {
    const mat = K.mat(hr.color || "#2a1a10", { roughness: 0.92 });
    const st = hr.style || "short";
    const cap = (k, thL, tiltZ, o = {}) => K.sphere(r * k, mat, Object.assign({ parent: g, thL, r: [0, 0, tiltZ], s: [1.0, 1.06, 0.98], ol: 0.7 }, o));
    if (st === "bald") return;
    if (st === "buzz") { cap(1.03, Math.PI * 0.42, 0.35); cap(1.02, Math.PI * 0.55, 0.9); return; }
    if (st === "short" || st === "swept" || st === "curly" || st === "receding" || st === "parted") {
      const front = st === "receding" ? 0.75 : 0.42;
      cap(1.07, Math.PI * 0.46, front);           // top, front edge lifted
      cap(1.06, Math.PI * 0.62, 1.25);            // back of the head down to the nape
      [-1, 1].forEach((z) => K.sphere(r * 0.42, mat, { parent: g, p: [-r * 0.12, r * 0.18, z * r * 0.8], s: [0.95, 0.85, 0.42], ol: 0.5 }));   // sides above the ears
      if (st === "swept") K.sphere(r * 0.62, mat, { parent: g, p: [r * 0.42, r * 0.78, r * 0.1], s: [1.25, 0.55, 1.15], r: [0, 0, -0.35], ol: 0.6 });
      if (st === "parted") K.sphere(r * 0.6, mat, { parent: g, p: [r * 0.38, r * 0.74, -r * 0.18], s: [1.2, 0.5, 1.1], r: [0.2, 0, -0.3], ol: 0.6 });
      if (st === "curly") {
        for (let i = 0; i < 26; i++) {
          const th = 0.15 + (i % 13) / 13 * 1.5, ph = (i < 13 ? 0.6 : -0.6) + Math.sin(i * 1.7) * 0.5;
          const dir = new T.Vector3(Math.cos(ph) * Math.sin(th) * 0.4 - 0.1 * (i % 3), Math.cos(th), Math.sin(ph) * Math.sin(th)).normalize();
          K.sphere(r * 0.2, mat, { parent: g, p: [dir.x * r * 1.03, dir.y * r * 1.06, dir.z * r * 1.0], ol: 0 });
        }
      }
      return;
    }
    if (st === "flattop") {
      K.cyl(r * 0.84, r * 0.92, r * 0.42, mat, { parent: g, p: [-r * 0.04, r * 0.82, 0], s: [1, 1, 0.95], ol: 0.7 });
      cap(1.05, Math.PI * 0.58, 1.2);
      [-1, 1].forEach((z) => K.sphere(r * 0.4, mat, { parent: g, p: [-r * 0.1, r * 0.25, z * r * 0.8], s: [0.95, 0.9, 0.38], ol: 0.4 }));
      return;
    }
    if (st === "custom" && hr.build) hr.build(T, K, g, r, mat, model);
  }

  function buildBeard(model, g, r, bd, s) {
    const st = bd.style || "trim";
    const mat = K.mat(bd.color || "#2a1a10", { roughness: 0.95, transparent: st === "stubble", opacity: st === "stubble" ? 0.22 : 1, depthWrite: st !== "stubble" });
    // lower-face shell
    K.sphere(r * 0.79, mat, { parent: g, p: [r * 0.28, -r * 0.4, 0], s: [1.04, 0.8, 0.96], th0: Math.PI * 0.42, thL: Math.PI * 0.58, ol: st === "stubble" ? 0 : 0.6 });
    if (st !== "stubble") {
      K.capsule(r * 0.07, r * 0.3, mat, { parent: g, p: [r * 1.02, -r * 0.3, 0], r: [Math.PI / 2, 0, 0], ol: 0 });   // moustache
      if (st === "full") K.sphere(r * 0.5, mat, { parent: g, p: [r * 0.62, -r * 0.82, 0], s: [1, 0.8, 1.2], ol: 0.6 });
    }
  }

  function buildGlasses(g, r, gl, s) {
    const mat = K.mat(gl.color || "#1a1a1a", { roughness: 0.3, metalness: 0.3 });
    const lens = gl.lens ? K.mat(gl.lens, { transparent: true, opacity: 0.35, roughness: 0.05 }) : null;
    const rr = r * (gl.size || 0.22);
    [-1, 1].forEach((side) => {
      const az = side * 0.36;
      const gx = Math.cos(az) * r * 1.02, gz = Math.sin(az) * r * 1.02;
      const ring = K.torus(rr, r * 0.035, mat, { parent: g, p: [gx, r * 0.08, gz], r: [0, Math.PI / 2 - az, 0], s: gl.style === "rect" ? [1.25, 0.82, 1] : [1, 1, 1], ol: 0 });
      if (lens) K.mesh(new T.CircleGeometry(rr, 18), lens, { parent: ring, ol: 0 });
      K.capsule(r * 0.025, r * 0.75, mat, { parent: g, p: [r * 0.38, r * 0.1, side * r * 0.92], r: [0, 0, Math.PI / 2], ol: 0 });   // temple arm
    });
    K.capsule(r * 0.03, r * 0.16, mat, { parent: g, p: [r * 1.05, r * 0.12, 0], r: [Math.PI / 2, 0, 0], ol: 0 });   // bridge
  }

  // ------------------------------------------------------------ posing
  const YAW_R = -0.72, YAW_L = Math.PI + 0.72;   // ¾ view toward the camera
  // amt: how far the model turns toward the camera from pure profile (models can set model.yawAmt)
  K.yawFor = (facing, amt) => (amt == null ? (facing >= 0 ? YAW_R : YAW_L) : facing >= 0 ? -amt : Math.PI + amt);

  // Drive a K.humanoid from S.pose (same angle conventions as the 2D rig). opts.snap: no smoothing.
  K.poseHumanoid = function (model, f, P, g, opts = {}) {
    const h = model.h, s = model.s;
    // facing: turn smoothly through the camera-facing side
    const target = K.yawFor(f.facing, model.yawAmt);
    if (model.yawVal == null || opts.snap) model.yawVal = target;
    else model.yawVal += (target - model.yawVal) * 0.35;
    model.yaw.rotation.y = model.yawVal;
    model.body.rotation.z = -(P.rot || 0);
    const crouchDrop = (P.crouch || 0) * h * 0.18;
    let legF = P.legF, legB = P.legB;
    if (P.crouch) { legF = [legF[0] + P.crouch * 0.6, legF[1] - P.crouch * 1.2]; legB = [legB[0] - P.crouch * 0.2, legB[1] - P.crouch * 1.0]; }
    model.hips.position.set((P.lean || 0) * 3, h * 0.43 - (P.bob || 0) - crouchDrop, 0);
    const tilt = Math.atan2((P.lean || 0) * 6, h * 0.3);
    model.torso.rotation.z = -tilt;
    model.neck.rotation.z = tilt * 0.6;
    setLimb(model.armF, P.armF, tilt);
    setLimb(model.armB, P.armB, tilt);
    setLeg(model.legF, legF, f);
    setLeg(model.legB, legB, f);
    // blink + expressions
    if (model.eyes) {
      const t = (g ? g.frame : 0) + f.port * 37;
      const blink = t % 190 > 183 ? 1 : 0;
      const hurt = f.state === "hitstun" || f.state === "tumble" || f.state === "dizzy";
      for (const e of model.eyes) {
        const closed = hurt ? 0.65 : Math.max(e.base, blink);
        e.lid.rotation.z = Math.PI / 2 - closed * Math.PI;   // cap behind the eye = open, in front = shut
      }
    }
    applyFlash(model, f, g);
  };
  function setLimb(A, ang, tilt) {
    if (!A) return;
    A.sh.rotation.z = ang[0] + tilt;
    A.el.rotation.z = ang[1];
    A.hand.rotation.z = 0;
  }
  function setLeg(L, ang, f) {
    if (!L) return;
    L.hip.rotation.z = ang[0];
    L.knee.rotation.z = ang[1];
    // keep the sole roughly level on the ground, toes down in the air
    const abs = ang[0] + ang[1];
    L.ankle.rotation.z = f.grounded ? -abs : -abs * 0.4 - 0.25;
  }
  // Invulnerability flicker, intangible dodges, armor glow.
  function applyFlash(model, f, g) {
    const fl = f.invuln > 0 && ((g ? g.frame : 0) >> 2) % 2 === 0;
    const dodge = (f.state === "spotdodge" || f.state === "roll" || f.state === "airdodge") && f.invuln > 0;
    const key = (fl ? 1 : 0) + (dodge ? 2 : 0) + (f.armor ? 4 : 0);
    if (model._flashKey === key) return;
    model._flashKey = key;
    for (const m of model.mats || []) {
      if (!m.emissive) continue;
      if (m.userData.baseEmissive == null) m.userData.baseEmissive = m.emissive.getHex();
      m.emissive.setHex(fl ? 0x555555 : f.armor ? 0x553300 : m.userData.baseEmissive);
      m.transparent = dodge || m.userData.wasTransparent || false;
      if (m.userData.baseOpacity == null) { m.userData.baseOpacity = m.opacity; m.userData.wasTransparent = m.transparent && !dodge; }
      m.opacity = dodge ? 0.5 * m.userData.baseOpacity : m.userData.baseOpacity;
    }
  }
  K.applyFlash = applyFlash;

  // ------------------------------------------------------------ instances
  function build(def) {
    const model = def.model.build(T, K);
    if (!model.mats) collectMats(model);
    // rest-pose height (ears, hair, hats) so portraits never clip the top of the head
    try { const bb = new T.Box3().setFromObject(model.root); model.topY = bb.max.y; } catch (e) { /* ignore */ }
    return model;
  }
  function getInstance(holder, def) {
    if (holder._m3 && holder._m3def === def) return holder._m3;
    try { holder._m3 = build(def); holder._m3def = def; }
    catch (e) { console.error("3D model failed for", def.id, e); def._model3dBroken = true; holder._m3 = null; }
    return holder._m3;
  }
  function poseInstance(model, f, g, opts) {
    const def = f.def;
    const P = S.pose(f, g);
    if (def.posePatch) def.posePatch(f, P, g);
    if (def.model.update) def.model.update(model, f, g, P, opts || {});
    else K.poseHumanoid(model, f, P, g, opts);
    return P;
  }

  // ------------------------------------------------------------ world rendering
  // Called from the match renderer (in WORLD coordinates on the 2D context): renders every 3D fighter and projectile
  // into the WebGL canvas with a camera matching the 2D view, then composites it in screen space.
  S3.renderWorld = function (c, g, cam, W, H, dpr, shake) {
    const used = new Set();
    applyStageLight(worldLights, g.stageDef);
    for (const f of g.fighters) {
      if (!S3.has(f.def)) continue;
      const m = getInstance(f, f.def);
      if (!m) continue;
      if (m.root.parent !== worldScene) worldScene.add(m.root);
      used.add(m.root);
      const vis = !f.out && f.state !== "dead";
      m.root.visible = vis;
      if (!vis) continue;
      let ox = 0;
      if (f.hitlag > 0 && f.state === "hitstun") ox = f.hitlag % 2 ? 2 : -2;
      try { poseInstance(m, f, g); }
      catch (e) { console.error(e); f.def._model3dBroken = true; m.root.visible = false; }
      m.root.position.set(f.x + ox, -f.y, f.port * 4);   // tiny z offset so overlapping fighters sort stably
    }
    for (const p of g.projectiles) {
      if (!p.model3d || !S3.active) continue;
      if (!p._obj) { try { p._obj = p.model3d(T, K, p); } catch (e) { console.error(e); p.model3d = null; continue; } }
      if (p._obj.parent !== worldScene) worldScene.add(p._obj);
      used.add(p._obj);
      p._obj.position.set(p.x, -p.y, 40);
      if (p.update3d) { try { p.update3d(p._obj, p, g); } catch (e) { console.error(e); } }
    }
    // drop objects of fighters/projectiles that are gone
    for (const o of worldScene.children.slice()) if (!o.isLight && !used.has(o)) worldScene.remove(o);
    const vw = W / cam.zoom, vh = H / cam.zoom;
    const sx = shake ? shake[0] / cam.zoom : 0, sy = shake ? shake[1] / cam.zoom : 0;
    worldCam.left = -vw / 2 - sx; worldCam.right = vw / 2 - sx; worldCam.top = vh / 2 + sy; worldCam.bottom = -vh / 2 + sy;
    worldCam.position.set(cam.x, -cam.y, 2000); worldCam.lookAt(cam.x, -cam.y, 0);
    worldCam.updateProjectionMatrix();
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (worldR.domElement.width !== pw || worldR.domElement.height !== ph) { worldR.setPixelRatio(1); worldR.setSize(pw, ph, false); }
    worldR.render(worldScene, worldCam);
    c.save(); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.drawImage(worldR.domElement, 0, 0, W, H); c.restore();
  };

  // ------------------------------------------------------------ portraits (menus, HUD, off-screen bubbles)
  // Draws fighter f's body at the CURRENT 2D transform (origin = feet, the caller may have mirrored x by facing),
  // exactly where def.draw would have drawn it. Returns false if 3D isn't available for this fighter.
  const portraitHolders = {};
  S3.drawBody = function (c, f, g, key) {
    if (!S3.has(f.def)) return false;
    const holder = portraitHolders[key || f.def.id] || (portraitHolders[key || f.def.id] = {});
    const m = getInstance(holder, f.def);
    if (!m) return false;
    const tf = c.getTransform();
    const mirror = tf.a < 0 ? -1 : 1;
    const scale = Math.hypot(tf.a, tf.b);
    // region in fighter-local px
    const Rw = Math.max(f.w * 2.2, f.h * 1.1), top = Math.max(f.h * 1.45, (m.topY || 0) + f.h * 0.12), bot = f.h * 0.22;
    const pxW = Math.min(1024, Math.max(8, Math.round(Rw * 2 * scale))), pxH = Math.min(1024, Math.max(8, Math.round((top + bot) * scale)));
    if (portR.domElement.width < pxW || portR.domElement.height < pxH) portR.setSize(Math.max(pxW, portR.domElement.width), Math.max(pxH, portR.domElement.height), false);
    const cw = portR.domElement.width, ch = portR.domElement.height;
    portScene.add(m.root);
    const realFacing = f.facing;
    f.facing = mirror;   // def.draw space always faces +x; the caller's mirror is the on-screen facing
    try { poseInstance(m, f, g, { snap: true }); } catch (e) { console.error(e); f.facing = realFacing; portScene.remove(m.root); f.def._model3dBroken = true; return false; }
    f.facing = realFacing;
    m.root.visible = true;
    m.root.position.set(0, 0, 0);
    // the canvas may be larger than needed: map the region into its top-left corner
    const ppx = pxW / (Rw * 2);
    portCam.left = -Rw; portCam.right = -Rw + cw / ppx; portCam.top = top; portCam.bottom = top - ch / ppx;
    portCam.position.set(0, 0, 2000); portCam.lookAt(0, 0, 0); portCam.updateProjectionMatrix();
    applyStageLight(portLights, null);
    portR.render(portScene, portCam);
    portScene.remove(m.root);
    c.save();
    c.scale(mirror, 1);   // undo the caller's mirror: the model was turned instead, so text and faces stay right-way-round
    c.drawImage(portR.domElement, 0, 0, pxW, pxH, -Rw, -top, Rw * 2, top + bot);
    c.restore();
    return true;
  };

  // How tall the fighter LOOKS (3D ears/hair can rise above the hurtbox height), for sizing portraits.
  S.visualHeight = function (f) {
    if (!f) return 70;
    if (!S3.has(f.def)) return f.h;
    const holder = portraitHolders[f.def.id] || (portraitHolders[f.def.id] = {});
    const m = getInstance(holder, f.def);
    return Math.max(f.h, (m && m.topY) || 0);
  };

  // Shared entry point for anything that wants a fighter's body (3D if possible, else 2D def.draw).
  S.drawFighterBody = function (c, f, g, key) {
    if (S3.drawBody(c, f, g, key)) { if (f.def.drawFx) { try { f.def.drawFx(c, f, g); } catch (e) { /* cosmetic */ } } return; }
    (f.def.draw || S.drawDummy)(c, f, g);
  };
})();
