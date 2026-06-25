/* ============================================================
 * Slidysim WR History Browser — views.js
 * All view rendering. Restructured into:
 *   - overview (landing): stats, player leaderboard, charts, heatmaps
 *   - categories (leaderboard): grid of categories with mini-charts
 *   - category: full record table, timeline, embedded video
 *   - compare: interactive multi-line, Y=time, distinct colors
 *   - player: player detail with snipes, nemesis, records
 *   - about
 * ============================================================ */
(function () {
  'use strict';

  var WR = (window.WR = window.WR || {});
  var U = WR;
  var state = { platform: 'exe', theme: 'dark', route: 'overview', params: {} };

  // Saved scroll position for Compare selector — preserved across re-renders
  // so the selector doesn't jump to the top after each selection.
  // User: "whole ui refreshes, so this section is scrolled back on top after
  // each selection, which is a bit annoying".
  var savedSelectorScroll = 0;

  // Compare Players chart mode: 'active' (floating state) or 'all' (cumulative
  // total records ever set). User: "add a toggle to the graph to show All
  // Records version of this chart ... Rival / All version".
  var compareChartMode = 'active';

  /* ---------- Container ---------- */
  function container() { return document.getElementById('view-container'); }

  /* ============================================================
   * OVERVIEW (landing page)
   * ============================================================ */
  function renderOverview() {
    var c = container();
    var stats = U.getGlobalStats(state.platform);
    var players = U.getPlayerLeaderboard(state.platform);

    var dateRange = U.getData().meta.dateRange || {};
    var yearSpan = '';
    if (dateRange.min && dateRange.max) {
      var y1 = dateRange.min.slice(0,4), y2 = dateRange.max.slice(0,4);
      yearSpan = y1 === y2 ? y1 : y1 + '–' + y2;
    }

    c.innerHTML = `
      <h1 class="page-title">Slidysim <span class="accent">World Records</span></h1>
      <p class="page-subtitle">${stats.totalRecords} records across ${stats.totalCategories} categories · ${stats.totalPlayers} players · ${yearSpan || 'all time'}</p>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Total Records</div>
          <div class="stat-value">${stats.totalRecords}</div>
          <div class="stat-sub">All are world records</div>
        </div>
        <div class="stat-card pink">
          <div class="stat-label">Snipes</div>
          <div class="stat-value">${stats.totalSnipes}</div>
          <div class="stat-sub">WR taken from a rival, or first documented record in a category</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Replays</div>
          <div class="stat-value">${stats.totalReplays}</div>
          <div class="stat-sub">linked evidence</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-label">Videos</div>
          <div class="stat-value">${stats.totalVideos}</div>
          <div class="stat-sub">With video evidence</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Players</div>
          <div class="stat-value">${stats.totalPlayers}</div>
          <div class="stat-sub">${stats.totalCategories} categories</div>
        </div>
      </div>

      <div class="grid-2 mb-16">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Current <span class="neon">WRs</span> Held</div>
            <div class="card-actions"><span class="badge badge-cyan">${Object.keys(stats.currentHolders).length} holders</span></div>
          </div>
          <div id="chart-current-wrs"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="neon">Snipes</span> Leaderboard</div>
            <div class="card-actions"><span class="badge badge-cyan">rival snipes + first documented records</span></div>
          </div>
          <div id="chart-snipes"></div>
        </div>
      </div>

      <div class="grid-2 mb-16">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Total <span class="neon">Records</span></div>
            <div class="card-actions"><span class="badge badge-cyan">all entries</span></div>
          </div>
          <div id="chart-total-records"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="neon">Player</span> Leaderboard</div>
            <div class="card-actions"><span class="badge badge-cyan">click row · sort headers</span></div>
          </div>
          <div id="player-leaderboard"></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title"><span class="neon">Records</span> by Years</div>
          <div class="card-actions">
            <div class="mode-toggle" id="velocity-toggle">
              <button class="mt-btn active" data-mode="total">Total</button>
              <button class="mt-btn" data-mode="rival">Rival</button>
            </div>
          </div>
        </div>
        <div id="chart-velocity"></div>
      </div>

      <div class="grid-nemesis-activity mb-16">
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="neon">Nemesis</span> Matrix</div>
            <div class="card-actions"><span class="badge badge-pink">row sniped column · click names</span></div>
          </div>
          <div id="nemesis-matrix"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">Activity <span class="neon">Heatmap</span></div>
            <div class="card-actions">
              <div class="mode-toggle" id="activity-toggle">
                <button class="mt-btn active" data-mode="total">Total</button>
                <button class="mt-btn" data-mode="rival">Rival</button>
              </div>
            </div>
          </div>
          <div id="activity-heatmap" style="overflow-x:auto"></div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Player × Category <span class="neon">Heatmap</span></div>
          <div class="card-actions">
            <div class="mode-toggle" id="playercat-toggle">
              <button class="mt-btn active" data-mode="total">Total</button>
              <button class="mt-btn" data-mode="rival">Rival</button>
            </div>
            <span class="badge badge-gray" id="playercat-count">${Math.min(15, stats.totalPlayers)} players</span>
          </div>
        </div>
        <div id="player-cat-heatmap" style="overflow-x:auto"></div>
      </div>
    `;

    // Top current WR holders (exclude 0-holders)
    // User: "Player names in all those WRs Held sections must be clickable and colored".
    // barChart now supports onLabelClick — clicking a player's NAME (not just
    // the bar) navigates to the player page.
    var currentHolders = Object.keys(stats.currentHolders)
      .map(function (name) { return { label: name, value: stats.currentHolders[name], color: U.playerColor(name) }; })
      .filter(function (i) { return i.value > 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 15);
    U.barChart(document.getElementById('chart-current-wrs'), currentHolders, {
      onBarClick: function (item) { U.setHash('player', { name: item.label }); },
      onLabelClick: function (item) { U.setHash('player', { name: item.label }); },
    });

    // Snipes leaderboard
    var snipeItems = Object.keys(stats.players).map(function (name) {
      var sp = U.getPlayerSnipes(name, state.platform);
      return { label: name, value: sp.count, color: U.playerColor(name), sub: sp.count + ' snipes' };
    }).filter(function (i) { return i.value > 0; })
      .sort(function (a, b) { return b.value - a.value; })
      .slice(0, 15);
    U.barChart(document.getElementById('chart-snipes'), snipeItems, {
      onBarClick: function (item) { U.setHash('player', { name: item.label }); },
      onLabelClick: function (item) { U.setHash('player', { name: item.label }); },
    });

    // Total records
    var totalItems = Object.keys(stats.players).map(function (name) {
      return { label: name, value: stats.players[name], color: U.playerColor(name) };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 15);
    U.barChart(document.getElementById('chart-total-records'), totalItems, {
      onBarClick: function (item) { U.setHash('player', { name: item.label }); },
      onLabelClick: function (item) { U.setHash('player', { name: item.label }); },
    });

    // Player leaderboard table (sortable)
    renderPlayerLeaderboardTable(document.getElementById('player-leaderboard'), players);

    // Velocity + Activity heatmaps with rival/total toggle
    var velocityMode = 'total';
    var activityMode = 'total';
    var playerCatMode = 'total';

    function renderVelocity() {
      var data = velocityMode === 'rival' ? U.getSnipesByYear(state.platform) : U.getRecordsByYear(state.platform);
      var items = data.map(function (y) { return { label: y.year, value: y.count, color: '#00bcd4' }; });
      WR.vbarChart(document.getElementById('chart-velocity'), items, { color: '#00bcd4' });
    }
    function renderActivity() {
      WR.activityHeatmap(document.getElementById('activity-heatmap'), state.platform, { mode: activityMode });
    }
    function renderPlayerCat() {
      WR.playerCategoryHeatmap(document.getElementById('player-cat-heatmap'), state.platform, 15, { mode: playerCatMode });
    }

    renderVelocity();
    renderActivity();
    WR.nemesisMatrix(document.getElementById('nemesis-matrix'), state.platform, 12);
    renderPlayerCat();

    // Wire toggles
    document.getElementById('velocity-toggle').querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('velocity-toggle').querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        velocityMode = btn.getAttribute('data-mode');
        renderVelocity();
      });
    });
    document.getElementById('activity-toggle').querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('activity-toggle').querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activityMode = btn.getAttribute('data-mode');
        renderActivity();
      });
    });
    document.getElementById('playercat-toggle').querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('playercat-toggle').querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        playerCatMode = btn.getAttribute('data-mode');
        renderPlayerCat();
      });
    });
  }

  /* ============================================================
   * Player Leaderboard table — sortable headers, default by snipes.
   * Columns: Player, Current WRs, Snipes, Records Ever Held, Categories
   * (Removed: First Ever, Total Records — duplicates per user request)
   * ============================================================ */
  function renderPlayerLeaderboardTable(container, players) {
    // Default sort: by snipes descending (already done in getPlayerLeaderboard)
    var sortState = { key: 'snipes', dir: 'desc' };

    function sortBy(key, dir) {
      return function (a, b) {
        var va = a[key], vb = b[key];
        if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return dir === 'asc' ? va - vb : vb - va;
      };
    }

    function render() {
      var sorted = players.slice().sort(sortBy(sortState.key, sortState.dir));
      var top = sorted.slice(0, 30);

      function sortIcon(key) {
        if (sortState.key !== key) return '';
        return sortState.dir === 'asc' ? ' ▲' : ' ▼';
      }

      var html = '<div class="table-scroll"><table class="wr-table sortable-table compact-table"><thead><tr>' +
        '<th class="rank">#</th>' +
        '<th class="sortable-th" data-sort="name">Player' + sortIcon('name') + '</th>' +
        '<th class="num sortable-th" data-sort="currentWRs" title="Current WRs held">WRs' + sortIcon('currentWRs') + '</th>' +
        '<th class="num sortable-th" data-sort="snipes" title="Times WR taken from a rival OR first documented record in a category">Snipes' + sortIcon('snipes') + '</th>' +
        '<th class="num sortable-th" data-sort="recordsEverHeld" title="Total records ever set">Total' + sortIcon('recordsEverHeld') + '</th>' +
        '<th class="num sortable-th" data-sort="categories" title="Distinct categories played">Cats' + sortIcon('categories') + '</th>' +
        '</tr></thead><tbody>';
      top.forEach(function (p, i) {
        var color = U.playerColor(p.name);
        html += '<tr class="player-row" data-name="' + esc(p.name) + '" style="cursor:pointer">' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="player" style="color:' + color + '">' + esc(p.name) + '</td>' +
          '<td class="num time">' + p.currentWRs + '</td>' +
          '<td class="num text-pink" style="font-weight:700">' + p.snipes + '</td>' +
          '<td class="num">' + p.recordsEverHeld + '</td>' +
          '<td class="num text-dim">' + p.categories + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;

      // wire row clicks
      container.querySelectorAll('tr[data-name]').forEach(function (tr) {
        tr.addEventListener('click', function () {
          U.setHash('player', { name: tr.getAttribute('data-name') });
        });
      });
      // wire header clicks (sort)
      container.querySelectorAll('.sortable-th').forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-sort');
          if (sortState.key === key) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            sortState.key = key;
            sortState.dir = (key === 'name') ? 'asc' : 'desc';
          }
          render();
        });
      });
    }

    render();
  }

  /* ============================================================
   * CATEGORIES (leaderboard page)
   * ============================================================ */
  function renderCategories() {
    var c = container();
    var cats = U.filterCats(state.platform);

    // Group categories by puzzle size. Big puzzles (11x11 and above) are
    // merged into a SINGLE "Big Puzzles" group — there is usually only one
    // category per size above 10x10, so a separate group per size wastes
    // vertical space. Within the Big Puzzles group, categories are sorted by
    // size ascending (11x11, 12x12, ...) just like 10x10 has its single+ao5.
    // User: "big puzzles should be grouped in one big group, not each new
    // size on new line, as all puzzles of 11x11 and above are only 1 category".
    var sizeGroups = {};
    cats.forEach(function (cat) {
      var size = cat.size || 'other';
      var n = parseInt(size, 10);
      var key;
      if (!isNaN(n) && n >= 11) {
        key = 'big'; // single merged group for all 11x11+
      } else {
        key = size;
      }
      if (!sizeGroups[key]) sizeGroups[key] = [];
      sizeGroups[key].push(cat);
    });
    var sizeKeys = Object.keys(sizeGroups).sort(function (a, b) {
      // 'big' sorts last (after all small numeric sizes).
      if (a === 'big') return 1;
      if (b === 'big') return -1;
      var na = parseInt(a), nb = parseInt(b);
      if (isNaN(na) || isNaN(nb)) return a < b ? -1 : 1;
      return na - nb;
    });

    c.innerHTML = `
      <h1 class="page-title">Category <span class="accent">History</span></h1>
      <p class="page-subtitle">${cats.length} categories across ${sizeKeys.length} puzzle groups · click any card for full record history</p>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Current <span class="neon">WRs</span> Summary</div>
          <div class="card-actions">
            <span class="badge badge-cyan">click row to open category</span>
            <button class="filter-pill" id="export-all-btn" title="Download the entire WR dataset (all categories, all records, all notes) as JSON">⬇ Export ALL WR Data (JSON)</button>
          </div>
        </div>
        <div id="wr-summary-table" class="summary-table"></div>
      </div>

      <div style="margin-bottom:8px">
        <div class="filter-label">By puzzle size</div>
        <div class="filter-row" id="cat-size-filters">
          <button class="filter-pill active" data-size="all">All</button>
          ${sizeKeys.map(function (k) {
            var lbl = k === 'big' ? 'Big Puzzles (11×11+)' : k + '×' + k;
            return '<button class="filter-pill" data-size="' + k + '">' + lbl + '</button>';
          }).join('')}
        </div>
      </div>

      <div id="cat-groups"></div>
    `;

    // Render the current WRs summary table (sortable, all columns).
    renderWRSummaryTable(document.getElementById('wr-summary-table'), cats);

    // Export ALL WR data — every record from every category, including notes,
    // solve data, scrambles, solutions, replays, videos. Same column format
    // as the per-category CSV export but covering the entire dataset.
    // User: "you should be able to export ALL wr data with all notes etc just
    // the same format this tool uses, not just individual tables".
    var exportAllBtn = document.getElementById('export-all-btn');
    if (exportAllBtn) {
      exportAllBtn.addEventListener('click', function () {
        exportAllWrDataJson(cats);
      });
    }

    // State
    var currentSizeFilter = 'all';

    function applyFilters() {
      var filtered = cats;
      if (currentSizeFilter !== 'all') {
        // Match the same grouping logic used for sizeKeys.
        // NOTE: cat.size is a NUMBER (e.g. 3), but currentSizeFilter comes
        // from a data-size attribute which is a STRING ("3"). Object keys are
        // coerced to strings, so the grouping keys are strings. We must
        // compare String(key) === currentSizeFilter, otherwise small puzzle
        // filters return 0 results (3 === "3" is false). Only "big"/"all"
        // worked before because they were already strings.
        filtered = filtered.filter(function (cat) {
          var size = cat.size || 'other';
          var n = parseInt(size, 10);
          var key;
          if (!isNaN(n) && n >= 11) key = 'big';
          else key = size;
          return String(key) === currentSizeFilter;
        });
      }
      // Re-group filtered cats (same logic as above)
      var fGroups = {};
      filtered.forEach(function (cat) {
        var size = cat.size || 'other';
        var n = parseInt(size, 10);
        var key;
        if (!isNaN(n) && n >= 11) key = 'big';
        else key = size;
        if (!fGroups[key]) fGroups[key] = [];
        fGroups[key].push(cat);
      });
      var fKeys = Object.keys(fGroups).sort(function (a, b) {
        if (a === 'big') return 1;
        if (b === 'big') return -1;
        var na = parseInt(a), nb = parseInt(b);
        if (isNaN(na) || isNaN(nb)) return a < b ? -1 : 1;
        return na - nb;
      });

      var groupsEl = document.getElementById('cat-groups');
      groupsEl.innerHTML = '';
      renderCatGroups(groupsEl, fGroups, fKeys);
    }

    // Size filter
    document.getElementById('cat-size-filters').querySelectorAll('.filter-pill').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.getElementById('cat-size-filters').querySelectorAll('.filter-pill').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentSizeFilter = btn.getAttribute('data-size');
        applyFilters();
      });
    });

    applyFilters();
  }

  /* ============================================================
   * Current WRs Summary table — top of History page.
   * Shows all current WRs: category, holder, time, moves, tps, control,
   * style, replays, videos, notes, days-since (gradient red→green).
   * ALL columns sortable. Default sort preserves the category order from
   * the data file (so categories appear in their natural size order).
   * User: "Summary should include replays, videos, Notes, all columns must
   * be sortable, including preserving default sorting order of categories".
   * Clicking a row opens the category detail page.
   *
   * Improvements (per user review):
   *   - Category sort now uses [size, eventType-order, name] so averages
   *     within a size sort as: single, ao5, ao12, ao50, ao100 (NOT
   *     alphabetically which gave "ao100 before ao50"). User: "should go in
   *     default order ao5 ao12 ao50 ao100 for averages".
   *   - Replay / Video / Notes columns show ACTUAL data (links/notes), not
   *     just "it exists" dots. User: "should be actual data, like in all
   *     other tables, not just 'it exists' mark".
   * ============================================================ */
  function renderWRSummaryTable(container, cats) {
    var nowSec = Date.now() / 1000;
    // Build rows in the SAME ORDER as the input `cats` array — which is the
    // data-file order. The default sort key 'order' preserves this.
    var rows = cats.map(function (cat, idx) {
      var s = U.getCategoryStats(cat, state.platform);
      var wr = s.currentWR;
      if (!wr) return null;
      var days = wr.dateSortKey ? Math.max(0, Math.round((nowSec - wr.dateSortKey) / 86400)) : null;
      return {
        cat: cat, wr: wr, days: days,
        order: idx,                                  // for default sort
        catName: cat.name,
        holder: wr.player,
        time: wr.time,
        moves: wr.movecount,
        tps: wr.tps != null ? wr.tps : -Infinity,
        control: wr.control || '',
        style: wr.style || '',
        hasReplay: wr.hasReplay ? 1 : 0,
        hasVideo: wr.hasVideo ? 1 : 0,
        hasNotes: (wr.notes || U.solveDataAsNote(wr.solveData)) ? 1 : 0,
      };
    }).filter(Boolean);

    // Compute max days for the gradient scale.
    var maxDays = 0;
    rows.forEach(function (r) { if (r.days != null && r.days > maxDays) maxDays = r.days; });

    // Sort state — default is 'order' (preserves data-file category order).
    var sortState = { key: 'order', dir: 'asc' };

    // EventType sort order: single < ao5 < ao12 < ao50 < ao100 < x10 < x42 < multi.
    // Ensures averages within a size sort in their natural order, NOT
    // alphabetically (which gave "ao100 before ao50").
    var EVENT_ORDER = { single: 0, ao5: 1, ao12: 2, ao50: 3, ao100: 4, x10: 5, x42: 6, multi: 7, relay: 8 };

    function sortVal(row, key) {
      // For category column, sort by [size, eventType-order, name] so 3x3
      // stays grouped AND averages appear in order: single, ao5, ao12, ao50, ao100.
      if (key === 'catName') {
        var sz = row.cat.size || 999;
        var et = row.cat.eventType || '';
        var etOrder = EVENT_ORDER[et] != null ? EVENT_ORDER[et] : 99;
        return [parseInt(sz, 10) || 999, etOrder, row.catName];
      }
      return row[key];
    }

    function cmp(a, b, key) {
      var va = sortVal(a, key), vb = sortVal(b, key);
      if (Array.isArray(va)) {
        for (var i = 0; i < va.length; i++) {
          if (va[i] !== vb[i]) return va[i] < vb[i] ? -1 : 1;
        }
        return 0;
      }
      if (typeof va === 'string') return va.localeCompare(vb);
      return va - vb;
    }

    function render() {
      var sorted = rows.slice().sort(function (a, b) {
        var c = cmp(a, b, sortState.key);
        return sortState.dir === 'asc' ? c : -c;
      });

      function sortIcon(key) {
        if (sortState.key !== key) return '';
        return sortState.dir === 'asc' ? ' ▲' : ' ▼';
      }

      var html = '<div class="table-scroll"><table class="wr-table sortable-table"><thead><tr>' +
        '<th class="sortable-th" data-sort="catName">Category' + sortIcon('catName') + '</th>' +
        '<th class="sortable-th" data-sort="holder">Holder' + sortIcon('holder') + '</th>' +
        '<th class="num sortable-th" data-sort="time">Time' + sortIcon('time') + '</th>' +
        '<th class="num sortable-th" data-sort="moves">Moves' + sortIcon('moves') + '</th>' +
        '<th class="num sortable-th" data-sort="tps">TPS' + sortIcon('tps') + '</th>' +
        '<th class="sortable-th" data-sort="control">Control' + sortIcon('control') + '</th>' +
        '<th class="sortable-th" data-sort="style">Style' + sortIcon('style') + '</th>' +
        '<th class="num sortable-th" data-sort="hasReplay" title="Has replay link">' + replayHeaderCell() + sortIcon('hasReplay') + '</th>' +
        '<th class="num sortable-th" data-sort="hasVideo" title="Has video link">Video' + sortIcon('hasVideo') + '</th>' +
        '<th class="num sortable-th" data-sort="hasNotes" title="Has notes / solve data">Notes' + sortIcon('hasNotes') + '</th>' +
        '<th class="num sortable-th" data-sort="days" title="Days since record set (recent first = smallest)">Days Held' + sortIcon('days') + '</th>' +
        '</tr></thead><tbody>';
      sorted.forEach(function (r) {
        var wr = r.wr;
        var holderColor = U.playerColor(wr.player);
        var ratio = maxDays > 0 && r.days != null ? Math.min(1, r.days / maxDays) : 0;
        var hue = Math.round(ratio * 120);
        var dsColor = 'hsl(' + hue + ', 80%, 55%)';
        var dsBg = 'hsla(' + hue + ', 80%, 45%, 0.15)';
        var dsBorder = 'hsla(' + hue + ', 80%, 45%, 0.5)';
        var daysText = r.days != null ? r.days + 'd' : '—';
        // Actual data for Replay/Video/Notes — same helpers as other tables.
        // User: "should be actual data, like in all other tables, not just
        // 'it exists' mark".
        var replayHtml = replayCell(wr);
        var videoHtml = videoCell(wr);
        var notesHtml = notesCell(wr);
        html += '<tr data-cat="' + r.cat.id + '" style="cursor:pointer">' +
          '<td class="player">' + esc(r.cat.name) + '</td>' +
          '<td class="player"><a data-player="' + esc(wr.player) + '" style="color:' + holderColor + '">' + esc(wr.player) + '</a></td>' +
          '<td class="num time text-cyan">' + U.fmtTime(wr.time) + '</td>' +
          '<td class="num">' + U.fmtMovecount(wr.movecount, U.isSingle(r.cat)) + '</td>' +
          '<td class="num text-dim">' + (wr.tps != null ? U.fmtTps(wr.tps) : '—') + '</td>' +
          '<td>' + controlCell(wr.control) + '</td>' +
          '<td>' + styleCell(wr.style) + '</td>' +
          '<td class="num">' + replayHtml + '</td>' +
          '<td class="num">' + videoHtml + '</td>' +
          '<td class="num">' + notesHtml + '</td>' +
          '<td class="num"><span class="days-since" style="--ds-color:' + dsColor + ';--ds-bg:' + dsBg + ';--ds-border:' + dsBorder + '">' + daysText + '</span></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;

      container.querySelectorAll('tr[data-cat]').forEach(function (tr) {
        tr.addEventListener('click', function (e) {
          // Don't navigate if user clicked a link inside the row.
          if (e.target.closest('a')) return;
          U.setHash('category', { id: tr.getAttribute('data-cat') });
        });
      });
      // Player name links inside the summary table.
      container.querySelectorAll('a[data-player]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          U.setHash('player', { name: a.getAttribute('data-player') });
        });
      });
      // Clickable notes.
      container.querySelectorAll('.clickable-note').forEach(function (note) {
        note.addEventListener('click', function (e) {
          e.stopPropagation();
          showNoteModal(note.getAttribute('data-full'));
        });
      });
      container.querySelectorAll('.sortable-th').forEach(function (th) {
        th.addEventListener('click', function () {
          var key = th.getAttribute('data-sort');
          if (sortState.key === key) {
            sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
          } else {
            sortState.key = key;
            // Default direction: ascending for text, descending for numeric
            // (so "most" sorts to top — except days which ascends = recent first).
            sortState.dir = (key === 'catName' || key === 'holder' || key === 'control' || key === 'style' || key === 'days') ? 'asc' : 'desc';
          }
          render();
        });
      });
      // wire download replay links + help buttons
      wireDownloadLinks(container);
      wireHelpLinks(container);
    }

    render();
  }

  /* Export all current WRs as a CSV summary. */
  function exportSummaryCsv(cats) {
    var nowSec = Date.now() / 1000;
    var rows = [['Category', 'Size', 'Holder', 'Time (s)', 'Time (display)', 'Movecount', 'TPS', 'Control', 'Style', 'Replay', 'Video', 'Notes', 'Days Held', 'Date']];
    cats.forEach(function (cat) {
      var s = U.getCategoryStats(cat, state.platform);
      var wr = s.currentWR;
      if (!wr) return;
      var days = wr.dateSortKey ? Math.max(0, Math.round((nowSec - wr.dateSortKey) / 86400)) : '';
      var notesCombined = [];
      if (wr.notes) notesCombined.push(wr.notes);
      var solveNote = U.solveDataAsNote(wr.solveData);
      if (solveNote) notesCombined.push('Solve data: ' + solveNote);
      rows.push([
        cat.name, cat.size || '', wr.player, wr.time, U.fmtTime(wr.time),
        wr.movecount, wr.tps != null ? wr.tps : '',
        wr.control || '', wr.style || '',
        wr.replayUrl || '', wr.videoUrl || '',
        notesCombined.join('\n'), days, wr.dateIso || '',
      ]);
    });
    U.downloadCsv('current_wrs_summary.csv', rows);
  }

  /* Export the ENTIRE WR dataset as JSON — every record from every category,
   * with all notes, solve data, scrambles, solutions, replays, and videos.
   * User: "should not be in csv format, it is broken, this tool uses xlsx,
   * or json, idk, something more complex, just give user full raw data, don't
   * convert into csv or something".
   * JSON preserves the full nested structure (arrays, multiline notes, etc.)
   * without the escaping/encoding issues that plague CSV.
   */
  function exportAllWrDataJson(cats) {
    var data = U.getData();
    // Build a clean export object: meta + all categories with all records.
    // Strip internal annotation fields (_victim, _sniper, _firstEver, _catId,
    // _catName, dateSortKeyEst) that were added at runtime.
    var exportObj = {
      meta: data.meta,
      exportedAt: new Date().toISOString(),
      categories: cats.map(function (cat) {
        var recs = U.filterRecords(cat, state.platform);
        return {
          id: cat.id,
          name: cat.name,
          size: cat.size,
          eventType: cat.eventType,
          eventGroup: cat.eventGroup,
          platform: cat.platform,
          records: recs.map(function (r) {
            var clean = {};
            // Copy all original fields, excluding runtime annotations.
            for (var k in r) {
              if (!r.hasOwnProperty(k)) continue;
              if (k === '_victim' || k === '_sniper' || k === '_firstEver' ||
                  k === '_catId' || k === '_catName' || k === 'dateSortKeyEst') continue;
              clean[k] = r[k];
            }
            return clean;
          }),
        };
      }),
    };
    U.downloadJson('all_wr_data.json', exportObj);
  }

  function renderCatGroups(container, sizeGroups, sizeKeys) {
    container.innerHTML = '';
    sizeKeys.forEach(function (size) {
      var groupCats = sizeGroups[size] || [];
      if (!groupCats.length) return;
      var section = document.createElement('div');
      section.className = 'cat-group-section mb-16';
      // For the merged 'big' group, use a styled "Big Puzzles" label.
      var labelText, subText;
      if (size === 'big') {
        labelText = 'Big Puzzles';
        subText = '(' + groupCats.length + ' ' + (groupCats.length === 1 ? 'category' : 'categories') + ' · 11×11 and above)';
        section.classList.add('cat-group-big');
      } else {
        labelText = size + '×' + size;
        subText = '(' + groupCats.length + ' ' + (groupCats.length === 1 ? 'category' : 'categories') + ')';
      }
      section.innerHTML = '<div class="section-label">' + labelText + ' <span class="text-dim" style="font-weight:400;text-transform:none;letter-spacing:0">' + subText + '</span></div>';
      var grid = document.createElement('div');
      grid.className = 'cat-grid';
      section.appendChild(grid);
      container.appendChild(section);

      groupCats.forEach(function (cat) {
        var card = document.createElement('div');
        card.className = 'cat-card';
        var s = U.getCategoryStats(cat, state.platform);
        var holder = s.currentWR ? s.currentWR.player : '—';
        var holderColor = s.currentWR ? U.playerColor(s.currentWR.player) : '#888';
        var bestTime = s.currentWR ? U.fmtTime(s.currentWR.time) : '—';

        card.innerHTML = `
          <div class="cat-card-head">
            <div>
              <div class="cat-card-name">${esc(cat.name)}</div>
              <div class="cat-card-stats">
                <span><b>${s.recordCount}</b> records</span>
                <span><b>${s.holderCount}</b> players</span>
                <span><b>${s.snipes.length}</b> snipes</span>
              </div>
            </div>
            <span class="cat-card-group">${esc(U.eventGroupLabel(cat.eventGroup))}</span>
          </div>
          <div class="cat-card-holder">Current WR: <b style="color:${holderColor}">${esc(holder)}</b> · <span class="text-cyan">${bestTime}</span></div>
          <div class="cat-mini-chart"></div>
        `;
        card.addEventListener('click', function () {
          U.setHash('category', { id: cat.id });
        });
        grid.appendChild(card);

        var miniEl = card.querySelector('.cat-mini-chart');
        WR.sparkline(miniEl, U.filterRecords(cat, state.platform), { color: holderColor });
      });
    });
  }

  /* ============================================================
   * CATEGORY DETAIL
   * ============================================================ */
  function renderCategory(params) {
    var c = container();
    var cat = U.getCategory(params.id);
    if (!cat) { c.innerHTML = '<div class="empty-state">Category not found</div>'; return; }

    var s = U.getCategoryStats(cat, state.platform);
    var recs = U.filterRecords(cat, state.platform);
    var isSingle = U.isSingle(cat);
    var holder = s.currentWR ? s.currentWR.player : '—';
    var holderColor = s.currentWR ? U.playerColor(s.currentWR.player) : '#888';
    var wr = s.currentWR;

    c.innerHTML = `
      <h1 class="page-title">${esc(cat.name)} <span class="accent">History</span></h1>
      <p class="page-subtitle">${s.recordCount} records · ${s.holderCount} players · ${s.snipes.length} snipes</p>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Current WR</div>
          <div class="stat-value text-cyan">${s.currentWR ? U.fmtTime(s.currentWR.time) : '—'}</div>
          <div class="stat-sub" style="color:${holderColor}">${esc(holder)}</div>
        </div>
        <div class="stat-card pink">
          <div class="stat-label">First Documented Record</div>
          <div class="stat-value">${s.firstRecord ? U.fmtTime(s.firstRecord.time) : '—'}</div>
          <div class="stat-sub">${s.firstRecord ? esc(s.firstRecord.player) : '—'} · ${s.firstRecord ? U.fmtDate(s.firstRecord) : ''}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Replays</div>
          <div class="stat-value">${recs.filter(function(r){return r.hasReplay}).length}</div>
          <div class="stat-sub">of ${recs.length} records</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-label">Videos</div>
          <div class="stat-value">${recs.filter(function(r){return r.hasVideo}).length}</div>
          <div class="stat-sub">with video evidence</div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Current <span class="neon">Record</span></div>
          <div class="card-actions">${wr ? videoBadge(wr.videoUrl) : ''}</div>
        </div>
        <div id="cat-current-record"></div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">WR <span class="neon">Progression</span></div>
          <div class="card-actions"><span class="badge badge-cyan">time over date · zoom</span></div>
        </div>
        <div id="cat-progression-chart"></div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Who Held the <span class="neon">Record</span></div>
          <div class="card-actions"><span class="badge badge-cyan">click player names</span></div>
        </div>
        <div id="cat-reign-timeline"></div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Full <span class="neon">Record</span> Table</div>
          <div class="card-actions">
            <span class="badge" style="color:var(--delta-up);border-color:rgba(0,255,170,0.4);background:rgba(0,255,170,0.08)">✓ accurate replay</span>
            <span class="badge" style="color:var(--c-keyboard);border-color:rgba(251,191,36,0.4);background:rgba(251,191,36,0.08)">inaccurate replay</span>
            <span class="badge" style="color:var(--s-lbl);border-color:rgba(205,133,63,0.45);background:rgba(205,133,63,0.08)">Data link</span>
            <span class="badge" style="color:var(--s-grids);border-color:rgba(154,205,50,0.45);background:rgba(154,205,50,0.08)">Info link</span>
          </div>
        </div>
        <div id="cat-records-table"></div>
      </div>
    `;

    // Current Record card — always present (video if available, replay link, notes).
    renderCurrentRecordCard(document.getElementById('cat-current-record'), cat, wr);

    // progression chart
    WR.lineChart(document.getElementById('cat-progression-chart'), recs, {
      onDotClick: function (r) { showRecordModal(r, cat); },
      onLegendClick: function (name) { U.setHash('player', { name: name }); },
    });

    // reign timeline — player names clickable
    WR.reignTimeline(document.getElementById('cat-reign-timeline'), s.reigns, {
      onReignClick: function (rg) { showRecordModal(rg.record, cat); },
      onPlayerClick: function (name) { U.setHash('player', { name: name }); },
    });

    // records table
    renderRecordTable(document.getElementById('cat-records-table'), cat, recs);
  }

  /* Current Record card — always shown.
   * Restructured into a clear vertical stack of info lines:
   *   line 1: holder · date · days ago
   *   line 2: time · moves · tps
   *   line 3: control · style · notes
   *   line 4: replay buttons (open ▶ / download ⬇ / help ?) + Open video on YouTube
   * When a video exists it is shown on the LEFT (true 16:9); the info stack
   * is on the right. User: "Current Record needs some restructuring: first
   * line: holder, date, days ago; second line: time, moves tps; third line:
   * controls style notes; next lines: replays / Open video on youtube".
   * Also: "Current Record - Replay link here is missing download / question
   * mark options" → prominent replay block now includes download + help.
   */
  function renderCurrentRecordCard(container, cat, wr) {
    if (!wr) {
      container.innerHTML = '<div class="empty-state">No current record</div>';
      return;
    }
    var color = U.playerColor(wr.player);
    var solveNote = U.solveDataAsNote(wr.solveData);
    var notesCombined = [];
    if (wr.notes && wr.notes.trim()) notesCombined.push(wr.notes);
    if (solveNote) notesCombined.push('Solve data: ' + solveNote);
    var nowSec = Date.now() / 1000;
    var daysAgo = wr.dateSortKey ? Math.max(0, Math.round((nowSec - wr.dateSortKey) / 86400)) : null;

    var html = '<div class="current-record-card' + (wr.videoUrl ? ' has-video' : '') + '">';
    // Left: video block — ONLY if a video exists (true 16:9 via CSS).
    if (wr.videoUrl) {
      html += '<div class="cr-video cr-video-large">';
      html += '<div id="cr-video-mount"></div>';
      html += '</div>';
    }
    // Right: info stack
    html += '<div class="cr-info">';

    // ---- Line 1: holder · date · days ago ----
    html += '<div class="cr-line cr-line-1">';
    html += '<span class="cr-holder" style="color:' + color + '">' + esc(wr.player) + '</span>';
    html += '<span class="cr-sep">·</span>';
    html += '<span class="cr-date">' + U.fmtDate(wr) + '</span>';
    if (daysAgo != null) {
      html += '<span class="cr-days-badge" title="Days since this record was set">' + daysAgo + 'd ago</span>';
    }
    html += '</div>';

    // ---- Line 2: time · moves · tps ----
    html += '<div class="cr-line cr-line-2">';
    html += '<span class="cr-field"><span class="cr-field-label">Time</span> <span class="cr-field-val text-cyan">' + U.fmtTime(wr.time) + '</span></span>';
    html += '<span class="cr-field"><span class="cr-field-label">Moves</span> <span class="cr-field-val">' + U.fmtMovecount(wr.movecount, U.isSingle(cat)) + '</span></span>';
    if (wr.tps != null) html += '<span class="cr-field"><span class="cr-field-label">TPS</span> <span class="cr-field-val">' + U.fmtTps(wr.tps) + '</span></span>';
    html += '</div>';

    // ---- Line 3: control · style · notes ----
    html += '<div class="cr-line cr-line-3">';
    if (wr.control) html += '<span class="cr-field">' + controlCell(wr.control) + '</span>';
    if (wr.style) html += '<span class="cr-field">' + styleCell(wr.style) + '</span>';
    if (notesCombined.length) {
      var notesFull = notesCombined.join('\n\n');
      // Show a preview of the actual notes (truncated, click-to-expand) — same
      // pattern as notesCell() in tables. User: "📝 Notes - can include preview
      // of notes just like in tables instead of 'notes'".
      var notesPrev = notesFull.length > 40
        ? esc(notesFull.slice(0, 40)) + '…'
        : esc(notesFull);
      html += '<span class="cr-field"><span class="cr-notes-pill clickable-note" data-full="' + esc(notesFull).replace(/"/g, '&quot;') + '" title="Click to expand notes">📝 ' + notesPrev + '</span></span>';
    }
    html += '</div>';

    // ---- Line 4+: replay buttons + Open video on YouTube ----
    if (wr.replayUrl) {
      var linkType = U.replayLinkType(wr.replayUrl);
      var rcls = linkType === 'data' ? 'replay-data' : linkType === 'info' ? 'replay-info' :
                (wr.replayAccurate === true ? 'replay-accurate' : wr.replayAccurate === false ? 'replay-inaccurate' : 'replay-unknown');
      var rlbl = linkType === 'data' ? '⬇ Data link' : linkType === 'info' ? '⬇ Info link' :
                (wr.replayAccurate === true ? '▶ Watch accurate replay' : wr.replayAccurate === false ? '▶ Watch replay (inaccurate)' : '▶ Watch replay');
      html += '<div class="cr-replay-row">';
      html += '<a href="' + esc(wr.replayUrl) + '" target="_blank" rel="noopener" class="cr-replay-btn ' + rcls + '">' + rlbl + '</a>';
      // Download button — same prominence as the open button.
      // User explicitly approved this layout: "▶ Watch accurate replay
      // ⬇ Download ? - this is good, keep question mark here as is".
      // Only show the download button for actual replay links (not Data/Info).
      // User: "Download button for replay should not be for 'Data' and 'info'
      // links, only for replay links obviously".
      if (linkType !== 'data' && linkType !== 'info') {
        html += '<a href="#" class="cr-replay-btn cr-dl-btn rec-link-download" data-download-url="' + esc(wr.replayUrl) + '" title="Download replay link as .txt">' + DOWNLOAD_ICON_SVG + ' Download</a>';
      }
      // Help button — opens the SlidySim Replay Fix modal. Kept here per user.
      html += '<button type="button" class="cr-replay-btn cr-help-btn replay-help-icon" data-replay-help>?</button>';
      html += '</div>';
    }
    if (wr.videoUrl) {
      html += '<a href="' + esc(wr.videoUrl) + '" target="_blank" rel="noopener" class="cr-video-btn">▶ Open video on YouTube</a>';
    }

    html += '</div></div>';
    container.innerHTML = html;

    if (wr.videoUrl) {
      var mount = document.getElementById('cr-video-mount');
      if (mount) WR.embedVideo(mount, wr);
    }
    // wire clickable notes
    container.querySelectorAll('.clickable-note').forEach(function (note) {
      note.addEventListener('click', function (e) {
        e.stopPropagation();
        showNoteModal(note.getAttribute('data-full'));
      });
    });
    // wire download + help buttons in this card
    wireDownloadLinks(container);
    wireHelpLinks(container);
  }

  function exportCategoryCsv(cat, recs) {
    var isSingle = U.isSingle(cat);
    var hasScramble = recs.some(function (r) { return r.scramble; });
    var hasSolution = recs.some(function (r) { return r.solution; });
    var rows = [];
    // CSV column order matches the visible table (delta AFTER TPS, before Control).
    // "Time (min)" removed — it was a duplicate of Time (user request).
    var header = ['#', 'Date', 'Player', 'Time (s)', 'Movecount', 'TPS', 'Δ vs prev (s)', 'Δ vs prev (%)', 'Control', 'Style', 'Replay URL', 'Replay Accurate', 'Video URL', 'Notes'];
    if (hasScramble) header.push('Scramble');
    if (hasSolution) header.push('Solution');
    rows.push(header);
    // newest first
    var sorted = recs.slice().reverse();
    var prevMap = {};
    recs.forEach(function (r, i) { prevMap[i] = i > 0 ? recs[i - 1] : null; });
    var sortedIdx = sorted.map(function (r) { return recs.indexOf(r); });
    sorted.forEach(function (r, i) {
      var prevRec = prevMap[sortedIdx[i]];
      var delta = prevRec ? (r.time - prevRec.time) : '';
      var deltaPct = prevRec && prevRec.time ? (((prevRec.time - r.time) / prevRec.time) * 100).toFixed(2) + '%' : '';
      var row = [
        i + 1,
        r.dateDisplay || r.dateIso || '',
        r.player,
        r.time,
        r.movecount,
        r.tps != null ? r.tps : '',
        delta === '' ? '' : delta.toFixed(4),
        deltaPct,
        r.control || '',
        r.style || '',
        r.replayUrl || '',
        r.replayAccurate === true ? 'accurate' : r.replayAccurate === false ? 'inaccurate' : '',
        r.videoUrl || '',
        r.notes || '',
      ];
      if (hasScramble) row.push(r.scramble || '');
      if (hasSolution) row.push(r.solution || '');
      rows.push(row);
    });
    var fname = cat.id.replace(/[^a-z0-9-]/gi, '_') + '_records.csv';
    U.downloadCsv(fname, rows);
  }

  function renderRecordTable(container, cat, recs) {
    var isSingle = U.isSingle(cat);
    var hasScramble = recs.some(function (r) { return r.scramble; });
    var hasSolution = recs.some(function (r) { return r.solution; });

    // sorted oldest -> newest is `recs` (sheet order). For the table we show newest first.
    // For Δ we need previous record (older) — that's recs[i-1] in sheet order.
    // Build a map: rec -> prevRec.
    var prevMap = {};
    recs.forEach(function (r, i) {
      prevMap[i] = i > 0 ? recs[i - 1] : null;
    });
    // sorted = newest first
    var sorted = recs.slice().reverse();
    var sortedIdx = sorted.map(function (r) { return recs.indexOf(r); });

    // Column order: #, Date, Player, Time, Movecount, TPS, Δ, Control, Style, Replay, Video, Notes
    // (delta moved AFTER TPS, before Control — user request.
    //  "Time (min)" removed — duplicate of Time — user request.)
    var html = '<div class="table-scroll"><table class="wr-table"><thead><tr>' +
      '<th class="rank">#</th><th>Date</th><th>Player</th><th class="num">Time</th>' +
      '<th class="num">Movecount</th><th class="num">TPS</th><th class="num">Δ vs prev</th>' +
      '<th>Control</th><th>Style</th>' +
      '<th>' + replayHeaderCell() + '</th><th>Video</th><th>Notes</th>';
    html += '</tr></thead><tbody>';

    sorted.forEach(function (r, i) {
      var color = U.playerColor(r.player);
      var replayHtml = replayCell(r);
      var videoHtml = videoCell(r);
      var notesHtml = notesCell(r);
      var prevRec = prevMap[sortedIdx[i]];
      var delta = U.fmtDelta(r.time, prevRec ? prevRec.time : null);
      var deltaPct = U.fmtDeltaPct(r.time, prevRec ? prevRec.time : null);
      var deltaTitle = prevRec ? 'Previous: ' + U.fmtTime(prevRec.time) + ' by ' + prevRec.player + ' (' + U.fmtDate(prevRec) + ')' : 'First-ever record';
      // # column: oldest = 1, newest = N (total records). The table is sorted
      // newest-first, so the first row is #N (most recent), last row is #1.
      // User: "the most recent record is '1', the oldest is '25' for example"
      // — should be reversed: oldest = 1, newest = highest number.
      var chronologicalNum = sorted.length - i;
      html += '<tr>' +
        '<td class="rank">' + chronologicalNum + '</td>' +
        '<td class="date">' + U.fmtDate(r) + '</td>' +
        '<td class="player"><a data-player="' + esc(r.player) + '" style="color:' + color + '">' + esc(r.player) + '</a></td>' +
        '<td class="num time">' + U.fmtTime(r.time) + '</td>' +
        '<td class="num">' + U.fmtMovecount(r.movecount, isSingle) + '</td>' +
        '<td class="num text-dim">' + (r.tps != null ? U.fmtTps(r.tps) : '—') + '</td>' +
        '<td class="num delta-' + delta.cls + '" title="' + esc(deltaTitle) + '">' + delta.text +
          (delta.cls === 'improve' ? ' <span class="delta-pct">(' + deltaPct + ')</span>' : '') +
        '</td>' +
        '<td>' + controlCell(r.control) + '</td>' +
        '<td>' + styleCell(r.style) + '</td>' +
        '<td>' + replayHtml + '</td>' +
        '<td>' + videoHtml + '</td>' +
        '<td>' + notesHtml + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;

    // wire player links
    container.querySelectorAll('a[data-player]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        U.setHash('player', { name: a.getAttribute('data-player') });
      });
    });
    // wire clickable notes (expand in modal)
    container.querySelectorAll('.clickable-note').forEach(function (note) {
      note.addEventListener('click', function (e) {
        e.stopPropagation();
        showNoteModal(note.getAttribute('data-full'));
      });
    });
    // wire download replay links + help buttons
    wireDownloadLinks(container);
    wireHelpLinks(container);
  }

  function showNoteModal(fullText) {
    var overlay = document.getElementById('modal-overlay');
    var title = document.getElementById('modal-title');
    var body = document.getElementById('modal-body');
    title.textContent = 'Note';
    body.innerHTML = '<pre class="note-full-text">' + esc(fullText) + '</pre>';
    overlay.hidden = false;
  }

  /* Replay-help modal — replaces the old title-tooltip link with a proper
   * pop-up (same modal used for notes). User: "Question mark does not show a
   * proper pop-up (like notes), just a basic link with important info provided
   * as title property, fix this". */
  function showReplayHelpModal() {
    var overlay = document.getElementById('modal-overlay');
    var title = document.getElementById('modal-title');
    var body = document.getElementById('modal-body');
    title.innerHTML = 'Replay Links <span class="neon">&amp;</span> SlidySim Replay Fix';
    var html = '<div class="replay-help-body">';
    html += '<p>Replay links open the solve replay directly in your browser. Some replays are very long, and older links may point to hosts that no longer work (e.g. <code>slidysim.online</code>).</p>';
    html += '<p>To fix these issues, install the <b style="color:var(--cyan-bright)">SlidySim Replay Fix</b> Chrome extension:</p>';
    html += '<ul>';
    html += '<li>Restores broken / outdated replay hosts.</li>';
    html += '<li>Handles long replay links that fail to open normally.</li>';
    html += '<li>Works on <code>slidysim.github.io</code> and related replay pages.</li>';
    html += '</ul>';
    html += '<a href="https://github.com/dphdmn/dphbot/releases/tag/1.0.0" target="_blank" rel="noopener" class="rec-link replay-accurate" style="font-size:13px;padding:6px 12px">⬇ Install SlidySim Replay Fix ↗</a>';
    html += '<p class="replay-help-note">Use the <b>⬇</b> button next to any replay to download the raw replay data instead of opening it.</p>';
    html += '</div>';
    body.innerHTML = html;
    overlay.hidden = false;
  }

  /* Wire up the replay-help "?" buttons. Clicking opens the help modal. */
  function wireHelpLinks(scope) {
    var root = scope || document;
    root.querySelectorAll('[data-replay-help]').forEach(function (btn) {
      if (btn._helpWired) return;
      btn._helpWired = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showReplayHelpModal();
      });
    });
  }

  /* Wire up "download replay" links.
   *
   * IMPORTANT FIX (user: "Download replay buttons are broken, they give the
   * index.html code of the page from the url, you probably overcomplicated
   * that feature. replay IS the link itself (self-contained), replay can be
   * imported on the leaderboard website from file, which content is valid
   * 'replay link'").
   *
   * The previous implementation fetched the URL as a blob — which for many
   * replay hosts returned the HTML wrapper page (not the replay data). The
   * replay link IS the data: it's a self-contained URL that the leaderboard
   * site can import from a text file. So we simply save the URL string
   * itself as a .txt file. No network fetch needed — fast, offline, and
   * always correct.
   */
  function wireDownloadLinks(scope) {
    var root = scope || document;
    root.querySelectorAll('.rec-link-download').forEach(function (dl) {
      if (dl._wired) return;
      dl._wired = true;
      dl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var url = dl.getAttribute('data-download-url');
        if (!url) return;
        // The replay link itself IS the file content. Save it as a .txt
        // file so users can import it on the leaderboard site.
        var fname = 'replay.txt';
        // Try to derive a more meaningful name from the URL, but always
        // end with .txt so the leaderboard import recognizes it.
        var tail = url.split('/').pop().split('?')[0];
        if (tail) {
          // strip any existing extension, then add .txt
          tail = tail.replace(/\.[^.]+$/, '');
          if (tail) fname = tail + '.txt';
        }
        var blob = new Blob([url], { type: 'text/plain' });
        var blobUrl = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = blobUrl;
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 1000);
      });
    });
  }

  /* SVG icon used for the "download replay" button. Replaces the old "⬇"
   * unicode character which the user called "weird". A real down-arrow-to-tray
   * icon is universally recognized as "download".
   * User: "change 'download' character to something more recognizable, current
   * emoji looks weird".
   */
  var DOWNLOAD_ICON_SVG = '<svg class="dl-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
    '<path d="M8 1.5v8.4M8 9.9L4.8 6.7M8 9.9l3.2-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M2.5 11v2.2a1.3 1.3 0 0 0 1.3 1.3h8.4a1.3 1.3 0 0 0 1.3-1.3V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';

  function replayCell(r) {
    if (!r.hasReplay || !r.replayUrl) return '<span class="text-dim">—</span>';
    var linkType = U.replayLinkType(r.replayUrl);
    // For actual replays (slidysim.github.io / raw.githubusercontent.com):
    //   accurate (green) → "✓ replay"
    //   inaccurate → yellow, NO "x" char (user: looks like no replay at all)
    //   unknown → neutral "replay"
    // For data/info links (pastebin etc): label "Data" or "Info"
    //
    // IMPORTANT (user requests):
    //   - "Move question mark next to 'Replay' header of the tables, not next
    //      to each and every replay link". → help icon is now ONLY in the
    //      table header (see replayHeaderCell()). Per-cell help removed.
    //   - "Download button for replay should not be for 'Data' and 'info'
    //      links, only for replay links obviously". → data/info links no
    //      longer get a download button.
    if (linkType === 'data') {
      return '<a href="' + esc(r.replayUrl) + '" target="_blank" rel="noopener" class="rec-link replay-data" title="External data link">Data</a>';
    }
    if (linkType === 'info') {
      return '<a href="' + esc(r.replayUrl) + '" target="_blank" rel="noopener" class="rec-link replay-info" title="External info link">Info</a>';
    }
    // actual replay — open ▶ + download ⤓ (SVG). No per-cell "?" (in header).
    var cls = r.replayAccurate === true ? 'replay-accurate' :
              r.replayAccurate === false ? 'replay-inaccurate' : 'replay-unknown';
    var label = r.replayAccurate === true ? '✓ replay' :
                r.replayAccurate === false ? 'replay' : 'replay';
    var dlAttr = 'data-download-url="' + esc(r.replayUrl) + '"';
    return '<a href="' + esc(r.replayUrl) + '" target="_blank" rel="noopener" class="rec-link ' + cls + '" title="Open replay">▶</a>' +
           '<a href="#" class="rec-link-download" ' + dlAttr + ' title="Download replay link as .txt">' + DOWNLOAD_ICON_SVG + '</a>';
  }

  /* Build a "Replay" header cell with the help "?" button next to the label.
   * User: "Move question mark next to 'Replay' header of the tables, not next
   * to each and every replay link, so question mark only in header".
   * `label` defaults to "Replay".
   */
  function replayHeaderCell(label) {
    var txt = label || 'Replay';
    return '<span class="th-replay-wrap">' +
      '<span class="th-replay-label">' + esc(txt) + '</span>' +
      '<button type="button" class="replay-help-icon th-replay-help" data-replay-help aria-label="About replay links and the SlidySim Replay Fix extension">?</button>' +
      '</span>';
  }

  function videoCell(r) {
    if (!r.hasVideo || !r.videoUrl) return '<span class="text-dim">—</span>';
    return '<a href="' + esc(r.videoUrl) + '" target="_blank" rel="noopener" class="rec-link video-link" title="Open video">▶ video</a>';
  }

  function notesCell(r) {
    // Combine actual notes + solveData-as-note (if solveData is times, not URL)
    var parts = [];
    if (r.notes && r.notes.trim()) parts.push(r.notes);
    var solveNote = U.solveDataAsNote(r.solveData);
    if (solveNote) parts.push('Solve data: ' + solveNote);
    if (!parts.length) return '';
    var fullText = parts.join('\n\n');
    // Truncated preview; click reveals full content in modal.
    var truncated = fullText.length > 30 ? esc(fullText.slice(0, 30)) + '…' : esc(fullText);
    return '<span class="note-bubble clickable-note" data-full="' + esc(fullText).replace(/"/g, '&quot;') + '" title="Click to expand">' + truncated + '</span>';
  }

  function videoBadge(url) {
    if (!url) return '';
    var ytId = U.youtubeId(url);
    if (ytId) return '<span class="badge badge-pink">YouTube</span>';
    return '<span class="badge badge-gray">video</span>';
  }

  /* Color-coded control cell — Tablet/Mouse/Keyboard (only 3 types). */
  function controlCell(c) {
    if (!c || c === '...') return '<span class="text-dim">—</span>';
    var cls = U.controlClass(c);
    return '<span class="tag-control ctrl-' + cls + '" title="' + esc(c) + '">' + esc(c) + '</span>';
  }

  /* Color-coded style cell — Fringe/LBL/Grids (only 3 types).
   * For Grids, the hue varies slightly by dimension (5x10 vs 10x5 etc)
   * so different grid layouts are visually distinguishable. */
  function styleCell(s) {
    if (!s || s === '...') return '<span class="text-dim">—</span>';
    var cls = U.styleClass(s);
    if (cls === 'grids') {
      // Compute a hue offset based on the primary dimension.
      var dim = U.gridsDimension(s);
      var off = U.gridsHueOffset(dim);
      var hue = 75 + off; // base olive = 75°
      return '<span class="tag-style style-grids" title="' + esc(s) + '" style="--grids-hue:' + hue + '">' + esc(s) + '</span>';
    }
    return '<span class="tag-style style-' + cls + '" title="' + esc(s) + '">' + esc(s) + '</span>';
  }

  /* ============================================================
   * COMPARE
   * Two modes: Compare Categories (WR time progression) and
   * Compare Players (active records held over time + head-to-head stats).
   * ============================================================ */
  function renderCompare(params) {
    var c = container();
    var cats = U.filterCats(state.platform);

    // Use ID-based selection (not object reference) to avoid equality bugs.
    var selectedIds = params.cats ? params.cats.split(',').filter(Boolean) : [];
    selectedIds = selectedIds.filter(function (id) { return U.getCategory(id); });
    var isEmpty = selectedIds.length === 0;

    // Player selection for "Compare Players" mode.
    var stats = U.getGlobalStats(state.platform);
    var allPlayerNames = Object.keys(stats.players).sort(function (a, b) { return stats.players[b] - stats.players[a]; });
    var selectedPlayers = params.players ? params.players.split(',').filter(Boolean) : [];
    selectedPlayers = selectedPlayers.filter(function (p) { return allPlayerNames.indexOf(p) >= 0; });

    // Mode: 'cats' (default) or 'players'
    var mode = params.mode === 'players' ? 'players' : 'cats';

    c.innerHTML = `
      <h1 class="page-title"><span class="accent">Compare</span></h1>
      <p class="page-subtitle">Categories: WR time progression · Players: active records over time + head-to-head stats</p>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title" id="compare-selector-title">Select <span class="neon">Categories</span></div>
          <div class="card-actions">
            <div class="mode-toggle" id="compare-mode-toggle">
              <button class="mt-btn${mode === 'cats' ? ' active' : ''}" data-mode="cats">Categories</button>
              <button class="mt-btn${mode === 'players' ? ' active' : ''}" data-mode="players">Players</button>
            </div>
            <button class="filter-pill" id="compare-clear">Clear</button>
            <span class="badge badge-cyan" id="compare-count">${mode === 'cats' ? selectedIds.length : selectedPlayers.length} selected</span>
          </div>
        </div>
        <div id="compare-selector-wrap"></div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title" id="compare-chart-title">WR <span class="neon">Progression</span> Comparison</div>
          <div class="card-actions">
            <div class="mode-toggle" id="compare-chart-mode-toggle" style="display:none">
              <button class="mt-btn active" data-cmode="active">Active</button>
              <button class="mt-btn" data-cmode="all">All Records</button>
            </div>
            <span class="badge badge-cyan">scroll to zoom · hover dots for detail</span>
          </div>
        </div>
        <div id="compare-chart"></div>
      </div>

      <div id="compare-stats-mount"></div>

      <div class="card mb-16" id="compare-table-card">
        <div class="card-header">
          <div class="card-title">Current <span class="neon">WRs</span> Side by Side</div>
          <div class="card-actions"><span class="badge badge-gray">moves · tps · replay</span></div>
        </div>
        <div id="compare-table"></div>
      </div>
    `;

    // Mode toggle
    document.getElementById('compare-mode-toggle').querySelectorAll('.mt-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var newMode = btn.getAttribute('data-mode');
        var newParams = { mode: newMode };
        if (newMode === 'cats') newParams.cats = selectedIds.join(',');
        else newParams.players = selectedPlayers.join(',');
        U.setHash('compare', newParams);
      });
    });

    // Build the selector (organized by puzzle size for cats, or player list for players)
    var selWrap = document.getElementById('compare-selector-wrap');
    if (mode === 'cats') {
      buildCategorySelector(selWrap, cats, selectedIds);
      document.getElementById('compare-selector-title').innerHTML = 'Select <span class="neon">Categories</span>';
    } else {
      buildPlayerSelector(selWrap, allPlayerNames, selectedPlayers, stats);
      document.getElementById('compare-selector-title').innerHTML = 'Select <span class="neon">Players</span>';
    }

    document.getElementById('compare-clear').addEventListener('click', function () {
      if (mode === 'cats') U.setHash('compare', { mode: 'cats', cats: '' });
      else U.setHash('compare', { mode: 'players', players: '' });
    });

    // Chart mode toggle (Active vs All Records) — only visible in Players mode.
    // User: "add a toggle to the graph to show All Records version of this
    // chart ... same new version should be supported in Compare page".
    var chartModeToggle = document.getElementById('compare-chart-mode-toggle');
    if (chartModeToggle) {
      chartModeToggle.style.display = (mode === 'players') ? '' : 'none';
      // Restore the active button from the saved mode.
      if (mode === 'players') {
        chartModeToggle.querySelectorAll('.mt-btn').forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-cmode') === compareChartMode);
        });
      }
      chartModeToggle.querySelectorAll('.mt-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          compareChartMode = btn.getAttribute('data-cmode');
          chartModeToggle.querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          // Re-render the chart only (not the whole page).
          if (mode === 'players' && selectedPlayers.length) {
            renderComparePlayers(selectedPlayers, stats);
          }
        });
      });
    }

    // Render chart + table based on mode
    if (mode === 'cats') {
      renderCompareCats(selectedIds, isEmpty);
    } else {
      renderComparePlayers(selectedPlayers, stats);
    }
  }

  function buildCategorySelector(container, cats, selectedIds) {
    // Group by puzzle size. Big puzzles (11x11+) merged into a single 'big'
    // group (user: "same groupping thing as before for big puzzles").
    var sizeGroups = {};
    cats.forEach(function (cat) {
      var size = cat.size || 'other';
      var n = parseInt(size, 10);
      var key;
      if (!isNaN(n) && n >= 11) key = 'big';
      else key = size;
      if (!sizeGroups[key]) sizeGroups[key] = [];
      sizeGroups[key].push(cat);
    });
    var sizeKeys = Object.keys(sizeGroups).sort(function (a, b) {
      if (a === 'big') return 1;
      if (b === 'big') return -1;
      var na = parseInt(a), nb = parseInt(b);
      if (isNaN(na) || isNaN(nb)) return a < b ? -1 : 1;
      return na - nb;
    });

    // User: "to reduce space, remove headers like '3x3' '4x4' etc, just new
    // lines are enough to visually separate toggles, especially considering
    // categories have puzzle size included in them".
    var wrap = document.createElement('div');
    wrap.className = 'compare-selector compare-selector-compact';
    sizeKeys.forEach(function (size) {
      var group = document.createElement('div');
      group.className = 'cs-group cs-group-compact';
      var pills = document.createElement('div');
      pills.className = 'cs-pills';
      sizeGroups[size].forEach(function (cat) {
        var isSel = selectedIds.indexOf(cat.id) >= 0;
        var btn = document.createElement('button');
        btn.className = 'filter-pill' + (isSel ? ' active' : '');
        btn.textContent = cat.name;
        btn.setAttribute('data-cat-id', cat.id);
        btn.addEventListener('click', function () {
          // Save scroll position before navigation so we can restore it
          // after re-render. User: "whole ui refreshes, so this section is
          // scrolled back on top after each selection, which is a bit annoying".
          var scrollEl = wrap;
          savedSelectorScroll = scrollEl.scrollTop;
          var idx = selectedIds.indexOf(cat.id);
          if (idx >= 0) selectedIds.splice(idx, 1);
          else selectedIds.push(cat.id);
          U.setHash('compare', { mode: 'cats', cats: selectedIds.join(',') });
        });
        pills.appendChild(btn);
      });
      group.appendChild(pills);
      wrap.appendChild(group);
    });
    container.innerHTML = '';
    container.appendChild(wrap);
    // Restore scroll position after re-render.
    wrap.scrollTop = savedSelectorScroll;
  }

  function buildPlayerSelector(container, allPlayerNames, selectedPlayers, stats) {
    var wrap = document.createElement('div');
    wrap.className = 'compare-selector compare-selector-compact';
    var group = document.createElement('div');
    group.className = 'cs-group cs-group-compact';
    var label = document.createElement('div');
    label.className = 'cs-group-label';
    label.textContent = 'Players (by total records)';
    group.appendChild(label);
    var pills = document.createElement('div');
    pills.className = 'cs-pills';
    allPlayerNames.forEach(function (name) {
      var isSel = selectedPlayers.indexOf(name) >= 0;
      var btn = document.createElement('button');
      btn.className = 'filter-pill' + (isSel ? ' active' : '');
      btn.textContent = name + ' (' + stats.players[name] + ')';
      btn.style.color = isSel ? '#000' : U.playerColor(name);
      btn.setAttribute('data-player', name);
      btn.addEventListener('click', function () {
        // Save scroll position before navigation.
        var scrollEl = wrap;
        savedSelectorScroll = scrollEl.scrollTop;
        var idx = selectedPlayers.indexOf(name);
        if (idx >= 0) selectedPlayers.splice(idx, 1);
        else selectedPlayers.push(name);
        U.setHash('compare', { mode: 'players', players: selectedPlayers.join(',') });
      });
      pills.appendChild(btn);
    });
    group.appendChild(pills);
    wrap.appendChild(group);
    container.innerHTML = '';
    container.appendChild(wrap);
    // Restore scroll position after re-render.
    wrap.scrollTop = savedSelectorScroll;
  }

  function renderCompareCats(selectedIds, isEmpty) {
    var selected = selectedIds.map(function (id) { return U.getCategory(id); }).filter(Boolean);
    var series = selected.map(function (cat, i) {
      var color;
      if (i < U.TIER_ORDER.length) color = U.TIER_COLORS[U.TIER_ORDER[i]];
      else { var grays = ['#c8c8c8', '#a0a0a0', '#787878', '#5a5a5a']; color = grays[(i - U.TIER_ORDER.length) % grays.length]; }
      var points = U.filterRecords(cat, state.platform)
        .filter(function (r) { return r.time != null && r.dateSortKey > 0; })
        .map(function (r) { return { x: r.dateSortKey, y: r.time, rec: r }; });
      return { label: cat.name, color: color, points: points };
    });

    document.getElementById('compare-chart-title').innerHTML = 'WR <span class="neon">Progression</span> Comparison';
    document.getElementById('compare-table-card').style.display = '';
    document.getElementById('compare-stats-mount').innerHTML = '';

    if (isEmpty) {
      document.getElementById('compare-chart').innerHTML = '<div class="empty-state"><div class="icon">⊕</div>Select categories above to compare</div>';
      document.getElementById('compare-table').innerHTML = '<div class="empty-state">No categories selected</div>';
    } else {
      WR.multiLineChart(document.getElementById('compare-chart'), series);
      var tableEl = document.getElementById('compare-table');
      var html = '<div class="table-scroll"><table class="wr-table"><thead><tr>' +
        '<th>Category</th><th class="num">Records</th><th class="num">Current WR</th><th>Holder</th>' +
        '<th class="num">Moves</th><th class="num">TPS</th><th>Control</th><th>Style</th><th>' + replayHeaderCell() + '</th><th>Video</th>' +
        '</tr></thead><tbody>';
      selected.forEach(function (cat, i) {
        var color;
        if (i < U.TIER_ORDER.length) color = U.TIER_COLORS[U.TIER_ORDER[i]];
        else { var grays = ['#c8c8c8', '#a0a0a0', '#787878', '#5a5a5a']; color = grays[(i - U.TIER_ORDER.length) % grays.length]; }
        var s = U.getCategoryStats(cat, state.platform);
        var wr = s.currentWR;
        html += '<tr>' +
          '<td class="player" style="color:' + color + '">' + esc(cat.name) + '</td>' +
          '<td class="num">' + s.recordCount + '</td>' +
          '<td class="num time">' + (wr ? U.fmtTime(wr.time) : '—') + '</td>' +
          '<td class="player" style="color:' + (wr ? U.playerColor(wr.player) : '#888') + '">' + (wr ? esc(wr.player) : '—') + '</td>' +
          '<td class="num">' + (wr ? U.fmtMovecount(wr.movecount, U.isSingle(cat)) : '—') + '</td>' +
          '<td class="num text-dim">' + (wr && wr.tps != null ? U.fmtTps(wr.tps) : '—') + '</td>' +
          '<td>' + (wr ? controlCell(wr.control) : '—') + '</td>' +
          '<td>' + (wr ? styleCell(wr.style) : '—') + '</td>' +
          '<td>' + (wr ? replayCell(wr) : '—') + '</td>' +
          '<td>' + (wr ? videoCell(wr) : '—') + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      tableEl.innerHTML = html;
      tableEl.querySelectorAll('.clickable-note').forEach(function (note) {
        note.addEventListener('click', function (e) {
          e.stopPropagation();
          showNoteModal(note.getAttribute('data-full'));
        });
      });
      // wire download replay links + help buttons
      wireDownloadLinks(tableEl);
      wireHelpLinks(tableEl);
    }
  }

  function renderComparePlayers(selectedPlayers, stats) {
    // Plot active records held over time for each player.
    // User: "should be number of records graph, rivals, various fun stats in
    // head to head style comparison, don't go wild though, just few fun stats".
    document.getElementById('compare-chart-title').innerHTML = '<span class="neon">Active Records</span> Over Time';
    document.getElementById('compare-table-card').style.display = 'none';

    if (!selectedPlayers.length) {
      document.getElementById('compare-chart').innerHTML = '<div class="empty-state"><div class="icon">⊕</div>Select players above to compare</div>';
      document.getElementById('compare-stats-mount').innerHTML = '';
      return;
    }

    // Build series for the active-records chart. Toggle between "Active"
    // (floating state — records gained and lost over time) and "All"
    // (cumulative total records ever set, never decreases).
    // User: "add a toggle to the graph to show All Records version of this
    // chart ... same new version should be supported in Compare page".
    var chartMode = compareChartMode;
    var series = selectedPlayers.map(function (name) {
      var data = chartMode === 'all'
        ? U.getPlayerTotalRecordsOverTime(name, state.platform)
        : U.getPlayerRecordsHeldOverTime(name, state.platform);
      return {
        label: name,
        color: U.playerColor(name),
        points: data.points.map(function (p) { return { t: p.t, y: p.y, rec: p.rec, cat: p.cat, gainCount: p.gainCount, lossCount: p.lossCount, evs: p.evs }; }),
        current: data.current,
      };
    });
    WR.activeRecordsChart(document.getElementById('compare-chart'), series);

    // ---- Fun stats ----
    // (Head-to-Head Snipes table removed — user: "this table below seems to be
    // broken, or at least i don't understand it, so remove it".)
    var playerStats = selectedPlayers.map(function (name) {
      var records = U.getPlayerRecords(name, state.platform);
      var currentWRs = U.getCurrentWRsHeld(name, state.platform);
      var snipes = U.getPlayerSnipes(name, state.platform);
      var everHeld = U.getRecordsEverHeld(name, state.platform);
      var heldOverTime = U.getPlayerRecordsHeldOverTime(name, state.platform);
      var peak = 0, peakDate = null;
      heldOverTime.points.forEach(function (p) { if (p.y > peak) { peak = p.y; peakDate = p.t; } });
      return {
        name: name,
        color: U.playerColor(name),
        records: records.count,
        currentWRs: currentWRs.count,
        snipes: snipes.count,
        firstEverSnipes: snipes.firstEverCount || 0,
        everHeld: everHeld.count,
        activeNow: heldOverTime.current,
        peak: peak,
        peakDate: peakDate,
      };
    });

    // Fun stats grid (one card per player with key numbers)
    var statsHtml = '<div class="card mb-16"><div class="card-header"><div class="card-title">Fun <span class="neon">Stats</span></div>';
    statsHtml += '<div class="card-actions"><span class="badge badge-cyan">' + selectedPlayers.length + ' player' + (selectedPlayers.length === 1 ? '' : 's') + '</span></div></div>';
    statsHtml += '<div class="compare-stats-grid">';
    playerStats.forEach(function (ps) {
      statsHtml += '<div class="compare-stat-card" style="border-color:' + ps.color + '">';
      statsHtml += '<div class="csc-name" style="color:' + ps.color + '">' + esc(ps.name) + '</div>';
      statsHtml += '<div class="csc-grid">';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">Active now</div><div class="csc-val text-cyan">' + ps.activeNow + '</div></div>';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">Peak held</div><div class="csc-val">' + ps.peak + (ps.peakDate ? ' <span class="text-dim" style="font-size:10px">(' + new Date(ps.peakDate * 1000).getUTCFullYear() + ')</span>' : '') + '</div></div>';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">Total records</div><div class="csc-val">' + ps.records + '</div></div>';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">Snipes</div><div class="csc-val text-pink">' + ps.snipes + '</div></div>';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">First documented</div><div class="csc-val">' + ps.firstEverSnipes + '</div></div>';
      statsHtml += '<div class="csc-cell"><div class="csc-lbl">Cats ever held</div><div class="csc-val">' + ps.everHeld + '</div></div>';
      statsHtml += '</div>';
      statsHtml += '</div>';
    });
    statsHtml += '</div></div>';

    document.getElementById('compare-stats-mount').innerHTML = statsHtml;
  }

  /* ============================================================
   * PLAYER DETAIL
   * ============================================================ */
  function renderPlayer(params) {
    var c = container();
    var name = params.name;
    if (!name) { c.innerHTML = '<div class="empty-state">No player specified</div>'; return; }

    var records = U.getPlayerRecords(name, state.platform);
    var currentWRs = U.getCurrentWRsHeld(name, state.platform);
    var everHeld = U.getRecordsEverHeld(name, state.platform);
    var snipes = U.getPlayerSnipes(name, state.platform);
    var heldOverTime = U.getPlayerRecordsHeldOverTime(name, state.platform);
    var color = U.playerColor(name);

    // nemesis: who this player sniped most, and who sniped them most
    var nemStats = U.getNemesisStats(state.platform);
    var snipedByPlayer = nemStats.matrix[name] || {};
    var snipedThisPlayer = {};
    Object.keys(nemStats.matrix).forEach(function (sniper) {
      if (nemStats.matrix[sniper][name]) snipedThisPlayer[sniper] = nemStats.matrix[sniper][name];
    });

    var topVictims = Object.keys(snipedByPlayer).sort(function (a, b) { return snipedByPlayer[b] - snipedByPlayer[a]; }).slice(0, 5);
    var topSnipers = Object.keys(snipedThisPlayer).sort(function (a, b) { return snipedThisPlayer[b] - snipedThisPlayer[a]; }).slice(0, 5);

    // Total snipe counts (all victims / all rivals, not just top 5).
    // User: "remove 'click names' nonsense thing tag, instead count total of
    // victims / rivals snipes".
    var totalVictimSnipes = 0;
    Object.keys(snipedByPlayer).forEach(function (v) { totalVictimSnipes += snipedByPlayer[v]; });
    var totalRivalSnipes = 0;
    Object.keys(snipedThisPlayer).forEach(function (r) { totalRivalSnipes += snipedThisPlayer[r]; });

    // Snipes breakdown: from rivals vs first documented records.
    // User: "Snipes 54 taken from rivals - OR first ever records if not
    // included already, either way improve the note to explain".
    var snipeFromRivals = snipes.count - (snipes.firstEverCount || 0);
    var snipeSub = snipeFromRivals + ' from rivals · ' + (snipes.firstEverCount || 0) + ' first documented';

    c.innerHTML = `
      <h1 class="page-title" style="color:${color}">${esc(name)}</h1>
      <p class="page-subtitle">${records.count} records · ${currentWRs.count} current WRs · ${everHeld.count} ever held · ${snipes.count} snipes</p>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Current WRs</div>
          <div class="stat-value text-cyan">${currentWRs.count}</div>
          <div class="stat-sub">held right now</div>
        </div>
        <div class="stat-card pink">
          <div class="stat-label">Snipes</div>
          <div class="stat-value">${snipes.count}</div>
          <div class="stat-sub">${snipeSub}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Ever Held</div>
          <div class="stat-value">${everHeld.count}</div>
          <div class="stat-sub">categories all-time</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-label">Total Records</div>
          <div class="stat-value">${records.count}</div>
          <div class="stat-sub">all entries</div>
        </div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title">Active <span class="neon">Records</span> Over Time</div>
          <div class="card-actions">
            <div class="mode-toggle" id="player-chart-mode-toggle">
              <button class="mt-btn active" data-cmode="active">Active</button>
              <button class="mt-btn" data-cmode="all">All Records</button>
            </div>
            <span class="badge badge-cyan" id="player-chart-badge">ends at ${heldOverTime.current} current</span>
          </div>
        </div>
        <div id="player-active-chart"></div>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title" id="player-records-title">All <span class="neon">Records</span></div>
          <div class="card-actions">
            <div class="mode-toggle" id="player-records-toggle">
              <button class="mt-btn active" data-rmode="all">All Records</button>
              <button class="mt-btn" data-rmode="current">Current WRs</button>
            </div>
            <span class="badge badge-cyan" id="player-records-badge">${records.count} entries</span>
          </div>
        </div>
        <div id="player-records"></div>
      </div>

      <div class="grid-2 mb-16">
        <div class="card">
          <div class="card-header">
            <div class="card-title">Victims &amp; <span class="neon">Rivals</span></div>
            <div class="card-actions">
              <span class="badge" style="color:var(--pink);border-color:rgba(255,34,98,0.4);background:rgba(255,34,98,0.08)" title="Total WRs this player took from others">${totalVictimSnipes} snipes</span>
              <span class="badge" style="color:var(--red);border-color:rgba(255,68,68,0.4);background:rgba(255,68,68,0.08)" title="Total WRs others took from this player">${totalRivalSnipes} losses</span>
            </div>
          </div>
          <div id="player-victims"></div>
          <div id="player-rivals" class="vr-rivals-gap"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="neon">Snipes</span> Timeline</div>
            <div class="card-actions">
              <span class="badge" style="color:var(--delta-up);border-color:rgba(0,255,170,0.4);background:rgba(0,255,170,0.08)">wins</span>
              <span class="badge" style="color:var(--red);border-color:rgba(255,68,68,0.4);background:rgba(255,68,68,0.08)">losses</span>
            </div>
          </div>
          <div id="player-snipes-timeline"></div>
        </div>
      </div>
    `;

    // ---- Active Records Over Time chart (single-player, with All/Active toggle) ----
    // User: "Remove player name from legend, as here we only have 1 player.
    // for same reason remove '1 player' from this version of the chart" →
    // singlePlayer:true removes legend + "1 player" text.
    // User: "add a toggle to the graph to show All Records version of this
    // chart, so player never loses his wrs in this version".
    var playerChartMode = 'active';
    function renderPlayerChart() {
      var data = playerChartMode === 'all'
        ? U.getPlayerTotalRecordsOverTime(name, state.platform)
        : U.getPlayerRecordsHeldOverTime(name, state.platform);
      var series = [{
        label: name,
        color: color,
        points: data.points.map(function (p) {
          return { t: p.t, y: p.y, rec: p.rec, cat: p.cat, gainCount: p.gainCount, lossCount: p.lossCount, evs: p.evs };
        }),
      }];
      WR.activeRecordsChart(document.getElementById('player-active-chart'), series, {
        height: 320,
        singlePlayer: true,
      });
      // Update badge.
      var badge = document.getElementById('player-chart-badge');
      if (badge) {
        if (playerChartMode === 'all') {
          badge.textContent = data.current + ' total records';
        } else {
          badge.textContent = 'ends at ' + data.current + ' current';
        }
      }
    }
    renderPlayerChart();
    // Wire chart mode toggle.
    var chartModeToggle = document.getElementById('player-chart-mode-toggle');
    if (chartModeToggle) {
      chartModeToggle.querySelectorAll('.mt-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          playerChartMode = btn.getAttribute('data-cmode');
          chartModeToggle.querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderPlayerChart();
        });
      });
    }

    // ---- All Records / Current WRs toggle ----
    // User: "make Current WRs section a Toggle option of All Records at the
    // bottom, so remove this section from the top, don't forget to add Video,
    // Notes, maybe other missing columns from 'All records' version".
    // Also: "Also #1 record is highlighted in that table, which doesn't really
    // make sense" → no current-wr highlight class.
    // Also: "the most recent record is marked as #1" → # column uses
    // chronological order (oldest = 1, newest = highest).
    var recordsMode = 'all';
    function renderPlayerRecords() {
      var el = document.getElementById('player-records');
      var titleEl = document.getElementById('player-records-title');
      var badgeEl = document.getElementById('player-records-badge');
      if (recordsMode === 'current') {
        // Current WRs table — includes Video, Notes columns (same as All Records).
        if (titleEl) titleEl.innerHTML = 'Current <span class="neon">WRs</span>';
        if (badgeEl) badgeEl.textContent = currentWRs.count + ' current';
        if (!currentWRs.categories.length) {
          el.innerHTML = '<div class="empty-state">No current WRs</div>';
          return;
        }
        var html = '<div class="table-scroll"><table class="wr-table"><thead><tr>' +
          '<th class="rank">#</th><th>Category</th><th class="num">Time</th><th class="num">Moves</th><th class="num">TPS</th>' +
          '<th>Control</th><th>Style</th><th>' + replayHeaderCell() + '</th><th>Video</th><th>Notes</th><th>Date</th>' +
          '</tr></thead><tbody>';
        // Sort current WRs by date (most recent first) for display, but number
        // them chronologically (oldest = 1).
        var curRecs = currentWRs.categories.map(function (cat) {
          var s = U.getCategoryStats(cat, state.platform);
          return { cat: cat, wr: s.currentWR };
        }).sort(function (a, b) {
          return (b.wr.dateSortKey || 0) - (a.wr.dateSortKey || 0);
        });
        curRecs.forEach(function (item, i) {
          var cat = item.cat, wr = item.wr;
          // Chronological #: oldest current WR = 1, newest = N.
          var chronNum = curRecs.length - i;
          html += '<tr style="cursor:pointer" data-cat="' + cat.id + '">' +
            '<td class="rank">' + chronNum + '</td>' +
            '<td class="player">' + esc(cat.name) + '</td>' +
            '<td class="num time">' + U.fmtTime(wr.time) + '</td>' +
            '<td class="num">' + U.fmtMovecount(wr.movecount, U.isSingle(cat)) + '</td>' +
            '<td class="num text-dim">' + (wr.tps != null ? U.fmtTps(wr.tps) : '—') + '</td>' +
            '<td>' + controlCell(wr.control) + '</td>' +
            '<td>' + styleCell(wr.style) + '</td>' +
            '<td>' + replayCell(wr) + '</td>' +
            '<td>' + videoCell(wr) + '</td>' +
            '<td>' + notesCell(wr) + '</td>' +
            '<td class="date">' + U.fmtDate(wr) + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div>';
        el.innerHTML = html;
        el.querySelectorAll('tr[data-cat]').forEach(function (tr) {
          tr.addEventListener('click', function (e) {
            if (e.target.closest('a')) return;
            var catId = tr.getAttribute('data-cat');
            var cat = U.getCategory(catId);
            if (cat) {
              var s = U.getCategoryStats(cat, state.platform);
              if (s.currentWR) { WR.showRecordModal(s.currentWR, cat); return; }
            }
            U.setHash('category', { id: catId });
          });
        });
      } else {
        // All Records table — no #1 highlight, chronological # (oldest=1).
        if (titleEl) titleEl.innerHTML = 'All <span class="neon">Records</span>';
        if (badgeEl) badgeEl.textContent = records.count + ' entries';
        var allRecs = records.details.map(function (d) {
          return d.rec;
        }).sort(function (a, b) { return (b.dateSortKey || 0) - (a.dateSortKey || 0); });
        var rhtml = '<div class="table-scroll"><table class="wr-table"><thead><tr><th class="rank">#</th><th>Date</th><th>Category</th><th class="num">Time</th><th class="num">Moves</th><th class="num">TPS</th><th>Control</th><th>Style</th><th>' + replayHeaderCell() + '</th><th>Video</th><th>Notes</th></tr></thead><tbody>';
        allRecs.forEach(function (r, i) {
          var cat = U.getCategory(r._catId);
          // Chronological #: oldest = 1, newest = N. Table is newest-first,
          // so first row = N, last row = 1.
          var chronNum = allRecs.length - i;
          rhtml += '<tr>' +
            '<td class="rank">' + chronNum + '</td>' +
            '<td class="date">' + U.fmtDate(r) + '</td>' +
            '<td class="player"><a data-cat="' + r._catId + '" style="cursor:pointer">' + esc(r._catName) + '</a></td>' +
            '<td class="num time">' + U.fmtTime(r.time) + '</td>' +
            '<td class="num">' + U.fmtMovecount(r.movecount, cat ? U.isSingle(cat) : false) + '</td>' +
            '<td class="num text-dim">' + (r.tps != null ? U.fmtTps(r.tps) : '—') + '</td>' +
            '<td>' + controlCell(r.control) + '</td>' +
            '<td>' + styleCell(r.style) + '</td>' +
            '<td>' + replayCell(r) + '</td>' +
            '<td>' + videoCell(r) + '</td>' +
            '<td>' + notesCell(r) + '</td>' +
            '</tr>';
        });
        rhtml += '</tbody></table></div>';
        el.innerHTML = rhtml;
        el.querySelectorAll('a[data-cat]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            U.setHash('category', { id: a.getAttribute('data-cat') });
          });
        });
      }
      // Wire clickable notes + download links for both modes.
      el.querySelectorAll('.clickable-note').forEach(function (note) {
        note.addEventListener('click', function (e) {
          e.stopPropagation();
          showNoteModal(note.getAttribute('data-full'));
        });
      });
      wireDownloadLinks(el);
      wireHelpLinks(el);
    }
    renderPlayerRecords();
    // Wire records mode toggle.
    var recordsToggle = document.getElementById('player-records-toggle');
    if (recordsToggle) {
      recordsToggle.querySelectorAll('.mt-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          recordsMode = btn.getAttribute('data-rmode');
          recordsToggle.querySelectorAll('.mt-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderPlayerRecords();
        });
      });
    }

    // ---- Snipes Timeline ----
    var snipeEl = document.getElementById('player-snipes-timeline');
    var wasSniped = U.getPlayerWasSniped(name, state.platform);
    // Combine win + loss events into a single timeline.
    var events = [];
    snipes.details.forEach(function (d) {
      events.push({
        type: d.snipe.first ? 'first' : 'win',
        date: d.snipe.rec.dateSortKey || 0,
        rec: d.snipe.rec,
        cat: d.cat,
        opponent: d.snipe.victim,
        opponentRole: 'victim',
        delta: +1,
      });
    });
    wasSniped.details.forEach(function (d) {
      events.push({
        type: 'loss',
        date: d.rec.dateSortKey || 0,
        rec: d.rec,
        cat: d.cat,
        opponent: d.sniper,
        opponentRole: 'sniper',
        delta: -1,
      });
    });

    // Pre-compute the active-count at each event. We sort events ascending by
    // date, walk through maintaining a running count, and tag each event with
    // its before/after counts. For same-day events we still process them in
    // order (so 2 wins on the same day show 10→11 and 11→12).
    var eventsAsc = events.slice().sort(function (a, b) { return a.date - b.date; });
    var running = 0;
    var countByKey = {}; // date|delta|catId -> {before, after}
    eventsAsc.forEach(function (ev) {
      var before = running;
      running += ev.delta;
      var after = running;
      // Key by date + delta + catId + opponent to uniquely identify the event.
      var key = ev.date + '|' + ev.delta + '|' + ev.cat.id + '|' + (ev.opponent || '');
      countByKey[key] = { before: before, after: after };
    });

    if (events.length) {
      // Sort by date descending (most recent first) for display.
      events.sort(function (a, b) { return b.date - a.date; });
      var shtml = '<div class="snipes-list">';
      events.forEach(function (ev) {
        var rec = ev.rec;
        var oppColor = ev.opponent ? U.playerColor(ev.opponent) : '#888';
        var itemCls = ev.type === 'loss' ? 'snipe-loss' : 'snipe-win';
        var tagCls = ev.type === 'loss' ? 'tag-loss' : (ev.type === 'first' ? 'tag-first' : 'tag-win');
        var tagText = ev.type === 'loss' ? 'LOST' : (ev.type === 'first' ? 'FIRST' : 'WIN');
        var bodyText;
        if (ev.type === 'first') {
          bodyText = '<span class="text-yellow">★ First documented record</span>';
        } else if (ev.type === 'win') {
          bodyText = ev.opponent
            ? 'sniped <b style="color:' + oppColor + '">' + esc(ev.opponent) + '</b>'
            : '<span class="text-dim">first record</span>';
        } else {
          bodyText = 'sniped by <b style="color:' + oppColor + '">' + esc(ev.opponent) + '</b>';
        }
        // Lookup before/after counts for this event.
        var key = ev.date + '|' + ev.delta + '|' + ev.cat.id + '|' + (ev.opponent || '');
        var cnt = countByKey[key] || { before: '?', after: '?' };
        var counterHtml = '<span class="snipe-counter" title="active records held">' + cnt.before + '→' + cnt.after + '</span>';
        shtml += '<div class="snipe-item ' + itemCls + '" data-cat="' + esc(ev.cat.id) + '">' +
          '<div class="snipe-date">' + U.fmtDate(rec) + '</div>' +
          '<div class="snipe-body">' +
            '<div class="snipe-head">' +
              '<span class="snipe-cat">' + esc(ev.cat.name) + '</span>' +
              '<span class="snipe-time text-cyan">' + U.fmtTime(rec.time) + '</span>' +
              counterHtml +
            '</div>' +
            '<div class="snipe-victim">' +
              '<span class="snipe-tag ' + tagCls + '">' + tagText + '</span> ' + bodyText +
            '</div>' +
          '</div>' +
        '</div>';
      });
      shtml += '</div>';
      snipeEl.innerHTML = shtml;
      snipeEl.querySelectorAll('.snipe-item').forEach(function (it) {
        it.addEventListener('click', function (e) {
          if (e.target.closest('a')) return;
          var catId = it.getAttribute('data-cat');
          var cat = U.getCategory(catId);
          if (cat) {
            var recs = U.filterRecords(cat, state.platform);
            var dateText = it.querySelector('.snipe-date').textContent;
            var timeText = it.querySelector('.snipe-time').textContent;
            var match = recs.find(function (r) {
              return U.fmtDate(r) === dateText && U.fmtTime(r.time) === timeText;
            });
            if (match) { WR.showRecordModal(match, cat); return; }
            U.setHash('category', { id: catId });
          }
        });
      });
    } else {
      snipeEl.innerHTML = '<div class="empty-state">No snipe events</div>';
    }

    // victims & rivals — combined into compact tables (no scroll wrapper).
    var victimsEl = document.getElementById('player-victims');
    if (topVictims.length) {
      var vhtml = '<div class="vr-table-label">Top Victims <span class="text-dim">sniped by ' + esc(name) + '</span></div>';
      vhtml += '<table class="wr-table compact-table"><thead><tr><th>Victim</th><th class="num">×</th></tr></thead><tbody>';
      topVictims.forEach(function (v) {
        vhtml += '<tr style="cursor:pointer" data-name="' + esc(v) + '"><td class="player" style="color:' + U.playerColor(v) + '">' + esc(v) + '</td><td class="num text-pink" style="font-weight:700">' + snipedByPlayer[v] + '</td></tr>';
      });
      vhtml += '</tbody></table>';
      victimsEl.innerHTML = vhtml;
      victimsEl.querySelectorAll('tr[data-name]').forEach(function (tr) {
        tr.addEventListener('click', function () { U.setHash('player', { name: tr.getAttribute('data-name') }); });
      });
    } else { victimsEl.innerHTML = '<div class="vr-table-label">Top Victims</div><div class="empty-state" style="padding:8px">No victims</div>'; }

    var rivalsEl = document.getElementById('player-rivals');
    if (topSnipers.length) {
      var rhtml = '<div class="vr-table-label">Top Rivals <span class="text-dim">sniped ' + esc(name) + '</span></div>';
      rhtml += '<table class="wr-table compact-table"><thead><tr><th>Rival</th><th class="num">×</th></tr></thead><tbody>';
      topSnipers.forEach(function (s2) {
        rhtml += '<tr style="cursor:pointer" data-name="' + esc(s2) + '"><td class="player" style="color:' + U.playerColor(s2) + '">' + esc(s2) + '</td><td class="num text-red" style="font-weight:700">' + snipedThisPlayer[s2] + '</td></tr>';
      });
      rhtml += '</tbody></table>';
      rivalsEl.innerHTML = rhtml;
      rivalsEl.querySelectorAll('tr[data-name]').forEach(function (tr) {
        tr.addEventListener('click', function () { U.setHash('player', { name: tr.getAttribute('data-name') }); });
      });
    } else { rivalsEl.innerHTML = '<div class="vr-table-label">Top Rivals</div><div class="empty-state" style="padding:8px">No rivals</div>'; }
  }

  /* ============================================================
   * Record detail modal
   * ============================================================ */
  function showRecordModal(rec, cat) {
    var overlay = document.getElementById('modal-overlay');
    var title = document.getElementById('modal-title');
    var body = document.getElementById('modal-body');
    var color = U.playerColor(rec.player);

    title.innerHTML = (cat ? esc(cat.name) + ' · ' : '') + '<span style="color:' + color + '">' + esc(rec.player) + '</span>';

    var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += statBox('Time', U.fmtTime(rec.time), 'text-cyan');
    html += statBox('Date', U.fmtDate(rec));
    if (cat) html += statBox('Movecount', U.fmtMovecount(rec.movecount, U.isSingle(cat)));
    if (rec.tps != null) html += statBox('TPS', U.fmtTps(rec.tps));
    if (rec.control) html += statBox('Control', esc(rec.control));
    if (rec.style) html += statBox('Style', esc(rec.style));
    html += '</div>';

    if (rec.videoUrl) {
      html += '<div class="section-label">Video</div>';
      html += '<div id="modal-video" style="max-width:480px;margin-bottom:16px"></div>';
    }
    if (rec.replayUrl) {
      var linkType = U.replayLinkType(rec.replayUrl);
      var cls = linkType === 'data' ? 'replay-data' : linkType === 'info' ? 'replay-info' :
                (rec.replayAccurate === true ? 'replay-accurate' : rec.replayAccurate === false ? 'replay-inaccurate' : 'replay-unknown');
      var lbl = linkType === 'data' ? 'Data link' : linkType === 'info' ? 'Info link' :
                (rec.replayAccurate === true ? 'Accurate replay' : rec.replayAccurate === false ? 'Inaccurate replay' : 'Replay');
      html += '<div class="section-label">' + (linkType === 'data' || linkType === 'info' ? 'External Evidence' : 'Replay') + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px">';
      html += '<a href="' + esc(rec.replayUrl) + '" target="_blank" rel="noopener" class="rec-link ' + cls + '" style="font-size:13px;padding:6px 12px">' + lbl + ' ↗</a>';
      // Download button — only for actual replay links (not Data/Info).
      // User: "Download button for replay should not be for 'Data' and 'info'
      // links, only for replay links obviously".
      if (linkType !== 'data' && linkType !== 'info') {
        html += '<a href="#" class="rec-link-download" data-download-url="' + esc(rec.replayUrl) + '" title="Download replay link as .txt" style="font-size:13px;padding:6px 12px">' + DOWNLOAD_ICON_SVG + ' Download</a>';
      }
      // Help button — opens the SlidySim Replay Fix modal.
      html += '<button type="button" class="replay-help-icon" data-replay-help style="font-size:13px;padding:6px 10px">?</button>';
      html += '</div>';
      html += '<div style="margin-top:8px;font-size:11px;color:var(--text-dim);word-break:break-all">' + esc(rec.replayUrl) + '</div>';
    }
    if (rec.scramble) {
      html += '<div class="section-label" style="margin-top:12px">Scramble</div>';
      html += '<pre class="modal-pre">' + esc(rec.scramble) + '</pre>';
    }
    if (rec.solution) {
      html += '<div class="section-label" style="margin-top:12px">Solution</div>';
      html += '<pre class="modal-pre">' + esc(rec.solution) + '</pre>';
    }
    // Solve Data — always show if it's actual data (not a URL).
    // User: "make sure they are not overwriting Solve data, merge notes
    // and Solve data content together in such cases".
    var solveNote = U.solveDataAsNote(rec.solveData);
    if (solveNote) {
      html += '<div class="section-label" style="margin-top:12px">Solve Data</div>';
      html += '<pre class="modal-pre">' + esc(solveNote) + '</pre>';
    }
    if (rec.notes) {
      html += '<div class="section-label" style="margin-top:12px">Note</div>';
      html += '<div class="note-bubble" style="display:block;max-width:none;white-space:pre-wrap">' + esc(rec.notes) + '</div>';
    }
    body.innerHTML = html;
    overlay.hidden = false;

    if (rec.videoUrl) {
      WR.embedVideo(document.getElementById('modal-video'), rec);
    }
    // wire download + help buttons inside the modal.
    wireDownloadLinks(body);
    wireHelpLinks(body);
  }

  function statBox(label, value, cls) {
    return '<div style="background:var(--bg);padding:10px;border-radius:4px;border:1px solid var(--border)">' +
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim)">' + label + '</div>' +
      '<div style="font-size:16px;font-weight:700;margin-top:2px" class="' + (cls||'') + '">' + value + '</div>' +
      '</div>';
  }

  /* ---------- Util ---------- */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ---------- Router ---------- */
  function render(route, params) {
    state.route = route || 'overview';
    state.params = params || {};
    var c = container();
    c.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading…</p></div>';
    // defer render to next tick so the loading state paints first
    requestAnimationFrame(function () {
      try {
        switch (state.route) {
          case 'overview': renderOverview(); break;
          case 'categories': renderCategories(); break;
          case 'category': renderCategory(state.params); break;
          case 'compare': renderCompare(state.params); break;
          case 'player': renderPlayer(state.params); break;
          default: renderOverview();
        }
      } catch (e) {
        console.error('Render error:', e);
        c.innerHTML = '<div class="empty-state"><div class="icon">!</div>Error rendering view: ' + esc(e.message) + '</div>';
      }
    });
  }

  function setPlatform(p) { state.platform = p; }
  function getPlatform() { return state.platform; }
  function setTheme(t) { state.theme = t; document.documentElement.setAttribute('data-theme', t); }
  function getTheme() { return state.theme; }

  /* ---------- Exports ---------- */
  WR.render = render;
  WR.setPlatform = setPlatform;
  WR.getPlatform = getPlatform;
  WR.setTheme = setTheme;
  WR.getTheme = getTheme;
  WR.showRecordModal = showRecordModal;
  WR.esc = esc;
})();
