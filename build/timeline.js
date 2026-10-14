// The Timeline: re-sorts the list between "As it happened" (data-when) and "As told in the
// book" (data-told, the book line), filters it by storyline, and keeps the sticky ruler current.
(function () {
  var list = document.getElementById('tl');
  if (!list) return;
  var controls = document.getElementById('tl-controls');
  var ruler = document.getElementById('tl-ruler');
  var countEl = document.getElementById('tl-count');
  var allBtn = document.getElementById('tl-all');
  var openBtn = document.getElementById('tl-open');
  var toolbar = document.querySelector('.toolbar');
  var items = Array.prototype.slice.call(list.children);
  var events = items.filter(function (li) { return li.classList.contains('tl-ev'); });
  var real = events.filter(function (li) { return li.id !== 'ev-to-be-continued'; });
  var smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  var groupsEl = document.getElementById('tl-groups');   // the "By group" view (may not exist)
  var state = { order: 'happened', lanes: [] };

  function lanesOf(li) { return (li.getAttribute('data-lanes') || '').split(' ').filter(Boolean); }
  function shown(li) { return !li.hidden && getComputedStyle(li).display !== 'none'; }
  function topOffset() { return (toolbar ? toolbar.offsetHeight : 0) + (ruler.hidden ? 0 : ruler.offsetHeight); }

  // ---- state from the URL, then the viewer's last choice
  var params = new URLSearchParams(location.search);
  var saved = null;
  try { saved = localStorage.getItem('loc-tl-order'); } catch (e) {}
  var wanted = params.get('order') || saved;
  if (wanted === 'told' || wanted === 'happened' || (wanted === 'groups' && groupsEl)) state.order = wanted;
  var known = {};
  events.forEach(function (li) { lanesOf(li).forEach(function (l) { known[l] = 1; }); });
  state.lanes = (params.get('lanes') || '').split(',').filter(function (l) { return known[l]; });

  // ---- apply
  function apply(keepPlace) {
    var isGroups = state.order === 'groups' && !!groupsEl;
    var wasGroups = !!groupsEl && !groupsEl.hidden;
    if (!isGroups && state.order === 'groups') state.order = 'happened';
    if (groupsEl) groupsEl.hidden = !isGroups;
    list.hidden = isGroups;
    ruler.hidden = isGroups;
    controls.querySelectorAll('.tl-only').forEach(function (el) { el.hidden = isGroups; });
    controls.querySelectorAll('.tl-order button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-order') === state.order ? 'true' : 'false');
    });
    if (isGroups || wasGroups) keepPlace = false;   // a different page layout: start at the controls

    // Remember what's at the top of the screen, so switching order doesn't lose your place.
    var anchor = null, anchorTop = 0;
    if (keepPlace) {
      var limit = topOffset();
      for (var i = 0; i < items.length; i++) {
        if (!shown(items[i])) continue;
        var r = items[i].getBoundingClientRect();
        if (r.bottom > limit + 4) { anchor = items[i]; anchorTop = r.top; break; }
      }
    }

    if (isGroups) {
      measure();
      remember();
      return;
    }
    var told = state.order === 'told';
    var key = told ? 'data-told' : 'data-when', key2 = told ? 'data-when' : 'data-told';
    items.sort(function (a, b) {
      return (+a.getAttribute(key) - +b.getAttribute(key)) || (+a.getAttribute(key2) - +b.getAttribute(key2));
    });
    items.forEach(function (li) { list.appendChild(li); });
    list.setAttribute('data-order', state.order);

    var want = state.lanes;
    var visible = 0;
    events.forEach(function (li) {
      var ls = lanesOf(li);
      var ok = !want.length || !ls.length || ls.some(function (l) { return want.indexOf(l) > -1; });
      li.hidden = !ok;
      if (ok && ls.length) visible++;
    });

    // Headings of the current kind; hide the ones with nothing left under them.
    var kind = told ? 'chapter' : 'era', groups = [], cur = null;
    items.forEach(function (li) {
      if (li.classList.contains('tl-head')) {
        if (li.getAttribute('data-kind') !== kind) return;
        cur = { head: li, n: 0 };
        groups.push(cur);
      } else if (cur && !li.hidden && lanesOf(li).length) cur.n++;
    });
    groups.forEach(function (g) { g.head.hidden = !g.n; });

    // Ruler
    ruler.innerHTML = '';
    ruler.setAttribute('data-kind', kind);
    groups.forEach(function (g) {
      if (!g.n) return;
      var a = document.createElement('a');
      var num = g.head.getAttribute('data-num'), name = g.head.getAttribute('data-short');
      a.href = '#' + g.head.id;
      a.style.setProperty('--n', g.n);
      a.title = (num ? num + '. ' : '') + name + ' (' + g.n + (g.n === 1 ? ' event)' : ' events)');
      if (num) {
        var b = document.createElement('b'); b.textContent = num;
        var s = document.createElement('span'); s.textContent = ' ' + name;
        a.appendChild(b); a.appendChild(s);
      } else a.textContent = name;
      a.addEventListener('click', function (ev) { ev.preventDefault(); go(g.head, false); });
      g.link = a;
      ruler.appendChild(a);
    });
    ruler._groups = groups.filter(function (g) { return g.n; });

    // Buttons and counts
    controls.querySelectorAll('.tl-order button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-order') === state.order ? 'true' : 'false');
    });
    controls.querySelectorAll('.tl-chip').forEach(function (b) {
      b.setAttribute('aria-pressed', want.indexOf(b.getAttribute('data-lane')) > -1 ? 'true' : 'false');
    });
    allBtn.hidden = !want.length;
    countEl.textContent = want.length
      ? visible + ' of ' + real.length + ' events'
      : real.length + ' events, ' + (told ? 'in the order the book tells them' : 'in the order they happened');
    syncOpenBtn();
    measure();

    if (anchor && shown(anchor)) window.scrollBy(0, anchor.getBoundingClientRect().top - anchorTop);
    onScroll();

    remember();
    if (wasGroups) controls.scrollIntoView();
  }

  // Remember the view, and put it in the address so it can be shared.
  function remember() {
    try { localStorage.setItem('loc-tl-order', state.order); } catch (e) {}
    var p = new URLSearchParams(location.search);
    if (state.order !== 'happened') p.set('order', state.order); else p.delete('order');
    if (state.lanes.length && state.order !== 'groups') p.set('lanes', state.lanes.join(',')); else p.delete('lanes');
    var qs = p.toString();
    try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) {}
  }

  // ---- sticky offsets and the ruler's current segment
  function measure() {
    var root = document.documentElement.style;
    root.setProperty('--tl-top', (toolbar ? toolbar.offsetHeight : 0) + 'px');
    root.setProperty('--tl-ruler', ruler.offsetHeight + 'px');
  }
  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      var groups = ruler._groups || [], line = topOffset() + 24, current = groups[0];
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].head.getBoundingClientRect().top <= line) current = groups[i];
      }
      groups.forEach(function (g) {
        if (g === current) g.link.setAttribute('aria-current', 'true'); else g.link.removeAttribute('aria-current');
      });
    });
  }

  // ---- jump to an event or heading
  function flash(li) {
    li.classList.remove('tl-flash');
    void li.offsetWidth;
    li.classList.add('tl-flash');
  }
  function go(li, open) {
    if (li.hidden) { state.lanes = []; apply(false); }   // filtered out: show every storyline again
    var d = li.querySelector('details');
    if (open && d) d.open = true;
    li.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    flash(li);
    if (d && open) { var s = d.querySelector('summary'); if (s) s.focus({ preventScroll: true }); }
  }
  function fromHash() {
    var id = decodeURIComponent(location.hash.slice(1));
    var li = id && document.getElementById(id);
    if (li && groupsEl && groupsEl.contains(li) && /^grp-/.test(li.id)) {   // a card in the "By group" view
      if (state.order !== 'groups') { state.order = 'groups'; apply(false); }
      li.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      flash(li);
      return;
    }
    if (li && li.parentNode === list) {
      if (state.order === 'groups') { state.order = 'told'; apply(false); }   // an event link from the "By group" view
      if (li.classList.contains('tl-head') && li.getAttribute('data-kind') !== (state.order === 'told' ? 'chapter' : 'era')) {
        state.order = li.getAttribute('data-kind') === 'chapter' ? 'told' : 'happened';
        apply(false);
      }
      go(li, true);
    }
  }

  // ---- open / close all
  function details() { return events.filter(function (li) { return !li.hidden; }).map(function (li) { return li.querySelector('details'); }).filter(Boolean); }
  function syncOpenBtn() {
    var ds = details();
    openBtn.textContent = ds.length && ds.every(function (d) { return d.open; }) ? 'Close all' : 'Open all';
  }
  openBtn.addEventListener('click', function () {
    var ds = details(), open = !ds.every(function (d) { return d.open; });
    ds.forEach(function (d) { d.open = open; });
    syncOpenBtn();
  });
  list.addEventListener('toggle', syncOpenBtn, true);

  // ---- controls
  controls.querySelectorAll('.tl-order button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (state.order === b.getAttribute('data-order')) return;
      state.order = b.getAttribute('data-order');
      apply(true);
    });
  });
  controls.querySelectorAll('.tl-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      var l = b.getAttribute('data-lane'), i = state.lanes.indexOf(l);
      if (i > -1) state.lanes.splice(i, 1); else state.lanes.push(l);
      apply(true);
    });
  });
  allBtn.addEventListener('click', function () { state.lanes = []; apply(true); });

  // Permalinks update the address without the browser's own jump (the list may have moved).
  list.addEventListener('click', function (ev) {
    var a = ev.target.closest('a.tl-permalink');
    if (!a) return;
    ev.preventDefault();
    try { history.replaceState(history.state, '', location.pathname + location.search + a.getAttribute('href')); } catch (e) {}
    go(a.closest('li'), true);
  });

  // ---- the Cycle: go round again, up to eight times, like the book
  var loopBtn = list.querySelector('.tl-loop'), loopN = list.querySelector('.tl-loop-n'), rounds = 1;
  if (loopBtn) {
    loopN.textContent = 'Times round: 1 of 8';
    loopBtn.addEventListener('click', function () {
      if (rounds >= 8) { go(document.getElementById('ev-stabbing-of-chris'), true); return; }
      rounds++;
      loopN.textContent = 'Times round: ' + rounds + ' of 8';
      if (rounds === 8) {
        loopBtn.textContent = 'Then he was stabbed →';
        loopN.textContent = 'That was the eighth time. The Cycle is broken.';
      }
      go(document.getElementById('ev-chris-is-born'), true);
    });
  }

  controls.hidden = false;
  ruler.hidden = false;
  apply(false);
  if (location.hash) {
    // Wait a frame so the sticky bars have their sizes, then jump.
    requestAnimationFrame(fromHash);
  }
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () { measure(); onScroll(); });
})();
