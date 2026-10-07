// The iPhone 3G: tap the phone in the toolbar and Steve's phone flies to the front of the screen,
// sideways and cracked, with the Sacred Apps on it. MySpace v1.3.3 and Twitter: Bluebird Variant
// are real apps (Will's YouTube and X clients); the others are still being hunted, as in the book.
(function () {
  var V = "__LOC_VERSION__";   // filled in by build.py, so a new icon is fetched after an update
  var APPS = [
    { name: "MySpace", icon: "assets/app-myspace.png?v=" + V, url: "https://lsamman.github.io/dbyc/", full: "MySpace v1.3.3" },
    { name: "Bluebird", icon: "assets/app-bluebird.png?v=" + V, url: "https://lsamman.github.io/bluebird/", full: "Twitter: Bluebird Variant (with no limits)" },
    { name: "Snapchat", glyph: "👻", bg: "linear-gradient(#fff86a,#f2d600)", wiki: "snapchat-ghost-protocol", full: "Snapchat: Ghost Protocol Edition",
      why: "Not found yet. Steve plans to start with the social media apps." },
    { name: "Facebook", glyph: "f", bg: "linear-gradient(#6d8fd6,#3b5998)", wiki: "facebook-pre-cringe", full: "Facebook (Pre-Cringe)",
      why: "Held on a 67gb micro SD card in the Projects National Archives." },
    { name: "Podcasts 2", glyph: "🎙", bg: "linear-gradient(#d68cf0,#8e3fc0)", wiki: "apple-podcasts", full: "Apple Podcasts 2",
      why: "Requires Apple Podcasts 1." },
    { name: "Settings", glyph: "⚙", bg: "linear-gradient(#c9ced4,#7d858f)", wiki: "settings", full: "Settings (Full access)",
      why: "Full access requires the 3 Year Contract Plan from Verizon." }
  ];
  var DOCK = [
    { name: "MASTER FILE", glyph: "📖", bg: "linear-gradient(#fdfdfd,#d9d9d9)", href: "read.html" },
    { name: "Playlist", glyph: "♫", bg: "linear-gradient(#ffb24d,#f26b1d)", href: "playlist.html" },
    { name: "Random", glyph: "🎲", bg: "linear-gradient(#7fe07a,#2f9e44)", href: "random.html" },
    { name: "Wiki", img: "assets/chill-chris.png", bg: "linear-gradient(#ffffff,#e3e7ea)", href: "index.html" }
  ];
  var reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var overlay, phone, hud, opener, open = false;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function icon(a, i) {
    var face = a.icon ? '<img src="' + esc(a.icon) + '" alt="">'
      : a.img ? '<span class="glyph" style="background:' + a.bg + '"><img src="' + esc(a.img) + '" alt=""></span>'
      : '<span class="glyph" style="background:' + a.bg + '">' + esc(a.glyph) + "</span>";
    var tag = a.url || a.href ? "a" : "button";
    var attrs = a.url ? ' href="' + esc(a.url) + '" data-launch' : a.href ? ' href="' + esc(a.href) + '" data-launch' : ' type="button" data-waiting="' + i + '"';
    return "<" + tag + ' class="ip-app' + (a.why ? " waiting" : "") + '"' + attrs + ' title="' + esc(a.full || a.name) + '" style="--i:' + i + '">' +
      '<span class="ip-icon">' + face + "</span>" +
      (a.why ? '<span class="ip-bar"><i></i></span><span class="ip-label">Waiting…</span>' : '<span class="ip-label">' + esc(a.name) + "</span>") +
      "</" + tag + ">";
  }
  function clock() { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  function build() {
    overlay = document.createElement("div");
    overlay.className = "ip-overlay";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Steve Jobs's iPhone 3G");
    overlay.innerHTML =
      '<button class="ip-close" type="button" aria-label="Put the phone away">✕</button>' +
      '<div class="ip">' +
        '<span class="ip-ear" aria-hidden="true"></span>' +
        '<button class="ip-home" type="button" aria-label="Home button: put the phone away"><i></i></button>' +
        '<div class="ip-screen">' +
          '<div class="ip-status" aria-hidden="true"><span class="sig"><i></i><i></i><i></i><i></i><i></i></span>God\'s router <b>3G</b><span class="ip-clock">' + clock() + '</span><span class="np">▶ U2</span><span class="batt"><span></span></span></div>' +
          '<div class="ip-apps">' + APPS.map(icon).join("") + "</div>" +
          '<div class="ip-dock">' + DOCK.map(function (a, i) { return icon(a, APPS.length + i); }).join("") + "</div>" +
          '<svg class="ip-crack" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true"><g><path d="M548 372l-38-52-61-21-48-46"/><path d="M510 320l-19-71-37-40"/><path d="M510 320l-64 18-58-8"/><path d="M548 372l-8-47 21-60"/><path d="M548 372l30-38"/><path d="M449 299l-30 31"/><path d="M491 249l23-29"/></g></svg>' +
          '<div class="ip-hud" role="status" hidden></div>' +
          '<div class="ip-zoom" aria-hidden="true"></div>' +
        "</div>" +
      "</div>" +
      '<p class="ip-caption">Steve Jobs\'s iPhone 3G. Sideways. Cracked. Never update.</p>';
    document.body.appendChild(overlay);
    phone = overlay.querySelector(".ip");
    hud = overlay.querySelector(".ip-hud");

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || e.target.closest(".ip-close, .ip-home")) return close();
      var w = e.target.closest("[data-waiting]");
      if (w) return waiting(APPS[+w.dataset.waiting]);
      var l = e.target.closest("[data-launch]");
      if (l && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); launch(l); }
    });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") {   // keep focus on the phone while it's out
        var f = overlay.querySelectorAll("a, button"), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  // Where the phone flies from: the button that opened it.
  function fromOpener() {
    var p = phone.getBoundingClientRect();
    if (!opener || !opener.getBoundingClientRect) return "translate(0, 70vh) scale(.1) rotate(-30deg)";
    var b = opener.getBoundingClientRect();
    var dx = b.left + b.width / 2 - (p.left + p.width / 2), dy = b.top + b.height / 2 - (p.top + p.height / 2);
    return "translate(" + dx + "px," + dy + "px) scale(.04) rotate(-320deg)";
  }

  function show(from) {
    if (open) return;
    if (!overlay) build();
    opener = from || null;
    open = true;
    overlay.querySelector(".ip-clock").textContent = clock();
    overlay.hidden = false;
    overlay.classList.remove("launching");
    document.documentElement.classList.add("ip-open");
    if (location.hash !== "#iphone-3g") history.replaceState(null, "", "#iphone-3g");
    if (reduce || !phone.animate) {
      overlay.classList.add("in");
    } else {
      overlay.classList.remove("in");
      void overlay.offsetWidth;
      overlay.classList.add("in");
      phone.animate([
        { transform: fromOpener(), opacity: 0, filter: "blur(6px)" },
        { opacity: 1, filter: "blur(0)", offset: .45 },
        { transform: "none", opacity: 1, filter: "blur(0)" }
      ], { duration: 850, easing: "cubic-bezier(.18,.9,.28,1.12)" });
    }
    setTimeout(function () { var a = overlay.querySelector(".ip-app"); if (a && open) a.focus({ preventScroll: true }); }, reduce ? 0 : 700);
  }

  function close() {
    if (!open) return;
    open = false;
    hud.hidden = true;
    if (location.hash === "#iphone-3g") history.replaceState(null, "", location.pathname + location.search);
    var done = function () {
      overlay.hidden = true; overlay.classList.remove("in", "out");
      document.documentElement.classList.remove("ip-open");
      if (opener && opener.focus) opener.focus({ preventScroll: true });
    };
    overlay.classList.add("out");
    if (reduce || !phone.animate) return done();
    phone.animate([{ transform: "none", opacity: 1 }, { transform: fromOpener(), opacity: 0 }],
      { duration: 480, easing: "cubic-bezier(.5,0,.75,0)" }).onfinish = done;
  }

  // iPhone OS app launch: the app's window zooms out of its icon, then the app loads.
  function launch(link) {
    var href = link.getAttribute("href");
    var zoom = overlay.querySelector(".ip-zoom"), scr = overlay.querySelector(".ip-screen").getBoundingClientRect();
    var r = link.querySelector(".ip-icon").getBoundingClientRect();
    var img = link.querySelector("img");
    zoom.style.backgroundImage = img ? "url(" + img.src + ")" : "none";
    overlay.classList.add("launching");
    if (reduce || !zoom.animate) { location.href = href; return; }
    var sx = r.width / scr.width, sy = r.height / scr.height;
    var tx = r.left - scr.left, ty = r.top - scr.top;
    zoom.animate([
      { transform: "translate(" + tx + "px," + ty + "px) scale(" + sx + "," + sy + ")", opacity: .6, borderRadius: "40px" },
      { transform: "none", opacity: 1, borderRadius: "0" }
    ], { duration: 380, easing: "cubic-bezier(.3,.6,.3,1)", fill: "forwards" });
    setTimeout(function () { location.href = href; }, 420);
  }

  function waiting(a) {
    hud.innerHTML = "<b>" + esc(a.full) + "</b><span>" + esc(a.why) + '</span><a href="' + esc(a.wiki) + '.html">Read about it →</a>';
    hud.hidden = false;
    clearTimeout(waiting.t);
    waiting.t = setTimeout(function () { hud.hidden = true; }, 4500);
  }

  // Back from an app with the browser's Back button: the page may come back from the cache with the
  // phone still showing its launch animation. Reset it.
  addEventListener("pageshow", function (e) { if (e.persisted && overlay) overlay.classList.remove("launching"); });

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
