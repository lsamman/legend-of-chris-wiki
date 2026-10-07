/* Super Smash Ballers — core: namespace, registries, seeded RNG, input.
   Everything hangs off window.Smash (S). Load order: core, game, [content files], ai, ui, engine. */
(function () {
  "use strict";
  const S = (window.Smash = window.Smash || {});

  // ------------------------------------------------------------ registries
  S.FIGHTERS = {}; S.FIGHTER_ORDER = [];
  S.STAGES = {}; S.STAGE_ORDER = [];
  S.registerFighter = function (def) {
    S.FIGHTERS[def.id] = def;
    if (!S.FIGHTER_ORDER.includes(def.id)) S.FIGHTER_ORDER.push(def.id);
  };
  S.registerStage = function (def) {
    S.STAGES[def.id] = def;
    if (!S.STAGE_ORDER.includes(def.id)) S.STAGE_ORDER.push(def.id);
  };

  S.PORT_COLORS = ["#e8333a", "#2f6bff", "#f2b705", "#1fa84a"];
  S.TICK = 1000 / 60;
  S.DEG = Math.PI / 180;
  S.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  S.lerp = (a, b, t) => a + (b - a) * t;
  S.sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

  // Deterministic RNG (mulberry32). The sim only ever uses game.rng, never Math.random.
  S.makeRng = function (seed) {
    let a = seed >>> 0;
    const r = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + r() * (hi - lo);
    r.int = (lo, hi) => Math.floor(lo + r() * (hi - lo + 1));
    r.pick = (arr) => arr[Math.floor(r() * arr.length)];
    return r;
  };

  // ------------------------------------------------------------ controllers
  // A "pad" is the virtual controller the sim reads. Humans and the AI both write one.
  //   x, y   : stick, -1..1 (y is +1 DOWN)
  //   a, b, j, s : held buttons (attack, special, jump, shield)
  //   tx, ty : frames since the stick was "tapped" hard on that axis (smash inputs, drop-through, fastfall)
  //   dash   : true on the frame a dash is requested (analog flick, or a keyboard double-tap)
  S.newPad = () => ({ x: 0, y: 0, a: false, b: false, j: false, s: false, tx: 99, ty: 99, dash: false, start: false });

  const KEYMAPS = {
    kbA: { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"], a: ["KeyF"], b: ["KeyG"], j: ["KeyH", "Space"], s: ["KeyT", "ShiftLeft"] },
    kbB: { left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"], a: ["Comma", "Numpad1"], b: ["Period", "Numpad2"], j: ["Slash", "Numpad3"], s: ["ShiftRight", "Numpad0"] },
  };
  S.KEYMAPS = KEYMAPS;
  S.DEVICE_LABELS = { kbA: "Keys A", kbB: "Keys B", pad0: "Pad 1", pad1: "Pad 2", pad2: "Pad 3", pad3: "Pad 4" };

  const down = new Set();
  const keyDownAt = {};   // code -> input frame of the last fresh press
  let inputFrame = 0;
  const GAME_KEYS = new Set(Object.values(KEYMAPS).flatMap((m) => Object.values(m).flat()));

  S.input = {
    down,
    // Fresh key presses since the last menu poll (menus use these; the sim uses pads).
    presses: [],
    mouse: { x: 0, y: 0, clicked: false, down: false },
    attach(target) {
      addEventListener("keydown", (e) => {
        if (GAME_KEYS.has(e.code) || e.code === "Enter" || e.code === "Escape") e.preventDefault();
        if (!e.repeat) { keyDownAt[e.code] = inputFrame; S.input.presses.push(e.code); }
        down.add(e.code);
      });
      addEventListener("keyup", (e) => down.delete(e.code));
      addEventListener("blur", () => down.clear());
      const pos = (e) => {
        const r = target.getBoundingClientRect();
        S.input.mouse.x = e.clientX - r.left;   // CSS pixels, same space scenes render in
        S.input.mouse.y = e.clientY - r.top;
      };
      target.addEventListener("mousemove", pos);
      target.addEventListener("mousedown", (e) => { pos(e); S.input.mouse.down = true; S.input.mouse.clicked = true; });
      addEventListener("mouseup", () => (S.input.mouse.down = false));
    },
    // Call once per sim tick before reading pads.
    tick() { inputFrame++; },
    // Consume menu events (call once per rendered menu frame).
    takePresses() { const p = S.input.presses; S.input.presses = []; return p; },
    takeClick() { const c = S.input.mouse.clicked; S.input.mouse.clicked = false; return c; },
  };

  // Per-port tap tracking lives on the pad itself (_px/_py previous stick, _lastTap times).
  function trackTaps(pad, nx, ny, digital) {
    const strong = 0.8, weak = 0.3;
    pad.tx = Math.min(99, pad.tx + 1);
    pad.ty = Math.min(99, pad.ty + 1);
    pad.dash = false;
    const px = pad._px || 0, py = pad._py || 0;
    if (Math.abs(nx) > strong && (Math.abs(px) < weak || Math.sign(px) !== Math.sign(nx))) {
      pad.tx = 0;
      if (digital) {
        // keyboard: double-tap the same direction to dash
        if (pad._lastTapDir === Math.sign(nx) && inputFrame - (pad._lastTapAt || -99) <= 14) pad.dash = true;
        pad._lastTapDir = Math.sign(nx); pad._lastTapAt = inputFrame;
      } else pad.dash = true;
    }
    if (Math.abs(ny) > strong && (Math.abs(py) < weak || Math.sign(py) !== Math.sign(ny))) pad.ty = 0;
    pad._px = nx; pad._py = ny;
  }

  function readKeyboard(map) {
    const any = (codes) => codes.some((c) => down.has(c));
    // last-pressed direction wins when both are held
    let x = 0, y = 0;
    const l = any(map.left), r = any(map.right), u = any(map.up), d = any(map.down);
    if (l && r) x = Math.max(...map.left.map((c) => keyDownAt[c] ?? -1)) > Math.max(...map.right.map((c) => keyDownAt[c] ?? -1)) ? -1 : 1;
    else x = l ? -1 : r ? 1 : 0;
    if (u && d) y = Math.max(...map.up.map((c) => keyDownAt[c] ?? -1)) > Math.max(...map.down.map((c) => keyDownAt[c] ?? -1)) ? -1 : 1;
    else y = u ? -1 : d ? 1 : 0;
    return { x, y, a: any(map.a), b: any(map.b), j: any(map.j), s: any(map.s) };
  }

  function readGamepad(i) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[i];
    if (!gp || !gp.connected) return null;
    const ax = (n) => { const v = gp.axes[n] || 0; return Math.abs(v) < 0.2 ? 0 : v; };
    const bt = (n) => !!(gp.buttons[n] && gp.buttons[n].pressed);
    let x = ax(0), y = ax(1);
    if (bt(14)) x = -1; if (bt(15)) x = 1; if (bt(12)) y = -1; if (bt(13)) y = 1;   // d-pad
    // Standard mapping: A attack, B special, X/Y jump, shoulders/triggers shield, Start pause.
    return { x, y, a: bt(0), b: bt(1), j: bt(2) || bt(3), s: bt(4) || bt(5) || bt(6) || bt(7), start: bt(9) };
  }

  // devices: array like ["kbA", "pad0"]. Results are OR-merged.
  S.input.readPad = function (pad, devices) {
    let x = 0, y = 0, a = false, b = false, j = false, s = false, start = false, digital = false;
    for (const d of devices) {
      const v = d.startsWith("kb") ? readKeyboard(KEYMAPS[d]) : readGamepad(+d.slice(3));
      if (!v) continue;
      if (Math.abs(v.x) > Math.abs(x)) { x = v.x; digital = d.startsWith("kb"); }
      if (Math.abs(v.y) > Math.abs(y)) y = v.y;
      a = a || v.a; b = b || v.b; j = j || v.j; s = s || v.s; start = start || !!v.start;
    }
    trackTaps(pad, x, y, digital);
    pad.x = x; pad.y = y; pad.a = a; pad.b = b; pad.j = j; pad.s = s; pad.start = start;
    return pad;
  };
  S.input.gamepadCount = function () {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let n = 0; for (const p of pads || []) if (p && p.connected) n++; return n;
  };
  // For CPU-driven pads: the AI sets x/y/buttons, then calls this to update tap timers consistently.
  S.input.finishAiPad = function (pad) {
    const nx = pad.x, ny = pad.y;
    const tx = pad.tx, ty = pad.ty, wantDash = pad.dash;
    const fin = pad._fin || {};
    trackTaps(pad, nx, ny, false);
    // the AI may force smash/dash inputs explicitly (only fresh requests: not values this function left last tick)
    if (tx === 0 && fin.tx !== 0) pad.tx = 0;
    if (ty === 0 && fin.ty !== 0) pad.ty = 0;
    if (wantDash && !fin.dash) pad.dash = true;
    pad._fin = { tx: pad.tx, ty: pad.ty, dash: pad.dash };
  };
})();
