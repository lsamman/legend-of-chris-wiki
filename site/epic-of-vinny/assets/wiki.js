(function () {
  var root = document.documentElement;

  // light/dark toggle (a per-viewer convenience only)
  var tb = document.querySelector('.theme-btn');
  if (tb) tb.addEventListener('click', function () {
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('teov-theme', root.dataset.theme); } catch (e) {}
  });

  // mobile navigation
  var mb = document.querySelector('.menu-btn');
  if (mb) mb.addEventListener('click', function () {
    var open = document.body.classList.toggle('nav-open');
    mb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // search
  var idx = window.TEOV_INDEX || {}, keys = Object.keys(idx);
  var q = document.getElementById('q'), out = document.getElementById('results'), sel = -1;
  function norm(s) { return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function search(term) {
    var t = norm(term); if (!t) return [];
    var words = t.split(' '), res = [];
    keys.forEach(function (k) {
      var r = idx[k], title = norm(r[0]), hay = title + ' ' + norm(r[2]) + ' ' + k.replace(/-/g, ' ');
      if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return;
      res.push([title === t ? 0 : title.indexOf(t) === 0 ? 1 : title.indexOf(t) > -1 ? 2 : 3, title.length, k]);
    });
    res.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return res.slice(0, 12).map(function (x) { return x[2]; });
  }
  function render() {
    var r = search(q.value); sel = -1;
    if (!q.value.trim()) { out.hidden = true; return; }
    out.innerHTML = r.length ? r.map(function (k) {
      return '<li><a href="' + k + '.html">' + esc(idx[k][0]) + '<small>' + esc(idx[k][1]) + (idx[k][2] ? ' · ' + esc(idx[k][2]) : '') + '</small></a></li>';
    }).join('') : '<li class="none">No results. Not even a Double Whopper with Cheese.</li>';
    out.hidden = false;
  }
  if (q) {
    q.addEventListener('input', render);
    q.addEventListener('focus', render);
    q.addEventListener('keydown', function (ev) {
      var links = out.querySelectorAll('a');
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!links.length) return;
        sel = (sel + (ev.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach(function (a, i) { a.setAttribute('aria-selected', i === sel ? 'true' : 'false'); });
      } else if (ev.key === 'Enter') {
        var target = links[sel > -1 ? sel : 0];
        if (target) location.href = target.getAttribute('href');
      } else if (ev.key === 'Escape') { out.hidden = true; q.blur(); }
    });
    document.addEventListener('click', function (ev) { if (!ev.target.closest('.search')) out.hidden = true; });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === '/' && document.activeElement !== q && !/input|textarea/i.test(document.activeElement.tagName)) { ev.preventDefault(); q.focus(); }
    });
  }

  // category filter
  var f = document.querySelector('.filter');
  if (f) f.addEventListener('input', function () {
    var t = norm(f.value);
    var shown = 0;
    document.querySelectorAll('.catlist .card').forEach(function (c) { c.hidden = !!t && norm(c.textContent).indexOf(t) === -1; if (!c.hidden) shown++; });
    var none = document.querySelector('.none-found'); if (none) none.hidden = shown > 0;
  });

  // the story page: a reading progress bar, and the chapter you are in lit up in the chapter bar
  var bar = document.querySelector('.progress i'), story = document.querySelector('.story');
  if (bar && story) {
    var tabs = [].slice.call(document.querySelectorAll('.story-toc a'));
    var heads = tabs.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var tick = false;
    function update() {
      tick = false;
      var r = story.getBoundingClientRect(), total = r.height - innerHeight * 0.6;
      bar.style.width = Math.max(0, Math.min(100, (-r.top + 80) / total * 100)) + '%';
      var cur = 0;
      heads.forEach(function (h, i) { if (h && h.getBoundingClientRect().top < 160) cur = i; });
      tabs.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
    }
    addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
  }
})();
