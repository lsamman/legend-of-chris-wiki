/* Super Smash Ballers — CPU players (S.AI).
   S.AI.create(f, level, g) -> brain; the engine calls brain.think(g, pad) every tick, then S.input.finishAiPad(pad).
   The brain only uses the generic fighter API (state, moves, hitboxes, stats, def.ai hints), so it works for
   any fighter. Deterministic: all randomness comes from g.rng().
   Levels: 1 = easy, 2 = normal, 3 = hard (reaction time, accuracy, shield/tech/DI frequency, aggression). */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp, sign } = S;
  const DEG = Math.PI / 180;

  const LEVELS = {
    1: { react: 18, interval: 13, skip: 0.35, defend: 0.12, dodge: 0.0, tech: 0.12, di: 0.25, mash: 0.35, hop: 0.12, noise: 14,
         ledgeWait: [30, 110], punish: 0.25, charge: 0.0, chase: 0.15, ranged: 0.15, lowRecover: 25, whiff: 0.25 },
    2: { react: 9, interval: 7, skip: 0.12, defend: 0.4, dodge: 0.12, tech: 0.5, di: 0.65, mash: 0.7, hop: 0.28, noise: 7,
         ledgeWait: [14, 70], punish: 0.6, charge: 0.15, chase: 0.4, ranged: 0.25, lowRecover: 10, whiff: 0.08 },
    3: { react: 3, interval: 3, skip: 0.0, defend: 0.72, dodge: 0.25, tech: 0.88, di: 0.95, mash: 1.0, hop: 0.42, noise: 3,
         ledgeWait: [6, 40], punish: 0.9, charge: 0.3, chase: 0.7, ranged: 0.3, lowRecover: 0, whiff: 0.0 },
  };

  const GROUND_MOVES = ["jab", "ftilt", "utilt", "dtilt", "fsmash", "usmash", "dsmash", "grab", "nspecial", "sspecial", "dspecial", "uspecial"];
  const AIR_MOVES = ["nair", "fair", "bair", "uair", "dair", "nspecial", "sspecial", "dspecial"];
  const TURNS = { ftilt: 1, fsmash: 1, sspecial: 1 };   // moves whose input sets facing toward the stick
  const SMASHES = { fsmash: 1, usmash: 1, dsmash: 1 };
  const SPECIALS = { nspecial: 1, sspecial: 1, dspecial: 1, uspecial: 1 };
  const THROWS = ["fthrow", "bthrow", "uthrow", "dthrow"];
  const STILL = ["dizzy", "ledgeclimb", "getup", "tech", "roll", "spotdodge", "land", "dead"];

  // ------------------------------------------------------------ helpers
  function boxesOf(def, f) {
    if (!def || !def.hitboxes) return [];
    if (typeof def.hitboxes === "function") {
      try { const r = def.hitboxes(f); return Array.isArray(r) ? r : []; } catch (e) { return []; }
    }
    return def.hitboxes;
  }
  function moveDef(f, name, air) {
    const m = f.moves[name];
    if (!m) return null;
    if (air && f.moves[name + "Air"]) return f.moves[name + "Air"];
    return m;
  }
  // Summary of a move's hitboxes: startup, strongest box, end of activity, total length.
  function info(f, name, air) {
    const def = moveDef(f, name, air);
    if (!def) return null;
    const boxes = boxesOf(def, f).filter((b) => b && typeof b.x === "number");
    let startup = 999, end = 0, best = null, grab = false, reachX = 0;
    for (const b of boxes) {
      startup = Math.min(startup, b.start || 1); end = Math.max(end, b.end || 1);
      if (b.grab) grab = true;
      if (!best || (b.dmg || 0) * 1 + (b.kbg || 0) * 0.05 > (best.dmg || 0) + (best.kbg || 0) * 0.05) best = b;
      reachX = Math.max(reachX, Math.abs(b.x) + b.r);
    }
    return { def, name, boxes, startup, end, best, grab, reachX, frames: def.frames || 30, helpless: !!def.helpless, counter: def.counter || null };
  }

  // Knockback travel (px) of a launch, ignoring gravity: v0 = kb*0.15, decel 0.255/frame.
  function travel(kb) { const v = kb * 0.15; return (v * v) / (2 * 0.255); }
  function launchVec(angleDeg, dir, kb) {
    let a = angleDeg === 361 ? (kb < 32 ? 0 : 40) : angleDeg;
    a *= DEG; if (dir < 0) a = Math.PI - a;
    return { ux: Math.cos(a), uy: -Math.sin(a) };
  }

  class Brain {
    constructor(f, level, g) {
      this.f = f;
      this.level = clamp(Math.round(level) || 2, 1, 3);
      this.L = LEVELS[this.level];
      this.hints = (f.def && f.def.ai) || {};
      this.t = 0;
      this.seq = [];
      this.target = null;
      this.nextDecide = 0;
      this.threats = new Map();
      this.mode = null; this.modeUntil = 0;
      this.lastState = null; this.stateEnter = 0;
      this.cool = {};
      this.recent = [];
      this.shieldHold = 0;
      this.ledgePlan = null;
      this.grabPlan = null;
      this.diFor = null; this.diOn = false;
      this.techFor = null; this.techOn = false;
      this.respawnWait = 0;
      this.err = false;
    }

    rng() { return this.g.rng(); }
    ri(a, b) { return this.g.rng.int(a, b); }

    // ------------------------------------------------------------ main entry
    think(g, pad) {
      const f = this.f;
      this.g = g;
      this.t++;
      pad.x = 0; pad.y = 0; pad.a = pad.b = pad.j = pad.s = false;
      // Engine workaround: finishAiPad() treats tx/ty === 0 and dash === true left over from the previous tick as
      // "force again", so they would stay stuck forever. Clear them; we re-force explicitly when we want them.
      pad.dash = false;
      if (pad.tx === 0) pad.tx = 1;
      if (pad.ty === 0) pad.ty = 1;
      if (f.out || f.state === "dead") { this.seq.length = 0; this.mode = null; return; }
      if (f.state !== this.lastState) { this.lastState = f.state; this.stateEnter = this.t; }
      try {
        this.geo(g);
        this.pickTarget(g);
        this.act(g, pad);
      } catch (e) {
        if (!this.err) { this.err = true; console.error("AI error", e); }
      }
      pad.x = clamp(pad.x, -1, 1); pad.y = clamp(pad.y, -1, 1);
      if (this.t % 120 === 0) for (const [k, v] of this.threats) if (this.t - v.seen > 180) this.threats.delete(k);
    }

    // ------------------------------------------------------------ world model
    geo(g) {
      const plats = g.platforms;
      let solids = plats.filter((P) => P.solid);
      if (!solids.length) solids = plats;
      this.solids = solids;
      let x1 = Infinity, x2 = -Infinity, top = Infinity;
      for (const P of solids) { x1 = Math.min(x1, P.x1); x2 = Math.max(x2, P.x2); top = Math.min(top, P.y); }
      this.stageX1 = x1; this.stageX2 = x2; this.stageTop = top;
      this.B = g.stage.blast;
    }
    // highest platform whose top is at/below (x, y)
    groundBelow(x, y, pad = 0) {
      let best = null;
      for (const P of this.g.platforms) {
        if (x < P.x1 - pad || x > P.x2 + pad) continue;
        if (P.y < y - 2) continue;
        if (!best || P.y < best.y) best = P;
      }
      return best;
    }
    overGround(fx, fy) {
      const P = this.groundBelow(fx, fy);
      return !!P && P.y < this.B.bottom - 40;
    }
    // solid platform the fighter is tucked under (would hit its underside)
    underSolid(f) {
      for (const P of this.solids) {
        if (!P.solid) continue;
        if (f.x + f.w / 2 > P.x1 && f.x - f.w / 2 < P.x2 && f.y > P.y + 2) return P;
      }
      return null;
    }
    pickTarget(g) {
      const f = this.f;
      let best = null, bs = Infinity, cur = null;
      for (const o of g.fighters) {
        if (o === f || o.out || o.state === "dead") continue;
        let s = Math.hypot(o.x - f.x, (o.y - f.y) * 1.3);
        if (o.state === "respawn") s += 500;
        if (o.invuln > 30) s += 150;
        if (o === this.target) cur = s;
        if (s < bs) { bs = s; best = o; }
      }
      if (cur != null && cur < bs * 1.3 + 40) return;
      this.target = best;
    }
    // where a fighter will be in k frames (rough)
    predict(o, k) {
      k = Math.min(k, 24);
      const vx = (o.vx || 0) + (o.kbx || 0);
      if (o.grounded || o.state === "ledge" || o.state === "grabbed" || o.state === "respawn") {
        let x = o.x + vx * k * 0.7;
        if (o.plat) x = clamp(x, o.plat.x1, o.plat.x2);
        return { x, y: o.y };
      }
      const gr = o.stats.gravity || 0.5;
      const vy = (o.vy || 0) + (o.kby || 0);
      let y = o.y + vy * k + 0.5 * gr * k * k * (o.state === "hitstun" ? 0.6 : 1);
      const P = this.groundBelow(o.x, o.y);
      if (P && y > P.y) y = P.y;
      return { x: o.x + vx * k, y };
    }
    rectAt(o, x, y) {
      const h = o.crouching ? o.h * 0.62 : o.h;
      return { x1: x - o.w / 2, x2: x + o.w / 2, y1: y - h, y2: y };
    }
    // fraction of a KO: >= 1 means the launch reaches a blast zone
    killRatio(T, angleDeg, dir, kb, tx, ty) {
      const B = this.B;
      const { ux, uy } = launchVec(angleDeg, dir, kb);
      const cx = tx, cy = ty - T.h / 2;
      let d = Infinity;
      if (ux > 0.05) d = Math.min(d, (B.right - cx) / ux);
      if (ux < -0.05) d = Math.min(d, (B.left - cx) / ux);
      if (uy < -0.05) d = Math.min(d, (B.top - cy) / uy * 1.25);   // gravity fights vertical launches
      if (uy > 0.05) {
        if (this.groundBelow(tx, ty)) return 0;                    // spiked into the floor = bounce
        d = Math.min(d, (B.bottom - cy) / uy * 0.6);              // spikes offstage are deadly
      }
      if (!isFinite(d) || d <= 0) return 0;
      return travel(kb) / d;
    }

    // ------------------------------------------------------------ sequences (scripted inputs)
    // step: { n, x, y, a, b, j, s, tx0, ty0, dash, press }
    runSeq(pad) {
      const f = this.f;
      while (this.seq.length) {
        const st = this.seq[0];
        if (st.press && !st._go) {
          if (f.prev[st.press]) { return true; }   // release a tick so the press registers as an edge
          st._go = true;
        }
        pad.x = st.x || 0; pad.y = st.y || 0;
        pad.a = !!st.a; pad.b = !!st.b; pad.j = !!st.j; pad.s = !!st.s;
        if (st.press) pad[st.press] = true;
        if (st.tx0) pad.tx = 0;
        if (st.ty0) pad.ty = 0;
        if (st.dash) pad.dash = true;
        if (--st.n <= 0) this.seq.shift();
        else st.press = null;   // later ticks of a press step keep the stick but release the button
        return true;
      }
      return false;
    }

    // input recipe for a named move (d = desired facing)
    perform(name, d, air, opts = {}) {
      const f = this.f;
      const step = { n: 1, press: "a" };
      switch (name) {
        case "jab": case "nair": break;
        case "ftilt": step.x = 0.6 * d; break;
        case "utilt": case "uair": step.y = -0.6; break;
        case "dtilt": case "dair": step.y = 0.6; break;
        case "fair": step.x = 0.6 * f.facing; break;
        case "bair": step.x = -0.6 * f.facing; break;
        case "fsmash": step.x = d; step.tx0 = 1; break;
        case "usmash": step.y = -1; step.ty0 = 1; break;
        case "dsmash": step.y = 1; step.ty0 = 1; break;
        case "dash": step.x = d; break;
        case "grab": step.s = true; break;
        case "nspecial": step.press = "b"; break;
        case "sspecial": step.press = "b"; step.x = d; break;
        case "dspecial": step.press = "b"; step.y = 1; break;
        case "uspecial": step.press = "b"; step.y = -1; step.x = 0.4 * d; break;
      }
      const seq = [step];
      if (SMASHES[name] && opts.charge > 0) {
        const def = f.moves[name];
        const n = (def && def.charge ? def.charge : 4) + opts.charge;
        // keep the stick & attack held through the charge
        seq.push({ n, a: true, x: step.x && sign(step.x) * 0.5, y: step.y && sign(step.y) * 0.5 });
      }
      if (name === "grab") seq.push({ n: 1 });
      this.seq = seq;
      this.recent.push(name); if (this.recent.length > 6) this.recent.shift();
    }

    // ------------------------------------------------------------ dispatcher
    act(g, pad) {
      const f = this.f, s = f.state;
      if (s !== "grabbing" && !(s === "attack" && f.grabbed)) this.grabPlan = null;
      if (s === "hitstun") { this.seq.length = 0; this.mode = null; this.hitstun(g, pad); return; }
      if (s === "grabbed") { this.seq.length = 0; this.mash(pad); return; }
      if (s === "grabbing") { this.seq.length = 0; this.grabbing(g, pad); return; }
      if (s === "ledge") { this.seq.length = 0; this.ledge(g, pad); return; }
      if (s === "respawn") { this.seq.length = 0; this.respawn(pad); return; }
      if (s === "down") { this.seq.length = 0; this.down(g, pad); return; }
      if (s === "shield" && !this.seq.length) { this.shield(g, pad); return; }
      if (this.seq.length && this.runSeq(pad)) {
        // never let a scripted input carry us off the stage while airborne
        if (!f.grounded && !this.overGround(f.x, f.y)) pad.x = this.towardStage(f);
        return;
      }
      if (STILL.includes(s)) return;
      const danger = !f.grounded && !this.overGround(f.x, f.y);
      if (s === "attack") { this.during(g, pad, danger); return; }
      if (s === "jumpsquat") { if (this.fullHop) pad.j = true; return; }
      if (s === "helpless" || s === "airdodge") { this.steerSafe(pad); return; }
      if (danger) { this.recover(g, pad); return; }
      if (f.grounded) this.ground(g, pad); else this.air(g, pad);
    }

    towardStage(f) {
      if (f.x < this.stageX1 + 30) return 1;
      if (f.x > this.stageX2 - 30) return -1;
      const P = this.underSolid(f);
      if (P) return f.x < (P.x1 + P.x2) / 2 ? -1 : 1;
      return 0;
    }

    // ------------------------------------------------------------ hitstun: DI + tech
    hitstun(g, pad) {
      const f = this.f;
      if (f.hitlag > 0 && f.pendingLaunch) {
        if (this.diFor !== f.pendingLaunch) { this.diFor = f.pendingLaunch; this.diOn = this.rng() < this.L.di; }
        if (this.diOn) { const d = this.bestDI(f.pendingLaunch); pad.x = d.x; pad.y = d.y; }
        return;
      }
      // tech: press shield shortly before hitting the ground while tumbling
      if (f.tumble && !f.grounded && f.techLock === 0 && !f.prev.s) {
        const k = this.framesToLand(f, 12);
        if (k != null && k <= (this.level === 3 ? 7 : 5)) {
          const key = f.lastHitAt;
          if (this.techFor !== key) { this.techFor = key; this.techOn = this.rng() < this.L.tech; }
          if (this.techOn) pad.s = true;
        }
      }
      // hold toward the stage (does nothing in hitstun, but primes the stick)
      if (!this.overGround(f.x, f.y)) pad.x = this.towardStage(f) * 0.5;
    }
    // Survival DI: try the launch angle rotated each way and keep the one that stays furthest from a blast zone.
    bestDI(L) {
      const f = this.f, B = this.B;
      const gr = f.stats.gravity, cap = f.stats.fallSpeed;
      const sim = (ang) => {
        const sp = L.kb * 0.15;
        let kx = Math.cos(ang) * sp, ky = -Math.sin(ang) * sp, vy = 0, x = f.x, y = f.y, m = Infinity;
        for (let i = 0; i < 90; i++) {
          const s2 = Math.hypot(kx, ky), ns = Math.max(0, s2 - 0.255);
          if (s2 > 0) { kx *= ns / s2; ky *= ns / s2; }
          vy = Math.min(cap, vy + gr);
          x += kx; y += vy + ky;
          m = Math.min(m, x - B.left, B.right - x, (y - f.h) - B.top, B.bottom - y);
          if (ns === 0 && i > 30) break;
        }
        return m;
      };
      const a = L.angle, lx = Math.cos(a), ly = -Math.sin(a);
      const opts = [{ x: -ly, y: lx, m: sim(a - 18 * DEG) }, { x: ly, y: -lx, m: sim(a + 18 * DEG) }];
      const o = opts[0].m >= opts[1].m ? opts[0] : opts[1];
      return { x: o.x, y: o.y };
    }
    framesToLand(f, n) {
      let x = f.x, y = f.y, vy = f.vy, kx = f.kbx, ky = f.kby;
      const gr = f.stats.gravity, cap = f.stats.fallSpeed;
      for (let k = 1; k <= n; k++) {
        const s2 = Math.hypot(kx, ky), ns = Math.max(0, s2 - 0.255);
        if (s2 > 0) { kx *= ns / s2; ky *= ns / s2; }
        if (vy < cap) vy = Math.min(cap, vy + gr);
        const py = y;
        x += f.vx + kx; y += vy + ky;
        if (vy + ky < 0) continue;
        for (const P of this.g.platforms) if (py <= P.y + 0.5 && y >= P.y && x >= P.x1 && x <= P.x2) return k;
      }
      return null;
    }

    mash(pad) {
      if (this.rng() >= this.L.mash) return;
      const k = this.t % 3;
      pad[k === 0 ? "a" : k === 1 ? "b" : "j"] = true;
      pad.x = this.t % 2 ? 1 : -1;
    }

    // ------------------------------------------------------------ throws
    grabbing(g, pad) {
      const f = this.f, T = f.grabbed;
      if (!T || f.stateFrame < 6) return;
      if (!this.grabPlan || this.grabPlan.T !== T) {
        const pm = T.damage < 90 ? this.ri(0, this.level) : 0;
        this.grabPlan = { T, pummels: pm, wait: this.ri(2, 10) };
      }
      const P = this.grabPlan;
      if (P.wait > 0) { P.wait--; return; }
      if (P.pummels > 0 && f.moves.pummel && f.grabTimer > 40) {
        if (!f.prev.a) { pad.a = true; P.pummels--; P.wait = 4; }
        return;
      }
      // pick the throw: kill if possible, otherwise toward the nearest edge, else most damage
      let best = null, bs = -Infinity;
      const nearestEdgeDir = (f.x - this.stageX1) < (this.stageX2 - f.x) ? -1 : 1;
      for (const n of THROWS) {
        const m = f.moves[n]; const th = m && m.throwHit;
        if (!th) continue;
        const dir = f.facing;   // throw angles are relative to the facing at grab time (bthrow angles point backward)
        const kb = S.knockback(T.damage + th.dmg, th.dmg, T.stats.weight, th.bkb, th.kbg);
        const kr = this.killRatio(T, th.angle, dir, kb, T.x, T.y);
        const lv = launchVec(th.angle, dir, kb);
        let sc = (kr >= 1 ? 80 : kr * 30) + th.dmg + this.rng() * this.L.noise;
        if (Math.abs(lv.ux) > 0.3 && sign(lv.ux) === nearestEdgeDir) sc += 8;
        if (sc > bs) { bs = sc; best = n; }
      }
      if (!best) return;
      if (best === "fthrow") pad.x = f.facing;
      else if (best === "bthrow") pad.x = -f.facing;
      else if (best === "uthrow") pad.y = -1;
      else pad.y = 1;
    }

    // ------------------------------------------------------------ ledge
    ledge(g, pad) {
      const f = this.f, Lg = f.ledge;
      if (!Lg) return;
      const inward = -Lg.side;
      if (!this.ledgePlan || this.ledgePlan.at !== this.stateEnter) {
        const T = this.target;
        const near = T && Math.abs(T.x - Lg.x) < 110 && Math.abs(T.y - Lg.plat.y) < 60;
        const r = this.rng();
        let opt = r < 0.4 ? "climb" : r < 0.7 ? "jump" : r < 0.85 ? "roll" : "attack";
        if (near && this.rng() < 0.5) opt = this.rng() < 0.5 ? "attack" : "roll";
        if (this.level === 1 && opt === "roll") opt = "climb";
        this.ledgePlan = { at: this.stateEnter, wait: this.ri(this.L.ledgeWait[0], this.L.ledgeWait[1]), opt };
      }
      const P = this.ledgePlan;
      if (this.t - this.stateEnter < Math.max(9, P.wait) && f.stateFrame < 240) return;
      switch (P.opt) {
        case "climb": pad.x = inward; break;
        case "jump": if (!f.prev.j) pad.j = true; pad.x = inward * 0.6; break;
        case "roll": if (!f.prev.s) pad.s = true; break;
        case "attack": if (!f.prev.a) pad.a = true; break;
      }
    }

    respawn(pad) {
      const f = this.f;
      if (this.t - this.stateEnter === 0 || !this.respawnWait) this.respawnWait = this.ri(20, 80);
      if (this.t - this.stateEnter >= this.respawnWait) {
        const T = this.target;
        pad.x = (T ? sign(T.x - f.x) || 1 : 1) * 0.7;
      }
    }

    down(g, pad) {
      const f = this.f;
      if (f.stateFrame < 13 + this.ri(0, this.L.react)) return;
      const T = this.target;
      const r = this.rng();
      if (T && Math.abs(T.x - f.x) < 80 && r < 0.45) pad.a = true;
      else if (r < 0.75) { const c = (this.stageX1 + this.stageX2) / 2; pad.x = sign(c - f.x) || 1; }
      else pad.y = -1;
    }

    // ------------------------------------------------------------ during an attack
    during(g, pad, danger) {
      const f = this.f, T = this.target;
      if (f.grounded) return;
      if (danger) { pad.x = this.towardStage(f) || (f.x < (this.stageX1 + this.stageX2) / 2 ? 1 : -1); return; }
      // airborne over the stage: drift toward the target but stay above ground
      if (T) {
        const want = this.clampStage(T.x);
        if (Math.abs(want - f.x) > 12) pad.x = sign(want - f.x);
      }
      if (!this.overGround(f.x + f.vx * 12, f.y + 60)) pad.x = this.towardCenter(f);
    }
    clampStage(x) { return clamp(x, this.stageX1 + 30, this.stageX2 - 30); }
    towardCenter(f) { return sign((this.stageX1 + this.stageX2) / 2 - f.x) || 1; }

    steerSafe(pad) {
      const f = this.f;
      if (!this.overGround(f.x, f.y) || !this.overGround(f.x + f.vx * 10, f.y)) { pad.x = this.towardStage(f) || this.towardCenter(f); return; }
      const T = this.target;
      if (T) { const w = this.clampStage(T.x); if (Math.abs(w - f.x) > 20) pad.x = sign(w - f.x) * 0.8; }
    }

    // ------------------------------------------------------------ recovery
    recover(g, pad) {
      const f = this.f;
      this.mode = null;
      const st = f.stats;
      // pick a ledge (or the nearest stage edge)
      let L = null, ld = Infinity;
      for (const lg of g.ledges) {
        const d = Math.abs(lg.x - f.x) + Math.abs(lg.plat.y - f.y) * 0.5 + (lg.owner && lg.owner !== f ? 250 : 0);
        if (d < ld) { ld = d; L = lg; }
      }
      let tx, ty;
      if (L) { tx = L.x; ty = L.plat.y; }
      else {
        // no ledges: aim for the nearest platform end
        let best = null, bd = Infinity;
        for (const P of g.platforms) for (const ex of [P.x1 + 20, P.x2 - 20]) { const d = Math.abs(ex - f.x) + Math.abs(P.y - f.y) * 0.5; if (d < bd) { bd = d; best = { x: ex, y: P.y }; } }
        tx = best ? best.x : 0; ty = best ? best.y : 0;
      }
      const under = this.underSolid(f);
      let dir;
      if (under) dir = (f.x - under.x1) < (under.x2 - f.x) ? -1 : 1;   // get out from under the stage first
      else dir = sign(tx - f.x) || (L ? -L.side : 1);
      if (L && !under) {
        // past the ledge horizontally? head inward
        if ((L.side < 0 && f.x < L.x) || (L.side > 0 && f.x > L.x)) dir = -L.side;
      }
      pad.x = dir;
      const dx = Math.abs(tx - f.x);
      const below = f.y - ty;                     // >0: feet below ledge level
      const lowBias = this.L.lowRecover;
      const deep = f.y > this.B.bottom - 260;
      if (f.state !== "air" && f.state !== "tumble") return;
      if (f.prev.j || f.prev.b) return;            // let buttons release between presses
      if (under && !deep) return;                  // jumping now would bonk the underside
      // 1) double jump
      if (f.jumpsLeft > 0) {
        const early = dx > 330 ? -160 : -25;
        if ((f.vy > -1 && below > early + lowBias) || below > 140 || deep) { pad.j = true; return; }
        return;
      }
      // 2) side special when far away horizontally
      const sideFirst = this.hints.recover === "sspecial";
      if (!f.usedSide && f.moves.sspecial && (dx > 320 || (sideFirst && dx > 140)) && below < 260 && f.vy > -2) {
        pad.x = dir; pad.y = 0; pad.b = true; return;
      }
      // 3) up special toward the ledge
      if (!f.usedUp && f.moves.uspecial) {
        if ((f.vy > 0 && below > -15 + lowBias) || (below > 110 && f.vy > -3) || deep) {
          pad.y = -1; pad.x = dir * 0.45; pad.b = true; return;
        }
        return;
      }
      // 4) last resort: air dodge toward the ledge
      if (L && !f.airdodged && !f.prev.s) {
        const hx = L.x + L.side * (f.w / 2 - 6), hy = L.plat.y + f.h * 0.62 - 10;   // where the hang snaps
        const ddx = hx - f.x, ddy = hy - f.y, m = Math.hypot(ddx, ddy) || 1;
        if (ddy < -10 && m < 100) { pad.x = ddx / m; pad.y = ddy / m; pad.s = true; }
      }
    }

    // ------------------------------------------------------------ threats & defence
    scanThreat(g) {
      const f = this.f, hb = f.hurtbox();
      const R = { x1: hb.x1 - 6, x2: hb.x2 + 6, y1: hb.y1 - 6, y2: hb.y2 + 2 };
      let best = null;
      for (const O of g.fighters) {
        if (O === f || O.out || O.state !== "attack" || !O.move) continue;
        const boxes = boxesOf(O.move, O);
        for (const b of boxes) {
          if (b.grab || (b.end || 0) < O.mf + 1) continue;
          const dt = Math.max(1, (b.start || 1) - O.mf);
          if (dt > 16) continue;
          const bx = O.x + (O.vx + O.kbx) * dt + b.x * O.facing, by = O.y + (O.grounded ? 0 : O.vy * dt) + b.y;
          if (S.circleRect(bx, by, b.r + 6, R)) { if (!best || dt < best.t) best = { t: dt, key: O.moveId, src: O }; }
        }
      }
      for (const p of g.projectiles) {
        if (p.owner === f || p.harmless || p.dead) continue;
        for (let k = 1; k <= 14; k++) {
          const px = p.x + p.vx * k, py = p.y + p.vy * k + 0.5 * (p.gravity || 0) * k * k;
          if (S.circleRect(px, py, p.r + 4, R)) { if (!best || k < best.t) best = { t: k, key: p, src: p.owner, proj: true }; break; }
        }
      }
      return best;
    }
    // returns true when the threat is "noticed" and we decided to defend against it
    shouldDefend(th) {
      let rec = this.threats.get(th.key);
      if (!rec) { rec = { seen: this.t, roll: this.rng(), choice: this.rng() }; this.threats.set(th.key, rec); }
      if (this.t - rec.seen < this.L.react && th.t > 1) return null;
      if (this.t - rec.seen < this.L.react) return null;
      return rec.roll < this.L.defend ? rec : null;
    }
    defend(g, pad) {
      const f = this.f;
      const th = this.scanThreat(g);
      if (!th) return false;
      const rec = this.shouldDefend(th);
      if (!rec) return false;
      // counter moves (def.counter) when the hit lands inside the window
      if (this.level >= 2 && !th.proj && rec.choice > 0.85) {
        for (const n of ["dspecial", "nspecial", "sspecial"]) {
          const m = f.moves[n];
          if (m && m.counter && th.t >= m.counter[0] && th.t <= m.counter[1]) { this.perform(n, f.facing, false); this.runSeq(pad); return true; }
        }
      }
      if (rec.choice < this.L.dodge && th.t >= 2) {
        this.seq = [{ n: 1, s: true }, { n: 1, s: true, y: 1, ty0: 1 }];
        this.runSeq(pad); return true;
      }
      pad.s = true; this.shieldHold = th.t + 4;
      return true;
    }
    shield(g, pad) {
      const f = this.f, T = this.target;
      const th = this.scanThreat(g);
      if (this.shieldHold > 0) this.shieldHold--;
      const keep = (th && this.threats.get(th.key)) || this.shieldHold > 0 || f.shieldStun > 0;
      if (keep && f.shieldHP > 12) { pad.s = true; return; }
      // out of shield punish
      if (T && this.rng() < this.L.punish) {
        const gi = info(f, "grab", false);
        const rng = gi ? gi.reachX + T.w / 2 : 50;
        if (Math.abs(T.x - f.x) < rng && Math.abs(T.y - f.y) < 30 && sign(T.x - f.x) === f.facing && T.grounded) {
          pad.s = true; if (!f.prev.a) pad.a = true; return;
        }
        if (Math.abs(T.x - f.x) < 110 && T.y < f.y - 20 && !f.prev.j) {   // jump out of shield toward an airborne foe
          pad.j = true; this.fullHop = true; this.mode = "aerial"; this.modeUntil = this.t + 45; return;
        }
      }
      pad.s = false;
    }

    // ------------------------------------------------------------ grounded neutral
    ground(g, pad) {
      const f = this.f, T = this.target;
      this.fullHop = false;
      if (this.mode && this.t > this.modeUntil) this.mode = null;
      if (f.state === "skid" || f.state === "idle" || f.state === "walk" || f.state === "crouch" || f.state === "dash" || f.state === "run") {
        if (this.defend(g, pad)) return;
      }
      if (!T) { this.walkTo((this.stageX1 + this.stageX2) / 2, pad); return; }
      if (this.t >= this.nextDecide) {
        this.nextDecide = this.t + this.L.interval + this.ri(0, 2);
        if (this.rng() >= this.L.skip) {
          const plan = this.chooseGround(g);
          if (plan) { plan(); this.runSeq(pad); return; }
        }
      }
      this.navigate(g, pad);
    }

    // try every ground option against the predicted target position; returns a closure that queues the inputs
    chooseGround(g) {
      const f = this.f, T = this.target;
      if (!T || T.state === "respawn") return null;
      const dx = T.x - f.x, dy = T.y - f.y, adx = Math.abs(dx);
      const d = sign(dx) || f.facing;
      const running = f.state === "dash" || f.state === "run";
      const P = f.plat;
      const edgeRoom = P ? (d > 0 ? P.x2 - f.x : f.x - P.x1) : 999;
      const tShield = T.state === "shield";
      const tVuln = ["land", "down", "dizzy", "helpless", "tech", "getup", "ledgeclimb"].includes(T.state) || (T.state === "attack" && T.move && T.mf > this.activeEnd(T)) || T.hitstun > 8;
      const lvl = this.L;
      let best = null, bs = -Infinity;
      let bestName = null;
      const consider = (name, sc, fn) => { sc += this.rng() * lvl.noise; if (sc > bs) { bs = sc; best = fn; bestName = name; } };

      if (T.invuln > 4 && T.state !== "ledge") { /* wait it out, maybe shield-bait */ }
      else {
        const names = running ? ["dash", "grab", "usmash"] : GROUND_MOVES;
        for (const name of names) {
          if (this.cool[name] > this.t) continue;
          const I = info(f, name, false);
          if (!I || !I.boxes.length) continue;
          if (I.grab && (!T.grounded || T.state === "ledge")) continue;
          if (name === "uspecial" && (edgeRoom < 160 || dy > -40)) continue;
          if (SPECIALS[name] && (edgeRoom < 150 || this.edgeDist(f) < 150) && !I.boxes.every((b) => Math.abs(b.x) < 60)) continue;
          if (name === "sspecial" && edgeRoom < 240) continue;
          if (name === "dash" && edgeRoom < 150) continue;
          const face = TURNS[name] || name === "dash" ? d : f.facing;
          const k = I.startup;
          const p = this.predict(T, k);
          let mx = f.x;
          if (name === "dash") mx += f.facing * Math.abs(f.vx) * Math.min(k, 10);
          const R = this.rectAt(T, p.x, p.y);
          let hitBox = null;
          for (const b of I.boxes) {
            if (S.circleRect(mx + b.x * face, f.y + b.y, b.r + 2, R)) { hitBox = b; break; }
          }
          if (!hitBox) continue;
          const hb = I.best || hitBox;
          let sc;
          if (I.grab) {
            sc = tShield ? 40 : 13 + (T.damage > 90 ? 5 : 0) + (this.level === 1 ? -6 : 0);
          } else {
            const kb = S.knockback(T.damage + (hb.dmg || 0), hb.dmg || 0, T.stats.weight, hb.bkb || 0, hb.kbg || 0) * (hb.kbMult || 1);
            const kr = this.killRatio(T, hb.angle || 0, face, kb, p.x, p.y);
            sc = (hb.dmg || 0) + (kr >= 1 ? 45 : kr * 14);
            if (this.hints.killMoves && this.hints.killMoves.includes(name) && kr > 0.6) sc += 12;
            if (tShield) sc -= 18;
          }
          sc -= k * (tVuln ? 0.25 : 1.1);
          sc -= (I.frames - I.end) * (tVuln ? 0.02 : 0.2);
          if (SMASHES[name] && !tVuln) sc -= 3;
          sc -= this.recent.filter((r) => r === name).length * 2.5;
          if (SPECIALS[name]) sc -= 3;
          const charge = SMASHES[name] && tVuln && this.rng() < lvl.charge ? this.ri(4, 18) : 0;
          consider(name, sc, () => {
            if (face !== f.facing && !TURNS[name] && name !== "dash") return this.turnThen(name, face);
            this.perform(name, face, false, { charge });
          });
        }
      }
      // short hop / jump into an aerial
      if (!running || true) {
        const gap = adx - (f.w + T.w) / 2;
        if (gap < 190 && gap > 10 && dy > -110 && dy < 40 && edgeRoom > 120 && this.rng() < lvl.hop * 2) {
          consider("hop", 7 + (tShield ? 6 : 0), () => this.hop(d, false));
        }
        if (dy < -90 && adx < 140 && T.state !== "ledge" && this.rng() < lvl.chase) {
          consider("jump", 9, () => this.hop(d, true));
        }
      }
      const rangedName = this.rangedMove();
      // "blind" specials: moves whose hitboxes we can't predict (buffs, traps, command grabs, spawned effects).
      // Use them now and then at close/mid range so every special gets some play.
      if (!running && T.invuln <= 4) {
        for (const name of ["nspecial", "sspecial", "dspecial"]) {
          if (this.cool[name] > this.t || !f.moves[name]) continue;
          const I = info(f, name, false);
          if (I && I.boxes.length && !I.counter) continue;        // predictable ones are scored above
          if (I && I.counter) continue;                            // counters are used defensively
          if (name === "sspecial" && edgeRoom < 240) continue;
          if (this.edgeDist(f) < 110) continue;
          const kill = this.hints.killMoves && this.hints.killMoves.includes(name);
          const range = name === "nspecial" && rangedName ? 999 : 150;
          if (adx > range || Math.abs(dy) > 90) continue;
          if (this.rng() > (kill ? 0.35 : 0.22)) continue;
          consider(name, 6 + (kill && T.damage > 80 ? 10 : 0) + (adx < 70 ? 3 : 0), () => {
            this.cool[name] = this.t + this.ri(90, 200);
            if (f.facing !== d && name !== "sspecial") return this.turnThen(name, d);
            this.perform(name, d, false);
          });
        }
      }
      // projectile / ranged special
      if (rangedName && adx > 170 && Math.abs(dy) < 90 && !(this.cool.ranged > this.t) && this.rng() < lvl.ranged * 2) {
        consider(rangedName, 9, () => {
          this.cool.ranged = this.t + this.ri(50, 120);
          if (f.facing !== d && rangedName !== "sspecial") return this.turnThen(rangedName, d);
          this.perform(rangedName, d, false);
        });
      }
      // don't always fish with a smash at max range: sometimes walk in for a tilt / grab instead
      if (best && bestName && SMASHES[bestName] && !tVuln && this.level >= 2 && this.rng() < 0.35) return null;
      // easy CPUs sometimes just swing at nothing
      if (!best && adx < 140 && this.rng() < lvl.whiff) {
        const n = ["jab", "ftilt", "fsmash", "dtilt"][this.ri(0, 3)];
        return () => this.perform(n, d, false);
      }
      return best;
    }
    rangedMove() {
      const f = this.f;
      if (this.hints.ranged) return typeof this.hints.ranged === "string" ? this.hints.ranged : "nspecial";
      const m = f.moves.nspecial;
      if (m && !boxesOf(m, f).length && !m.counter && !m.helpless) return "nspecial";   // probably spawns a projectile
      return null;
    }
    activeEnd(O) {
      let e = 0; for (const b of boxesOf(O.move, O)) e = Math.max(e, b.end || 0); return e;
    }
    edgeDist(f) {
      const P = f.plat; if (!P || !P.solid) return 999;
      return Math.min(f.x - P.x1, P.x2 - f.x);
    }
    turnThen(name, face) {
      this.seq = [{ n: 1, x: 0.3 * face }, { n: 1 }];
      const keep = this.seq;
      this.perform(name, face, false);
      this.seq = keep.concat(this.seq);
    }
    hop(d, full) {
      const f = this.f, js = f.stats.jumpsquat || 4;
      this.fullHop = full;
      this.seq = [{ n: 1, press: "j", x: 0.5 * d, j: false }, { n: js + 1, x: 0.5 * d, j: full }];
      this.mode = "aerial"; this.modeUntil = this.t + js + 60;
    }

    // ------------------------------------------------------------ moving around on the ground
    navigate(g, pad) {
      const f = this.f, T = this.target, P = f.plat;
      let want = T.x;
      const tOff = !this.overGround(T.x, T.y) || T.state === "ledge";
      if (T.state === "respawn") want = clamp(T.x, this.stageX1 + 120, this.stageX2 - 120) + (f.x < T.x ? -90 : 90);
      else if (tOff) {
        // edge-guard: wait near the edge the target is coming back to
        const side = T.x < (this.stageX1 + this.stageX2) / 2 ? -1 : 1;
        want = side < 0 ? this.stageX1 + 40 + (this.level === 1 ? 60 : 0) : this.stageX2 - 40 - (this.level === 1 ? 60 : 0);
      } else want = T.x - sign(T.x - f.x) * Math.min(18, Math.abs(T.x - f.x));
      // platforms: follow the target up / down
      if (!tOff && T.state !== "respawn" && P) {
        const dy = T.y - f.y;
        if (dy < -60 && T.grounded && T.plat !== P) {
          const TP = T.plat;
          if (f.x > TP.x1 + 10 && f.x < TP.x2 - 10 && this.canAct()) { this.hop(sign(T.x - f.x) || f.facing, true); this.runSeq(pad); return; }
          want = clamp(f.x, TP.x1 + 25, TP.x2 - 25);
        } else if (dy > 50 && P.pass && (T.grounded || dy > 120)) {
          if (["idle", "walk", "crouch"].includes(f.state)) { pad.y = 1; pad.ty = 0; return; }
        }
      }
      // stay on our platform (solid ones: never walk off; pass ones: drop when the target is below)
      if (P) {
        const m = P.solid ? 40 : 15;
        want = clamp(want, P.x1 + m, P.x2 - m);
      }
      this.walkTo(want, pad);
    }
    canAct() { const s = this.f.state; return s === "idle" || s === "walk" || s === "crouch" || s === "skid"; }
    walkTo(want, pad) {
      const f = this.f, T = this.target, P = f.plat;
      const dist = want - f.x, adist = Math.abs(dist), d = sign(dist);
      const room = P ? (d > 0 ? P.x2 - f.x : f.x - P.x1) : 999;
      const roomOK = !P || !P.solid ? room > 140 : room > 180;
      if (f.state === "dash" || f.state === "run") {
        if (adist > 70 && room > 110 && d === f.facing) pad.x = d; else pad.x = 0;
        return;
      }
      if (adist < 10) {
        if (T && Math.abs(T.x - f.x) > 12 && sign(T.x - f.x) !== f.facing && (f.state === "idle" || f.state === "walk")) pad.x = 0.3 * sign(T.x - f.x);
        return;
      }
      if (adist > 150 && roomOK && f.state !== "skid") { pad.x = d; pad.dash = f.state !== "walk"; return; }
      pad.x = Math.min(0.75, 0.3 + adist / 120) * d;
    }

    // ------------------------------------------------------------ airborne over the stage
    air(g, pad) {
      const f = this.f, T = this.target;
      if (this.mode && this.t > this.modeUntil) this.mode = null;
      if (!T) { pad.x = this.towardCenter(f) * 0.5; return; }
      const dx = T.x - f.x, dy = T.y - f.y;
      // aerial attack when something connects
      const decide = this.mode === "aerial" ? true : this.t >= this.nextDecide;
      if (decide && !f.prev.a) {
        if (this.mode !== "aerial") this.nextDecide = this.t + this.L.interval;
        const a = this.chooseAir(g);
        if (a) { this.mode = null; a(); this.runSeq(pad); if (!this.overGround(f.x + f.vx * 15, f.y + 80)) pad.x = this.towardCenter(f); return; }
      }
      // drift toward target, but keep above ground
      const want = this.clampStage(T.x);
      if (Math.abs(want - f.x) > 10) pad.x = sign(want - f.x);
      if (!this.overGround(f.x + f.vx * 14 + pad.x * 20, f.y + 100)) pad.x = this.towardCenter(f);
      // chase upward with the double jump
      if (f.jumpsLeft > 0 && dy < -90 && Math.abs(dx) < 140 && f.vy > -2 && !f.prev.j && this.level >= 2 && this.rng() < 0.08 * this.L.chase * 2) {
        pad.j = true; this.mode = "aerial"; this.modeUntil = this.t + 40; return;
      }
      // fast fall when the target is below and we're not attacking
      if (f.vy > 0 && !f.fastfall && dy > 40 && this.mode !== "aerial" && this.level >= 2 && this.rng() < 0.3) {
        pad.y = 1; pad.ty = 0;
      }
    }
    chooseAir(g) {
      const f = this.f, T = this.target;
      if (!T || T.state === "respawn" || T.invuln > 3) return null;
      let best = null, bs = -Infinity;
      for (const name of AIR_MOVES) {
        if (SPECIALS[name]) { if (this.level < 2 || this.rng() < 0.7) continue; if (name === "sspecial" && f.usedSide) continue; }
        const I = info(f, name, true);
        if (!I || !I.boxes.length || I.grab) continue;
        const k = I.startup;
        const p = this.predict(T, k), me = this.predict(f, k);
        const R = this.rectAt(T, p.x, p.y);
        let hb = null;
        for (const b of I.boxes) if (S.circleRect(me.x + b.x * f.facing, me.y + b.y, b.r + 3, R)) { hb = b; break; }
        if (!hb) continue;
        const B = I.best || hb;
        const kb = S.knockback(T.damage + (B.dmg || 0), B.dmg || 0, T.stats.weight, B.bkb || 0, B.kbg || 0);
        const kr = this.killRatio(T, B.angle || 0, f.facing, kb, p.x, p.y);
        let sc = (B.dmg || 0) + (kr >= 1 ? 40 : kr * 12) - k * 0.7 - this.recent.filter((r) => r === name).length * 2;
        sc += this.rng() * this.L.noise;
        if (sc > bs) { bs = sc; best = name; }
      }
      if (!best && this.level >= 2 && Math.abs(T.x - f.x) < 130 && Math.abs(T.y - f.y) < 100 && this.rng() < 0.04) {
        for (const n of ["dspecial", "nspecial"]) {
          const I = info(f, n, true);
          if (I && !I.boxes.length && !I.counter && !(this.cool[n] > this.t)) { best = n; this.cool[n] = this.t + this.ri(120, 240); break; }
        }
      }
      if (!best) return null;
      const name = best;
      return () => {
        if (SPECIALS[name]) this.perform(name, f.facing, true);
        else this.perform(name, f.facing, true);
      };
    }
  }

  S.AI = {
    LEVELS,
    create(f, level, g) { const b = new Brain(f, level, g); b.g = g; return b; },
  };
})();
