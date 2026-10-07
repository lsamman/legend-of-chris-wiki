/* Super Smash Ballers — boot splash. A dark "press any button" screen (browsers only allow sound after a gesture),
   then a dramatic intro: a studio card, light rushing in, the emblem slamming down with a flash and shockwave,
   the title words slamming in on the brass hits, a shine, then a fade to the title screen. Any input skips it.
   Timings come from S.audio.INTRO_TIMES so the picture lands on the music. Plays once per browser session. */
(function () {
  "use strict";
  const S = window.Smash;
  const T = (S.audio && S.audio.INTRO_TIMES) || { impact: 3.2, fanfare: [3.95, 4.3, 4.65], words: [5.3, 5.62, 5.94], final: 6.5, end: 9.2 };
  const WORDS = [["SUPER", "#e8333a"], ["SMASH", "#e8333a"], ["BALLERS", "#ffd23f"]];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (u) => 1 - Math.pow(1 - clamp01(u), 3);
  const easeBack = (u) => { u = clamp01(u); const c = 2.2; return 1 + (c + 1) * Math.pow(u - 1, 3) + c * Math.pow(u - 1, 2); };

  // The emblem: a golden broken ring around a glowing basketball (it's all about balling).
  function emblem(c, R, glow, spin) {
    c.save();
    c.shadowColor = "rgba(255,200,80," + (0.55 + glow * 0.45) + ")"; c.shadowBlur = R * (0.35 + glow * 0.5);
    // ring: four arcs with gaps, metallic gradient
    const g = c.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, "#fff6c8"); g.addColorStop(0.35, "#ffd23f"); g.addColorStop(0.6, "#b8860b"); g.addColorStop(1, "#ffe98a");
    c.strokeStyle = g; c.lineWidth = R * 0.16; c.lineCap = "butt";
    for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(0, 0, R, spin + k * Math.PI / 2 + 0.12, spin + (k + 1) * Math.PI / 2 - 0.12); c.stroke(); }
    c.shadowBlur = 0;
    // ball
    const r = R * 0.68;
    const bg = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    bg.addColorStop(0, "#ffb15c"); bg.addColorStop(0.55, "#e8701a"); bg.addColorStop(1, "#8a3a06");
    c.fillStyle = bg; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    c.strokeStyle = "#1a0d04"; c.lineWidth = r * 0.07;
    c.beginPath(); c.moveTo(0, -r); c.lineTo(0, r); c.moveTo(-r, 0); c.lineTo(r, 0); c.stroke();
    c.beginPath(); c.ellipse(-r * 1.02, 0, r * 0.62, r * 1.05, 0, -Math.PI / 2, Math.PI / 2); c.stroke();
    c.beginPath(); c.ellipse(r * 1.02, 0, r * 0.62, r * 1.05, 0, Math.PI / 2, Math.PI * 1.5); c.stroke();
    // gloss
    const hl = c.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * 0.8);
    hl.addColorStop(0, "rgba(255,255,255,.55)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = hl; c.fillRect(-r, -r, r * 2, r * 2);
    c.restore();
    c.restore();
  }
  function rays(c, R, t, strength) {
    c.save(); c.rotate(t * 0.25);
    for (let i = 0; i < 16; i++) {
      c.rotate(Math.PI / 8);
      const gr = c.createLinearGradient(0, 0, R * 6, 0);
      gr.addColorStop(0, "rgba(255,220,120," + 0.35 * strength + ")"); gr.addColorStop(1, "rgba(255,220,120,0)");
      c.fillStyle = gr; c.beginPath(); c.moveTo(0, 0); c.lineTo(R * 6, -R * 0.35); c.lineTo(R * 6, R * 0.35); c.closePath(); c.fill();
    }
    c.restore();
  }
  function bigText(c, str, x, y, size, fill, alpha) {
    c.save(); c.globalAlpha = alpha; c.font = `900 ${size}px ${S.FONT_BIG}`; c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.lineJoin = "round"; c.lineWidth = size * 0.14; c.strokeStyle = "#141414"; c.strokeText(str, x + size * 0.05, y + size * 0.05);
    c.fillStyle = "#141414"; c.fillText(str, x + size * 0.05, y + size * 0.05);
    c.strokeText(str, x, y); c.fillStyle = fill; c.fillText(str, x, y);
    c.restore();
  }

  function intro(then) {
    const go = then || (() => S.ui.title());
    let started = 0, gateT = 0, leaving = 0;
    const streaks = Array.from({ length: 160 }, () => ({ a: Math.random() * Math.PI * 2, d: 0.6 + Math.random() * 0.7, sp: 0.7 + Math.random() * 0.6, hue: Math.random() < 0.7 ? 45 : 200 }));
    const sparks = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, v: 0.3 + Math.random() * 1.1, s: 1 + Math.random() * 2.5 }));
    const anyPadButton = () => { const ps = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of ps || []) if (p && p.buttons && p.buttons.some((b) => b.pressed)) return true; return false; };
    let padWasDown = anyPadButton();
    const finish = () => { try { sessionStorage.setItem("smash.introSeen", "1"); } catch (e) { /* ignore */ } go(); };
    const sc = {
      enter() { S.input.takePresses(); S.input.takeClick(); },
      update() {
        const presses = S.input.takePresses(), click = S.input.takeClick();
        const padNow = anyPadButton(), padPress = padNow && !padWasDown; padWasDown = padNow;
        const pressed = presses.some((k) => k !== "KeyM") || click || padPress;
        if (!started) {
          gateT++;
          if (pressed) { started = performance.now(); try { S.audio && S.audio.intro && S.audio.intro(); } catch (e) { /* ignore */ } }
          return;
        }
        const el = (performance.now() - started) / 1000;
        if (leaving) { if (performance.now() - leaving > 380) finish(); return; }
        if (pressed && el > 0.4) { leaving = performance.now(); try { S.audio && S.audio.stopIntro && S.audio.stopIntro(); } catch (e) { /* ignore */ } }
        else if (el > T.end) finish();
      },
      render(c, W, H) {
        const cx = W / 2, cy = H * 0.4, R = Math.min(W, H) * 0.16;
        c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
        if (!started) {   // the gate
          const p = (Math.sin(gateT * 0.05) + 1) / 2;
          c.save(); c.translate(cx, H * 0.42); c.globalAlpha = 0.25 + p * 0.25; emblem(c, R * 0.55, p * 0.4, gateT * 0.004); c.restore();
          c.globalAlpha = 0.45 + p * 0.55;
          c.font = `900 ${Math.max(16, Math.min(28, W / 40))}px ${S.FONT_BIG}`; c.textAlign = "center"; c.fillStyle = "#fff";
          c.fillText("PRESS ANY BUTTON", cx, H * 0.72);
          c.globalAlpha = 0.5; c.font = `bold 14px ${S.FONT}`; c.fillText("(sound on for the full experience)", cx, H * 0.72 + 30);
          c.globalAlpha = 1;
          return;
        }
        const el = (performance.now() - started) / 1000;
        // background: black → deep night glow after the impact
        const bgA = clamp01((el - 1.2) / 2) * (el < T.impact ? 0.6 : 1);
        const bg = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
        bg.addColorStop(0, `rgba(60,40,140,${0.85 * bgA})`); bg.addColorStop(0.5, `rgba(20,14,60,${0.8 * bgA})`); bg.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = bg; c.fillRect(0, 0, W, H);
        // screen shake on hits
        let shake = 0;
        const hit = (at, amt, len) => { if (el >= at && el < at + len) shake = Math.max(shake, amt * (1 - (el - at) / len)); };
        hit(T.impact, 22, 0.45); T.fanfare.forEach((a) => hit(a, 6, 0.2)); T.words.forEach((a) => hit(a, 10, 0.25)); hit(T.final, 14, 0.4);
        c.save(); c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        // 1) studio card
        if (el < 1.9) {
          const a = el < 0.5 ? el / 0.5 : el < 1.3 ? 1 : 1 - (el - 1.3) / 0.6;
          c.globalAlpha = clamp01(a);
          c.fillStyle = "#fff"; c.textAlign = "center";
          c.font = `900 ${Math.min(54, W / 16)}px ${S.FONT_BIG}`;
          // letter-spaced by real glyph widths, slowly opening up like a film studio card
          const word = "DREAMLINER", gap = Math.min(54, W / 16) * (0.18 + el * 0.06);
          const ws = [...word].map((ch) => c.measureText(ch).width), tot = ws.reduce((a, b) => a + b, 0) + gap * (word.length - 1);
          let wx = cx - tot / 2; c.textAlign = "left";
          [...word].forEach((ch, i) => { c.fillText(ch, wx, H * 0.5); wx += ws[i] + gap; });
          c.textAlign = "center";
          c.font = `bold ${Math.min(20, W / 45)}px ${S.FONT_COMIC}`; c.fillStyle = "#bbb";
          c.fillText("presents", cx, H * 0.5 + 40);
          c.globalAlpha = 1;
        }
        // 2) light rushing to the centre
        if (el > 1.4 && el < T.impact + 0.1) {
          const u = clamp01((el - 1.4) / (T.impact - 1.4));
          for (const s of streaks) {
            const prog = (u * s.sp * 1.6 + s.d) % 1;           // 0 far → 1 centre
            const r1 = (1 - prog) * Math.max(W, H) * 0.8, r2 = r1 + 20 + prog * 160 * (0.4 + u);
            c.strokeStyle = `hsla(${s.hue},100%,${70 + prog * 25}%,${0.15 + prog * 0.75 * u})`; c.lineWidth = 1 + prog * 3;
            c.beginPath(); c.moveTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); c.lineTo(cx + Math.cos(s.a) * r2, cy + Math.sin(s.a) * r2); c.stroke();
          }
          const core = c.createRadialGradient(cx, cy, 0, cx, cy, R * (0.2 + u * 1.2));
          core.addColorStop(0, `rgba(255,240,200,${0.9 * u})`); core.addColorStop(1, "rgba(255,240,200,0)");
          c.fillStyle = core; c.beginPath(); c.arc(cx, cy, R * (0.2 + u * 1.2), 0, Math.PI * 2); c.fill();
        }
        // 3) the emblem slams in
        if (el >= T.impact - 0.22) {
          const u = (el - (T.impact - 0.22)) / 0.22;
          const scale = u < 1 ? 5 - 4 * easeOut(u) : 1 + Math.sin((el - T.impact) * 2.2) * 0.012;
          let glow = 0; T.fanfare.forEach((a) => { if (el >= a) glow = Math.max(glow, 1 - (el - a) / 0.35); });
          if (el >= T.final) glow = Math.max(glow, 1 - (el - T.final) / 0.6);
          const settle = el > T.words[0] - 0.1 ? easeOut((el - T.words[0] + 0.1) / 0.4) : 0;   // lift up to make room for the words
          c.save(); c.translate(cx, cy - settle * R * 0.45);
          if (el >= T.impact) rays(c, R, el, 0.6 + glow * 0.6);
          c.globalAlpha = clamp01(u * 1.5); c.scale(scale * (1 - settle * 0.25), scale * (1 - settle * 0.25));
          emblem(c, R, clamp01(glow), el * 0.35);
          c.restore();
          // shockwave
          if (el >= T.impact && el < T.impact + 0.9) {
            const v = (el - T.impact) / 0.9;
            c.strokeStyle = `rgba(255,235,180,${1 - v})`; c.lineWidth = 14 * (1 - v) + 2;
            c.beginPath(); c.arc(cx, cy, R * (1 + v * 5), 0, Math.PI * 2); c.stroke();
          }
          // sparks burst
          if (el >= T.impact && el < T.impact + 1.6) {
            const v = (el - T.impact) / 1.6;
            for (const p of sparks) {
              const d = R * (0.9 + p.v * 5 * easeOut(v));
              c.fillStyle = `rgba(255,${200 + p.v * 50 | 0},120,${1 - v})`;
              c.beginPath(); c.arc(cx + Math.cos(p.a) * d, cy + Math.sin(p.a) * d, p.s * (1 - v * 0.6), 0, Math.PI * 2); c.fill();
            }
          }
        }
        // 4) the title words slam in on the brass hits
        // the three words must fit the screen: measure at a reference size, then scale to 88% of the width
        let size = Math.min(W / 7.2, H / 6.4);
        c.font = `900 ${size}px ${S.FONT_BIG}`;
        const full = WORDS.map(([w], i) => c.measureText(w).width * (i === 2 ? 1.06 : 1) + c.measureText(" ").width).reduce((a, b) => a + b, 0);
        if (full > W * 0.88) size *= (W * 0.88) / full;
        const ty = cy + R * 0.95 + size * 0.85;
        const xs = (() => { c.font = `900 ${size}px ${S.FONT_BIG}`; const ws = WORDS.map(([w], i) => c.measureText(w).width * (i === 2 ? 1.06 : 1) + c.measureText(" ").width); const tot = ws.reduce((a, b) => a + b, 0); let x = cx - tot / 2; return ws.map((w) => { const m = x + w / 2; x += w; return m; }); })();
        WORDS.forEach(([w, col], i) => {
          const at = T.words[i]; if (el < at) return;
          const u = (el - at) / 0.18, sc = u < 1 ? 2.6 - 1.6 * easeBack(u) : 1;
          c.save(); c.translate(xs[i], ty); c.scale(sc, sc);
          bigText(c, w, 0, 0, size * (i === 2 ? 1.06 : 1), col, clamp01(u * 2));
          c.restore();
        });
        // 5) final: shine sweep + subtitle
        if (el >= T.final) {
          const v = (el - T.final) / 0.8;
          if (v < 1) {
            c.save(); c.globalCompositeOperation = "lighter";
            const sx = W * (-0.2 + v * 1.4);
            const sh = c.createLinearGradient(sx - 120, 0, sx + 120, 0);
            sh.addColorStop(0, "rgba(255,255,255,0)"); sh.addColorStop(0.5, "rgba(255,255,255,.55)"); sh.addColorStop(1, "rgba(255,255,255,0)");
            c.fillStyle = sh; c.fillRect(0, ty - size, W, size * 1.3);
            c.restore();
          }
          const sa = clamp01((el - T.final - 0.3) / 0.6);
          c.globalAlpha = sa; c.fillStyle = "#fff"; c.textAlign = "center";
          c.font = `900 ${Math.min(26, W / 34)}px ${S.FONT_BIG}`;
          const sub = "T H E   L E G E N D   O F   C H R I S";
          c.fillText(sub, cx, ty + size * 0.62);
          c.globalAlpha = 1;
        }
        c.restore();
        // flashes
        const flash = (at, peak, len) => { if (el >= at && el < at + len) { c.fillStyle = `rgba(255,255,255,${peak * (1 - (el - at) / len)})`; c.fillRect(0, 0, W, H); } };
        flash(T.impact, 1, 0.55); flash(T.final, 0.6, 0.45); T.words.forEach((a) => flash(a, 0.18, 0.15));
        // fade to white into the (white paper) title screen, or out fast when skipped
        const out = leaving ? clamp01((performance.now() - leaving) / 380) : clamp01((el - (T.end - 0.7)) / 0.7);
        if (out > 0) { c.fillStyle = `rgba(255,253,244,${out})`; c.fillRect(0, 0, W, H); }
        if (el > 0.6 && el < T.end - 0.8 && !leaving) {
          c.fillStyle = "rgba(255,255,255,.35)"; c.font = `bold 13px ${S.FONT}`; c.textAlign = "right";
          c.fillText("any button to skip", W - 16, H - 16);
        }
      },
    };
    S.setScene(sc);
  }

  // Boot: the intro the first time in a browser session (or never with ?skipintro), then the title.
  S.ui = S.ui || {};
  S.ui.intro = intro;
  S.ui.boot = function () {
    let seen = false;
    try { seen = sessionStorage.getItem("smash.introSeen") === "1"; } catch (e) { /* ignore */ }
    if (seen || /[?&]skipintro\b/.test(location.search)) S.ui.title(); else intro();
  };
})();
