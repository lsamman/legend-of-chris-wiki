// The phone: tap the phone in the toolbar and a sacred phone flies to the front of the screen with
// the Sacred Apps on it. Two models, switched with the toggle above the phone (remembered per browser):
//   - Steve Jobs's iPhone 3G, sideways and cracked (the Flashback Chapter, the Keynote).
//   - The Nokia I-4500 flip phone "with android wireless technology" (Plankton's briefing, Chapter Triangle).
// Every app is one of Will's real apps on lsamman.github.io. The wallpaper comes from the Settings app
// (localStorage "loc.phone.wallpaper", a CSS background value).
(function () {
  var V = "__LOC_VERSION__";   // filled in by build.py, so a new icon is fetched after an update
  var SITE = "https://lsamman.github.io/";
  var APPS = [
    { name: "MySpace", icon: "app-myspace", url: SITE + "dbyc/", full: "MySpace v1.3.3", glyph: "M", bg: "linear-gradient(#7fd0ff,#1a8fe0)" },
    { name: "Bluebird", icon: "app-bluebird", url: SITE + "bluebird/", full: "Twitter: Bluebird Variant (with no limits)", glyph: "🐦", bg: "linear-gradient(#9ad5f2,#3fa9e0)" },
    { name: "Snapchat", icon: "app-snapchat", url: SITE + "snapchat/", full: "Snapchat: Ghost Protocol Edition", glyph: "👻", bg: "linear-gradient(#fff86a,#f2d600)" },
    { name: "Facebook", icon: "app-facebook", url: SITE + "facebook/", full: "Facebook (Pre-Cringe)", glyph: "f", bg: "linear-gradient(#6d8fd6,#3b5998)" },
    { name: "Podcasts 2", icon: "app-podcasts", url: SITE + "podcasts/", full: "Apple Podcasts 2", glyph: "🎙", bg: "linear-gradient(#d68cf0,#8e3fc0)" },
    { name: "Settings", icon: "app-settings", url: SITE + "settings/", full: "Settings (Full access)", glyph: "⚙", bg: "linear-gradient(#c9ced4,#7d858f)" }
  ];
  var DOCK = [
    { name: "MASTER FILE", glyph: "📖", bg: "linear-gradient(#fdfdfd,#d9d9d9)", url: "read.html" },
    { name: "Playlist", glyph: "♫", bg: "linear-gradient(#ffb24d,#f26b1d)", url: "playlist.html" },
    { name: "Random", glyph: "🎲", bg: "linear-gradient(#7fe07a,#2f9e44)", url: "random.html" },
    { name: "Wiki", img: "assets/chill-chris.png", bg: "linear-gradient(#ffffff,#e3e7ea)", url: "index.html" }
  ];
  var MODELS = {
    iphone: { label: "iPhone 3G", caption: "Steve Jobs's iPhone 3G. Sideways. Cracked. Never update." },
    nokia: { label: "Nokia I-4500", caption: "The Nokia I-4500 flip phone, with android wireless technology. 3 year contract from \"version\"." }
  };
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var overlay, stage, phone, model, opener, open = false, busy = false, sel = 0;

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function iconSrc(a) { return a.icon ? "assets/" + a.icon + ".png?v=" + V : a.img || ""; }
  // An icon image if the app has one; if it fails to load, the coloured glyph tile underneath shows instead.
  function face(a) {
    var src = iconSrc(a);
    return '<span class="glyph" style="background:' + a.bg + '">' + (a.glyph ? esc(a.glyph) : "") + "</span>" +
      (src ? '<img src="' + esc(src) + '" alt="" class="' + (a.img ? "pad" : "") + '" onerror="this.remove()">' : "");
  }
  function wallpaper() { var w = store("loc.phone.wallpaper"); return w && w.length < 3000000 ? w : ""; }

  // ---------- the iPhone 3G ----------
  function iphoneHTML() {
    function icon(a, i) {
      return '<a class="ip-app" href="' + esc(a.url) + '" data-launch title="' + esc(a.full || a.name) + '" style="--i:' + i + '">' +
        '<span class="ip-icon">' + face(a) + '</span><span class="ip-label">' + esc(a.name) + "</span></a>";
    }
    return '<div class="ip">' +
      '<span class="ip-ear" aria-hidden="true"></span>' +
      '<button class="ip-home" type="button" aria-label="Home button: put the phone away"><i></i></button>' +
      '<div class="ip-screen">' +
        '<div class="ip-status" aria-hidden="true"><span class="sig"><i></i><i></i><i></i><i></i><i></i></span>God\'s router <b>3G</b><span class="ip-clock">' + clock() + '</span><span class="np">▶ U2</span><span class="batt"><span></span></span></div>' +
        '<div class="ip-apps">' + APPS.map(icon).join("") + "</div>" +
        '<div class="ip-dock">' + DOCK.map(function (a, i) { return icon(a, APPS.length + i); }).join("") + "</div>" +
        '<svg class="ip-crack" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true"><g><path d="M548 372l-38-52-61-21-48-46"/><path d="M510 320l-19-71-37-40"/><path d="M510 320l-64 18-58-8"/><path d="M548 372l-8-47 21-60"/><path d="M548 372l30-38"/><path d="M449 299l-30 31"/><path d="M491 249l23-29"/></g></svg>' +
        '<div class="ip-zoom" aria-hidden="true"></div>' +
      "</div></div>";
  }

  // ---------- the Nokia I-4500 ----------
  var NK_MENU = APPS.concat(DOCK.slice(0, 3));   // 3 x 3, like a Nokia menu: 1–9 on the keypad opens each
  function nokiaHTML() {
    var keys = [["1", ""], ["2", "abc"], ["3", "def"], ["4", "ghi"], ["5", "jkl"], ["6", "mno"], ["7", "pqrs"], ["8", "tuv"], ["9", "wxyz"], ["*", "+"], ["0", "␣"], ["#", "⇧"]];
    return '<div class="nk">' +
      '<div class="nk-lid">' +
        '<div class="nk-face nk-inside">' +
          '<span class="nk-speaker" aria-hidden="true"></span>' +
          '<div class="nk-screen">' +
            '<div class="nk-status" aria-hidden="true"><span class="sig"><i></i><i></i><i></i><i></i></span><span>3G</span><span class="nk-droid">android</span><span class="nk-clock">' + clock() + '</span><span class="batt"><i></i><i></i><i></i></span></div>' +
            '<div class="nk-title" id="nk-title">Menu</div>' +
            '<div class="nk-grid" role="listbox" aria-label="Menu">' + NK_MENU.map(function (a, i) {
              return '<a class="nk-app" role="option" href="' + esc(a.url) + '" data-launch data-n="' + i + '" title="' + (i + 1) + ". " + esc(a.full || a.name) + '">' +
                '<span class="nk-icon">' + face(a) + "</span></a>";
            }).join("") + "</div>" +
            '<div class="nk-soft" aria-hidden="true"><span>Back</span><b>Select</b><span>Exit</span></div>' +
            '<div class="nk-connect" hidden><b>Connecting…</b><span>3G · cutting edge</span><i><s></s></i></div>' +
          "</div>" +
          '<span class="nk-brand">NOKIA</span>' +
        "</div>" +
        '<div class="nk-face nk-outside" aria-hidden="true"><span class="nk-cam"></span><div class="nk-mini"><b>' + clock() + '</b><span>3G</span></div><span class="nk-brand">NOKIA</span></div>' +
      "</div>" +
      '<div class="nk-base">' +
        '<div class="nk-nav">' +
          '<button type="button" class="nk-key nk-softkey" data-key="back" aria-label="Back">—</button>' +
          '<div class="nk-dpad"><button type="button" data-key="up" aria-label="Up"></button><button type="button" data-key="left" aria-label="Left"></button><button type="button" data-key="ok" class="nk-ok" aria-label="Select"></button><button type="button" data-key="right" aria-label="Right"></button><button type="button" data-key="down" aria-label="Down"></button></div>' +
          '<button type="button" class="nk-key nk-softkey" data-key="exit" aria-label="Exit">—</button>' +
          '<button type="button" class="nk-key nk-call" data-key="ok" aria-label="Call: open">✆</button>' +
          '<button type="button" class="nk-key nk-end" data-key="exit" aria-label="End: put the phone away"><span>✆</span></button>' +
        "</div>" +
        '<div class="nk-pad">' + keys.map(function (k) {
          return '<button type="button" class="nk-key" data-key="' + k[0] + '" aria-label="' + k[0] + '"><b>' + k[0] + "</b><small>" + k[1] + "</small></button>";
        }).join("") + "</div>" +
        '<span class="nk-mic" aria-hidden="true"></span>' +
      "</div></div>";
  }
  function nkSelect(i) {
    sel = (i + NK_MENU.length) % NK_MENU.length;
    overlay.querySelectorAll(".nk-app").forEach(function (a, n) { a.classList.toggle("on", n === sel); a.setAttribute("aria-selected", n === sel); });
    var t = overlay.querySelector("#nk-title"); if (t) t.textContent = (sel + 1) + ". " + NK_MENU[sel].name;
  }
  function nkKey(k) {
    if (k === "up") nkSelect(sel - 3);
    else if (k === "down") nkSelect(sel + 3);
    else if (k === "left") nkSelect(sel - 1);
    else if (k === "right") nkSelect(sel + 1);
    else if (k === "ok") launch(overlay.querySelectorAll(".nk-app")[sel]);
    else if (k === "back" || k === "exit") close();
    else if (/^[1-9]$/.test(k)) { nkSelect(+k - 1); launch(overlay.querySelectorAll(".nk-app")[sel]); }
  }

  // ---------- overlay ----------
  function build() {
    overlay = document.createElement("div");
    overlay.className = "ip-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "The phone");
    overlay.innerHTML =
      '<div class="ph-models" role="radiogroup" aria-label="Phone">' + Object.keys(MODELS).map(function (k) {
        return '<button type="button" role="radio" data-model="' + k + '">' + MODELS[k].label + "</button>";
      }).join("") + "</div>" +
      '<button class="ip-close" type="button" aria-label="Put the phone away">✕</button>' +
      '<div class="ph-stage"></div>' +
      '<p class="ip-caption"></p>';
    document.body.appendChild(overlay);
    stage = overlay.querySelector(".ph-stage");

    overlay.addEventListener("click", function (e) {
      if (busy) return;
      var m = e.target.closest("[data-model]");
      if (m) return switchModel(m.dataset.model);
      if (e.target === overlay || e.target === stage || e.target.closest(".ip-close, .ip-home")) return close();
      var k = e.target.closest("[data-key]");
      if (k) return nkKey(k.dataset.key);
      var l = e.target.closest("[data-launch]");
      if (l && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); launch(l); }
    });
    overlay.addEventListener("mouseover", function (e) { var a = e.target.closest(".nk-app"); if (a) nkSelect(+a.dataset.n); });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); return close(); }
      if (model === "nokia" && !e.target.closest(".ph-models, .ip-close")) {
        var map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "ok" };
        var k = map[e.key] || (/^[1-9]$/.test(e.key) ? e.key : null);
        if (k) { e.preventDefault(); return nkKey(k); }
      }
      if (e.key === "Tab") {   // keep focus on the phone while it's out
        var f = Array.prototype.filter.call(overlay.querySelectorAll("a, button"), function (x) { return x.offsetParent; });
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function render(m) {
    model = m;
    stage.innerHTML = m === "nokia" ? nokiaHTML() : iphoneHTML();
    phone = stage.firstChild;
    var w = wallpaper(), scr = stage.querySelector(".ip-screen, .nk-screen");
    if (w && scr) scr.style.background = w;
    overlay.querySelector(".ip-caption").textContent = MODELS[m].caption;
    overlay.querySelectorAll("[data-model]").forEach(function (b) { b.setAttribute("aria-checked", b.dataset.model === m); b.classList.toggle("on", b.dataset.model === m); });
    overlay.classList.remove("launching");
    if (m === "nokia") nkSelect(sel);
  }

  // Where the phone flies from: the button that opened it.
  function fromOpener() {
    var p = phone.getBoundingClientRect();
    if (!opener || !opener.getBoundingClientRect || !opener.offsetParent) return "translate(0, 70vh) scale(.1) rotate(-30deg)";
    var b = opener.getBoundingClientRect();
    var dx = b.left + b.width / 2 - (p.left + p.width / 2), dy = b.top + b.height / 2 - (p.top + p.height / 2);
    return "translate(" + dx + "px," + dy + "px) scale(.04) rotate(-320deg)";
  }
  function flyIn() {
    var after = function () {
      if (model === "nokia") phone.classList.add("open");   // flip the lid open once it lands
      var first = overlay.querySelector(model === "nokia" ? ".nk-app.on" : ".ip-app");
      setTimeout(function () { if (open && first) first.focus({ preventScroll: true }); }, reduce ? 0 : 450);
    };
    if (reduce || !phone.animate) { phone.classList.add("landed"); return after(); }
    phone.animate([
      { transform: fromOpener(), opacity: 0, filter: "blur(6px)" },
      { opacity: 1, filter: "blur(0)", offset: .45 },
      { transform: "none", opacity: 1, filter: "blur(0)" }
    ], { duration: 850, easing: "cubic-bezier(.18,.9,.28,1.12)" }).onfinish = function () { phone.classList.add("landed"); after(); };
  }
  function flyOut(done) {
    if (model === "nokia") phone.classList.remove("open");
    if (reduce || !phone.animate) return done();
    setTimeout(function () {
      phone.animate([{ transform: "none", opacity: 1 }, { transform: fromOpener(), opacity: 0 }],
        { duration: 480, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" }).onfinish = done;
    }, model === "nokia" ? 260 : 0);
  }

  function show(from) {
    if (open) return;
    if (!overlay) build();
    opener = from || null;
    open = true;
    var m = store("loc.phone.model");
    render(MODELS[m] ? m : "iphone");
    overlay.hidden = false;
    document.documentElement.classList.add("ip-open");
    if (location.hash !== "#iphone-3g") history.replaceState(null, "", "#iphone-3g");
    overlay.classList.remove("in", "out");
    void overlay.offsetWidth;
    overlay.classList.add("in");
    flyIn();
  }

  function close() {
    if (!open || busy) return;
    open = false;
    if (location.hash === "#iphone-3g") history.replaceState(null, "", location.pathname + location.search);
    overlay.classList.add("out");
    flyOut(function () {
      overlay.hidden = true; overlay.classList.remove("in", "out");
      document.documentElement.classList.remove("ip-open");
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    });
  }

  function switchModel(m) {
    if (m === model || !MODELS[m]) return;
    store("loc.phone.model", m);
    busy = true;
    flyOut(function () { render(m); busy = false; flyIn(); });
  }

  // Opening an app: the iPhone zooms the app out of its icon; the Nokia connects over 3G. Then the app loads.
  function launch(link) {
    if (!link) return;
    var href = link.getAttribute("href");
    overlay.classList.add("launching");
    if (model === "nokia") {
      var c = overlay.querySelector(".nk-connect");
      c.querySelector("b").textContent = "Connecting to " + (NK_MENU[+link.dataset.n] || {}).name + "…";
      c.hidden = false;
      return setTimeout(function () { location.href = href; }, reduce ? 0 : 700);
    }
    var zoom = overlay.querySelector(".ip-zoom"), scr = overlay.querySelector(".ip-screen").getBoundingClientRect();
    var r = link.querySelector(".ip-icon").getBoundingClientRect();
    var img = link.querySelector("img");
    zoom.style.backgroundImage = img ? "url(" + img.src + ")" : "none";
    if (reduce || !zoom.animate) { location.href = href; return; }
    zoom.animate([
      { transform: "translate(" + (r.left - scr.left) + "px," + (r.top - scr.top) + "px) scale(" + r.width / scr.width + "," + r.height / scr.height + ")", opacity: .6, borderRadius: "40px" },
      { transform: "none", opacity: 1, borderRadius: "0" }
    ], { duration: 380, easing: "cubic-bezier(.3,.6,.3,1)", fill: "forwards" });
    setTimeout(function () { location.href = href; }, 420);
  }

  // Back from an app with the browser's Back button: the page may come back from the cache mid-launch. Reset it.
  addEventListener("pageshow", function (e) {
    if (!e.persisted || !overlay) return;
    overlay.classList.remove("launching");
    var c = overlay.querySelector(".nk-connect"); if (c) c.hidden = true;
  });

  document.addEventListener("click", function (e) {
    var b = e.target.closest(".phone-btn, .phone-open, a[href='#iphone-3g']");
    if (!b) return;
    e.preventDefault();
    document.body.classList.remove("nav-open");
    show(b.closest(".phone-btn") ? b : document.querySelector(".phone-btn") || b);
  });
  if (location.hash === "#iphone-3g") show(document.querySelector(".phone-btn"));
  addEventListener("hashchange", function () { if (location.hash === "#iphone-3g") show(document.querySelector(".phone-btn")); });
})();
