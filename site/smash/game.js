/* Super Smash Ballers — simulation. Deterministic fixed-step (60/s): physics, fighter state machine,
   moves/hitboxes, Melee-style knockback, shields, grabs, ledges, projectiles, KOs.
   World units are pixels, y grows DOWN, a fighter's (x, y) is the point between its feet. */
(function () {
  "use strict";
  const S = window.Smash;
  const { clamp, sign, DEG } = S;

  // ------------------------------------------------------------ defaults
  S.DEFAULT_STATS = {
    weight: 100,      // Melee-style weight (Plankton ~60, Bowser ~117)
    walk: 4.2, run: 7.4, dashInit: 7.8, traction: 0.55,
    airSpeed: 5, airAccel: 0.38, airFriction: 0.12,
    gravity: 0.5, fallSpeed: 9, fastFall: 13,
    jump: 13.5, shortHop: 8.5, airJump: 12.5, jumps: 2, jumpsquat: 4,
    width: 34, height: 70,
  };

  // Hitbox helper: hb(start, end, x, y, r, dmg, angle, bkb, kbg, extra)
  //   x/y relative to the feet, x is FORWARD (mirrored by facing), y negative is up.
  //   angle in degrees, 0 = forward, 90 = up, 180 = backward, 270/-90 = down (spike). 361 = "sakurai" (40, flatter on weak hits).
  S.hb = (start, end, x, y, r, dmg, angle, bkb, kbg, extra) =>
    Object.assign({ start, end, x, y, r, dmg, angle, bkb, kbg }, extra || {});

  // Generic moveset, scaled by the fighter's reach (s) and power (p). Fighters override what they want.
  S.genericMoves = function (s = 1, p = 1) {
    const hb = (st, en, x, y, r, d, a, b, k, e) => S.hb(st, en, x * s, y * s, r * s, Math.round(d * p), a, b, k, e);
    return {
      jab:    { frames: 18, iasa: 14, hitboxes: [hb(3, 5, 24, -38, 12, 3, 45, 10, 50)] },
      ftilt:  { frames: 26, hitboxes: [hb(6, 9, 36, -36, 14, 9, 35, 10, 100), hb(6, 9, 18, -36, 12, 8, 35, 10, 100)] },
      utilt:  { frames: 28, hitboxes: [hb(6, 11, 12, -78, 17, 8, 95, 25, 110), hb(6, 11, -14, -66, 14, 7, 100, 25, 110)] },
      dtilt:  { frames: 22, crouch: true, hitboxes: [hb(5, 7, 32, -8, 13, 8, 80, 18, 80)] },
      dash:   { frames: 34, hitboxes: [hb(6, 14, 26, -32, 17, 9, 60, 30, 70)], update(f, g, mf) { if (mf < 16) f.vx = f.facing * Math.max(Math.abs(f.vx), 4) * 0.97; } },
      fsmash: { frames: 46, charge: 6, hitboxes: [hb(14, 17, 42, -38, 18, 16, 40, 30, 100), hb(14, 17, 20, -38, 14, 14, 40, 30, 100)] },
      usmash: { frames: 44, charge: 5, hitboxes: [hb(12, 16, 0, -84, 21, 15, 88, 30, 105), hb(12, 16, 0, -50, 15, 12, 90, 30, 100)] },
      dsmash: { frames: 46, charge: 4, crouch: true, hitboxes: [hb(8, 10, 36, -8, 16, 13, 25, 25, 95), hb(14, 16, -36, -8, 16, 13, 155, 25, 95)] },
      nair:   { frames: 36, air: true, landingLag: 10, hitboxes: [hb(4, 9, 0, -36, 26, 10, 45, 15, 90), hb(10, 24, 0, -36, 22, 6, 45, 10, 70)] },
      fair:   { frames: 40, air: true, landingLag: 18, hitboxes: [hb(10, 14, 36, -40, 18, 13, 40, 20, 100), hb(10, 14, 14, -40, 13, 10, 45, 20, 90)] },
      bair:   { frames: 32, air: true, landingLag: 12, hitboxes: [hb(6, 10, -36, -38, 17, 12, 145, 15, 100), hb(6, 10, -14, -38, 13, 9, 140, 15, 90)] },
      uair:   { frames: 30, air: true, landingLag: 12, hitboxes: [hb(5, 9, 6, -84, 19, 10, 85, 20, 95)] },
      dair:   { frames: 40, air: true, landingLag: 20, hitboxes: [hb(10, 14, 0, 2, 18, 13, -90, 20, 90), hb(15, 22, 0, 0, 16, 8, 70, 15, 80)] },
      grab:   { frames: 30, hitboxes: [hb(7, 8, 28, -38, 15, 0, 0, 0, 0, { grab: true })] },
      pummel: { frames: 18, throwHit: { frame: 6, dmg: 2, angle: 0, bkb: 0, kbg: 0, keepHold: true } },
      fthrow: { frames: 30, throwHit: { frame: 10, dmg: 8, angle: 40, bkb: 55, kbg: 70 } },
      bthrow: { frames: 32, throwHit: { frame: 12, dmg: 9, angle: 140, bkb: 55, kbg: 75 } },
      uthrow: { frames: 34, throwHit: { frame: 12, dmg: 7, angle: 90, bkb: 65, kbg: 70 } },
      dthrow: { frames: 34, throwHit: { frame: 14, dmg: 6, angle: 75, bkb: 70, kbg: 40 } },
      ledgeattack: { frames: 40, hitboxes: [hb(20, 24, 30, -24, 18, 8, 35, 40, 50)] },
      getupattack: { frames: 40, hitboxes: [hb(16, 18, 30, -10, 16, 6, 30, 50, 30), hb(22, 24, -30, -10, 16, 6, 150, 50, 30)] },
      // Placeholder specials: real fighters replace all four.
      nspecial: { frames: 30, hitboxes: [hb(8, 12, 30, -40, 16, 7, 45, 20, 70)] },
      sspecial: { frames: 34, hitboxes: [hb(8, 16, 30, -36, 16, 9, 40, 25, 70)], update(f, g, mf) { if (mf >= 6 && mf < 16) f.vx = f.facing * 8; } },
      uspecial: { frames: 34, helpless: true, ledgeGrab: true, hitboxes: [hb(3, 12, 0, -40, 22, 8, 80, 30, 60)],
        start(f) { f.vy = -15; f.grounded = false; f.plat = null; }, update(f, g, mf, pad) { f.vx = pad.x * 4; } },
      dspecial: { frames: 30, hitboxes: [hb(6, 10, 0, -30, 30, 9, 75, 30, 70)] },
    };
  };

  // ------------------------------------------------------------ fighter
  let moveSerial = 1;

  class Fighter {
    constructor(def, port, opts) {
      this.def = def;
      this.port = port;
      this.cpu = !!opts.cpu;
      this.level = opts.level || 2;
      this.devices = opts.devices || [];
      this.stats = Object.assign({}, S.DEFAULT_STATS, def.stats || {});
      this.moves = Object.assign(S.genericMoves(def.reach || 1, def.power || 1), def.moves || {});
      this.w = this.stats.width; this.h = this.stats.height;
      this.pad = S.newPad();
      this.prev = { a: false, b: false, j: false, s: false };
      this.stocks = opts.stocks || 4;
      this.damage = 0;
      this.kos = 0; this.falls = 0; this.sds = 0; this.dmgDealt = 0; this.dmgTaken = 0;
      this.buffs = {};       // free-form: fighter files store timers here (e.g. buffs.redbull = 600)
      this.data = {};        // free-form per-fighter scratch space (projectile handles, cooldowns...)
      this.out = false;
      this.reset(opts.x || 0, opts.y || 0, opts.facing || 1);
    }

    reset(x, y, facing) {
      this.x = x; this.y = y; this.px = x; this.py = y;
      this.vx = 0; this.vy = 0; this.kbx = 0; this.kby = 0;
      this.facing = facing;
      this.grounded = false; this.plat = null; this.dropPlat = null; this.dropTimer = 0;
      this.state = "air"; this.stateFrame = 0;
      this.jumpsLeft = this.stats.jumps - 1;
      this.fastfall = false; this.airdodged = false; this.usedSide = false; this.usedUp = false;
      this.move = null; this.moveName = null; this.mf = 0; this.hitSet = null; this.moveId = 0;
      this.charging = 0; this.chargeMult = 1;
      this.hitlag = 0; this.hitstun = 0; this.tumble = false; this.pendingLaunch = null; this.lastHitBy = null; this.lastHitAt = -9999;
      this.invuln = 0; this.armor = false; this.counter = null;
      this.shieldHP = 60; this.shieldStun = 0; this.techWindow = 0; this.techLock = 0;
      this.ledge = null; this.ledgeCooldown = 0;
      this.grabbed = null; this.grabbedBy = null; this.grabTimer = 0;
      this.lag = 0; this.deadTimer = 0;
      this.respawnPlat = false;
    }

    get cx() { return this.x; }
    get cy() { return this.y - this.h / 2; }
    get crouching() { return this.state === "crouch" || (this.state === "attack" && this.move && this.move.crouch); }
    hurtbox() {
      const h = this.crouching ? this.h * 0.62 : this.h;
      return { x1: this.x - this.w / 2, x2: this.x + this.w / 2, y1: this.y - h, y2: this.y };
    }
    setState(s) { this.state = s; this.stateFrame = 0; if (s !== "attack") { this.move = null; this.moveName = null; this.counter = null; this.armor = false; } }
    pressed(btn) { return this.pad[btn] && !this.prev[btn]; }
    isActionable() { return ["idle", "walk", "dash", "run", "crouch", "air", "tumble", "skid"].includes(this.state); }

    startMove(name, g) {
      let def = this.moves[name];
      if (!def) return false;
      if (!this.grounded && this.moves[name + "Air"]) def = this.moves[name + "Air"];
      this.setState("attack");
      this.move = def; this.moveName = name; this.mf = 0; this.moveId = moveSerial++;
      this.hitSet = new Set(); this.charging = 0; this.chargeMult = 1;
      this.counter = null; this.armor = false;
      if (def.start) def.start(this, g, this.pad);
      return true;
    }

    land(g) {
      const wasState = this.state;
      this.ledgeInvulnUsed = false;
      this.grounded = true; this.vy = 0; this.kby = 0; this.fastfall = false;
      this.jumpsLeft = this.stats.jumps - 1; this.airdodged = false; this.usedSide = false; this.usedUp = false;
      if (wasState === "hitstun" || (wasState === "tumble")) {
        if (this.techWindow > 0) { this.setState("tech"); this.invuln = Math.max(this.invuln, 20); this.kbx = 0; this.vx = 0; S.fx.spark(g, this.x, this.y, "#fff", 6); return; }
        if (this.tumble || wasState === "tumble") { this.setState("down"); this.kbx *= 0.5; S.audio && S.audio.thud && S.audio.thud(); return; }
        this.hitstun = 0; this.setState("land"); this.lag = 4; return;
      }
      if (wasState === "attack" && this.move) {
        if (this.move.air) { this.lag = this.move.landingLag || 8; this.setState("land"); return; }
        if (this.move.onLand) { this.move.onLand(this, g); return; }
        return;   // ground/special moves keep going
      }
      if (wasState === "helpless") { this.lag = 10; this.setState("land"); return; }
      if (wasState === "airdodge") { this.lag = 10; this.setState("land"); this.vx = this.kbx + this.vx; this.kbx = 0; return; }
      if (wasState === "respawn") { this.setState("idle"); return; }
      if (wasState === "dizzy" || wasState === "down" || wasState === "getup" || wasState === "tech") return;
      this.lag = 4; this.setState("land");
    }

    leaveGround() {
      this.grounded = false; this.plat = null;
    }

    // ---------------------------------------------------- per-tick logic
    update(g) {
      const st = this.stats, pad = this.pad;
      if (this.out) return;
      if (this.state === "dead") {
        if (--this.deadTimer <= 0) {
          if (this.stocks > 0) this.respawn(g); else this.out = true;
        }
        return;
      }
      for (const k in this.buffs) if (typeof this.buffs[k] === "number" && this.buffs[k] > 0) this.buffs[k]--;
      if (this.def.tick) this.def.tick(this, g);

      if (this.hitlag > 0) {
        this.hitlag--;
        if (this.hitlag === 0 && this.pendingLaunch) this.launch(this.pendingLaunch, g);
        this.savePrev();
        return;
      }
      this.stateFrame++;
      if (this.invuln > 0) this.invuln--;
      if (this.ledgeCooldown > 0) this.ledgeCooldown--;
      if (this.dropTimer > 0 && --this.dropTimer === 0) this.dropPlat = null;
      if (this.techWindow > 0) this.techWindow--;
      if (this.techLock > 0) this.techLock--;
      if (this.pressed("s") && (this.state === "hitstun" || this.state === "tumble") && this.techLock === 0) { this.techWindow = 20; this.techLock = 40; }
      if (this.state !== "shield" && this.shieldHP < 60) this.shieldHP = Math.min(60, this.shieldHP + 0.07);

      this.think(g, pad, st);
      this.physics(g, st);
      this.savePrev();
    }
    savePrev() { const p = this.pad; this.prev.a = p.a; this.prev.b = p.b; this.prev.j = p.j; this.prev.s = p.s; }

    think(g, pad, st) {
      const s = this.state;

      // ---- states that can do anything ----
      if (this.isActionable() || (s === "land" && false)) {
        if (this.tryActions(g, pad, st)) return;
      }

      switch (s) {
        case "idle": case "walk": case "crouch":
          if (Math.abs(pad.x) > 0.25 && !(s === "crouch" && pad.y > 0.6)) {
            if (pad.dash) { this.facing = sign(pad.x); this.setState("dash"); this.vx = this.facing * st.dashInit; break; }
            if (sign(pad.x) !== this.facing && this.state !== "walk") this.facing = sign(pad.x);
            if (sign(pad.x) !== this.facing) this.facing = sign(pad.x);
            if (s !== "walk") this.setState("walk");
            const target = pad.x * st.walk;
            this.vx += clamp(target - this.vx, -0.8, 0.8);
          } else if (pad.y > 0.6) {
            if (s !== "crouch") this.setState("crouch");
            this.friction(st);
          } else {
            if (s !== "idle") this.setState("idle");
            this.friction(st);
          }
          break;
        case "dash":
          if (pad.dash && sign(pad.x) === -this.facing) { this.facing = -this.facing; this.vx = this.facing * st.dashInit; this.stateFrame = 0; break; }
          this.vx = this.facing * Math.max(st.dashInit * 0.9, Math.abs(this.vx));
          if (this.stateFrame >= 14) {
            if (sign(pad.x) === this.facing && Math.abs(pad.x) > 0.6) this.setState("run");
            else this.setState("idle");
          }
          break;
        case "run":
          if (sign(pad.x) === this.facing && Math.abs(pad.x) > 0.3) this.vx += clamp(this.facing * st.run - this.vx, -0.9, 0.9);
          else if (sign(pad.x) === -this.facing) { this.setState("skid"); }
          else { this.setState("skid"); }
          break;
        case "skid":
          this.friction(st, 1.4);
          if (this.stateFrame >= 10) { if (sign(pad.x) === -this.facing) this.facing = -this.facing; this.setState("idle"); }
          break;
        case "land":
          this.friction(st);
          if (this.stateFrame >= this.lag) this.setState("idle");
          break;
        case "jumpsquat":
          this.friction(st);
          if (this.stateFrame >= st.jumpsquat) {
            const full = pad.j || pad.y < -0.5;
            this.leaveGround();
            const hx = pad.x * st.airSpeed;
            this.vx = clamp(this.vx * 0.75 + hx * 0.5, -st.airSpeed * 1.25, st.airSpeed * 1.25);
            this.vy = -(full ? st.jump : st.shortHop) * (this.buffs.jumpBoost ? 1.15 : 1);
            this.setState("air");
            S.audio && S.audio.jump && S.audio.jump();
          }
          break;
        case "air": case "tumble":
          this.airControl(pad, st);
          break;
        case "helpless":
          this.airControl(pad, st, 0.6);
          break;
        case "attack": this.runMove(g, pad, st); break;
        case "shield": this.shieldState(g, pad, st); break;
        case "roll": {
          const dur = 28;
          this.vx = (this.stateFrame < 20 ? this.rollDir * 5.2 : 0);
          if (this.stateFrame >= dur) { this.facing = -this.rollDir; this.setState("idle"); this.vx = 0; }
          break;
        }
        case "spotdodge":
          this.friction(st);
          if (this.stateFrame >= 24) this.setState("idle");
          break;
        case "airdodge":
          if (this.stateFrame > 10) { this.vy = Math.min(st.fallSpeed, this.vy + st.gravity * 0.8); }
          this.vx *= 0.9; if (this.stateFrame <= 10) this.vy *= 0.9;
          if (this.stateFrame >= 40) this.setState("helpless");
          break;
        case "hitstun":
          if (--this.hitstun <= 0) { this.hitstun = 0; this.setState(this.grounded ? "idle" : this.tumble ? "tumble" : "air"); }
          break;
        case "tech":
          this.friction(st);
          if (this.stateFrame >= 22) this.setState("idle");
          break;
        case "down":
          this.friction(st);
          this.kbx *= 0.8;
          if (this.stateFrame > 12 && (pad.a || Math.abs(pad.x) > 0.5 || pad.y < -0.5 || pad.j || pad.s) || this.stateFrame > 90) {
            if (pad.a) { this.setState("idle"); this.startMove("getupattack", g); this.invuln = 18; }
            else { this.setState("getup"); this.invuln = 22; this.rollDir = Math.abs(pad.x) > 0.5 ? sign(pad.x) : 0; }
          }
          break;
        case "getup":
          this.vx = this.rollDir ? (this.stateFrame < 18 ? this.rollDir * 4.5 : 0) : 0;
          if (this.stateFrame >= 26) this.setState("idle");
          break;
        case "dizzy":
          this.friction(st);
          if (this.grounded && this.stateFrame > this.dizzyTime) { this.setState("idle"); this.shieldHP = 30; }
          if (!this.grounded) this.airControl({ x: 0, y: 0 }, st, 0);
          break;
        case "ledge": this.ledgeState(g, pad, st); break;
        case "ledgeclimb":
          if (this.stateFrame >= 22) {
            const L = this.ledge;
            this.x = L.x - L.side * (this.w / 2 + 14); this.y = L.plat.y; this.grounded = true; this.plat = L.plat;
            this.releaseLedge(); this.setState("idle");
            if (this.afterClimb) { const m = this.afterClimb; this.afterClimb = null; if (m === "roll") { this.rollDir = -this.ledgeSide; this.setState("roll"); this.invuln = 20; } else this.startMove(m, g); }
          }
          break;
        case "grabbing": this.grabState(g, pad, st); break;
        case "grabbed":
          // mashing out
          if ((this.pressed("a") || this.pressed("b") || this.pressed("j") || pad.tx === 0 || pad.ty === 0)) this.grabbedBy && (this.grabbedBy.grabTimer -= 5);
          break;
        case "respawn":
          if (this.stateFrame > 150 || Math.abs(pad.x) > 0.5 || pad.y > 0.5 || this.pressed("j") || this.pressed("a") || this.pressed("b")) {
            this.respawnPlat = false; this.setState("air"); this.invuln = 120; this.leaveGround();
          }
          break;
      }
    }

    tryActions(g, pad, st) {
      const s = this.state, air = !this.grounded;
      // jump
      if (this.pressed("j") || (pad.ty === 0 && pad.y < -0.8 && g.tapJump)) {
        if (!air) { this.setState("jumpsquat"); return true; }
        if (this.jumpsLeft > 0) {
          this.jumpsLeft--; this.fastfall = false;
          this.vy = -st.airJump * (this.buffs.jumpBoost ? 1.15 : 1); this.vx = pad.x * st.airSpeed;
          this.setState("air"); this.airJumped = 10;
          S.fx.ring(g, this.x, this.y, "#ffffff");
          S.audio && S.audio.jump && S.audio.jump();
          return true;
        }
      }
      // shield / airdodge / grab
      if (this.pad.s) {
        if (!air && this.pressed("a")) { this.startMove("grab", g); return true; }
        if (!air) { this.setState("shield"); return true; }
        if (air && this.pressed("s") && !this.airdodged) {
          this.airdodged = true;
          let dx = pad.x, dy = pad.y; const m = Math.hypot(dx, dy);
          if (m > 0.3) { dx /= m; dy /= m; this.vx = dx * 14; this.vy = dy * 14; } else { this.vx *= 0.2; this.vy = 0; }
          this.fastfall = false; this.setState("airdodge"); this.invuln = 26;
          return true;
        }
      }
      // specials
      if (this.pressed("b")) {
        let name = "nspecial";
        if (pad.y < -0.5 && Math.abs(pad.y) >= Math.abs(pad.x) * 0.8) name = "uspecial";
        else if (pad.y > 0.5 && Math.abs(pad.y) >= Math.abs(pad.x)) name = "dspecial";
        else if (Math.abs(pad.x) > 0.5) { name = "sspecial"; this.facing = sign(pad.x); }
        if (name === "sspecial" && air && this.usedSide) name = null;
        if (name === "uspecial" && air && this.usedUp) name = null;
        if (name && this.moves[name]) {
          if (name === "sspecial" && air) this.usedSide = true;
          if (name === "uspecial") this.usedUp = true;
          if (name === "uspecial" && !air) { /* ground up-b becomes airborne via its start() */ }
          this.startMove(name, g); return true;
        }
      }
      // attacks
      if (this.pressed("a")) {
        let name;
        const ax = Math.abs(pad.x), ay = Math.abs(pad.y);
        if (air) {
          if (ay > 0.5 && ay >= ax) name = pad.y < 0 ? "uair" : "dair";
          else if (ax > 0.5) name = sign(pad.x) === this.facing ? "fair" : "bair";
          else name = "nair";
        } else if (s === "dash" || s === "run") name = "dash";
        else {
          const smashX = ax > 0.7 && pad.tx <= 4, smashY = ay > 0.7 && pad.ty <= 4;
          if (smashY && ay >= ax) name = pad.y < 0 ? "usmash" : "dsmash";
          else if (smashX) { name = "fsmash"; this.facing = sign(pad.x); }
          else if (ay > 0.5 && ay >= ax) name = pad.y < 0 ? "utilt" : "dtilt";
          else if (ax > 0.4) { name = "ftilt"; this.facing = sign(pad.x); }
          else name = "jab";
        }
        this.startMove(name, g); return true;
      }
      // drop-through
      if (!air && this.plat && this.plat.pass && pad.y > 0.7 && pad.ty <= 2 && (s === "idle" || s === "walk" || s === "crouch")) {
        this.dropPlat = this.plat; this.dropTimer = 12; this.leaveGround(); this.vy = 1; this.setState("air"); return true;
      }
      // fastfall
      if (air && (s === "air" || s === "tumble") && this.vy > -1 && pad.y > 0.7 && pad.ty <= 3 && !this.fastfall) {
        this.fastfall = true; this.vy = st.fastFall; S.fx.spark(g, this.x, this.y - this.h, "#fff", 3);
      }
      return false;
    }

    friction(st, mult = 1) {
      const t = st.traction * mult;
      if (Math.abs(this.vx) <= t) this.vx = 0; else this.vx -= sign(this.vx) * t;
    }

    airControl(pad, st, mult = 1) {
      const max = st.airSpeed * mult * (this.buffs.speedBoost ? 1.25 : 1);
      if (Math.abs(pad.x) > 0.2) {
        const target = pad.x * max;
        if ((target > 0 && this.vx < target) || (target < 0 && this.vx > target)) this.vx = clamp(this.vx + pad.x * st.airAccel, -max, max);
      } else {
        if (Math.abs(this.vx) <= st.airFriction) this.vx = 0; else this.vx -= sign(this.vx) * st.airFriction;
      }
      if (this.airJumped) this.airJumped--;
    }

    runMove(g, pad, st) {
      const m = this.move;
      // smash charge
      if (m.charge && this.mf === m.charge && pad.a && this.charging < 60) {
        this.charging++; this.chargeMult = 1 + 0.4 * (this.charging / 60);
        if (this.grounded) this.friction(st);
        if (this.charging % 8 === 0) S.fx.spark(g, this.x + this.facing * 10, this.y - this.h * 0.6, "#fff6a0", 2);
        return;
      }
      this.mf++;
      // armor / counter / invulnerability windows
      this.armor = !!(m.armor && this.mf >= m.armor[0] && this.mf <= m.armor[1]);
      this.counter = m.counter && this.mf >= m.counter[0] && this.mf <= m.counter[1] ? m : null;
      if (m.invuln && this.mf >= m.invuln[0] && this.mf <= m.invuln[1]) this.invuln = Math.max(this.invuln, 1);
      // throws
      if (m.throwHit && this.mf === m.throwHit.frame && this.grabbed) {
        const T = this.grabbed, th = m.throwHit;
        if (!th.keepHold) { this.grabbed = null; T.grabbedBy = null; T.setState("air"); }
        // a back throw turns the thrower around first, so its angle is relative to the way they faced when grabbing
        const dir = this.moveName === "bthrow" ? -this.facing : this.facing;
        S.applyHit(g, this, T, { dmg: th.dmg, angle: th.angle, bkb: th.bkb, kbg: th.kbg, throw: true, noHitlag: !th.keepHold }, dir, 1);
        if (th.keepHold) { T.setState("grabbed"); T.hitstun = 0; T.pendingLaunch = null; }
      }
      if (m.update) m.update(this, g, this.mf, pad);
      if (this.state !== "attack" || this.move !== m) return;   // the hook changed state
      if (this.grounded) { if (!m.keepMomentum && !m.update) this.friction(st); else if (!m.keepMomentum) this.friction(st, 0.5); }
      else if (!m.noAirControl) this.airControl(pad, st, m.air ? 1 : 0.6);
      // interrupt
      const done = this.mf >= m.frames;
      const iasa = m.iasa && this.mf >= m.iasa;
      if (done || iasa) {
        if (m.throwHit && this.grabbed && m.throwHit.keepHold) { this.state = "grabbing"; this.move = null; this.moveName = null; return; }
        if (iasa && !done) { if (this.tryActions(g, pad, st)) return; if (Math.abs(pad.x) < 0.3 && Math.abs(pad.y) < 0.3) return; }
        if (m.helpless && !this.grounded) this.setState("helpless");
        else this.setState(this.grounded ? "idle" : "air");
        if (m.end) m.end(this, g);
      }
    }

    shieldState(g, pad, st) {
      this.friction(st);
      if (this.shieldStun > 0) { this.shieldStun--; return; }
      this.shieldHP -= 0.14;
      if (this.shieldHP <= 0) { this.shieldBreak(g); return; }
      if (this.pressed("j")) { this.setState("jumpsquat"); return; }
      if (this.pressed("a")) { this.startMove("grab", g); return; }
      if (!pad.s) { this.setState("idle"); return; }
      if (Math.abs(pad.x) > 0.7 && pad.tx <= 3) { this.rollDir = sign(pad.x); this.setState("roll"); this.invuln = 18; return; }
      if (pad.y > 0.7 && pad.ty <= 3) { this.setState("spotdodge"); this.invuln = 16; return; }
    }
    shieldBreak(g) {
      this.shieldHP = 0; this.setState("dizzy"); this.dizzyTime = 240;
      this.leaveGround(); this.vy = -15; this.vx = 0;
      S.fx.burst(g, this.x, this.y - this.h / 2, S.PORT_COLORS[this.port], 16);
      S.audio && S.audio.shieldBreak && S.audio.shieldBreak();
    }

    grabState(g, pad, st) {
      const T = this.grabbed;
      if (!T || T.state !== "grabbed") { this.grabbed = null; this.setState("idle"); return; }
      this.friction(st);
      T.x = this.x + this.facing * (this.w / 2 + T.w / 2 - 6); T.y = this.y; T.vx = T.vy = 0; T.facing = -this.facing;
      if (--this.grabTimer <= 0) {
        this.grabbed = null; T.grabbedBy = null; T.setState("air"); T.leaveGround(); T.vy = -6; T.vx = this.facing * 4; T.ledgeCooldown = 10;
        this.setState("land"); this.lag = 16; this.vx = -this.facing * 3; return;
      }
      if (this.stateFrame < 6) return;
      let name = null;
      if (Math.abs(pad.x) > 0.6 && Math.abs(pad.x) >= Math.abs(pad.y)) name = sign(pad.x) === this.facing ? "fthrow" : "bthrow";
      else if (pad.y < -0.6) name = "uthrow";
      else if (pad.y > 0.6) name = "dthrow";
      else if (this.pressed("a")) name = "pummel";
      if (name) {
        const keep = this.grabbed;
        const timer = this.grabTimer;
        this.startMove(name, g);
        this.grabbed = keep; this.grabTimer = timer;
        if (name === "bthrow") { this.facing = -this.facing; keep.x = this.x + this.facing * (this.w / 2 + keep.w / 2 - 6); }
      }
    }

    // ---------------------------------------------------- ledges
    ledgeState(g, pad, st) {
      const L = this.ledge;
      this.vx = this.vy = 0;
      this.x = L.x + L.side * (this.w / 2 - 6); this.y = L.plat.y + this.h * 0.62;
      this.facing = -L.side; this.jumpsLeft = st.jumps - 1; this.usedSide = false; this.usedUp = false; this.airdodged = false;
      if (this.stateFrame < 8) return;
      const inward = -L.side;
      if (this.pressed("j") || (pad.y < -0.7 && pad.ty <= 3)) {
        this.releaseLedge(); this.setState("air"); this.vy = -st.jump * 0.95; this.vx = inward * 2.5; this.invuln = Math.max(this.invuln, 6); return;
      }
      if (this.pressed("a") || this.pressed("s") || (sign(pad.x) === inward && Math.abs(pad.x) > 0.6)) {
        this.afterClimb = this.pad.a ? "ledgeattack" : this.pad.s ? "roll" : null;
        this.ledgeSide = L.side;
        this.setState("ledgeclimb"); this.invuln = Math.max(this.invuln, 24); return;
      }
      if ((pad.y > 0.7) || (sign(pad.x) === L.side && Math.abs(pad.x) > 0.6) || this.stateFrame > 300) {
        this.releaseLedge(); this.setState("air"); this.x += L.side * 6; this.ledgeCooldown = 30; return;
      }
    }
    releaseLedge() { if (this.ledge) this.ledge.owner = null; this.ledge = null; this.ledgeCooldown = 30; }

    tryLedgeGrab(g) {
      if (this.ledgeCooldown > 0 || this.grounded || this.vy < 0) return;
      const s = this.state;
      const okState = s === "air" || s === "tumble" || s === "helpless" || (s === "attack" && this.move && this.move.ledgeGrab);
      if (!okState) return;
      if (this.pad.y > 0.6) return;   // holding down = don't snap
      for (const L of g.ledges) {
        if (L.owner && L.owner !== this) continue;
        const hx = L.x + L.side * (this.w / 2 - 6), hy = L.plat.y + this.h * 0.62;
        if (Math.abs(this.x - hx) < 34 && this.y > hy - 46 && this.y < hy + 40) {
          L.owner = this; this.ledge = L; this.setState("ledge");
          this.fastfall = false; this.kbx = this.kby = 0;
          if (!this.ledgeInvulnUsed) { this.invuln = Math.max(this.invuln, 30); }
          this.ledgeInvulnUsed = true;
          S.audio && S.audio.ledge && S.audio.ledge();
          return;
        }
      }
    }

    // ---------------------------------------------------- physics
    physics(g, st) {
      if (this.state === "grabbed" || this.state === "ledge" || this.state === "ledgeclimb" || this.state === "respawn") {
        if (this.state === "respawn") { this.vx = this.vy = 0; }
        return;
      }
      this.px = this.x; this.py = this.y;
      // knockback velocity decays (0.051 Melee units/frame² → 0.255 px)
      if (this.kbx || this.kby) {
        const sp = Math.hypot(this.kbx, this.kby);
        const ns = Math.max(0, sp - 0.255);
        if (ns === 0) { this.kbx = this.kby = 0; } else { this.kbx *= ns / sp; this.kby *= ns / sp; }
      }
      if (this.grounded) {
        // ground: kb x slides with traction
        if (this.kbx) { const t = st.traction; this.kbx = Math.abs(this.kbx) <= t ? 0 : this.kbx - sign(this.kbx) * t; }
        const P = this.plat;
        this.x += this.vx + this.kbx + (P ? P.dx || 0 : 0);
        this.y = P ? P.y : this.y;
        if (P && (this.x < P.x1 - 2 || this.x > P.x2 + 2)) {
          // walked off
          this.leaveGround();
          if (["idle", "walk", "dash", "run", "skid", "crouch", "land"].includes(this.state)) this.setState("air");
          if (this.state === "shield") this.setState("air");
          this.jumpsLeft = Math.max(0, st.jumps - 1);
        }
      } else {
        const noGrav = this.state === "airdodge" && this.stateFrame <= 10 || (this.state === "attack" && this.move && this.move.noGravity && (this.move.noGravity === true || (this.mf >= this.move.noGravity[0] && this.mf <= this.move.noGravity[1])));
        if (!noGrav) {
          const g2 = st.gravity * (this.move && this.move.gravityMult != null && this.state === "attack" ? this.move.gravityMult : 1);
          const cap = this.fastfall ? st.fastFall : st.fallSpeed;
          if (this.vy < cap) this.vy = Math.min(cap, this.vy + g2);
          else if (this.fastfall) this.vy = cap;
        }
        this.x += this.vx + this.kbx;
        this.y += this.vy + this.kby;
        this.collide(g);
        if (!this.grounded) this.tryLedgeGrab(g);
      }
      this.solidPush(g);
      // blast zones
      const B = g.stage.blast;
      if (this.x < B.left || this.x > B.right || this.y > B.bottom || this.y - this.h < B.top) this.ko(g);
    }

    collide(g) {
      const vyTot = this.vy + this.kby;
      if (vyTot < 0) return;
      for (const P of g.platforms) {
        if (P === this.dropPlat) continue;
        if (P.pass && this.pad.y > 0.7 && this.state === "air" && this.fastfall) continue;   // fastfalling with down held goes through
        const prevY = this.py + (P.dy > 0 ? 0 : 0);
        const top = P.y;
        if (prevY <= top - (P.dy || 0) + 0.5 && this.y >= top && this.x >= P.x1 && this.x <= P.x2) {
          if ((this.state === "hitstun" || this.state === "tumble") && this.kby > 4.5 && this.techWindow === 0 && this.tumble) {
            // ground bounce
            this.y = top; this.kby = -this.kby * 0.75; this.vy = 0;
            S.fx.spark(g, this.x, top, "#fff", 8); S.audio && S.audio.thud && S.audio.thud();
            return;
          }
          this.y = top; this.plat = P;
          this.land(g);
          return;
        }
      }
    }

    // keep bodies out of solid stage blocks (walls / underside)
    solidPush(g) {
      const hw = this.w / 2 - 2;
      for (const P of g.platforms) {
        if (!P.solid) continue;
        const bot = P.y + (P.depth || 60);
        if (this.x + hw <= P.x1 || this.x - hw >= P.x2) continue;
        if (this.y <= P.y + 1 || this.y - this.h * 0.6 >= bot) continue;
        if (this.grounded && this.plat === P) continue;
        // inside: resolve by smallest push
        const pl = this.x + hw - P.x1, pr = P.x2 - (this.x - hw), pd = bot - (this.y - this.h * 0.6);
        const m = Math.min(pl, pr, pd);
        if (m === pd && this.py - this.h * 0.6 >= bot - 4) { this.y += pd; if (this.vy < 0) this.vy = 0; if (this.kby < 0) this.kby = -this.kby * 0.5; }
        else if (pl < pr) { this.x -= pl; if (this.kbx > 0) this.kbx = -this.kbx * 0.5; if (this.vx > 0) this.vx = 0; }
        else { this.x += pr; if (this.kbx < 0) this.kbx = -this.kbx * 0.5; if (this.vx < 0) this.vx = 0; }
      }
    }

    // ---------------------------------------------------- hits taken
    launch(L, g) {
      // DI: perpendicular stick input rotates the launch angle up to 18°
      let ang = L.angle;
      const pad = this.pad;
      const m = Math.hypot(pad.x, pad.y);
      if (m > 0.3 && L.kb > 0) {
        const lx = Math.cos(ang), ly = -Math.sin(ang);
        const sx = pad.x / m, sy = pad.y / m;
        const cross = lx * sy - ly * sx;   // >0: stick is clockwise of launch (screen space)
        ang -= clamp(cross, -1, 1) * 18 * DEG * Math.min(1, m);
      }
      const speed = L.kb * 0.15;
      let kx = Math.cos(ang) * speed, ky = -Math.sin(ang) * speed;
      if (this.grounded) {
        if (ky > 0) { if (L.kb < 80) ky = 0; else { ky = -ky * 0.8; } }
        if (ky < -0.1) this.leaveGround();
      }
      this.kbx = kx; this.kby = ky; this.vx = 0; this.vy = 0; this.fastfall = false;
      this.pendingLaunch = null;
    }

    ko(g) {
      if (this.state === "dead") return;
      this.stocks--; this.falls++;
      const credit = this.lastHitBy && g.frame - this.lastHitAt < 600 ? this.lastHitBy : null;
      if (credit && credit !== this) credit.kos++; else this.sds++;
      if (this.grabbed) { const T = this.grabbed; T.grabbedBy = null; T.setState("air"); this.grabbed = null; }
      if (this.grabbedBy) { this.grabbedBy.grabbed = null; this.grabbedBy.setState("idle"); this.grabbedBy = null; }
      this.releaseLedge();
      S.fx.koBlast(g, this);
      S.audio && S.audio.ko && S.audio.ko();
      g.shake = 14;
      this.setState("dead"); this.deadTimer = 70; this.kbx = this.kby = this.vx = this.vy = 0;
      if (this.def.onKO) this.def.onKO(this, g);
      if (this.stocks <= 0) this.deadTimer = 1;
    }

    respawn(g) {
      const R = g.stage.respawn || { x: 0, y: -260 };
      const keep = { stocks: this.stocks, kos: this.kos, falls: this.falls, sds: this.sds, dmgDealt: this.dmgDealt, dmgTaken: this.dmgTaken };
      this.reset(R.x + (this.port - 1.5) * 50, R.y, this.port % 2 ? -1 : 1);
      Object.assign(this, keep);
      this.damage = 0; this.buffs = {}; this.ledgeInvulnUsed = false;
      this.setState("respawn"); this.respawnPlat = true; this.invuln = 0;
    }
  }
  S.Fighter = Fighter;

  // ------------------------------------------------------------ hits
  S.knockback = function (pAfter, d, w, bkb, kbg) {
    return (((pAfter / 10 + (pAfter * d) / 20) * (200 / (w + 100)) * 1.4 + 18) * (kbg / 100)) + bkb;
  };

  // A = attacker fighter (may be null for stage hazards), T = target, hb = hitbox-like {dmg, angle, bkb, kbg, ...}
  // dir = which way "forward" is (+1/-1), mult = damage multiplier (smash charge, buffs). Returns true if it connected.
  S.applyHit = function (g, A, T, hb, dir, mult = 1, src) {
    if (T.out || T.state === "dead" || T.state === "respawn") return false;
    if (T.invuln > 0 && !hb.throw) return false;
    const dmgRaw = hb.dmg * mult * (A && A.buffs.dmgBoost ? 1.15 : 1);
    const dmg = Math.round(dmgRaw * 10) / 10;

    // counters: projectiles are blocked (no free damage on a far-away shooter); melee hits get retaliated
    if (T.counter && src && !hb.throw) { S.fx.spark(g, src.x, src.y, "#fff", 6); return false; }
    if (T.counter && !hb.throw && !hb.grab && A) {
      const C = T.counter.counterCfg || {};
      const cd = Math.max(C.min || 8, dmg * (C.mult || 1.3));
      T.invuln = Math.max(T.invuln, 20);
      if (C.onCounter) C.onCounter(T, A, g, cd);
      const d2 = sign(A.x - T.x) || T.facing; T.facing = d2;
      S.applyHit(g, T, A, { dmg: cd, angle: C.angle != null ? C.angle : 40, bkb: C.bkb != null ? C.bkb : 40, kbg: C.kbg != null ? C.kbg : 90 }, d2, 1);
      T.counter = null;
      if (T.move && T.move.counterHit) { T.mf = T.move.counterHit; }
      S.fx.burst(g, T.x, T.y - T.h / 2, "#ffffff", 12);
      return false;
    }

    // grabs
    if (hb.grab) {
      if (!A || T.state === "grabbed" || T.state === "ledge" || T.state === "ledgeclimb" || T.grabbedBy || A.grabbed) return false;
      if (!T.grounded && !hb.airGrab) return false;
      if (hb.onGrab) { hb.onGrab(A, T, g); return true; }
      A.grabbed = T; T.grabbedBy = A;
      if (T.grabbed) { const U = T.grabbed; U.grabbedBy = null; U.setState("idle"); T.grabbed = null; }
      T.releaseLedge && T.ledge && T.releaseLedge();
      A.setState("grabbing"); A.grabTimer = Math.round(90 + T.damage * 0.6);
      T.setState("grabbed"); T.kbx = T.kby = 0; T.hitstun = 0; T.pendingLaunch = null;
      S.audio && S.audio.grab && S.audio.grab();
      return true;
    }

    // shields
    if (T.state === "shield" && !hb.throw && !hb.unblockable) {
      T.shieldHP -= dmg * (hb.shieldMult || 1);
      const stun = Math.floor(dmg * 0.45 + 2);
      T.shieldStun = stun; T.hitlag = Math.min(12, Math.floor(dmg / 3 + 2));
      if (A && !src) A.hitlag = T.hitlag;
      T.vx = (dir || sign(T.x - (A ? A.x : 0))) * Math.min(6, 1 + dmg * 0.3);
      S.fx.spark(g, T.x, T.y - T.h / 2, "#9fd8ff", 6);
      S.audio && S.audio.shieldHit && S.audio.shieldHit();
      if (T.shieldHP <= 0) T.shieldBreak(g);
      return false;
    }

    // a real hit
    T.damage = Math.min(999, T.damage + dmg);
    T.dmgTaken += dmg; if (A && A !== T) A.dmgDealt += dmg;
    if (A) { T.lastHitBy = A; T.lastHitAt = g.frame; }
    if (hb.onHitTarget) hb.onHitTarget(A, T, g);
    const kb = S.knockback(T.damage, dmg, T.stats.weight, hb.bkb, hb.kbg) * (hb.kbMult || 1);
    const hitlag = hb.noHitlag ? 0 : Math.min(20, Math.floor(dmg / 3 + 3));
    if (A && !src && !hb.throw) A.hitlag = Math.max(A.hitlag, hitlag);
    // flinchless / armor
    if (T.armor && kb < (T.move && T.move.armorKB || 140)) {
      T.hitlag = hitlag;
      S.fx.spark(g, T.x, T.y - T.h / 2, "#ffcf3a", 6);
      S.audio && S.audio.hit && S.audio.hit(dmg);
      return true;
    }
    let ang = hb.angle === 361 ? (kb < 32 ? 0 : 40) : hb.angle;
    ang = ang * DEG;
    if (dir < 0) ang = Math.PI - ang;   // mirror
    if (T.grabbed) { const U = T.grabbed; U.grabbedBy = null; U.setState("air"); T.grabbed = null; }
    if (T.grabbedBy && !hb.throw) { const G = T.grabbedBy; G.grabbed = null; G.setState("idle"); T.grabbedBy = null; }
    if (T.ledge) T.releaseLedge();
    T.setState("hitstun");
    T.hitstun = Math.floor(kb * 0.4);
    T.tumble = kb > 80;
    T.fastfall = false;
    T.hitlag = hitlag;
    T.pendingLaunch = { angle: ang, kb };
    if (hitlag === 0) T.launch(T.pendingLaunch, g);
    const hx = src ? src.x : (T.x + (A ? A.x : T.x)) / 2;
    S.fx.hit(g, hx, T.y - T.h / 2, dmg, kb);
    if (kb > 140) g.shake = Math.max(g.shake, 8);
    S.audio && S.audio.hit && S.audio.hit(dmg, kb);
    return true;
  };

  function circleRect(cx, cy, r, R) {
    const nx = clamp(cx, R.x1, R.x2), ny = clamp(cy, R.y1, R.y2);
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
  }
  S.circleRect = circleRect;

  // Active hitboxes of a fighter this frame, in world space.
  S.activeHitboxes = function (f) {
    if (f.state !== "attack" || !f.move || !f.move.hitboxes || f.charging && f.mf === f.move.charge) return [];
    const out = [];
    const list = typeof f.move.hitboxes === "function" ? f.move.hitboxes(f) : f.move.hitboxes;
    for (const h of list) {
      if (f.mf >= h.start && f.mf <= h.end) out.push({ h, x: f.x + h.x * f.facing, y: f.y + h.y, r: h.r });
    }
    return out;
  };

  // ------------------------------------------------------------ projectiles
  // g.spawn({ owner, x, y, vx, vy, r, dmg, angle, bkb, kbg, life, gravity, bounces, pierce, facing,
  //           update(p, g), draw(ctx, p, g), onHit(p, target, g), onExpire(p, g), solid (stops on stage), hitOwner })
  class Projectile {
    constructor(o) {
      Object.assign(this, { vx: 0, vy: 0, r: 8, dmg: 5, angle: 40, bkb: 20, kbg: 50, life: 120, gravity: 0, bounces: 0, pierce: false, solid: true, hits: new Set(), dead: false, t: 0 }, o);
      if (this.facing == null) this.facing = this.vx < 0 ? -1 : 1;
    }
  }
  S.Projectile = Projectile;

  function updateProjectiles(g) {
    for (const p of g.projectiles) {
      if (p.dead) continue;
      p.t++;
      if (p.update) p.update(p, g);
      if (p.dead) continue;
      p.vy += p.gravity;
      const oy = p.y;
      p.x += p.vx; p.y += p.vy;
      if (p.solid) {
        for (const P of g.platforms) {
          if (p.x < P.x1 || p.x > P.x2) continue;
          const crossedTop = oy + p.r <= P.y + 1 && p.y + p.r >= P.y && p.vy >= 0;
          const inside = P.solid && p.y > P.y && p.y < P.y + (P.depth || 60);
          if (crossedTop && (P.solid || P.pass)) {
            if (p.bounces > 0) { p.bounces--; p.y = P.y - p.r; p.vy = -Math.abs(p.vy) * (p.bounce != null ? p.bounce : 0.7); if (p.onBounce) p.onBounce(p, g); }
            else if (p.ground) { p.y = P.y - p.r; p.vy = 0; p.onGround = P; }
            else { p.dead = true; }
          } else if (inside) { p.dead = true; }
        }
      }
      if (--p.life <= 0) p.dead = true;
      const B = g.stage.blast;
      if (p.x < B.left || p.x > B.right || p.y > B.bottom || p.y < B.top) p.dead = true;
      if (p.dead && p.onExpire) p.onExpire(p, g);
    }
  }

  function projectileHits(g) {
    for (const p of g.projectiles) {
      if (p.dead || p.harmless) continue;
      for (const T of g.fighters) {
        if (T === p.owner && !p.hitOwner) continue;
        if (T.out || T.state === "dead" || p.hits.has(T)) continue;
        if (!circleRect(p.x, p.y, p.r, T.hurtbox())) continue;
        if (T.invuln > 0) continue;
        p.hits.add(T);
        const dir = p.knockDir ? p.knockDir(p, T) : (p.facing || 1);
        const ok = S.applyHit(g, p.owner, T, p, dir, p.mult || 1, p);
        if (ok && p.onHit) p.onHit(p, T, g);
        if (!p.pierce) { p.dead = true; if (p.onExpire) p.onExpire(p, g); break; }
      }
    }
    g.projectiles = g.projectiles.filter((p) => !p.dead);
  }

  // ------------------------------------------------------------ effects (cosmetic, but deterministic)
  S.fx = {
    spark(g, x, y, color, n) {
      for (let i = 0; i < n; i++) g.particles.push({ x, y, vx: g.rng.range(-3, 3), vy: g.rng.range(-4, 1), life: 18, max: 18, color, size: 3 });
    },
    burst(g, x, y, color, n) {
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.particles.push({ x, y, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, life: 24, max: 24, color, size: 4 }); }
    },
    ring(g, x, y, color) { g.particles.push({ x, y, ring: true, life: 14, max: 14, color, size: 10 }); },
    hit(g, x, y, dmg, kb) {
      g.particles.push({ x, y, star: true, life: 10, max: 10, color: kb > 140 ? "#ff5a3a" : "#fff59a", size: 10 + dmg * 1.6 });
      S.fx.spark(g, x, y, kb > 140 ? "#ff8a3a" : "#ffffff", Math.min(14, 3 + Math.floor(dmg / 2)));
    },
    koBlast(g, f) {
      const B = g.stage.blast;
      const x = clamp(f.x, B.left + 20, B.right - 20), y = clamp(f.y - f.h / 2, B.top + 20, B.bottom - 20);
      g.particles.push({ x, y, ko: true, life: 50, max: 50, color: S.PORT_COLORS[f.port], size: 300, ang: Math.atan2(-y, -x) });
    },
    text(g, x, y, text, color) { g.particles.push({ x, y, text, vx: 0, vy: -1, life: 50, max: 50, color: color || "#fff", size: 18 }); },
  };

  // ------------------------------------------------------------ the game
  class Game {
    // cfg: { stage: id, stocks, seed, players: [{ fighter: id, port: 0..3, cpu: bool, level, devices: [] }] }
    constructor(cfg) {
      this.cfg = cfg;
      this.rng = S.makeRng(cfg.seed || 1);
      this.frame = 0;
      this.stageDef = S.STAGES[cfg.stage] || S.STAGES[S.STAGE_ORDER[0]];
      this.stage = Object.assign({ blast: { left: -1150, right: 1150, top: -950, bottom: 650 }, respawn: { x: 0, y: -260 } }, this.stageDef);
      this.platforms = this.stageDef.platforms.map((p) => Object.assign({ dx: 0, dy: 0 }, p));
      this.state = {};   // stage scratch
      this.ledges = [];
      for (const P of this.platforms) if (P.solid && P.ledges !== false) {
        this.ledges.push({ x: P.x1, side: -1, plat: P, owner: null }, { x: P.x2, side: 1, plat: P, owner: null });
      }
      this.projectiles = [];
      this.particles = [];
      this.shake = 0;
      this.tapJump = false;
      this.fighters = cfg.players.map((pl, i) => {
        const def = S.FIGHTERS[pl.fighter] || S.FIGHTERS[S.FIGHTER_ORDER[0]];
        const sp = (this.stage.spawns || [])[i] || { x: -200 + i * 130, y: -20 };
        const f = new Fighter(def, pl.port != null ? pl.port : i, { cpu: pl.cpu, level: pl.level, devices: pl.devices, stocks: cfg.stocks || 4, x: sp.x, y: sp.y, facing: sp.x > 0 ? -1 : 1 });
        if (pl.cpu && S.AI) f.brain = S.AI.create(f, pl.level || 2, this);
        return f;
      });
      if (this.stageDef.init) this.stageDef.init(this.stage, this);
      for (const f of this.fighters) if (f.def.init) f.def.init(f, this);
      this.over = false; this.overTimer = 0; this.winner = null;
    }

    spawn(o) { const p = new Projectile(o); this.projectiles.push(p); return p; }

    // pads must be filled in before step() (engine reads input / runs AI)
    step() {
      this.frame++;
      const st = this.stageDef;
      // moving platforms: stage updates set P.dx/P.dy and move the platform
      for (const P of this.platforms) { P.dx = 0; P.dy = 0; }
      if (st.update) st.update(this.stage, this);
      for (const L of this.ledges) L.x = L.side < 0 ? L.plat.x1 : L.plat.x2;

      const order = this.fighters;
      for (const f of order) f.update(this);
      // fighter hitboxes vs hurtboxes
      for (const A of order) {
        if (A.hitlag > 0 || A.out) continue;
        const boxes = S.activeHitboxes(A);
        if (!boxes.length) continue;
        for (const T of order) {
          if (T === A || A.hitSet.has(T) || T.out) continue;
          const hr = T.hurtbox();
          for (const b of boxes) {
            if (!circleRect(b.x, b.y, b.r, hr)) continue;
            if (T.invuln > 0 && !b.h.grab) break;
            A.hitSet.add(T);
            const ok = S.applyHit(this, A, T, b.h, A.facing, A.chargeMult);
            if (ok && A.move && A.move.onHit) A.move.onHit(A, T, this, b.h);
            break;
          }
        }
      }
      updateProjectiles(this);
      projectileHits(this);
      for (const p of this.particles) { p.life--; if (p.vx != null) { p.x += p.vx; p.y += p.vy; p.vy += 0.15; } }
      this.particles = this.particles.filter((p) => p.life > 0);
      if (this.shake > 0) this.shake--;

      // game over?
      const alive = this.fighters.filter((f) => !f.out && (f.stocks > 0 || f.state !== "dead"));
      if (!this.over && this.fighters.length > 1 && alive.length <= 1) {
        this.over = true; this.winner = alive[0] || null;
      }
      if (this.over) this.overTimer++;
    }
  }
  S.Game = Game;
})();
