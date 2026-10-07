# Super Smash Ballers — contributor notes

A Melee-style platform fighter for the Legend of Chris wiki. Vanilla JS + Canvas 2D, no dependencies, no build step
(`build/build.py` copies this folder to `site/smash/`). Everything hangs off `window.Smash` (`S`).

Load order (see `smash.html`): `core.js` → `game.js` → `render.js` → `audio.js` → `fighters-a.js` → `fighters-b.js`
→ `stages.js` → `ai.js` → `ui.js` → `engine.js` (boots).

## Files
| file | owns |
|---|---|
| core.js | namespace, registries, seeded RNG, keyboard/gamepad → virtual pads |
| game.js | the deterministic sim: Fighter state machine, physics, moves/hitboxes, knockback, shields, grabs, ledges, projectiles, `S.Game` |
| render.js | `S.drawHumanoid` rig + `S.pose`, fighter overlays, particles, default platform drawing |
| render3d.js | 3D fighters: three.js world/portrait rendering and the modelling toolkit `S.K3` (`K.humanoid`, `K.poseHumanoid`, primitives, painted textures) |
| three.module.min.js, three.core.min.js | three.js 0.184 (MIT, see three.LICENSE.txt), loaded as a module by smash.html |
| engine.js | loop, camera, match scene, HUD, pause, boot, `?quick=` test URLs, `S.simulate` |
| fighters-a.js / fighters-b.js | the roster (4 each) |
| stages.js | the 5 stages |
| audio.js | WebAudio SFX/music (`S.audio`) |
| ai.js | CPU players (`S.AI`) |
| ui.js | title, character select, stage select, results (`S.ui`) |

## Rules
- The sim must stay deterministic: in sim code (moves, projectiles, stage updates, AI) use `g.rng()`, never `Math.random()`.
  Drawing code may use anything (prefer `g.frame` for animation).
- Units are pixels at zoom 1; y grows DOWN; a fighter's `(x, y)` is between its feet. 60 ticks/s.
- Melee scale: 5 px = 1 Melee unit. Main stages are ~700–900 px wide; blast zones ~±1150 x, -950 top, +650 bottom.

## Controls
- P1 keys: WASD move, F attack, G special, H/Space jump, T/LShift shield.
- P2 keys: arrows move, `,` attack, `.` special, `/` jump, RShift shield (numpad 1/2/3/0 also work).
- Gamepads (Gamepad API): A attack, B special, X/Y jump, LT/RT (analog) or LB shield, RB grab (Z), right stick = C-stick
  (smash attacks on the ground, aerials in the air), Start/Back pause, V (while paused) toggles rumble.
  - XInput pads (Xbox) work directly. Steam Input works through Steam's virtual XInput gamepad (run the browser as a
    non-Steam game, or on Steam Deck), which also covers PlayStation, Switch, Steam Controller and Deck controls.
    A web page cannot call the native Steamworks Steam Input API; the browser only sees the virtual pad.
  - Non-"standard" layouts that some browsers report (raw XInput/xpad, Steam Virtual Gamepad, DualShock/DualSense on
    Linux Firefox) are recognised by vendor/product id and remapped (`S.input.describe`). Menus label each slot with
    the controller type and the title screen shows matching button names.
  - Rumble on hits and KOs via `vibrationActuator` (Chrome/Edge; Steam Input passes it through).
- Keyboard: double-tap a direction to dash; tap a direction + attack together for a smash attack; hold a direction then attack for a tilt.
- Enter/Esc pause, R restart, Q quit (while paused), backquote toggles hitbox view.

## Fighter definition (`S.registerFighter(def)`)
```js
{
  id: "lebron-james",          // = wiki slug
  slug: "lebron-james",        // wiki page, linked from character select (../<slug>.html)
  name: "LeBron James", short: "LeBron",
  tagline: "Balled into the sky. Cannot abide cringe.",   // from the wiki subtitle
  color: "#552583",            // UI / stock icon colour
  stats: { weight, walk, run, dashInit, traction, airSpeed, airAccel, airFriction, gravity, fallSpeed, fastFall,
           jump, shortHop, airJump, jumps, jumpsquat, width, height },   // any subset; see S.DEFAULT_STATS
  reach: 1, power: 1,          // scale the generic moveset (S.genericMoves)
  moves: { ...overrides },     // see move names below
  draw(ctx, f, g) { },         // origin = feet, already mirrored so +x is "forward". Use S.drawHumanoid or custom.
  init(f, g), tick(f, g), onKO(f, g),   // optional hooks
  ai: { ranged: true, recover: "uspecial", killMoves: ["fsmash"] },  // optional hints for ai.js
  moveNames: { nspecial: "Chase-Down Pass", ... },                    // optional display names for the controls screen
}
```
Move names: `jab ftilt utilt dtilt dash fsmash usmash dsmash nair fair bair uair dair grab pummel fthrow bthrow uthrow dthrow
ledgeattack getupattack nspecial sspecial uspecial dspecial`. A move named `<name>Air` (e.g. `nspecialAir`) is used instead
when the fighter is airborne.

