/* Super Smash Ballers — audio. Everything is procedural WebAudio (no files).
   The AudioContext is created lazily on the first user gesture (key, mouse, touch or gamepad button),
   because browsers block autoplay. Every public method is wrapped so it can never throw.
   M toggles mute (remembered in localStorage). Music is a quiet procedural loop per stage. */
(function () {
  "use strict";
  const S = (window.Smash = window.Smash || {});
  const KEY = "smash.muted";
  const MASTER = 0.55, SFX = 0.9, MUSIC = 0.16;

  let ac = null, master = null, sfxBus = null, musBus = null, noiseBuf = null, comp = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) { /* storage blocked */ }
  let wantMusic = null;          // stage id requested before the context existed
  const last = {};               // per-sound rate limiting (seconds)

  function ensure() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ac.createGain(); master.gain.value = muted ? 0 : MASTER;
    sfxBus = ac.createGain(); sfxBus.gain.value = SFX;
    musBus = ac.createGain(); musBus.gain.value = MUSIC;
    sfxBus.connect(comp); musBus.connect(comp); comp.connect(master); master.connect(ac.destination);
    // one second of white noise, reused by every noise voice
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ac;
  }
  function ready() { return ac && ac.state === "running" && !muted; }
  function unlock() {
    try {
      if (!ensure()) return;
      if (ac.state === "suspended") ac.resume().then(() => { if (wantMusic && !seq) startMusic(wantMusic); }).catch(() => {});
      else if (wantMusic && !seq) startMusic(wantMusic);
    } catch (e) { /* ignore */ }
  }
  function limit(name, gap) {
    const t = ac.currentTime;
    if (last[name] != null && t - last[name] < gap) return false;
    last[name] = t; return true;
  }

  // ------------------------------------------------------------ voices
  // Pitched blip: frequency sweep with a fast attack and exponential decay.
  function tone(o) {
    const t = ac.currentTime + (o.delay || 0);
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + (o.slide || o.dur));
    const v = o.vol == null ? 0.2 : o.vol, dur = o.dur || 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (o.att || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = g;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; g.connect(f); out = f; }
    osc.connect(g); out.connect(o.bus || sfxBus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }
  // Filtered noise burst.
  function noise(o) {
    const t = ac.currentTime + (o.delay || 0);
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = o.rate || 1; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = o.filter || "bandpass"; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f2), t + o.dur);
    const g = ac.createGain(), v = o.vol == null ? 0.2 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (o.att || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus || sfxBus);
    const off = Math.random() * 0.5;
    src.start(t, off, o.dur + 0.05);
  }

  // ------------------------------------------------------------ sound effects
  const fx = {
    hit(dmg, kb) {
      if (!limit("hit", 0.025)) return;
      dmg = Math.max(1, Math.min(30, +dmg || 5)); kb = +kb || 0;
      const k = dmg / 30;                                   // 0..1
      noise({ f: 2600 - k * 1500, f2: 300, q: 0.9, dur: 0.05 + k * 0.12, vol: 0.18 + k * 0.32, filter: "bandpass" });
      tone({ type: "sine", f: 190 - k * 70, f2: 45, dur: 0.07 + k * 0.16, vol: 0.12 + k * 0.4 });
      if (dmg >= 9) tone({ type: "square", f: 140, f2: 60, dur: 0.08 + k * 0.1, vol: 0.05 + k * 0.08, lp: 900 });
      if (kb > 140) {
        // big launch: crunchy smack + rising whistle
        noise({ f: 900, f2: 120, q: 0.6, dur: 0.35, vol: 0.3, filter: "lowpass", delay: 0.01 });
        tone({ type: "sawtooth", f: 300, f2: 1600, dur: 0.28, vol: 0.05, lp: 2600, delay: 0.05 });
      }
    },
    ko() {
      if (!limit("ko", 0.15)) return;
      noise({ f: 1800, f2: 60, q: 0.5, dur: 1.1, vol: 0.5, filter: "lowpass", att: 0.005 });
      tone({ type: "sine", f: 110, f2: 28, dur: 0.9, vol: 0.55 });
      tone({ type: "triangle", f: 1320, f2: 2640, dur: 0.35, vol: 0.08, delay: 0.02 });
      tone({ type: "triangle", f: 1760, f2: 3520, dur: 0.4, vol: 0.06, delay: 0.1 });
    },
    jump() {
      if (!limit("jump", 0.04)) return;
      tone({ type: "triangle", f: 260 + Math.random() * 30, f2: 560, slide: 0.07, dur: 0.1, vol: 0.07 });
      noise({ f: 3000, q: 0.7, dur: 0.05, vol: 0.03 });
    },
    ledge() {
      if (!limit("ledge", 0.05)) return;
      tone({ type: "square", f: 1200, f2: 700, dur: 0.04, vol: 0.05, lp: 3000 });
      noise({ f: 4000, q: 2, dur: 0.03, vol: 0.06 });
    },
    grab() {
      if (!limit("grab", 0.05)) return;
      noise({ f: 600, f2: 200, q: 1, dur: 0.1, vol: 0.18, filter: "lowpass" });
      tone({ type: "triangle", f: 220, f2: 150, dur: 0.1, vol: 0.12 });
    },
    shieldHit() {
      if (!limit("shieldHit", 0.03)) return;
      tone({ type: "sine", f: 1400, dur: 0.12, vol: 0.08 });
      tone({ type: "sine", f: 2130, dur: 0.09, vol: 0.05 });
      noise({ f: 5000, q: 3, dur: 0.04, vol: 0.05 });
    },
    shieldBreak() {
      noise({ f: 6000, f2: 800, q: 1.5, dur: 0.5, vol: 0.3, filter: "highpass" });
      [1760, 1318, 988, 740, 554].forEach((f, i) => tone({ type: "triangle", f, dur: 0.18, vol: 0.09, delay: i * 0.06 }));
      tone({ type: "sine", f: 90, f2: 40, dur: 0.4, vol: 0.3 });
    },
    thud() {
      if (!limit("thud", 0.05)) return;
      noise({ f: 400, f2: 80, q: 0.7, dur: 0.14, vol: 0.22, filter: "lowpass" });
      tone({ type: "sine", f: 80, f2: 40, dur: 0.15, vol: 0.25 });
    },
    count(isGo) {
      if (isGo) { [523, 659, 784, 1047].forEach((f) => tone({ type: "square", f, dur: 0.5, vol: 0.045, lp: 3500 })); tone({ type: "sine", f: 1047, dur: 0.6, vol: 0.1 }); }
      else { tone({ type: "square", f: 440, dur: 0.18, vol: 0.06, lp: 2500 }); tone({ type: "sine", f: 880, dur: 0.12, vol: 0.05 }); }
    },
    game() {
      wantMusic = null; stopMusic();
      noise({ f: 1500, f2: 100, q: 0.5, dur: 0.8, vol: 0.25, filter: "lowpass" });
      [392, 523, 659, 784].forEach((f, i) => tone({ type: "sawtooth", f, dur: 0.9 - i * 0.1, vol: 0.05, lp: 2400, delay: i * 0.09 }));
      tone({ type: "sine", f: 98, f2: 49, dur: 1, vol: 0.3 });
    },
    pause() { tone({ type: "square", f: 880, dur: 0.06, vol: 0.05, lp: 3000 }); tone({ type: "square", f: 660, dur: 0.08, vol: 0.05, lp: 3000, delay: 0.07 }); },
    menu() { if (!limit("menu", 0.03)) return; tone({ type: "triangle", f: 880, dur: 0.05, vol: 0.06 }); },
    select() { tone({ type: "triangle", f: 660, dur: 0.08, vol: 0.08 }); tone({ type: "triangle", f: 990, dur: 0.14, vol: 0.08, delay: 0.07 }); },
    back() { tone({ type: "triangle", f: 700, dur: 0.07, vol: 0.07 }); tone({ type: "triangle", f: 470, dur: 0.12, vol: 0.07, delay: 0.06 }); },
    coin() { tone({ type: "square", f: 988, dur: 0.07, vol: 0.04, lp: 4000 }); tone({ type: "square", f: 1319, dur: 0.25, vol: 0.04, lp: 4000, delay: 0.07 }); },
  };

  // ------------------------------------------------------------ music
  // Each stage gets a small loop: drums + bass + soft chord pad + a sparse lead, in its own key and tempo.
  const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
  const SONGS = {
    // degrees are scale steps for chord roots (one per bar)
    "the-court":                 { bpm: 96,  root: 45, scale: "minor",    prog: [0, 5, 3, 4], kick: "x...x..x..x.x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.xx", lead: "square",   pad: "sawtooth", swing: 0.12 },
    "shadow-realm":              { bpm: 66,  root: 38, scale: "phrygian", prog: [0, 1, 0, 6], kick: "x.......x.......", snare: "........x.......", hat: "..x...x...x...x.", lead: "sine",     pad: "sawtooth", swing: 0 },
    "vending-machine-labyrinth": { bpm: 124, root: 40, scale: "dorian",   prog: [0, 3, 0, 4], kick: "x...x...x...x...", snare: "....x.......x..x", hat: "xxxxxxxxxxxxxxxx", lead: "square",   pad: "square",   swing: 0, arp: true },
    "stairway-to-heaven":        { bpm: 80,  root: 48, scale: "major",    prog: [0, 6, 5, 4], kick: "x.......x.....x.", snare: "........x.......", hat: "x...x...x...x...", lead: "triangle", pad: "sine",     swing: 0, descend: true },
    "the-67-casino":             { bpm: 118, root: 43, scale: "mixo",     prog: [0, 3, 4, 3], kick: "x..x..x.x..x..x.", snare: "....x.......x...", hat: "x.xxx.xxx.xxx.xx", lead: "triangle", pad: "square",   swing: 0.18, bells: true },
    "menu":                      { bpm: 100, root: 41, scale: "major",    prog: [0, 4, 5, 3], kick: "x.......x.......", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", lead: "triangle", pad: "sine",     swing: 0.1 },
  };
  function songFor(id) {
    if (SONGS[id]) return SONGS[id];
    // unknown ids get a stable variation of the menu song
    let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const keys = Object.keys(SONGS);
    return Object.assign({}, SONGS[keys[h % keys.length]], { root: 38 + (h % 10) });
  }
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function deg(song, d, oct) { const sc = SCALES[song.scale]; const n = sc.length; const o = Math.floor(d / n); return song.root + sc[((d % n) + n) % n] + 12 * (o + (oct || 0)); }

  let seq = null;
  function startMusic(id) {
    stopMusic();
    if (!ac || ac.state !== "running") { wantMusic = id; return; }
    wantMusic = id;
    const song = songFor(id);
    const bus = ac.createGain(); bus.gain.value = 0; bus.connect(musBus);
    bus.gain.linearRampToValueAtTime(1, ac.currentTime + 1.5);
    const stepDur = 60 / song.bpm / 4;
    const s = { id, song, bus, step: 0, next: ac.currentTime + 0.1, timer: null, rng: 1 };
    const rnd = () => { s.rng = (s.rng * 16807) % 2147483647; return s.rng / 2147483647; };
    function play(t, step) {
      const bar = Math.floor(step / 16) % song.prog.length, i = step % 16;
      const chord = song.prog[bar] - (song.descend ? Math.floor(step / 64) % 7 : 0);
      const sw = i % 2 ? song.swing * stepDur : 0, at = t + sw;
      const v = (o) => Object.assign({ bus }, o);
      const sched = (fn, o) => { o.delay = Math.max(0, at - ac.currentTime); fn(v(o)); };
      if (song.kick[i] === "x") sched(tone, { type: "sine", f: 130, f2: 42, slide: 0.12, dur: 0.22, vol: 0.55 });
      if (song.snare[i] === "x") { sched(noise, { f: 1800, q: 0.8, dur: 0.14, vol: 0.22 }); sched(tone, { type: "triangle", f: 220, f2: 160, dur: 0.08, vol: 0.1 }); }
      if (song.hat[i] === "x") sched(noise, { f: 8000, q: 1.5, filter: "highpass", dur: i % 4 === 2 ? 0.07 : 0.035, vol: 0.05 });
      // bass on the beat (and the "and" of 3)
      if (i % 4 === 0 || i === 10) sched(tone, { type: "triangle", f: mtof(deg(song, chord, -1)), dur: stepDur * (i === 10 ? 1.6 : 3.2), vol: 0.32, lp: 600 });
      // pad: chord at the top of each bar
      if (i === 0) for (const d of [0, 2, 4]) sched(tone, { type: song.pad, f: mtof(deg(song, chord + d, 1)), dur: stepDur * 15, att: 0.25, vol: 0.035, lp: 1100 });
      // lead / arp
      if (song.arp) { if (i % 2 === 0) sched(tone, { type: song.lead, f: mtof(deg(song, chord + [0, 2, 4, 7, 4, 2, 0, 4][(i / 2) % 8], 1)), dur: stepDur * 1.6, vol: 0.03, lp: 2800 }); }
      else if ((i === 0 || i === 6 || i === 10 || i === 14) && rnd() < 0.6) sched(tone, { type: song.lead, f: mtof(deg(song, chord + [0, 2, 4, 6][Math.floor(rnd() * 4)], 2)), dur: stepDur * 2.5, vol: 0.035, lp: 3000 });
      if (song.bells && i === 12 && bar === 3) for (const [k, d] of [[0, 4], [1, 7], [2, 9]]) sched(tone, { type: "sine", f: mtof(deg(song, d, 2)), dur: 0.5, vol: 0.04, delay: k * stepDur });
    }
    s.timer = setInterval(() => {
      try {
        if (!ac || ac.state !== "running") return;
        if (s.next < ac.currentTime - 0.5) s.next = ac.currentTime + 0.05;   // tab was asleep
        while (s.next < ac.currentTime + 0.15) { play(s.next, s.step); s.next += stepDur; s.step++; }
      } catch (e) { /* never break the game over music */ }
    }, 30);
    seq = s;
  }
  function stopMusic() {
    if (!seq) return;
    const s = seq; seq = null;
    clearInterval(s.timer);
    try { const t = ac.currentTime; s.bus.gain.cancelScheduledValues(t); s.bus.gain.setValueAtTime(s.bus.gain.value, t); s.bus.gain.linearRampToValueAtTime(0, t + 0.4); setTimeout(() => { try { s.bus.disconnect(); } catch (e) { /* gone */ } }, 600); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ mute + toast
  let toastEl = null, toastTimer = 0;
  function toast(msg) {
    try {
      if (!document.body) return;
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText = "position:fixed;top:10px;right:12px;z-index:5;font:bold 13px Arial,'Arimo',sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:6px;pointer-events:none;transition:opacity .4s;opacity:0";
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg; toastEl.style.opacity = "1";
      clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.style.opacity = "0"; }, 1200);
    } catch (e) { /* ignore */ }
  }
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) { /* storage blocked */ }
    if (master && ac) { const t = ac.currentTime; master.gain.cancelScheduledValues(t); master.gain.setTargetAtTime(muted ? 0 : MASTER, t, 0.03); }
  }

  // ------------------------------------------------------------ boot intro music
  // An original, synthesized "orchestral" sting for the boot splash (in the spirit of a big console intro):
  // rumble + rising choir, an impact on the emblem, a brass fanfare, a stab per title word, and a final chord.
  // All times are seconds from the start; INTRO_TIMES is shared with the visuals in intro.js.
  const INTRO_TIMES = { impact: 3.2, fanfare: [3.95, 4.3, 4.65], words: [5.3, 5.62, 5.94], final: 6.5, end: 9.2 };
  // Several detuned voices through a lowpass whose cutoff swells: choir pads and brass.
  function ensemble(t0, o) {
    const t = t0 + (o.at || 0), dur = o.dur, out = ac.createGain(), f = ac.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.lp0 || 300, t);
    f.frequency.exponentialRampToValueAtTime(o.lp1 || 2400, t + (o.bright || 0.08));
    if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + dur);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(o.vol, t + (o.att || 0.02));
    out.gain.setValueAtTime(o.vol, t + Math.max(o.att || 0.02, dur - (o.rel || 0.3)));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(out); out.connect(o.bus || sfxBus);
    for (const n of o.notes) for (const det of o.det || [-7, 0, 7]) {
      const osc = ac.createOscillator(); osc.type = o.type || "sawtooth";
      osc.frequency.setValueAtTime(mtof(n), t); osc.detune.setValueAtTime(det, t);
      if (o.vib) { const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 5 + Math.random(); lg.gain.value = o.vib; l.connect(lg); lg.connect(osc.detune); l.start(t); l.stop(t + dur + 0.05); }
      osc.connect(f); osc.start(t); osc.stop(t + dur + 0.05);
    }
  }
  function timpani(t0, at, m, vol) {
    const t = t0 + at;
    tone({ type: "sine", f: mtof(m) * 1.5, f2: mtof(m), slide: 0.06, dur: 1.4, vol, delay: t - ac.currentTime });
    tone({ type: "triangle", f: mtof(m) * 2, f2: mtof(m) * 1.4, dur: 0.5, vol: vol * 0.3, delay: t - ac.currentTime });
    noise({ f: 600, f2: 90, q: 0.6, dur: 0.5, vol: vol * 0.7, filter: "lowpass", delay: t - ac.currentTime });
  }
  function crash(t0, at, vol, dur) {
    noise({ f: 7000, f2: 2500, q: 0.4, dur: dur || 2.4, vol, filter: "highpass", att: 0.003, delay: t0 + at - ac.currentTime });
    noise({ f: 3500, f2: 1200, q: 0.8, dur: (dur || 2.4) * 0.6, vol: vol * 0.6, filter: "bandpass", delay: t0 + at - ac.currentTime });
  }
  function swellNoise(t0, at, dur, vol) {   // reverse cymbal: rises, then cuts dead at the hit
    const t = t0 + at, src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.01);
    src.connect(f); f.connect(g); g.connect(sfxBus); src.start(t); src.stop(t + dur + 0.05);
  }
  let introBus = null;
  function playIntro() {
    // everything goes through its own bus so skipping the intro can fade it out
    introBus = ac.createGain(); introBus.gain.value = 1; introBus.connect(comp);
    const keep = sfxBus; sfxBus = introBus;
    try { scheduleIntro(); } finally { sfxBus = keep; }
  }
  function scheduleIntro() {
    const t0 = ac.currentTime + 0.05, T = INTRO_TIMES;
    // 0 → impact: sub rumble, dark choir rising (C minor), reverse cymbal
    tone({ type: "sine", f: 41, f2: 55, slide: T.impact, dur: T.impact + 0.3, vol: 0.32, att: 0.8, delay: 0.05 });
    ensemble(t0, { at: 0.2, dur: T.impact - 0.15, notes: [48, 55, 60, 63], type: "sawtooth", vol: 0.05, att: 2.2, rel: 0.1, lp0: 180, lp1: 1600, bright: T.impact - 0.4, det: [-9, 0, 9], vib: 9 });
    ensemble(t0, { at: 1.4, dur: T.impact - 1.35, notes: [72, 75, 79], type: "triangle", vol: 0.035, att: 1.6, rel: 0.05, lp0: 900, lp1: 4000, bright: 1.6, vib: 14 });
    swellNoise(t0, T.impact - 1.6, 1.6, 0.22);
    [0.9, 1.7, 2.3, 2.7, 2.95, 3.08].forEach((at, i) => timpani(t0, at, 36, 0.12 + i * 0.05));   // timpani roll accelerating in
    // impact: huge chord + timpani + crash
    timpani(t0, T.impact, 36, 0.6); crash(t0, T.impact, 0.32, 3);
    ensemble(t0, { at: T.impact, dur: 1.2, notes: [36, 48, 55, 60, 63, 67], vol: 0.11, att: 0.01, rel: 0.6, lp0: 3500, lp1: 3500, lp2: 600, det: [-12, 0, 12] });
    // fanfare: Ab → Bb → C (brass stabs)
    [[56, 60, 63, 68], [58, 62, 65, 70], [60, 64, 67, 72]].forEach((ch, i) => {
      ensemble(t0, { at: T.fanfare[i], dur: i === 2 ? 0.6 : 0.3, notes: ch, vol: 0.085, att: 0.012, rel: 0.12, lp0: 500, lp1: 3800, bright: 0.05, lp2: 900 });
      timpani(t0, T.fanfare[i], i === 2 ? 36 : 31 + i * 2, 0.25);
    });
    // a stab per title word: SUPER · SMASH · BALLERS
    T.words.forEach((at, i) => {
      ensemble(t0, { at, dur: 0.22, notes: [55 + i * 2, 60 + i * 2, 64 + i * 2], vol: 0.08, att: 0.008, rel: 0.1, lp0: 700, lp1: 4200, bright: 0.04, lp2: 800 });
      timpani(t0, at, 31 + i * 2, 0.35); noise({ f: 2500, q: 0.7, dur: 0.12, vol: 0.12, delay: t0 + at - ac.currentTime });
    });
    // final: C major, brass + choir, long ring, cymbal
    timpani(t0, T.final, 36, 0.55); crash(t0, T.final, 0.28, 3.2);
    ensemble(t0, { at: T.final, dur: 2.6, notes: [36, 48, 55, 60, 64, 67, 72], vol: 0.1, att: 0.015, rel: 1.6, lp0: 1200, lp1: 4200, bright: 0.06, lp2: 1100, det: [-10, 0, 10], vib: 6 });
    ensemble(t0, { at: T.final, dur: 2.7, notes: [76, 79, 84], type: "triangle", vol: 0.04, att: 0.25, rel: 1.8, lp0: 3000, lp1: 6000, vib: 12 });
    for (let k = 0; k < 10; k++) timpani(t0, T.final + 0.9 + k * 0.07, 36, 0.06 + 0.02 * Math.min(k, 6));   // little roll into the ring-out
  }

  // ------------------------------------------------------------ public API (never throws)
  const api = {
    get muted() { return muted; },
    set muted(v) { try { setMuted(v); } catch (e) { /* ignore */ } },
    get ctx() { return ac; },
    toggleMute() { try { setMuted(!muted); toast(muted ? "Sound off (M)" : "Sound on (M)"); } catch (e) { /* ignore */ } return muted; },
    unlock,
    music(id) { try { wantMusic = id; if (ac && ac.state === "running") startMusic(id); } catch (e) { /* ignore */ } },
    stopMusic() { try { wantMusic = null; stopMusic(); } catch (e) { /* ignore */ } },
    INTRO_TIMES,
    // Plays the boot sting once the context is running (call from a user gesture). Never throws.
    stopIntro() {
      try { if (!introBus) return; const t = ac.currentTime, b = introBus; introBus = null; b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + 0.35); setTimeout(() => { try { b.disconnect(); } catch (e) { /* gone */ } }, 600); } catch (e) { /* ignore */ }
    },
    intro() {
      try {
        if (!ensure()) return;
        wantMusic = null; stopMusic();
        const go = () => { try { if (!muted) playIntro(); } catch (e) { /* ignore */ } };
        if (ac.state === "running") go(); else ac.resume().then(go).catch(() => {});
      } catch (e) { /* ignore */ }
    },
  };
  for (const name of Object.keys(fx)) {
    api[name] = function () {
      try { if (!ready()) return; fx[name].apply(null, arguments); } catch (e) { /* audio must never break the game */ }
    };
  }
  S.audio = api;

  // ------------------------------------------------------------ gesture unlock + M key
  try {
    const onGesture = () => unlock();
    for (const ev of ["keydown", "mousedown", "pointerdown", "touchstart"]) addEventListener(ev, onGesture, { capture: true, passive: true });
    addEventListener("keydown", (e) => { if (e.code === "KeyM" && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) api.toggleMute(); });
    // gamepads: poll lightly until the context is running
    const gpPoll = setInterval(() => {
      try {
        if (ac && ac.state === "running") { clearInterval(gpPoll); return; }
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        for (const p of pads || []) if (p && p.buttons && p.buttons.some((b) => b.pressed)) { unlock(); break; }
      } catch (e) { clearInterval(gpPoll); }
    }, 250);
    document.addEventListener("visibilitychange", () => {
      try { if (!ac) return; if (document.hidden) ac.suspend(); else if (ac.state === "suspended") ac.resume(); } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
})();
