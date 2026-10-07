(function () {
  var root = document.documentElement;

  // theme toggle (per-viewer convenience only)
  var tb = document.querySelector('.theme-btn');
  if (tb) tb.addEventListener('click', function () {
    var dark = root.dataset.theme ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('loc-theme', root.dataset.theme); } catch (e) {}
  });

  // mobile nav
  var mb = document.querySelector('.menu-btn');
  if (mb) mb.addEventListener('click', function () {
    var open = document.body.classList.toggle('nav-open');
    mb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // search
  var idx = window.LOC_INDEX || {};
  var keys = Object.keys(idx);
  var q = document.getElementById('q'), out = document.getElementById('results');
  var sel = -1;
  function norm(s) { return (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function search(term) {
    var t = norm(term); if (!t) return [];
    var words = t.split(' ');
    var res = [];
    keys.forEach(function (k) {
      var r = idx[k], title = norm(r[0]), hay = title + ' ' + norm(r[3]) + ' ' + norm(r[2]) + ' ' + k.replace(/-/g, ' ');
      if (!words.every(function (w) { return hay.indexOf(w) > -1; })) return;
      var score = title === t ? 0 : title.indexOf(t) === 0 ? 1 : title.indexOf(t) > -1 ? 2 : (norm(r[3]).indexOf(t) > -1 ? 3 : 4);
      res.push([score, title.length, k]);
    });
    res.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    return res.slice(0, 12).map(function (x) { return x[2]; });
  }
  function render() {
    var r = search(q.value); sel = -1;
    if (!q.value.trim()) { out.hidden = true; return; }
    out.innerHTML = r.length ? r.map(function (k) {
      return '<li><a href="' + k + '.html">' + esc(idx[k][0]) + '<small>' + esc(idx[k][1]) + (idx[k][2] ? ' · ' + esc(idx[k][2]) : '') + '</small></a></li>';
    }).join('') : '<li class="none">No results. Much like Mic Q, it cannot exist in any universe.</li>';
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
    document.querySelectorAll('.catlist li').forEach(function (li) {
      li.hidden = t && norm(li.textContent).indexOf(t) === -1;
    });
  });
})();
