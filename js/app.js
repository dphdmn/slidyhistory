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
      // wr-data.js failed to load (script tag broken / file missing).
      // Show a retry button — no JSON fallback anymore (we removed the
      // 4MB wr-data.json duplicate from the repo).
      document.getElementById('view-container').innerHTML =
        '<div class="empty-state"><div class="icon">!</div>Failed to load data: ' + e.message +
        '<br><br><button class="filter-pill" onclick="location.reload()">Retry</button></div>';
    }
  }

  function bootApp() {
    // theme — dark only (light mode removed per user request)
    WR.setTheme('dark');

    // platform
    var savedPlatform = localStorage.getItem('wr-platform') || 'exe';
    WR.setPlatform(savedPlatform);
    syncPlatformToggle();
    updateAppTitle();

    // expanded palette
    if (localStorage.getItem('wr-expanded-palette') === 'true') {
      WR.toggleExpandedPalette();
      WR.refreshPlayerColors(WR.getPlatform());
    }
    syncPaletteToggle();

    // footer
    updateFooter();

    // nav
    setupNav();
    setupSearch();
    setupModal();
    setupPlatformToggle();
    setupPaletteToggle();
    setupTimeSlider();

    // route
    window.addEventListener('hashchange', handleRoute);
    handleRoute();

    // ---- Responsive re-render on viewport / zoom change ----
    // ROOT FIX for user issue: "Just changing resolution back and forth
    // makes it look weird, if you zoom in, then zoom out from normal
    // resolution page, everything starts looking too big, so you have to
    // refresh the page to let it normalize."
    //
    // Cause: charts are SVG with a viewBox computed from container.clientWidth
    // AT RENDER TIME. When the viewport changes (browser zoom, window resize,
    // device rotation), the SVG scales via CSS width:100% + viewBox, but the
    // internal coordinate system (margins, tick spacing, font sizes) was
    // designed for the ORIGINAL width. On mobile this makes text tiny and
    // X-axis labels collapse; on zoom-in-then-out the stretched viewBox makes
    // everything look oversized until a refresh.
    //
    // Fix: debounced re-render of the CURRENT view on every resize. This
    // rebuilds all charts with dimensions appropriate for the new viewport, so
    // text stays readable and proportions stay correct at any size. The
    // debounce (180ms) avoids thrashing during continuous resize / pinch-zoom.
    var resizeTimer = null;
    var lastWidth = window.innerWidth;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        var w = window.innerWidth;
        // Only re-render if width actually changed (height-only changes e.g.
        // mobile browser URL bar show/hide don't affect chart layout).
        if (w === lastWidth) return;
        lastWidth = w;
        var h = WR.getHashParams();
        WR.render(h.route, h.params);
      }, 180);
    }, { passive: true });
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
        updateAppTitle();
        // re-render current view
        var h = WR.getHashParams();
        WR.render(h.route, h.params);
        // footer counts are cutoff+platform aware — refresh after platform switch
        updateFooter();
      });
    });
  }
  function syncPlatformToggle() {
    var p = WR.getPlatform();
    document.querySelectorAll('.plt-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-platform') === p);
    });
  }

  function setupPaletteToggle() {
    var btn = document.getElementById('palette-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var on = WR.toggleExpandedPalette();
      localStorage.setItem('wr-expanded-palette', on);
      WR.refreshPlayerColors(WR.getPlatform());
      syncPaletteToggle();
      var h = WR.getHashParams();
      WR.render(h.route, h.params);
    });
  }
  function syncPaletteToggle() {
    var btn = document.getElementById('palette-toggle');
    if (!btn) return;
    btn.classList.toggle('active', WR.isExpandedPalette());
    btn.title = WR.isExpandedPalette() ? 'Collapse color palette' : 'Expand color palette';
  }

  function updateFooter() {
    var meta = WR.getData().meta;
    var platform = WR.getPlatform();
    // Always use computed stats for LM/Combined views (meta only reflects
    // original exe+web data). Also use computed stats when time-travelling
    // to reflect the cutoff-aware state.
    var useComputed = WR.isTimeTravelling() || platform === 'lm' || platform === 'combined';
    var stats = useComputed ? WR.getGlobalStats(platform) : null;
    var recCount = stats ? stats.totalRecords : meta.totalRecords;
    var catCount = stats ? stats.totalCategories : meta.totalCategories;
    var sub = document.getElementById('brand-sub');
    if (sub) {
      var ttTag = WR.isTimeTravelling() ? ' · as of ' + formatTsLabel(WR.getTimeCutoff()) : '';
      sub.textContent = recCount + ' records · ' + catCount + ' categories' + ttTag;
    }
    var statsEl = document.getElementById('footer-stats');
    if (statsEl) statsEl.textContent = recCount + ' records';
    var fetched = document.getElementById('footer-fetched');
    if (fetched) fetched.textContent = 'Updated ' + meta.fetchedAt;
  }

  function updateAppTitle() {
    var p = WR.getPlatform();
    var titles = {
      exe: 'Desktop Slidysim WR History',
      web: 'Web Slidysim WR History',
      both: 'Overall Slidysim WR History',
      lm: 'League of Minesweeper WR History',
      combined: 'Combined Speedsliding WR History'
    };
    var t = titles[p] || 'Slidysim WR History';
    document.title = t;
    var el = document.querySelector('.brand-title');
    if (el) el.textContent = t;
  }

  /* ---------- Search ---------- */
  function setupSearch() {
    var trigger = document.getElementById('search-trigger');
    var overlay = document.getElementById('search-overlay');
    var input = document.getElementById('search-input');
    var results = document.getElementById('search-results');
    if (!trigger || !overlay || !input) return;

    function open() {
      // Hide any chart tooltip — the search overlay sits on top of the page,
      // and a tooltip that was visible when the user hit Ctrl+K would float
      // on top of the overlay (tooltips are position:fixed on document.body).
      if (WR.hideAllTooltips) WR.hideAllTooltips();
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
    // players — from meta (exe+web) + scan records (for LM-only players)
    var players = WR.getData().meta.players || {};
    var seen = {};
    Object.keys(players).forEach(function (name) { seen[name] = true; });
    cats.forEach(function (c) {
      c.records.forEach(function (r) {
        if (!seen[r.player]) {
          seen[r.player] = true;
          players[r.player] = (players[r.player] || 0) + 1;
        }
      });
    });
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

  /* ============================================================
   * Time-travel slider ("teleport back in time")
   * ------------------------------------------------------------
   * A full-width range slider in the header that lets the user scrub
   * through history. Dragging it sets a global cutoff timestamp — every
   * record, stat, chart, leaderboard, and heatmap then reflects the state
   * of the world "as of" that moment. A native <input type="date"> beside
   * the slider allows precise date entry; the "Live" button returns to now.
   *
   * Performance strategy:
   *   - The slider's `input` event fires rapidly during a drag. We update
   *     the date LABEL synchronously on every fire (a single textContent
   *     write — effectively free) so the user sees the date chase the thumb
   *     with zero perceptible lag.
   *   - The actual view re-render is debounced (~110ms). This collapses a
   *     burst of input events into a single render, keeping the UI fluid
   *     even on slow devices. The data filtering itself is cheap (~1200
   *     records, linear scan) so the bottleneck is DOM rebuild, which the
   *     debounce absorbs.
   *   - The re-render is skipped entirely if the value hasn't actually
   *     changed since the last applied cutoff (e.g. sub-day drags that land
   *     on the same day boundary produce no visible difference).
   * User: "slider must be smooth and performance friendly".
   * ============================================================ */
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Format a unix-seconds timestamp as "DD Mon YYYY" (e.g. "15 Mar 2021").
  function formatTsLabel(ts) {
    if (ts == null || isNaN(ts)) return 'Live';
    var d = new Date(ts * 1000);
    return pad(d.getUTCDate()) + ' ' + MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  // Format as YYYY-MM-DD for the <input type="date"> value.
  function tsToIsoDate(ts) {
    if (ts == null || isNaN(ts)) return '';
    var d = new Date(ts * 1000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function setupTimeSlider() {
    var slider = document.getElementById('tt-slider');
    var dateText = document.getElementById('tt-date-text');
    var dateInput = document.getElementById('tt-date');
    var liveBtn = document.getElementById('tt-live-btn');
    var labelBlock = document.getElementById('tt-label-block');
    var ticksEl = document.getElementById('tt-ticks');
    var bar = document.getElementById('time-travel-bar');
    if (!slider || !dateText || !dateInput || !liveBtn) return;

    var STEP = 86400; // 1 day — matches data granularity & date picker
    var range = WR.getCutoffDateRange();
    // The slider's max is range.live (a float = NOW). The browser quantizes
    // the slider VALUE to the step, so the actual max reachable value is
    // floor(live/step)*step — which can be slightly less than range.live.
    // We track this quantized "live value" so isAtLive() correctly recognises
    // the rightmost slider position as live (not 1-day-before-live).
    var liveValue = Math.floor(range.live / STEP) * STEP;

    slider.min = range.min;
    slider.max = range.live;
    slider.step = STEP;
    slider.value = liveValue; // start at "live"

    // Date picker bounds — same as slider.
    dateInput.min = tsToIsoDate(range.min);
    dateInput.max = tsToIsoDate(range.live);
    dateInput.value = '';

    // Build year tick marks under the slider for orientation while scrubbing.
    buildTicks();

    function buildTicks() {
      if (!ticksEl) return;
      var startYear = new Date(range.min * 1000).getUTCFullYear();
      var endYear = new Date(range.live * 1000).getUTCFullYear();
      var span = range.live - range.min;
      var html = '';
      for (var y = startYear; y <= endYear; y++) {
        var ts = Math.floor(Date.UTC(y, 0, 1) / 1000);
        if (ts < range.min) ts = range.min;
        if (ts > range.live) ts = range.live;
        var pct = span > 0 ? ((ts - range.min) / span) * 100 : 0;
        html += '<span class="tt-tick" style="left:' + pct.toFixed(2) + '%">' +
          '<span class="tt-tick-line"></span>' +
          '<span class="tt-tick-label">' + y + '</span>' +
        '</span>';
      }
      ticksEl.innerHTML = html;
    }

    // Whether the slider is currently at the live (rightmost) position.
    // Compares against liveValue (quantized) so the natural max position
    // is recognised as live.
    function isAtLive(v) {
      return Number(v) >= liveValue;
    }

    // Apply a cutoff value (unix ts) and re-render. Skipped if unchanged.
    var lastApplied = null; // last cutoff actually applied (null = live)
    function applyCutoff(v) {
      var atLive = isAtLive(v);
      var cutoff = atLive ? null : Number(v);
      // Skip re-render if the effective cutoff hasn't changed (e.g. dragging
      // within the same day, or releasing at the same position).
      if (lastApplied === cutoff) {
        updateLabelOnly(v);
        return;
      }
      lastApplied = cutoff;
      WR.setTimeCutoff(cutoff);
      updateLabelOnly(v);
      // Re-render the current view + refresh footer counts.
      var h = WR.getHashParams();
      WR.render(h.route, h.params);
      updateFooter();
    }

    // Update ONLY the date label + body class — no re-render. Called on every
    // input event for instant visual feedback while the debounced render
    // catches up.
    function updateLabelOnly(v) {
      var atLive = isAtLive(v);
      if (atLive) {
        dateText.textContent = 'Live';
        dateText.classList.remove('travelling');
        labelBlock.classList.remove('travelling');
        if (bar) bar.classList.remove('time-travel-active');
        document.body.classList.remove('time-travelling');
        dateInput.value = '';
      } else {
        dateText.textContent = formatTsLabel(Number(v));
        dateText.classList.add('travelling');
        labelBlock.classList.add('travelling');
        if (bar) bar.classList.add('time-travel-active');
        document.body.classList.add('time-travelling');
        dateInput.value = tsToIsoDate(Number(v));
      }
    }

    // Debounced re-render. The label updates immediately (above); the heavy
    // DOM rebuild waits ~110ms so a fast drag fires only one render at the end
    // of each pause. requestAnimationFrame wraps the actual render so it lands
    // on a paint boundary (no jank).
    var renderTimer = null;
    var pendingValue = null;
    function scheduleRender(v) {
      pendingValue = v;
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(function () {
        renderTimer = null;
        var vv = pendingValue;
        requestAnimationFrame(function () { applyCutoff(vv); });
      }, 110);
    }

    // Slider drag: label live, render debounced.
    slider.addEventListener('input', function () {
      updateLabelOnly(slider.value);
      scheduleRender(slider.value);
    });
    // On release (change event), force an immediate apply so the final
    // position is reflected without waiting for the debounce tail.
    slider.addEventListener('change', function () {
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      applyCutoff(slider.value);
    });

    // Date picker: precise date entry. Snap to end-of-day so "15 Mar 2021"
    // includes all records set on 15 Mar (records are midnight-UTC, so
    // cutoff = 15 Mar 23:59:59 includes 15 Mar's midnight record).
    dateInput.addEventListener('change', function () {
      if (!dateInput.value) return;
      var dayStart = Math.floor(Date.parse(dateInput.value + 'T00:00:00Z') / 1000);
      if (isNaN(dayStart)) return;
      var endOfDay = dayStart + 86399; // 23:59:59 UTC
      if (endOfDay > liveValue) endOfDay = liveValue;
      // Quantize to step so the slider thumb lands exactly on a tick.
      endOfDay = Math.floor(endOfDay / STEP) * STEP;
      slider.value = endOfDay;
      applyCutoff(endOfDay);
    });

    // "Live" button: reset to now.
    liveBtn.addEventListener('click', function () {
      slider.value = liveValue;
      if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
      applyCutoff(liveValue);
    });
  }

  // boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
