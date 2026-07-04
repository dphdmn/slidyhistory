/* ============================================================
 * Slidysim WR History Browser — features.js
 * Heatmaps, nemesis matrix, video-only leaderboard, embedded videos.
 * ============================================================ */
(function () {
  'use strict';

  var WR = (window.WR = window.WR || {});
  var U = WR;

  /* ============================================================
   * Activity heatmap — records by year × month
   * Now with rival/total toggle (rival = snipes only).
   * ============================================================ */
  function activityHeatmap(container, platform, opts) {
    opts = opts || {};
    var mode = opts.mode || 'total'; // 'total' | 'rival'
    var cats = U.filterCats(platform);
    var months = {}; // 'YYYY-MM' -> count
    cats.forEach(function (c) {
      var recs = U.filterRecords(c, platform);
      if (mode === 'rival') {
        // only snipe records
        var s = U.getCategoryStats(c, platform);
        var snipeSet = {};
        s.snipes.forEach(function (sn) { snipeSet[sn.rec._catId + '|' + sn.rec.dateIso + '|' + sn.rec.time] = true; });
        recs = recs.filter(function (r) {
          return snipeSet[r._catId + '|' + r.dateIso + '|' + r.time] || false;
        });
      }
      recs.forEach(function (r) {
        if (!r.dateIso) return;
        var parts = r.dateIso.split('-');
        var key = parts[0] + '-' + (parts[1] || '01');
        months[key] = (months[key] || 0) + 1;
      });
    });
    var grid = [];
    Object.keys(months).sort().forEach(function (key) {
      var parts = key.split('-');
      var yr = parts[0], mo = parseInt(parts[1], 10);
      var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      grid.push({ x: monthNames[mo-1], y: yr, v: months[key] });
    });
    U.heatmap(container, grid, { cellW: 22, cellH: 20 });
  }

  /* ============================================================
   * Player × Category heatmap — how many records each player has in each category
   * Now with rival/total toggle + clickable player names (Y) and category names (X).
   * ============================================================ */
  function playerCategoryHeatmap(container, platform, topN, opts) {
    opts = opts || {};
    var mode = opts.mode || 'total';
    var cats = U.filterCats(platform);
    // top players by record count
    var pcounts = {};
    cats.forEach(function (c) {
      U.filterRecords(c, platform).forEach(function (r) {
        pcounts[r.player] = (pcounts[r.player] || 0) + 1;
      });
    });
    var topPlayers = Object.keys(pcounts).sort(function (a, b) { return pcounts[b] - pcounts[a]; });
    if (topN != null) topPlayers = topPlayers.slice(0, topN);

    // Build a lookup of category by name (for click handler).
    var catByName = {};
    cats.forEach(function (c) { catByName[c.name] = c; });

    var data = [];
    cats.forEach(function (c) {
      var counts = {};
      var recs = U.filterRecords(c, platform);
      if (mode === 'rival') {
        // only snipe records per player
        var s = U.getCategoryStats(c, platform);
        s.snipes.forEach(function (sn) {
          counts[sn.sniper] = (counts[sn.sniper] || 0) + 1;
        });
      } else {
        recs.forEach(function (r) {
          counts[r.player] = (counts[r.player] || 0) + 1;
        });
      }
      topPlayers.forEach(function (p) {
        data.push({ x: c.name, y: p, v: counts[p] || 0 });
      });
    });
    U.heatmap(container, data, {
      cellW: 24, cellH: 22,
      yColor: function (p) { return U.playerColor(p); },
      onYLabelClick: function (p) { U.setHash('player', { name: p }); },
      onXLabelClick: function (catName) {
        var c = catByName[catName];
        if (c) U.setHash('category', { id: c.id });
      },
    });
  }

  /* ============================================================
   * Nemesis matrix — who sniped whom
   * Player names (row + column headers) are now clickable.
   * ============================================================ */
  function nemesisMatrix(container, platform, topN) {
    var stats = U.getNemesisStats(platform);
    var allSnipers = Object.keys(stats.snipeTotals).sort(function (a, b) {
      return stats.snipeTotals[b] - stats.snipeTotals[a];
    });
    var top = allSnipers.slice(0, topN || 12);
    // victims = union of all victims of these snipers
    var victimSet = {};
    top.forEach(function (s) {
      var v = stats.matrix[s] || {};
      Object.keys(v).forEach(function (vv) { victimSet[vv] = true; });
    });
    var victims = Object.keys(victimSet).sort(function (a, b) {
      return (stats.victimTotals[b] || 0) - (stats.victimTotals[a] || 0);
    }).slice(0, topN || 12);

    container.innerHTML = '';

    var grid = document.createElement('div');
    grid.className = 'nemesis-matrix';
    // Use minmax(48px, 1fr) so victim columns have a MINIMUM width of 48px.
    // Previously `1fr` columns squished to fit the container — which meant
    // the matrix never overflowed and the parent's overflow-x:auto never
    // engaged, so the matrix was unscrollable even when wider than the card.
    // User: "Nemesis matrix - still not scrollable".
    grid.style.gridTemplateColumns = '120px repeat(' + victims.length + ', minmax(48px, 1fr)) 60px';

    // header row — victim names clickable
    grid.appendChild(cell('Sniper \\ Victim', 'header'));
    victims.forEach(function (v) {
      var c = cell(v.length > 10 ? v.slice(0,8)+'…' : v, 'header clickable');
      c.title = 'View ' + v;
      c.style.color = U.playerColor(v);
      c.addEventListener('click', function () { U.setHash('player', { name: v }); });
      grid.appendChild(c);
    });
    grid.appendChild(cell('Total', 'header'));

    // data rows — sniper names clickable
    top.forEach(function (sniper) {
      var sc = U.playerColor(sniper);
      var rc = document.createElement('div');
      rc.className = 'nemesis-cell row-header clickable';
      rc.style.color = sc;
      rc.textContent = sniper;
      rc.title = 'View ' + sniper;
      rc.addEventListener('click', function () { U.setHash('player', { name: sniper }); });
      grid.appendChild(rc);

      var rowTotal = 0;
      victims.forEach(function (victim) {
        var count = (stats.matrix[sniper] || {})[victim] || 0;
        rowTotal += count;
        var c = cell(count > 0 ? String(count) : '·', count > 0 ? 'count' : 'zero');
        if (count > 0) {
          c.title = sniper + ' sniped ' + victim + ' ' + count + ' time' + (count > 1 ? 's' : '');
          c.style.cursor = 'pointer';
          c.addEventListener('click', function () { U.setHash('player', { name: sniper }); });
        }
        grid.appendChild(c);
      });
      grid.appendChild(cell(String(rowTotal), 'count'));
    });

    container.appendChild(grid);
  }

  function cell(text, cls) {
    var c = document.createElement('div');
    c.className = 'nemesis-cell ' + (cls || '');
    c.textContent = text;
    return c;
  }

  /* ============================================================
   * Video-only leaderboard — all records with video links
   * ============================================================ */
  function videoLeaderboard(container, platform, opts) {
    opts = opts || {};
    var cats = U.filterCats(platform);
    var videos = [];
    cats.forEach(function (c) {
      U.filterRecords(c, platform).forEach(function (r) {
        if (r.videoUrl) videos.push({ cat: c, rec: r });
      });
    });
    // sort: most recent first by default
    videos.sort(function (a, b) { return (b.rec.dateSortKey || 0) - (a.rec.dateSortKey || 0); });

    container.innerHTML = '';
    var grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(280px, 1fr))';
    grid.style.gap = '12px';

    var limit = opts.limit || 60;
    videos.slice(0, limit).forEach(function (v) {
      var card = document.createElement('div');
      card.className = 'card';
      card.style.padding = '0';
      card.style.overflow = 'hidden';
      card.style.cursor = 'pointer';

      var ytId = U.youtubeId(v.rec.videoUrl);
      if (ytId) {
        var thumb = document.createElement('div');
        thumb.className = 'video-thumb';
        thumb.innerHTML =
          '<img src="https://img.youtube.com/vi/' + ytId + '/hqdefault.jpg" alt="" loading="lazy">' +
          '<div class="play-overlay"><div class="play-icon"></div></div>';
        thumb.addEventListener('click', function () {
          if (opts.onVideoClick) opts.onVideoClick(v);
        });
        card.appendChild(thumb);
      }

      var info = document.createElement('div');
      info.style.padding = '10px 12px';
      info.innerHTML =
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px">' + v.cat.name + '</div>' +
        '<div style="font-weight:700;color:' + U.playerColor(v.rec.player) + '">' + v.rec.player + '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">' +
          '<span class="text-cyan" style="font-weight:700">' + U.fmtTime(v.rec.time) + '</span>' +
          '<span style="font-size:11px;color:var(--text-dim)">' + U.fmtDate(v.rec) + '</span>' +
        '</div>';
      card.appendChild(info);

      card.addEventListener('click', function (e) {
        if (e.target.closest('.video-thumb')) return;
        if (opts.onVideoClick) opts.onVideoClick(v);
      });
      grid.appendChild(card);
    });

    if (!videos.length) {
      container.innerHTML = '<div class="empty-state"><div class="icon">▶</div>No videos found</div>';
      return;
    }
    container.appendChild(grid);

    var count = document.createElement('div');
    count.style.textAlign = 'center';
    count.style.marginTop = '12px';
    count.style.fontSize = '11px';
    count.style.color = 'var(--text-dim)';
    count.textContent = 'Showing ' + Math.min(limit, videos.length) + ' of ' + videos.length + ' videos';
    container.appendChild(count);
  }

  /* ============================================================
   * Embedded YouTube player — renders an iframe for a record's video
   * ============================================================ */
  function embedVideo(container, rec) {
    container.innerHTML = '';
    var embed = U.youtubeEmbed(rec.videoUrl);
    if (!embed) {
      container.innerHTML = '<div class="empty-state">No embeddable video</div>';
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'video-embed';
    wrap.innerHTML = '<iframe src="' + embed + '?rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
    container.appendChild(wrap);
  }

  /* ---------- Exports ---------- */
  WR.activityHeatmap = activityHeatmap;
  WR.playerCategoryHeatmap = playerCategoryHeatmap;
  WR.nemesisMatrix = nemesisMatrix;
  WR.videoLeaderboard = videoLeaderboard;
  WR.embedVideo = embedVideo;
})();
