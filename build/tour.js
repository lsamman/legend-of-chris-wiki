// The Flythrough (flythrough.html): one route per group, flown as the reader scrolls.
// This file owns the scroll, the captions, the route and order controls, the URL, and the CAMERA POSE:
// where the camera is and what it looks at is a pure function of how far down the page you are, so
// scrubbing back up reproduces it exactly and the words can never drift away from the picture.
// tour3d.js turns a pose into a picture; this file never touches three.js. With no WebGL the page is
// the same captions, read top to bottom.
(function () {
  var T = window.LOC_TOUR;
  if (!T) return;
  var PL = T.places;
  var root = document.documentElement, body = document.body;
  var toolbar = document.querySelector('.toolbar');
  var hud = document.getElementById('tour-hud');
  var countEl = document.getElementById('tour-count');
  var motionBtn = document.getElementById('tour-motion');
  var noglEl = document.getElementById('tour-nogl');
  var wrappers = [].slice.call(document.querySelectorAll('.tour-route'));
  var chips = [].slice.call(document.querySelectorAll('.tour-chip'));
  var orderBtns = [].slice.call(document.querySelectorAll('.tour-order button'));
  var routesById = {};
  T.routes.forEach(function (r) { routesById[r.id] = r; });
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { route: null, order: 'happened', motion: !reduce };
  var view = null, veilEl = null, failed = false;
  var secs = [], stops = [], legs = [], tops = [], N = 0, cur = 0;
  var lastS = -1, lastStill = -1, dirty = true, tick = false;

  // ---- small maths. Vectors are plain arrays; nothing here allocates per frame except these scratch ones.
  var D = 0.45;            // the first 45% of a stop's band is the dwell; the rest is the travel to the next stop
  var CREEP = 1.5;         // how far the camera drifts forward down a hallway while it dwells in a room
  var EYE = 1.65;          // eye height indoors: what makes a hallway read as a building
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var x = fnv(seed) || 1; return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sm(x) { return x * x * (3 - 2 * x); }
  function outCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function inOutQuint(x) { return x < .5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function len(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function norm(a) { var l = len(a); return l > 1e-9 ? scale(a, 1 / l) : null; }
  function bez(p0, p1, p2, p3, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2]];
  }
  function veilAt(v) { return Math.max(0, 1 - Math.abs(v - .5) / .18); }

  // ---- places
  function at(s) { var p = PL[s]; return [p.x, p.y, p.z]; }
  function building(s) { var b = null, c = s; while (c && PL[c].k === 'poi') { b = c; c = PL[c].p; } return b; }   // the outermost building a place is in
  function anchorOf(s) { var b = building(s); return b ? PL[b].p : s; }                                                 // the thing in space the camera orbits
  function dirOf(s) {   // a fixed direction per place: where the camera sits when it orbits it
    var h = fnv(s), az = (h % 360) * Math.PI / 180, el = 0.16 + 0.26 * ((h >>> 9) % 100) / 100;
    return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  }
  function rotY(v, a) { var c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; }

  // ---- the hallway inside a building: a seeded polyline with one wide room per stop, used by tour3d.js too
  var halls = {};
  function hallOf(b, n) {
    var key = b + '/' + n;
    if (halls[key]) return halls[key];
    var R = rng('hall:' + b), pts = [[0, 0, 0]], dir = Math.PI, segs = [], rooms = [], L = 0;
    for (var k = 0; k < n + 2; k++) {
      if (k) dir += (R() - .5) * 1.1;
      var room = k >= 1 && k <= n, l = room ? 16 : 11;
      var p0 = pts[k], p1 = [p0[0] + Math.sin(dir) * l, 0, p0[2] + Math.cos(dir) * l];
      pts.push(p1);
      segs.push({ a: p0, b: p1, dir: dir, len: l, from: L, room: room ? k - 1 : -1, w: room ? 12 : 4.2, h: room ? 5 : 3.2 });
      if (room) rooms.push({ at: L + l * .5, seg: k });
      L += l;
    }
    function spineAt(t) {
      t = clamp(t, 0, L);
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (t <= s.from + s.len || i === segs.length - 1) { var u = (t - s.from) / s.len; return [lerp(s.a[0], s.b[0], u), 0, lerp(s.a[2], s.b[2], u)]; }
      }
    }
    return (halls[key] = { pts: pts, segs: segs, rooms: rooms, L: L, spineAt: spineAt });
  }

  // ---- canonical camera poses. Each returns [eye, look].
  function orbit(sp, ph) {   // round the thing in space, slowly turning with the phase
    var p = PL[sp], d = rotY(dirOf(sp), ph * .35), dist = 3.0 * p.r + 2;
    return [add(at(sp), scale(d, dist)), at(sp)];
  }
  function surface(sp, b) {  // just above the point on the surface where the building is
    var p = PL[sp], n = norm(sub(at(b), at(sp))) || dirOf(sp);
    return [add(at(sp), scale(n, p.r * 1.08)), add(at(sp), scale(n, p.r * .9))];
  }
  function standoff(b, ph) {  // outside a building, in its own frame: the building at the origin, its front towards +z
    var inav = b === 'inav', a = ph * (inav ? .9 : .25), r = inav ? 30 : 26, y = inav ? 7 : 5.5;
    return [[Math.sin(a) * r, y, Math.cos(a) * r], [0, inav ? 7 : 4.5, 0]];
  }
  function high(b) { return [[0, 110, 70], [0, 0, 0]]; }
  function door(b) { return [[0, EYE, 9.5], [0, EYE, 0]]; }

  var POSE = { stage: 0, px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 50, veil: 0, poi: null, run: null, room: 0, rooms: 0, i: 0, u: 0 };
  function set(stage, e, l, fov, poi) {
    POSE.stage = stage; POSE.px = e[0]; POSE.py = e[1]; POSE.pz = e[2]; POSE.lx = l[0]; POSE.ly = l[1]; POSE.lz = l[2];
    POSE.fov = fov; POSE.poi = poi || null; POSE.veil = 0;
  }
  function setHall(st, t, sway) {
    var h = st.hall, e = h.spineAt(t), l = h.spineAt(Math.min(t + 6, h.L));
    if (sway) { var d = h.spineAt(t + .1); var side = norm([d[2] - e[2], 0, -(d[0] - e[0])]) || [1, 0, 0]; e = add(e, scale(side, sway)); }
    set(2, [e[0], EYE, e[2]], [l[0], EYE, l[2]], 70, st.b);
    POSE.run = st.run; POSE.room = st.room; POSE.rooms = st.rooms;
  }

  // ---- the moves between two stops, each a weight and a function of v in [0,1]
  function eHop(a, b, ph0, ph1) {
    var A = orbit(a.sp, ph0), B = orbit(b.sp, ph1), pa = PL[a.sp], pb = PL[b.sp];
    var dist = len(sub(B[0], A[0])), lift = .35 * dist + .5 * (pa.r + pb.r);
    var c1 = add(A[0], scale(norm(sub(A[0], at(a.sp))) || [0, 1, 0], lift)), c2 = add(B[0], scale(norm(sub(B[0], at(b.sp))) || [0, 1, 0], lift));
    return { w: 3, f: function (v) { set(0, bez(A[0], c1, c2, B[0], inOutQuint(v)), mix(A[1], B[1], sm(clamp((v - .1) / .8, 0, 1))), 50, null); } };
  }
  function eTurn(a, ph0, ph1) {  // the same thing in space: just come round a little
    return { w: 1, f: function (v) { var o = orbit(a.sp, lerp(ph0, ph1, sm(v))); set(0, o[0], o[1], 50, null); } };
  }
  function eDescend(b, ph0, ph1) {  // orbit -> down to the surface, cut, high above the building -> its door
    var A = orbit(b.sp, ph0), S = surface(b.sp, b.b), H = high(b.b), K = standoff(b.b, ph1);
    return { w: 1.6, f: function (v) {
      if (v < .5) { var t = outCubic(v * 2); set(0, mix(A[0], S[0], t), mix(A[1], S[1], t), lerp(50, 42, t), null); }
      else { var t2 = outCubic((v - .5) * 2); set(1, mix(H[0], K[0], t2), mix(H[1], K[1], t2), 55, b.b); }
      POSE.veil = veilAt(v);
    } };
  }
  function eAscend(a, ph0, ph1) {
    var K = standoff(a.b, ph0), H = high(a.b), S = surface(a.sp, a.b), A = orbit(a.sp, ph1);
    return { w: 1.2, f: function (v) {
      if (v < .5) { var t = sm(v * 2); set(1, mix(K[0], H[0], t), mix(K[1], H[1], t), lerp(55, 50, t), a.b); }
      else { var t2 = sm((v - .5) * 2); set(0, mix(S[0], A[0], t2), mix(S[1], A[1], t2), lerp(42, 50, t2), null); }
      POSE.veil = veilAt(v);
    } };
  }
  function ePan(a, b, ph0, ph1) {
    var A = standoff(a.b, ph0), B = standoff(b.b, ph1);
    return { w: .6, f: function (v) { var t = sm(v); set(1, mix(A[0], B[0], t), mix(A[1], B[1], t), 55, b.b); } };
  }
  function eEnter(b, ph0) {
    var K = standoff(b.b, ph0), Dr = door(b.b), h = b.hall, t1 = h.rooms[b.room].at;
    return { w: 1, f: function (v) {
      if (v < .5) { var t = sm(v * 2); set(1, mix(K[0], Dr[0], t), mix(K[1], Dr[1], t), lerp(55, 64, t), b.b); }
      else setHall(b, lerp(0, t1, outCubic((v - .5) * 2)), 0);
      POSE.veil = veilAt(v);
    } };
  }
  function eExit(a, ph1) {
    var h = a.hall, t0 = h.rooms[a.room].at + CREEP, Dr = door(a.b), K = standoff(a.b, ph1);
    return { w: .8, f: function (v) {
      if (v < .5) setHall(a, lerp(t0, h.L, sm(v * 2)), 0);
      else { var t = outCubic((v - .5) * 2); set(1, mix(Dr[0], K[0], t), mix(Dr[1], K[1], t), lerp(64, 55, t), a.b); }
      POSE.veil = veilAt(v);
    } };
  }
  function eHall(a, b) {
    var h = a.hall, t0 = h.rooms[a.room].at + CREEP, t1 = h.rooms[b.room].at;
    return { w: .8, f: function (v) { setHall(b, lerp(t0, t1, sm(v)), .12 * Math.sin(3 * Math.PI * v)); } };
  }
  function legOf(a, b) {   // from the end of a's dwell to the start of b's dwell
    var edges = [], ph = a.ph + .35, pb = b.ph;
    if (a.stage === 2 && b.stage === 2 && a.run === b.run) edges.push(eHall(a, b));
    else if (a.stage === 1 && b.stage === 1 && a.b === b.b) edges.push(ePan(a, b, ph, pb));
    else {
      if (a.stage === 2) edges.push(eExit(a, ph));
      if (a.stage >= 1) edges.push(eAscend(a, ph, ph));
      if (a.sp !== b.sp) { edges.push(eHop(a, b, ph, b.stage === 0 ? pb : ph)); if (b.stage === 0) ph = pb; }
      else if (b.stage === 0) { edges.push(eTurn(a, ph, pb)); ph = pb; }
      if (b.stage >= 1) edges.push(eDescend(b, ph, pb));
      if (b.stage === 2) edges.push(eEnter(b, pb));
    }
    var total = 0, cuts = [0];
    edges.forEach(function (e) { total += e.w; cuts.push(total); });
    cuts = cuts.map(function (c) { return c / total; });
    return { edges: edges, cuts: cuts };
  }
  function dwell(st, v) {
    if (st.stage === 0) { var o = orbit(st.sp, st.ph + .35 * v); set(0, o[0], o[1], 50, null); }
    else if (st.stage === 1) { var k = standoff(st.b, st.ph + .35 * v); set(1, k[0], k[1], 55, st.b); }
    else setHall(st, st.hall.rooms[st.room].at + CREEP * sm(v), 0);
  }
  function poseAt(s) {
    var i = clamp(Math.floor(s), 0, N - 1), u = clamp(s - i, 0, 1);
    POSE.i = i; POSE.u = u; POSE.run = null; POSE.room = 0; POSE.rooms = 0;
    if (i === N - 1 || u < D) dwell(stops[i], Math.min(u / D, 1));
    else {
      var w = (u - D) / (1 - D), L = legs[i], k = 0;
      while (k < L.edges.length - 1 && w >= L.cuts[k + 1]) k++;
      L.edges[k].f(clamp((w - L.cuts[k]) / (L.cuts[k + 1] - L.cuts[k]), 0, 1));
    }
    return POSE;
  }

  // ---- building a route from the sections on the page (so the order toggle is respected)
  function buildRoute() {
    var wrap = document.getElementById('route-' + state.route);
    secs = [].slice.call(wrap.querySelectorAll('.tour-stop'));
    N = secs.length;
    stops = secs.map(function (sec, i) {
      var pl = sec.getAttribute('data-place'), b = building(pl), p = PL[pl];
      var st = { i: i, ev: sec.getAttribute('data-ev'), pl: pl, b: b, sp: anchorOf(pl), ph: i * .5, sec: sec,
                 stage: b ? (p['in'] ? 2 : 1) : 0, room: 0, rooms: 1, run: null, hall: null, ch: sec.getAttribute('data-chapter') };
      var img = sec.querySelector('.tour-pic'), h3 = sec.querySelector('h3');
      st.img = img ? img.getAttribute('src') : (p.img || '');
      st.title = h3 ? h3.textContent : p.t;
      return st;
    });
    // consecutive indoor stops in one building walk one hallway, a room each
    var run = null;
    stops.forEach(function (st, i) {
      if (st.stage === 2 && run && run.b === st.b) { st.room = run.n++; run.stops.push(st); }
      else if (st.stage === 2) { run = { key: st.b + '#' + i, b: st.b, n: 1, stops: [st] }; st.room = 0; }
      else run = null;
      if (run) st.run = run.key, st.runObj = run;
      st.sec.removeAttribute('data-run');
    });
    stops.forEach(function (st) {
      if (!st.run) return;
      st.rooms = st.runObj.n; st.hall = hallOf(st.b, st.rooms); st.sec.setAttribute('data-run', st.run);
    });
    legs = stops.map(function (st, i) { return i < N - 1 ? legOf(st, stops[i + 1]) : null; });
    lastS = -1; dirty = true;
  }
  function runInfo(key) {   // what tour3d.js needs to furnish one hallway: its rooms' pictures and names
    for (var i = 0; i < stops.length; i++) if (stops[i].run === key) {
      var r = stops[i].runObj;
      return { b: r.b, n: r.n, rooms: r.stops.map(function (st) { return { img: st.img, title: st.title }; }) };
    }
    return null;
  }
  function anchors() { var out = []; stops.forEach(function (st) { if (!out.length || out[out.length - 1] !== st.sp) out.push(st.sp); }); return out; }

  // ---- scroll -> s
  function topOffset() { return (toolbar ? toolbar.offsetHeight : 0) + 16; }
  function measure() {
    var sy = window.scrollY;
    tops = secs.map(function (el) { return el.getBoundingClientRect().top + sy; });
    if (secs.length) tops.push(secs[N - 1].getBoundingClientRect().bottom + sy);
    root.style.setProperty('--tl-top', (toolbar ? toolbar.offsetHeight : 0) + 'px');
  }
  function sFromScroll() {
    if (!N) return 0;
    var A = window.scrollY + topOffset();
    while (cur > 0 && A < tops[cur]) cur--;
    while (cur < N - 1 && A >= tops[cur + 1]) cur++;
    return cur + clamp((A - tops[cur]) / (tops[cur + 1] - tops[cur]), 0, 1);
  }

  // ---- paint: the cards, the veil, the HUD
  function paint(s) {
    var i = Math.min(Math.floor(s), N - 1), u = s - i;
    stops.forEach(function (st, k) { st.sec.style.setProperty('--u', k === i ? u.toFixed(3) : '0'); });
    if (veilEl) veilEl.style.setProperty('--veil', POSE.veil.toFixed(3));
    if (hud) {
      var r = routesById[state.route], st = stops[i], c = r && st && st.ch && r.cells[st.ch];
      var above = tops.length && window.scrollY + topOffset() < tops[0] - 40;   // still reading the introduction
      if (c && !above) {
        hud.querySelector('.tour-hud-ch').textContent = T.chapters[st.ch] || st.ch;
        hud.querySelector('.tour-hud-place').innerHTML = c.place;
        hud.querySelector('.tour-hud-doing').innerHTML = c.doing;
        hud.hidden = false;
      } else hud.hidden = true;
    }
  }
  function req() { if (!tick) { tick = true; requestAnimationFrame(frame); } }
  function frame() {
    tick = false;
    if (!N) return;
    var s = sFromScroll();
    if (s === lastS && !dirty) return;
    lastS = s; dirty = false;
    if (state.motion) poseAt(s);
    else {   // reduced motion: one still per stop, from inside its dwell
      var f = Math.floor(s);
      if (f !== lastStill || !view) { lastStill = f; poseAt(f + .2); } else { paint(s); return; }
    }
    paint(s);
    if (view) { view.apply(POSE); view.render(); }
  }

  // ---- state: the route, the order, motion; in the address and remembered
  function laneColor() {
    var r = routesById[state.route];
    return getComputedStyle(root).getPropertyValue('--lane-' + (r ? r.lane : 'history')).trim() || '#8a8a8a';
  }
  function applyOrder() {
    var wrap = document.getElementById('route-' + state.route);
    var list = [].slice.call(wrap.querySelectorAll('.tour-stop')), end = wrap.querySelector('.tour-end');
    var key = state.order === 'told' ? 'data-told' : 'data-when';
    list.sort(function (a, b) { return (+a.getAttribute(key)) - (+b.getAttribute(key)); });
    list.forEach(function (el) { wrap.insertBefore(el, end); });
    orderBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-order') === state.order ? 'true' : 'false'); });
  }
  function remember() {
    try { localStorage.setItem('loc-tour-route', state.route); localStorage.setItem('loc-tour-order', state.order); localStorage.setItem('loc-tour-motion', state.motion ? '1' : '0'); } catch (e) {}
    var p = new URLSearchParams(location.search);
    if (state.route !== T.routes[0].id) p.set('route', state.route); else p.delete('route');
    if (state.order !== 'happened') p.set('order', state.order); else p.delete('order');
    var qs = p.toString();
    try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
  }
  function setRoute(id, keepPlace) {
    if (!routesById[id]) id = T.routes[0].id;
    state.route = id;
    wrappers.forEach(function (w) { w.hidden = w.getAttribute('data-route') !== id; });
    chips.forEach(function (c) { c.setAttribute('aria-pressed', c.getAttribute('data-route') === id ? 'true' : 'false'); });
    applyOrder();
    buildRoute();
    cur = 0;
    measure();
    if (countEl) countEl.textContent = N + ' stops, ' + (state.order === 'told' ? 'in the order the book tells them' : 'in the order they happened');
    if (view) view.setRoute(routesById[id], anchors(), laneColor());
    if (!keepPlace) { var w = document.getElementById('route-' + id); window.scrollTo(0, w.getBoundingClientRect().top + window.scrollY - topOffset() + 8); }
    remember();
    lastS = -1; dirty = true; req();
  }
  function setOrder(o) {
    if (o === state.order) return;
    state.order = o;
    setRoute(state.route, false);
  }
  function setMotion(on) {
    state.motion = on;
    if (motionBtn) { motionBtn.textContent = on ? 'Camera: moving' : 'Camera: stills'; motionBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    lastStill = -1; lastS = -1; dirty = true; remember(); req();
  }

  // ---- the 3D, if it can start. flythrough.html calls enable3d() from the module that loads three.js.
  var Tour = window.LOCTour = {
    data: T, places: PL, pose: POSE, hallOf: hallOf, runInfo: runInfo, poseAt: poseAt, state: state,
    s: sFromScroll, stops: function () { return stops; },
    invalidate: function () { dirty = true; req(); },
    enable3d: function () {
      if (view || failed) return;
      var flat = new URLSearchParams(location.search).get('flat') === '1';
      if (!flat && window.LOCTour3D && window.THREE) {
        try { view = window.LOCTour3D.create(window.THREE, Tour); } catch (e) { view = null; }
      }
      if (!view) { failed = true; body.classList.add('tour-flat'); if (noglEl) noglEl.hidden = false; return; }
      veilEl = document.createElement('div'); veilEl.className = 'tour-veil'; veilEl.setAttribute('aria-hidden', 'true');
      body.appendChild(veilEl);
      body.classList.add('tour-live');
      if (motionBtn) motionBtn.hidden = false;
      view.resize();
      view.setRoute(routesById[state.route], anchors(), laneColor());
      // the layout just changed under us: keep the reader on the same stop
      var s = N ? sFromScroll() : 0;
      measure();
      if (N) window.scrollTo(0, tops[Math.min(Math.floor(s), N - 1)] - topOffset() + (s % 1) * ((tops[Math.min(Math.floor(s), N - 1) + 1] || 0) - tops[Math.min(Math.floor(s), N - 1)]));
      lastS = -1; dirty = true; req();
    },
    view: function () { return view; }
  };

  // ---- controls
  chips.forEach(function (c) { c.addEventListener('click', function (ev) { ev.preventDefault(); setRoute(c.getAttribute('data-route'), false); }); });
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a.tour-next');
    if (a) { ev.preventDefault(); setRoute(a.getAttribute('data-route'), false); }
  });
  orderBtns.forEach(function (b) { b.addEventListener('click', function () { setOrder(b.getAttribute('data-order')); }); });
  if (motionBtn) motionBtn.addEventListener('click', function () { setMotion(!state.motion); });
  window.addEventListener('scroll', req, { passive: true });
  window.addEventListener('resize', function () {
    var s = N ? sFromScroll() : 0;
    measure();
    if (view) view.resize();
    if (N) { var i = Math.min(Math.floor(s), N - 1); window.scrollTo(0, tops[i] + (s - i) * (tops[i + 1] - tops[i]) - topOffset()); }
    lastS = -1; dirty = true; req();
  });
  new MutationObserver(function () { if (view) view.setRoute(routesById[state.route], anchors(), laneColor()); dirty = true; req(); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // ---- start: the route from the address, then the last one chosen, then the first
  var params = new URLSearchParams(location.search), saved = {};
  try { saved = { route: localStorage.getItem('loc-tour-route'), order: localStorage.getItem('loc-tour-order'), motion: localStorage.getItem('loc-tour-motion') }; } catch (e) {}
  var hashRoute = (/^#stop-([a-z0-9]+)-/.exec(location.hash) || [])[1];
  var want = params.get('route') || hashRoute || saved.route || T.routes[0].id;
  state.order = (params.get('order') || saved.order) === 'told' ? 'told' : 'happened';
  if (saved.motion === '0') state.motion = false; else if (saved.motion === '1') state.motion = true;
  setMotion(state.motion);
  setRoute(want, true);
  if (location.hash) {
    requestAnimationFrame(function () {
      var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el && el.classList.contains('tour-stop')) { el.scrollIntoView({ behavior: 'auto', block: 'start' }); window.scrollBy(0, -topOffset() + 2); }
    });
  }
})();
