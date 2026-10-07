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
  //   cx, cy : C-stick (right stick); ct = frames since it was flicked (0 = this tick)
  //   z      : grab button (RB), like Melee's Z
  //   x, y   : stick, -1..1 (y is +1 DOWN)
  //   a, b, j, s : held buttons (attack, special, jump, shield)
  //   tx, ty : frames since the stick was "tapped" hard on that axis (smash inputs, drop-through, fastfall)
  //   dash   : true on the frame a dash is requested (analog flick, or a keyboard double-tap)
  S.newPad = () => ({ x: 0, y: 0, cx: 0, cy: 0, ct: 99, a: false, b: false, j: false, s: false, z: false, tx: 99, ty: 99, dash: false, start: false });

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

  // ------------------------------------------------------------ gamepads (XInput, Steam Input, PlayStation, Switch…)
  // Browsers expose controllers through the Gamepad API. XInput pads (Xbox, and Steam Input's "Steam Virtual Gamepad",
  // which is how Steam remaps PlayStation/Switch/Steam Controller/Steam Deck input for non-Steam apps) usually arrive
  // with mapping "standard". Some browser/OS combos report the raw layout instead, so known raw layouts get a profile.
  //   Melee-style layout: A attack · B special · X/Y jump · LT/RT (analog) shield · RB grab (Z) · LB shield
  //   right stick = C-stick (smash attacks / aerials) · d-pad moves too · Start pause · Back/Select also pauses
  const STD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15, axes: [0, 1, 2, 3] };
  // Linux xpad / raw XInput (Firefox): triggers and d-pad are axes.
  const XPAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, back: 6, start: 7, ls: 9, rs: 10, axes: [0, 1, 3, 4], ltAxis: 2, rtAxis: 5, dpadAxes: [6, 7] };
  // Raw DualShock 4 / DualSense (hid-sony / hid-playstation on Linux, Firefox): ✕ ○ △ □ order.
  const SONY = { a: 0, b: 1, y: 2, x: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 11, rs: 12, axes: [0, 1, 3, 4], ltAxis: 2, rtAxis: 5, dpadAxes: [6, 7] };

  function vidpid(id) {
    let m = /Vendor:\s*([0-9a-f]{4})\s*Product:\s*([0-9a-f]{4})/i.exec(id);          // Chrome
    if (!m) m = /^([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);                        // Firefox
    return m ? [m[1].toLowerCase().padStart(4, "0"), m[2].toLowerCase().padStart(4, "0")] : ["", ""];
  }
  // What kind of controller is this? Used for labels, button glyphs and the raw-layout profile.
  S.input.describe = function (gp) {
    const id = gp.id || "", [v, p] = vidpid(id), low = id.toLowerCase();
    let kind = "Gamepad", family = "xbox";
    if (v === "28de" || /steam|valve/.test(low)) {
      kind = p === "1205" || /deck/.test(low) ? "Steam Deck" : p === "1102" || p === "1142" ? "Steam Controller" : "Steam Input";
    } else if (v === "045e" || /xbox|xinput|x-box/.test(low)) kind = "Xbox";
    else if (v === "054c" || /playstation|dualshock|dualsense|wireless controller/.test(low)) { kind = "PlayStation"; family = "sony"; }
    else if (v === "057e" || /nintendo|pro controller|joy-con/.test(low)) { kind = "Switch"; family = "nintendo"; }
    else if (/8bitdo/.test(low)) kind = "8BitDo";
    let profile = STD;
    if (gp.mapping !== "standard") {
      if (family === "sony") profile = SONY;
      else if (kind !== "Gamepad" || gp.axes.length >= 6) profile = XPAD;   // XInput-style raw layout (Xbox, Steam virtual pad)
    }
    return { kind, family, profile, standard: gp.mapping === "standard" };
  };
  const padInfo = {};   // index -> describe() result, refreshed on connect

  // Radial deadzone with rescaling, so small stick drift is ignored but full range is kept.
  function stick(gp, ix, iy, dz = 0.22) {
    const x = gp.axes[ix] || 0, y = gp.axes[iy] || 0, m = Math.hypot(x, y);
    if (m < dz) return [0, 0];
    const k = Math.min(1, (m - dz) / (1 - dz)) / m;
    return [x * k, y * k];
  }
  function readGamepad(i) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[i];
    if (!gp || !gp.connected) return null;
    let info = padInfo[i];
    if (!info || info.id !== gp.id) {   // pads already plugged in at load never fire "gamepadconnected"
      info = padInfo[i] = Object.assign({ id: gp.id }, S.input.describe(gp));
      S.DEVICE_LABELS["pad" + i] = "Pad " + (i + 1) + " · " + info.kind;
    }
    const P = info.profile;
    const btn = (n) => n != null && gp.buttons[n] ? gp.buttons[n] : null;
    const bt = (n) => { const b = btn(n); return !!(b && (b.pressed || b.value > 0.5)); };
    const trig = (bi, ai) => {   // analog trigger 0..1 from a button value or a -1..1 axis
      const b = btn(bi); if (b) return Math.max(b.value || 0, b.pressed ? 1 : 0);
      if (ai != null && gp.axes[ai] != null) { const v = gp.axes[ai]; return v === 0 ? 0 : (v + 1) / 2; }   // rest is -1 (or 0 before first touch)
      return 0;
    };
    let [x, y] = stick(gp, P.axes[0], P.axes[1]);
    const [cx, cy] = stick(gp, P.axes[2], P.axes[3], 0.3);
    if (P.dpadAxes) { const dx = gp.axes[P.dpadAxes[0]] || 0, dy = gp.axes[P.dpadAxes[1]] || 0; if (Math.abs(dx) > 0.5) x = Math.sign(dx); if (Math.abs(dy) > 0.5) y = Math.sign(dy); }
    else { if (bt(P.left)) x = -1; if (bt(P.right)) x = 1; if (bt(P.up)) y = -1; if (bt(P.down)) y = 1; }
    const lt = trig(P.lt, P.ltAxis), rt = trig(P.rt, P.rtAxis);
    return {
      x, y, cx, cy,
      a: bt(P.a), b: bt(P.b), j: bt(P.x) || bt(P.y),
      s: lt > 0.35 || rt > 0.35 || bt(P.lb),
      z: bt(P.rb),
      start: bt(P.start) || bt(P.back),
      shieldAnalog: Math.max(lt, rt),
    };
  }

  // Hot-plug: label each slot with what's in it ("Pad 1 · Xbox", "Pad 2 · Steam Deck"…) and tell the UI.
  S.input.onPadChange = null;
  function refreshLabels() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < 4; i++) {
      const gp = pads && pads[i];
      if (gp && gp.connected) { padInfo[i] = Object.assign({ id: gp.id }, S.input.describe(gp)); S.DEVICE_LABELS["pad" + i] = "Pad " + (i + 1) + " · " + padInfo[i].kind; }
      else { delete padInfo[i]; S.DEVICE_LABELS["pad" + i] = "Pad " + (i + 1); }
    }
  }
  addEventListener("gamepadconnected", (e) => {
    refreshLabels();
    S.input.toast = { text: "Controller connected: " + S.DEVICE_LABELS["pad" + e.gamepad.index], t: 180 };
    if (S.input.onPadChange) S.input.onPadChange(e.gamepad.index, true);
  });
  addEventListener("gamepaddisconnected", (e) => {
    refreshLabels();
    S.input.toast = { text: "Controller " + (e.gamepad.index + 1) + " disconnected", t: 180 };
    if (S.input.onPadChange) S.input.onPadChange(e.gamepad.index, false);
  });
  S.input.padInfo = (i) => padInfo[i] || null;
  // Which button glyphs to show for a device ("xbox" A/B/X/Y, "sony" ✕○□△, "nintendo").
  S.input.family = (devices) => { for (const d of devices || []) if (d.startsWith("pad") && padInfo[+d.slice(3)]) return padInfo[+d.slice(3)].family; return null; };

  // Rumble (XInput and Steam Input both pass it through; Chrome/Edge support "dual-rumble").
  S.input.rumbleOn = (() => { try { return localStorage.getItem("smash.rumble") !== "0"; } catch (e) { return true; } })();
  S.input.setRumble = function (on) { S.input.rumbleOn = on; try { localStorage.setItem("smash.rumble", on ? "1" : "0"); } catch (e) { /* ignore */ } };
  S.input.rumble = function (devices, strong, weak, ms) {
    if (!S.input.rumbleOn || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (const d of devices || []) {
      if (!d.startsWith("pad")) continue;
      const gp = pads[+d.slice(3)];
      const act = gp && (gp.vibrationActuator || (gp.hapticActuators && gp.hapticActuators[0]));
      if (!act) continue;
      try {
        if (act.playEffect) act.playEffect("dual-rumble", { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
        else if (act.pulse) act.pulse(Math.min(1, strong), ms);
      } catch (e) { /* unsupported */ }
    }
  };

  // devices: array like ["kbA", "pad0"]. Results are OR-merged.
  S.input.readPad = function (pad, devices) {
    let x = 0, y = 0, cx = 0, cy = 0, a = false, b = false, j = false, s = false, z = false, start = false, digital = false;
    for (const d of devices) {
      const v = d.startsWith("kb") ? readKeyboard(KEYMAPS[d]) : readGamepad(+d.slice(3));
      if (!v) continue;
      if (Math.abs(v.x) > Math.abs(x)) { x = v.x; digital = d.startsWith("kb"); }
      if (Math.abs(v.y) > Math.abs(y)) y = v.y;
      if (v.cx != null && Math.hypot(v.cx, v.cy) > Math.hypot(cx, cy)) { cx = v.cx; cy = v.cy; }
      a = a || v.a; b = b || v.b; j = j || v.j; s = s || v.s; z = z || !!v.z; start = start || !!v.start;
    }
    trackTaps(pad, x, y, digital);
    // C-stick: ct = 0 on the tick it is flicked out of neutral (like Melee's C-stick smash/aerial inputs)
    const cm = Math.hypot(cx, cy), pm = Math.hypot(pad.cx || 0, pad.cy || 0);
    pad.ct = cm > 0.7 && pm < 0.4 ? 0 : Math.min(99, (pad.ct == null ? 99 : pad.ct) + 1);
    pad.cx = cx; pad.cy = cy;
    pad.x = x; pad.y = y; pad.a = a; pad.b = b; pad.j = j; pad.s = s; pad.z = z; pad.start = start;
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
