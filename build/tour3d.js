/* The Flythrough's 3D layer. three.js r184 is vendored in smash/ and put on window by flythrough.html,
   which then calls LOCTour.enable3d(); that calls create() here. Three stages, each a Group built near
   the origin: SPACE (every place the data knows, the same cosmos for every route), one building's OUTSIDE,
   and one building's HALLWAYS. tour.js owns the scroll, the captions and the camera pose; this file only
   turns a pose into a picture. There are no people in it: it is a camera. Positions are invented. */
(function () {
  window.LOCTour3D = { create: create };

  function create(THREE, Tour) {
    var T = Tour.data, PL = T.places;
    var canvas = document.createElement('canvas');
    canvas.className = 'tour-canvas'; canvas.setAttribute('aria-hidden', 'true'); canvas.setAttribute('role', 'presentation');
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'low-power', alpha: false });
    } catch (e) { return null; }
    renderer.shadowMap.enabled = false;
    document.body.insertBefore(canvas, document.body.firstChild);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(50, 1, .5, 60000);
    var hemi = new THREE.HemisphereLight(0x8899cc, 0x15151a, .8); scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(1, .55, .4); scene.add(sun);
    var lamp = new THREE.PointLight(0xffe4bd, 0, 34, 2); scene.add(lamp);
    var G = { space: new THREE.Group(), ext: new THREE.Group(), int: new THREE.Group() };
    scene.add(G.space); scene.add(G.ext); scene.add(G.int);
    var SKY = new THREE.Color(0x07080c), FOG_EXT = new THREE.FogExp2(0x0b0e16, .0048), FOG_INT = new THREE.Fog(0x050506, 6, 48);
    var lane = new THREE.Color(0x8a8a8a);

    // ---- shared geometry (scaled per mesh) and small helpers
    var SPHERE = new THREE.SphereGeometry(1, 28, 18), BOX = new THREE.BoxGeometry(1, 1, 1), PLANE = new THREE.PlaneGeometry(1, 1);
    function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
    function rng(seed) { var x = fnv(seed) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
    function tint(slug, l) { var c = new THREE.Color(); c.setHSL((fnv(slug) % 360) / 360, .22, l || .3); return c; }
    function canvasTex(w, h, draw) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 1;
      return t;
    }
    var loader = new THREE.TextureLoader(), texCache = new Map();
    function texture(url) {   // the article thumbnails, kept in a least-recently-used cache
      if (!url) return null;
      var t = texCache.get(url);
      if (t) { texCache.delete(url); texCache.set(url, t); return t; }
      t = loader.load(url, function () { Tour.invalidate(); });
      t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.anisotropy = 1;
      t.userData.cached = true;
      texCache.set(url, t);
      while (texCache.size > 48) { var k = texCache.keys().next().value, old = texCache.get(k); texCache.delete(k); old.userData.cached = false; old.dispose(); }
      return t;
    }
    var haloTex = canvasTex(64, 64, function (g, w, h) {
      var r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.35, 'rgba(255,255,255,.25)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
    var gridTex = canvasTex(256, 256, function (g, w, h) {
      g.fillStyle = '#2a2d35'; g.fillRect(0, 0, w, h); g.strokeStyle = '#3b3f4a'; g.lineWidth = 2;
      for (var i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    });
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping; gridTex.repeat.set(40, 40);
    haloTex.userData.shared = gridTex.userData.shared = true;
    function textTex(text, w, h, size, color, bg) {
      return canvasTex(w, h, function (g) {
        if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
        g.fillStyle = color; g.font = 'bold ' + size + 'px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        var t = text, m = g.measureText(t);
        while (m.width > w - 20 && t.length > 4) { t = t.slice(0, -2) + '…'; m = g.measureText(t); }
        g.fillText(t, w / 2, h / 2);
      });
    }
    function dispose(group) {   // a building that fell out of the cache: free its materials, and the textures only it drew
      group.traverse(function (o) {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (m) {
          if (m.userData.shared) return;
          ['map', 'emissiveMap'].forEach(function (k) { var t = m[k]; if (t && !t.userData.shared && !t.userData.cached) t.dispose(); });
          m.dispose();
        });
        if (o.geometry && o.geometry !== SPHERE && o.geometry !== BOX && o.geometry !== PLANE) o.geometry.dispose();
      });
    }
    function box(mat, w, h, d, x, y, z) { var m = new THREE.Mesh(BOX, mat); m.scale.set(w, h, d); m.position.set(x, y, z); return m; }

    // ---- SPACE: built once. Planets and regions wear their article's picture; the bigger things are faint shells.
    var stars, routeLine = null, markers = [];
    (function buildSpace() {
      var n = 1800, arr = new Float32Array(n * 3), R = rng('stars');
      for (var i = 0; i < n; i++) {
        var u = R() * 2 - 1, a = R() * Math.PI * 2, s = Math.sqrt(1 - u * u), d = 1800 + R() * 600;
        arr[i * 3] = s * Math.cos(a) * d; arr[i * 3 + 1] = u * d; arr[i * 3 + 2] = s * Math.sin(a) * d;
      }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfd6ff, size: 1.6, sizeAttenuation: false, depthWrite: false }));
      scene.add(stars);
      var shell = { universe: 0x6a7cff, galaxy: 0xffd27a, sector: 0x8fe3ff, system: 0xffb0a0 };
      Object.keys(PL).forEach(function (s) {
        var p = PL[s];
        if (p.k === 'poi') return;
        var mesh;
        if (p.k === 'planet' || p.k === 'region') {
          mesh = new THREE.Mesh(SPHERE, new THREE.MeshStandardMaterial({ map: texture(p.img), color: p.k === 'region' ? 0xb8bcc8 : 0xffffff, roughness: .92, metalness: 0 }));
        } else {
          mesh = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ color: shell[p.k] || 0x8899cc, transparent: true, opacity: p.k === 'universe' ? .035 : .07, side: THREE.DoubleSide, depthWrite: false }));
          // the stars inside it, so flying into a galaxy or a system is flying into a cluster, not into fog
          var cn = p.k === 'universe' ? 900 : 420, cr = rng('cloud:' + s), ca = new Float32Array(cn * 3);
          for (var j = 0; j < cn; j++) {
            var cu = cr() * 2 - 1, cang = cr() * Math.PI * 2, cs = Math.sqrt(1 - cu * cu), cd = p.r * Math.pow(cr(), .45);
            ca[j * 3] = p.x + cs * Math.cos(cang) * cd; ca[j * 3 + 1] = p.y + cu * cd * .55; ca[j * 3 + 2] = p.z + cs * Math.sin(cang) * cd;
          }
          var cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(ca, 3));
          G.space.add(new THREE.Points(cg, new THREE.PointsMaterial({ color: shell[p.k] || 0x8899cc, size: 2.2, sizeAttenuation: false, transparent: true, opacity: .85, depthWrite: false })));
          var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: shell[p.k] || 0x8899cc, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending }));
          halo.scale.setScalar(p.r * 2.4); halo.position.set(p.x, p.y, p.z); G.space.add(halo);
        }
        mesh.scale.setScalar(p.r); mesh.position.set(p.x, p.y, p.z); mesh.rotation.y = (fnv(s) % 628) / 100;
        G.space.add(mesh);
      });
    })();

    // ---- OUTSIDE a building: the building at the origin, its front towards +z, wearing its article's picture.
    var skydome = new THREE.Mesh(SPHERE, new THREE.MeshBasicMaterial({ side: THREE.BackSide, map: canvasTex(4, 128, function (g, w, h) {
      var r = g.createLinearGradient(0, 0, 0, h); r.addColorStop(0, '#1a2140'); r.addColorStop(.55, '#0b0e18'); r.addColorStop(1, '#05060a');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }), fog: false }));
    skydome.scale.setScalar(1500); skydome.material.userData.shared = true; skydome.material.map.userData.shared = true; G.ext.add(skydome);
    var laneMat = new THREE.MeshStandardMaterial({ color: 0x222228, emissive: lane, emissiveIntensity: 1.6, roughness: .6 }); laneMat.userData.shared = true;

    function buildExt(b) {
      var g = new THREE.Group(), p = PL[b];
      if (b === 'inav') return buildInav(g);
      var R = rng('ext:' + b), wallMat = new THREE.MeshStandardMaterial({ color: tint(b, .32), roughness: .88 });
      var ground = new THREE.Mesh(PLANE, new THREE.MeshStandardMaterial({ map: gridTex, color: 0x5a5e6a, roughness: 1 }));
      ground.scale.set(600, 600, 1); ground.rotation.x = -Math.PI / 2; g.add(ground);
      g.add(box(wallMat, 14, 8, 10, 0, 4, 0));                                                               // the building
      var pic = new THREE.Mesh(PLANE, new THREE.MeshStandardMaterial({ map: texture(p.img), color: 0xffffff, roughness: .8, emissive: 0x303030 }));
      pic.scale.set(5.6, 5.6, 1); pic.position.set(3.6, 4.6, 5.02); g.add(pic);                              // its picture, square, beside the door
      g.add(box(new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: .6 }), 5.9, 5.9, .08, 3.6, 4.6, 5.0));
      g.add(box(new THREE.MeshStandardMaterial({ color: 0x0f1014, roughness: .5 }), 2.4, 3.4, .3, -2.2, 1.7, 5.1));  // the door
      g.add(box(laneMat, 3.4, .22, .3, -2.2, 3.7, 5.15));                                                           // a lit lintel in the group's colour
      var sign = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: textTex(p.t, 512, 96, 44, '#f2f2f2', 'rgba(10,10,14,.85)'), transparent: true }));
      sign.scale.set(11, 2.1, 1); sign.position.set(0, 9.4, 5.02); g.add(sign);
      for (var k = 0; k < 7; k++) {   // neighbours, so the place has a skyline
        var a = k / 7 * Math.PI * 2 + R() * .7, r = 26 + R() * 22, w = 4 + R() * 9, h = 2 + R() * 11, d = 4 + R() * 9;
        g.add(box(new THREE.MeshStandardMaterial({ color: tint(b + k, .18 + R() * .12), roughness: .95 }), w, h, d, Math.sin(a) * r, h / 2, Math.cos(a) * r));
      }
      g.add(box(new THREE.MeshStandardMaterial({ color: 0x33363f, roughness: 1 }), 3, .05, 30, 0, .02, 20));  // the path to the door
      return g;
    }
    // The iNav: a white orb; a long thin window across the upper front; a door flush with the body, shown only by its
    // seam; and a light grey Apple mark on the far side. It hangs in space, so no ground and no sky.
    function buildInav(g) {
      var R = 7, C = [0, 7, 0];
      var hull = new THREE.Mesh(SPHERE, new THREE.MeshStandardMaterial({ color: 0xf5f5f7, roughness: .34, metalness: .06 }));
      hull.scale.setScalar(R); hull.position.set(C[0], C[1], C[2]); g.add(hull);
      var glass = new THREE.MeshStandardMaterial({ color: 0x0b1720, emissive: 0x2a4a60, emissiveIntensity: .7, roughness: .25, metalness: .5 });
      function onHull(lat, az, mesh, lift) {   // put a mesh on the hull's surface, facing out
        var r = R + (lift || 0), y = Math.sin(lat) * r, h = Math.cos(lat) * r;
        mesh.position.set(Math.sin(az) * h + C[0], y + C[1], Math.cos(az) * h + C[2]);
        mesh.lookAt(C[0], C[1], C[2]); mesh.rotateY(Math.PI);
        g.add(mesh);
      }
      var lat = .40;                                                                     // the window: a band across the upper front
      for (var i = -5; i <= 5; i++) onHull(lat, i * .165, box(glass, .95, .55, .22, 0, 0, 0), .02);
      var seam = new THREE.MeshStandardMaterial({ color: 0xa8a8ae, roughness: .5 });     // the door: only its seam shows
      for (var j = -2; j <= 2; j++) { onHull(-.05 + j * .085, -.15, box(seam, .05, .62, .04, 0, 0, 0), .01); onHull(-.05 + j * .085, .15, box(seam, .05, .62, .04, 0, 0, 0), .01); }
      onHull(.13, 0, box(seam, 2.1, .05, .04, 0, 0, 0), .01); onHull(-.235, 0, box(seam, 2.1, .05, .04, 0, 0, 0), .01);
      var apple = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ transparent: true, map: canvasTex(256, 256, function (c, w, h) {
        c.fillStyle = '#c9c9ce';
        c.beginPath(); c.ellipse(96, 150, 58, 66, 0, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.ellipse(160, 150, 58, 66, 0, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath(); c.arc(226, 128, 34, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = 'source-over';
        c.beginPath(); c.ellipse(138, 62, 14, 26, -.6, 0, Math.PI * 2); c.fill();
      }) }));
      apple.scale.set(3.4, 3.4, 1); onHull(0, Math.PI, apple, .03);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: lane, transparent: true, opacity: .35, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.scale.setScalar(R * 3.4); glow.position.set(C[0], C[1], C[2]); glow.userData.laneGlow = true; g.add(glow);
      g.userData.inav = true;
      return g;
    }

    // ---- INSIDE a building: the hallway tour.js drew, with the stop's picture hung in each room.
    function buildInt(key) {
      var info = Tour.runInfo(key), g = new THREE.Group();
      if (!info) return g;
      var h = Tour.hallOf(info.b, info.n), inav = info.b === 'inav';
      var wall = new THREE.MeshStandardMaterial({ color: inav ? 0xe9e9ee : tint(info.b, .34), roughness: .92 });
      var floor = new THREE.MeshStandardMaterial({ color: inav ? 0xc9c9cf : tint(info.b + 'f', .14), roughness: .98 });
      var ceil = new THREE.MeshStandardMaterial({ color: inav ? 0xf4f4f7 : tint(info.b + 'c', .22), roughness: 1 });
      var light = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: inav ? 0xdff0ff : 0xffe7c2, emissiveIntensity: 1.8 }); light.userData.shared = false;
      h.segs.forEach(function (s) {
        var cx = (s.a[0] + s.b[0]) / 2, cz = (s.a[2] + s.b[2]) / 2, L = s.len + .3, piv = new THREE.Group();
        piv.position.set(cx, 0, cz); piv.rotation.y = s.dir; g.add(piv);
        piv.add(box(floor, s.w, .12, L, 0, -.06, 0));
        piv.add(box(ceil, s.w, .12, L, 0, s.h + .06, 0));
        piv.add(box(wall, .12, s.h, L, -s.w / 2, s.h / 2, 0));
        piv.add(box(wall, .12, s.h, L, s.w / 2, s.h / 2, 0));
        if (s.room >= 0) {
          var room = info.rooms[s.room] || {};
          piv.add(box(light, 1.8, .06, 1.8, 0, s.h - .02, 0));
          var pic = new THREE.Mesh(PLANE, new THREE.MeshStandardMaterial({ map: texture(room.img), color: 0xffffff, emissive: 0x404040, roughness: .7 }));
          pic.scale.set(3.4, 3.4, 1); pic.position.set(-s.w / 2 + .08, 2.3, 0); pic.rotation.y = Math.PI / 2; piv.add(pic);
          piv.add(box(new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: .6 }), .06, 3.7, 3.7, -s.w / 2 + .04, 2.3, 0));
          var cap = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: textTex(room.title || '', 512, 64, 30, '#f0f0f0', 'rgba(12,12,16,.9)'), transparent: true }));
          cap.scale.set(3.4, .42, 1); cap.position.set(-s.w / 2 + .08, .28, 0); cap.rotation.y = Math.PI / 2; piv.add(cap);
          if (inav) { var win = new THREE.Mesh(PLANE, light); win.scale.set(L * .8, .55, 1); win.position.set(s.w / 2 - .08, 2.3, 0); win.rotation.y = -Math.PI / 2; piv.add(win); }
          else { var lin = box(laneMat, .08, .08, L * .9, s.w / 2 - .1, s.h - .3, 0); piv.add(lin); }
        } else {
          piv.add(box(laneMat, .08, .08, L * .9, -s.w / 2 + .1, s.h - .25, 0));
        }
      });
      // Where a wide room meets a narrow corridor (or the hallway turns), a wall across the wider one with the
      // narrower one's opening cut out, so nothing looks out onto the void. Both ends get a closed wall.
      function bulkhead(x, z, dir, W, H, w, hh) {
        var piv = new THREE.Group(); piv.position.set(x, 0, z); piv.rotation.y = dir; g.add(piv);
        var side = (W - w) / 2 + .3;
        piv.add(box(wall, side, H, .14, -(w / 2 + side / 2 - .15), H / 2, 0));
        piv.add(box(wall, side, H, .14, (w / 2 + side / 2 - .15), H / 2, 0));
        if (H > hh) piv.add(box(wall, w + .4, H - hh, .14, 0, hh + (H - hh) / 2, 0));
      }
      h.segs.forEach(function (s, i) {
        var next = h.segs[i + 1];
        if (!next) return;
        var wide = s.w >= next.w ? s : next, narrow = wide === s ? next : s;
        bulkhead(s.b[0], s.b[2], wide.dir, wide.w + 1.2, wide.h, narrow.w, narrow.h);
      });
      var end = h.segs[h.segs.length - 1], first = h.segs[0];
      var cap1 = box(wall, end.w + 1.2, end.h, .14, end.b[0], end.h / 2, end.b[2]); cap1.rotation.y = end.dir; g.add(cap1);
      var cap0 = box(wall, first.w + 1.2, first.h, .14, first.a[0], first.h / 2, first.a[2]); cap0.rotation.y = first.dir; g.add(cap0);
      return g;
    }

    // ---- which building is loaded: a cache of three each
    var ext = new Map(), ints = new Map(), curExt = null, curInt = null;
    function ensure(cache, key, build, limit) {
      var g = cache.get(key);
      if (g) { cache.delete(key); cache.set(key, g); return g; }
      g = build(key); cache.set(key, g);
      while (cache.size > limit) { var k = cache.keys().next().value, old = cache.get(k); cache.delete(k); if (old.parent) old.parent.remove(old); dispose(old); }
      return g;
    }
    function show(parent, cur, next) { if (cur === next) return next; if (cur && cur.parent === parent) parent.remove(cur); if (next && next.parent !== parent) parent.add(next); return next; }

    // ---- the route: a line through the places it visits, in the group's colour
    function setRoute(route, anchors, color) {
      lane.set(color || '#8a8a8a');
      laneMat.emissive.copy(lane);
      hemi.color.copy(new THREE.Color(0x8899cc).lerp(lane, .35));
      if (routeLine) { G.space.remove(routeLine); routeLine.geometry.dispose(); routeLine.material.dispose(); routeLine = null; }
      markers.forEach(function (m) { G.space.remove(m); m.material.dispose(); }); markers = [];
      var pts = anchors.map(function (s) { var p = PL[s]; return new THREE.Vector3(p.x, p.y + p.r * 1.3, p.z); });
      if (pts.length >= 2) {
        var curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', .6);
        routeLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 24)), new THREE.LineBasicMaterial({ color: lane, transparent: true, opacity: .75 }));
        G.space.add(routeLine);
      }
      pts.forEach(function (v, i) {
        var m = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: lane, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
        m.scale.setScalar(Math.max(6, PL[anchors[i]].r * .9)); m.position.copy(v); G.space.add(m); markers.push(m);
      });
      ext.forEach(function (g) { g.traverse(function (o) { if (o.userData.laneGlow) o.material.color.copy(lane); }); });
      Tour.invalidate();
    }

    // ---- a pose becomes a picture
    var look = new THREE.Vector3();
    function apply(P) {
      if (P.poi) curExt = show(G.ext, curExt, ensure(ext, P.poi, buildExt, 3));
      if (P.stage === 2 && P.run) curInt = show(G.int, curInt, ensure(ints, P.run, buildInt, 3));
      var inav = P.stage === 1 && P.poi === 'inav';
      G.space.visible = P.stage === 0; G.ext.visible = P.stage === 1; G.int.visible = P.stage === 2;
      skydome.visible = P.stage === 1 && !inav;
      stars.visible = P.stage === 0 || inav;
      stars.position.set(P.px, P.py, P.pz);
      scene.fog = P.stage === 1 ? (inav ? null : FOG_EXT) : P.stage === 2 ? FOG_INT : null;
      scene.background = P.stage === 2 ? FOG_INT.color : P.stage === 1 && !inav ? FOG_EXT.color : SKY;
      hemi.intensity = P.stage === 0 ? .55 : P.stage === 1 ? .9 : (P.poi === 'inav' ? 1.9 : 1.15);
      sun.intensity = P.stage === 2 ? 0 : P.stage === 1 ? 2.6 : 2.2;
      lamp.intensity = P.stage === 2 ? 36 : 0;
      if (P.stage === 2) lamp.position.set(P.px, P.py + 1, P.pz);
      camera.near = P.stage === 0 ? .5 : P.stage === 1 ? .05 : .03;
      camera.far = P.stage === 0 ? 60000 : P.stage === 1 ? 4000 : 400;
      camera.fov = P.fov;
      camera.position.set(P.px, P.py, P.pz);
      look.set(P.lx, P.ly, P.lz); camera.lookAt(look);
      camera.updateProjectionMatrix();
    }
    function resize() {
      var w = window.innerWidth, h = window.innerHeight, pr = Math.min(window.devicePixelRatio || 1, 1.5);
      while (w * h * pr * pr > 2.1e6 && pr > .75) pr -= .25;
      renderer.setPixelRatio(pr); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    function render() { renderer.render(scene, camera); }
    function info() {
      var r = renderer.info;
      return { calls: r.render.calls, triangles: r.render.triangles, textures: r.memory.textures, geometries: r.memory.geometries, programs: r.programs ? r.programs.length : 0 };
    }
    return { setRoute: setRoute, apply: apply, render: render, resize: resize, info: info, canvas: canvas };
  }
})();
