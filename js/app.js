/* ============================================================
 * Slidysim WR History Browser — app.js
 * App bootstrap, routing, search, theme, platform toggle.
 * ============================================================ */
(function () {
  'use strict';

  var WR = (window.WR = window.WR || {});

  function init() {
    try {
      WR.loadData();
      bootApp();
    } catch (e) {
      // Fallback: try async fetch of the JSON file (handles cases where the
      // synchronous script tag / XHR failed, e.g. in some iframe contexts).
      fetch('data/wr-data.json')
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          window.WR_DATA = data;
          WR.loadData();
          bootApp();
        })
        .catch(function (err) {
          document.getElementById('view-container').innerHTML =
            '<div class="empty-state"><div class="icon">!</div>Failed to load data: ' + err.message +
            '<br><br><button class="filter-pill" onclick="location.reload()">Retry</button></div>';
        });
    }
  }

  function bootApp() {
    // theme — dark only (light mode removed per user request)
    WR.setTheme('dark');

    // platform
    var savedPlatform = localStorage.getItem('wr-platform') || 'exe';
    WR.setPlatform(savedPlatform);
    syncPlatformToggle();

    // footer
    updateFooter();

    // nav
    setupNav();
    setupSearch();
    setupModal();
    setupPlatformToggle();

    // route
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
  }

  function handleRoute() {
    var h = WR.getHashParams();
    // update nav active state
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-route') === h.route);
    });
    WR.render(h.route, h.params);
    window.scrollTo(0, 0);
  }

  function setupNav() {
    document.querySelectorAll('.nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        WR.setHash(btn.getAttribute('data-route'), {});
      });
    });
    document.querySelector('.brand').addEventListener('click', function () {
      WR.setHash('overview', {});
    });
    document.querySelector('.brand').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        WR.setHash('overview', {});
      }
    });
  }

  function setupPlatformToggle() {
    var toggle = document.getElementById('platform-toggle');
    if (!toggle) return;
    toggle.querySelectorAll('.plt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        WR.setPlatform(btn.getAttribute('data-platform'));
        localStorage.setItem('wr-platform', btn.getAttribute('data-platform'));
        syncPlatformToggle();
        // re-render current view
        var h = WR.getHashParams();
        WR.render(h.route, h.params);
      });
    });
  }
  function syncPlatformToggle() {
    var p = WR.getPlatform();
    document.querySelectorAll('.plt-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-platform') === p);
    });
  }

  function updateFooter() {
    var meta = WR.getData().meta;
    var sub = document.getElementById('brand-sub');
    if (sub) sub.textContent = meta.totalRecords + ' records · ' + meta.totalCategories + ' categories';
    var stats = document.getElementById('footer-stats');
    if (stats) stats.textContent = meta.totalRecords + ' records';
    var fetched = document.getElementById('footer-fetched');
    if (fetched) fetched.textContent = 'Updated ' + meta.fetchedAt;
  }

  /* ---------- Search ---------- */
  function setupSearch() {
    var trigger = document.getElementById('search-trigger');
    var overlay = document.getElementById('search-overlay');
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    if (!trigger || !overlay || !input) return;

    function open() {
      overlay.hidden = false;
      input.value = '';
      results.innerHTML = '';
      setTimeout(function () { input.focus(); }, 50);
    }
    function close() { overlay.hidden = true; }

    trigger.addEventListener('click', open);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (overlay.hidden) open();
        else close();
      }
    });

    var selectedIdx = -1;
    var currentResults = [];

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) { results.innerHTML = ''; currentResults = []; return; }
      currentResults = searchAll(q);
      selectedIdx = -1;
      renderResults();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = Math.min(currentResults.length - 1, selectedIdx + 1);
        renderResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = Math.max(-1, selectedIdx - 1);
        renderResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIdx >= 0 && currentResults[selectedIdx]) {
          goResult(currentResults[selectedIdx]);
        } else if (currentResults.length) {
          goResult(currentResults[0]);
        }
      }
    });

    function renderResults() {
      if (!currentResults.length) {
        results.innerHTML = '<div class="search-result" style="cursor:default"><span class="sr-type">—</span><span class="sr-label" style="color:var(--text-dim)">No results</span></div>';
        return;
      }
      results.innerHTML = '';
      currentResults.forEach(function (r, i) {
        var div = document.createElement('div');
        div.className = 'search-result' + (i === selectedIdx ? ' selected' : '');
        div.innerHTML = '<span class="sr-type">' + r.type + '</span>' +
          '<span class="sr-label">' + WR.esc(r.label) + '</span>' +
          '<span class="sr-meta">' + WR.esc(r.meta || '') + '</span>';
        div.addEventListener('click', function () { goResult(r); });
        div.addEventListener('mouseenter', function () { selectedIdx = i; });
        results.appendChild(div);
      });
    }

    function goResult(r) {
      close();
      WR.setHash(r.route, r.params || {});
    }
  }

  function searchAll(q) {
    var results = [];
    var cats = WR.getCategories();
    // categories
    cats.forEach(function (c) {
      if (c.name.toLowerCase().indexOf(q) >= 0) {
        results.push({ type: 'cat', label: c.name, meta: c.records.length + ' records', route: 'category', params: { id: c.id } });
      }
    });
    // players
    var players = WR.getData().meta.players;
    Object.keys(players).forEach(function (name) {
      if (name.toLowerCase().indexOf(q) >= 0) {
        results.push({ type: 'player', label: name, meta: players[name] + ' records', route: 'player', params: { name: name } });
      }
    });
    return results.slice(0, 20);
  }

  /* ---------- Modal ---------- */
  function setupModal() {
    var overlay = document.getElementById('modal-overlay');
    var close = document.getElementById('modal-close');
    if (!overlay || !close) return;
    close.addEventListener('click', function () { overlay.hidden = true; });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) overlay.hidden = true;
    });
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