## Move definition
```js
{
  frames: 40,                  // total length
  hitboxes: [S.hb(start, end, x, y, r, dmg, angle, bkb, kbg, extra)],   // or a function (f) => [...]
  //   x forward / y up-negative from the feet; angle degrees (0 fwd, 90 up, 180 back, -90 spike, 361 sakurai)
  //   extra: { grab, airGrab, onGrab(A,T,g), unblockable, shieldMult, kbMult, onHitTarget(A,T,g) }
  air: true, landingLag: 12,   // aerials: landing cancels into landingLag
  charge: 6,                   // smash charge frame (hold attack to charge up to 60f, ×1.4 dmg)
  iasa: 30,                    // can act from this frame
  helpless: true,              // ends in special fall if airborne (up-B)
  ledgeGrab: true,             // may grab ledges during the move
  armor: [5, 20], armorKB: 140,// super armor window
  counter: [4, 24],            // counter window; when hit inside it, retaliate with counterCfg and jump to frame counterHit
  counterHit: 30, counterCfg: { mult: 1.3, min: 8, angle: 40, bkb: 40, kbg: 90, onCounter(me, attacker, g, dmg) {} },
  invuln: [1, 10],
  noGravity: true | [a, b], gravityMult: 0.5, noAirControl: true, keepMomentum: true, crouch: true,
  throwHit: { frame, dmg, angle, bkb, kbg, keepHold },   // throws/pummel
  pose: "kick" | "punch" | "both" | (f, P) => {},        // how the rig animates
  start(f, g, pad), update(f, g, mf, pad), end(f, g), onHit(f, target, g, hb), onLand(f, g)
}
```

## 3D models
Fighters are 3D when `def.model = { build(T, K) -> model, update?(model, f, g, P, opts) }` is set and WebGL works
(`?flat=1` forces the 2D fallback). Most fighters use `K.humanoid(spec)` (see the spec comment in render3d.js) and the default
update `K.poseHumanoid`, which reads the same `S.pose()` angles as the 2D rig, so move `pose` functions animate both.
- The model faces +X, y up, origin at the feet; it is turned ¾ toward the camera (`K.yawFor`).
- Props attach to `model.armF.hand` (local -Y runs along the forearm).
- `def.posePatch(f, P, g)` tweaks the pose for both 2D and 3D.
- Effects stay 2D: `def.drawFx` (over the body) and `def.drawFxBehind`, both in `def.draw` coordinates. `def.draw` remains the
  full 2D fallback and is used when 3D is unavailable.
- Projectiles can render in 3D with `model3d(T, K, p)` and `update3d(obj, p, g)`.
- Reference: Chris in fighters-a.js.

## Projectiles: `g.spawn({...})`
`owner, x, y, vx, vy, r, dmg, angle, bkb, kbg, life, gravity, bounces, bounce, pierce, facing, solid, ground, harmless,
hitOwner, behind, update(p,g), draw(ctx,p,g), onHit(p,T,g), onExpire(p,g), onBounce(p,g), knockDir(p,T)`.
Stage hazards spawn with `owner: null`.

## Stage definition (`S.registerStage(def)`)
```js
{
  id, slug, name, tagline,
  platforms: [{ x1, x2, y, solid: true, depth: 140 }, { x1, x2, y, pass: true }],   // solid ones get ledges
  blast: { left, right, top, bottom }, spawns: [{x,y} ×4], respawn: { x, y },
  init(stage, g), update(stage, g),          // moving platforms: change P.x1/x2/y AND set P.dx/P.dy to the delta
  drawBg(ctx, stage, g, cam, W, H),           // screen space; cam = { x, y, zoom } for parallax
  drawMid(ctx, stage, g, cam), drawPlatforms(ctx, stage, g), drawFg(ctx, stage, g, cam),   // world space
  thumb(ctx, w, h),                           // small preview for stage select (screen space, 0,0 → w,h)
}
```

## Testing
- `python3 -m http.server -d build/smash 8765`, then open `smash.html?quick=chris,lebron-james&stage=the-court&cpu=0,2&debug=1`.
- `S.simulate(cfg, ticks, padFn?)` runs a headless match (CPU brains drive pads when no padFn is given).
