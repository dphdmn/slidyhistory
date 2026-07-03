/* ============================================================
 * Slidysim WR History Browser — utils.js
 * Data loading, defensive formatting, state, stats.
 *
 * KEY PRINCIPLE (verified against source data):
 *   EVERY entry in the sheet IS a world record. Times are
 *   monotonically decreasing within every category. There is
 *   no "WR envelope" or "genuine record breaks" filter — ALL
 *   records are record breaks. We trust the sheet order
 *   (oldest -> newest) as the authoritative chronological order.
 *
 * Snipe = first-ever record in a category, OR taking the WR from
 * a DIFFERENT player (improving your own record is not a snipe).
 * ============================================================ */
(function () {
  'use strict';

  var WR = (window.WR = window.WR || {});

  /* ---------- Data ---------- */
  var DATA = null;
  var CATEGORIES = [];
  var CAT_BY_ID = {};
  var DAY = 86400;
  var NOW = Date.now() / 1000;

  /* ---------- Time-travel cutoff ----------
   * "Teleport back in time" feature: when set (a unix-seconds timestamp),
   * ALL record-filtering functions exclude records dated AFTER this moment.
   * This lets the user view the leaderboard / stats / charts "as of" a past
   * date — e.g. see who held the 3x3 ao5 WR in March 2021, what the player
   * leaderboard looked like at end of 2020, etc.
   *
   * null  = live (no cutoff, show everything up to today)
   * number = only show records with dateSortKey <= cutoff
   *
   * The cutoff is applied at the lowest level (filterRecords / filterCats) so
   * every downstream computation (snipes, reigns, leaderboards, charts, nemesis
   * matrix, heatmaps, current-WRs-held, global stats) automatically reflects
   * the time-traveled state — no need to thread the parameter through every
   * function. User: "teleport back in time of the leaderboard (or select
   * precise date with the calendar) to see leaderboard and all stats/players
   * etc. as it was for example 2021 and not 2026".
   */
  var TIME_CUTOFF = null;

  /* ---------- Tier palette (from openslidy) ----------
   * 10 tiers. Used for player colors and rank badges.
   * alpha (best) -> kappa (worst).
   */
  var TIER_COLORS = {
    alpha: '#00ffff',
    beta: '#00ff00',
    gamma: '#ff2262',
    delta: '#a14dff',
    epsilon: '#ffff00',
    zeta: '#ffaaf4',
    eta: '#85fa85',
    theta: '#b9f2ff',
    iota: '#23958b',
    kappa: '#afafaf',
  };
  var TIER_ORDER = ['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','iota','kappa'];

  // Assign a stable color to each player based on their overall record count rank.
  // Top 10 players get tier colors; 11th+ players get distinct SHADES OF GRAY
  // (user request: avoid random colors for >10 players since we only have 11).
  // Per-platform player color maps: PLAYER_COLORS[platform][name] = color
  var PLAYER_COLORS = {};
  var _colorPlatform = 'exe';
  // Gray shades for players ranked 11+ — progressively darker.
  var EXTRA_GRAYS = ['#c8c8c8', '#a0a0a0', '#787878', '#5a5a5a', '#909090', '#b0b0b0'];
  function assignPlayerColors(platform) {
    var stats = getGlobalStats(platform);
    var players = stats.players;
    PLAYER_COLORS[platform] = PLAYER_COLORS[platform] || {};
    var map = PLAYER_COLORS[platform];
    var entries = Object.entries(players);
    entries.sort(function(a,b){ return b[1]-a[1]; });
    entries.forEach(function(e, i) {
      if (i < TIER_ORDER.length) {
        map[e[0]] = TIER_COLORS[TIER_ORDER[i]];
      } else {
        var idx = i - TIER_ORDER.length;
        map[e[0]] = EXTRA_GRAYS[idx % EXTRA_GRAYS.length];
      }
    });
  }
  function refreshPlayerColors(platform) {
    _colorPlatform = platform;
    PLAYER_COLORS[platform] = {};
    assignPlayerColors(platform);
  }
  function playerColor(name) {
    var map = PLAYER_COLORS[_colorPlatform];
    if (!map) return '#888';
    return map[name] || '#888';
  }

  /* ---------- Date interpolation for unknown dates ---------- */
  function interpolateDates(recs) {
    if (!recs.length) return;
    var lastKnown = 0;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].dateSortKey > 0) {
        lastKnown = recs[i].dateSortKey;
      } else if (lastKnown > 0) {
        recs[i].dateSortKeyEst = lastKnown + DAY;
      }
    }
    var nextKnown = 0;
    for (var j = recs.length - 1; j >= 0; j--) {
      if (recs[j].dateSortKey > 0) {
        nextKnown = recs[j].dateSortKey;
      } else if (nextKnown > 0) {
        var est = nextKnown - DAY;
        if (!recs[j].dateSortKeyEst || recs[j].dateSortKeyEst > nextKnown) {
          recs[j].dateSortKeyEst = est;
        }
      }
    }
    recs.forEach(function (r) {
      if ((!r.dateSortKey || r.dateSortKey === 0) && r.dateSortKeyEst) {
        r.dateSortKey = r.dateSortKeyEst;
      }
    });
    var counter = 0;
    recs.forEach(function (r) {
      if (!r.dateSortKey || r.dateSortKey === 0) {
        counter++;
        r.dateSortKey = counter * DAY;
      }
    });
  }

  /* ---------- Data loading ----------
   * Primary (and only): window.WR_DATA, set by data/wr-data.js script tag
   * in index.html. We removed the JSON fallback to avoid keeping a 4MB
   * duplicate file in the repo. If the script tag fails to load, the user
   * sees the loading state and a retry button (handled by app.js init).
   */
  function loadData() {
    var orig = window._WR_ORIG || window.WR_DATA;
    var lmData = window._WR_LM;
    if (!orig) {
      throw new Error('WR_DATA not loaded — check that data/wr-data.js is reachable');
    }
    // Clone orig so we don't mutate the saved original.
    var merged = JSON.parse(JSON.stringify(orig));
    if (lmData && lmData.categories) {
      var catMap = {};
      (merged.categories || []).forEach(function (c) { catMap[c.id] = c; });
      lmData.categories.forEach(function (lc) {
        if (catMap[lc.id]) {
          // Append LM records to existing category (records already tagged platform:"lm")
          catMap[lc.id].records = catMap[lc.id].records.concat(lc.records);
        } else {
          // New category from LM data only
          merged.categories.push(JSON.parse(JSON.stringify(lc)));
        }
      });
      // Merge dateRange from LM data so the time slider covers LM dates
      if (lmData.meta && lmData.meta.dateRange && merged.meta && merged.meta.dateRange) {
        if (lmData.meta.dateRange.min < merged.meta.dateRange.min) {
          merged.meta.dateRange.min = lmData.meta.dateRange.min;
        }
        if (lmData.meta.dateRange.max > merged.meta.dateRange.max) {
          merged.meta.dateRange.max = lmData.meta.dateRange.max;
        }
      }
    }
    return processData(merged);
  }

  function processData(data) {
    DATA = data;
    CATEGORIES = (DATA.categories || []).filter(function (c) {
      return c && c.records && c.records.length > 0;
    });
    CAT_BY_ID = {};
    CATEGORIES.forEach(function (c) {
      CAT_BY_ID[c.id] = c;
      c.records.forEach(function (r) {
        // Defensive: catch Excel-serial-format dates (e.g. "44963.0") that
        // may slip through if the source spreadsheet gets re-exported with
        // mixed date formats. Convert to ISO date on load.
        // User: "Some categories have broken dates due to partially corrupted
        // Excel format data ... numbers like 44963.0 which is not a date, but
        // excel style format of some sort".
        normalizeExcelDate(r);
        if (r.dateSortKey == null) r.dateSortKey = 0;
        r._catId = c.id;
        r._catName = c.name;
      });
      interpolateDates(c.records);
    });
    return DATA;
  }

  /* Detect Excel-serial-format dates (e.g. "44963.0") and convert them
   * to proper ISO dates. Excel 1900-system: serial 25569 = 1970-01-01.
   * Only triggers for 4-5 digit numbers in the plausible range (2010..2030).
   * Idempotent: skips records that already have a valid dateIso.
   */
  function normalizeExcelDate(r) {
    if (!r) return;
    // Already has a valid ISO date — skip.
    if (r.dateIso && /^\d{4}-\d{2}-\d{2}$/.test(r.dateIso)) return;
    var raw = r.dateRaw;
    if (!raw) return;
    var m = /^(\d{4,5})(?:\.\d+)?$/.exec(raw);
    if (!m) return;
    var serial = parseInt(m[1], 10);
    if (!(serial >= 40000 && serial <= 50000)) return;
    var ts = (serial - 25569) * 86400;
    var d = new Date(ts * 1000);
    var iso = d.toISOString().slice(0, 10);
    var parts = iso.split('-');
    var disp = parts[2] + '.' + parts[1] + '.' + parts[0];
    r.dateRaw = disp;
    r.dateType = 'exact';
    r.dateIso = iso;
    r.dateDisplay = disp;
    r.dateSortKey = ts;
    r.dayUnknown = false;
  }

  function getData() { return DATA; }
  function getCategories() { return CATEGORIES; }
  function getCategory(id) { return CAT_BY_ID[id] || null; }

  /* ---------- Platform filter ----------
   * Each record carries its own `platform` tag ("exe" or "web"), set by
   * fetch.py. A category may have records from BOTH platforms (e.g. 3x3 ao12
   * has 21 exe + 2 web records). filterCats returns categories that have at
   * least one record of the requested platform; filterRecords returns just
   * those records.
   *
   * "both" view = the COMBINED WORLD RECORD timeline. The two platforms keep
   * independent record histories in the raw data (cat.records is NEVER
   * mutated), but the "both" VIEW merges them into a single lower-envelope
   * frontier: only records that were the BEST (lowest) combined time at the
   * moment they were set are shown. A record that improved its own platform's
   * WR but was slower than the other platform's current WR is NOT a combined
   * world record and is excluded from this view.
   *
   * User: "it appears that record got worse (0.736) entry, but it's just exe
   * record, which was better compared to exe (0.745s), but not better than
   * web record (0.731s)... should be removed exe 0.736s entry, because it's
   * not the actual combined record. However, be careful, as it might just
   * happened that exe record IS actually saving time over some web record at
   * the moment in time."
   *
   * Example (3x3 ao100, both view, date-ascending):
   *   0.745 exe  ← first valid, best=0.745, INCLUDE
   *   0.731 web  ← 0.731 < 0.745, best=0.731, INCLUDE
   *   0.736 exe  ← 0.736 < 0.731? NO → EXCLUDE (never the combined WR)
   *   0.715 web  ← 0.715 < 0.731, best=0.715, INCLUDE
   *   0.707 web  ← 0.707 < 0.715, best=0.707, INCLUDE
   * If an exe 0.700 later appeared it WOULD be included (0.700 < 0.731) —
   * the frontier correctly keeps cross-platform improvements.
   */
  function filterCats(platform) {
    // Time-travel cutoff: a category is included only if it has at least one
    // record matching the platform AND within the time window. A category
    // first played in 2023 is invisible when viewing 2020 — exactly what
    // "as of <date>" means.
    var hasCutoff = TIME_CUTOFF != null;
    if (platform === 'both' || platform === 'combined') {
      return CATEGORIES.filter(function (c) {
        return c.records.some(function (r) {
          if (platform === 'both' && (r.platform || 'exe') === 'lm') return false;
          if (hasCutoff && (r.dateSortKey || 0) > TIME_CUTOFF) return false;
          return true;
        });
      });
    }
    return CATEGORIES.filter(function (c) {
      return c.records.some(function (r) {
        if ((r.platform || 'exe') !== platform) return false;
        if (hasCutoff && (r.dateSortKey || 0) > TIME_CUTOFF) return false;
        return true;
      });
    });
  }
  function filterRecords(cat, platform) {
    var hasCutoff = TIME_CUTOFF != null;
    if (platform === 'both' || platform === 'combined') {
      // Lower-envelope (combined WR frontier). Sort by date ascending, walk
      // through keeping a running minimum time, include a record only if its
      // time is strictly less than the running minimum. Stable sort preserves
      // sheet-internal order for same-day records. Null-time records skipped.
      //
      // Time-travel: the cutoff is applied BEFORE the frontier computation, so
      // the frontier is built only from records that existed at/before the
      // cutoff moment. A record set after the cutoff is invisible — the user
      // sees the combined-WR history exactly as it stood on that date.
      var all = cat.records.slice();
      if (platform === 'both') {
        // "both" excludes LM records (only exe+web frontier)
        all = all.filter(function (r) { return (r.platform || 'exe') !== 'lm'; });
      }
      if (hasCutoff) {
        all = all.filter(function (r) { return (r.dateSortKey || 0) <= TIME_CUTOFF; });
      }
      all.sort(function (a, b) { return (a.dateSortKey || 0) - (b.dateSortKey || 0); });
      var frontier = [];
      var best = Infinity;
      for (var i = 0; i < all.length; i++) {
        var r = all[i];
        if (r.time == null) continue;
        if (r.time < best) {
          frontier.push(r);
          best = r.time;
        }
      }
      return frontier;
    }
    var recs = cat.records.filter(function (r) {
      if ((r.platform || 'exe') !== platform) return false;
      if (hasCutoff && (r.dateSortKey || 0) > TIME_CUTOFF) return false;
      return true;
    });
    return recs;
  }

  /* ---------- Defensive formatting ---------- */
  function fmt(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback || '—';
    return String(v);
  }

  // Time formatting — ALWAYS 3 decimal digits.
  // FIX: use Math.round on the fractional milliseconds to avoid floating
  // point representation errors (e.g. 72.059 stored as 72.05899999999999
  // was rendering as "1:12.058" instead of "1:12.059").
  function fmtTime(t) {
    if (t === null || t === undefined || t === '' || isNaN(t)) return '—';
    var n = Number(t);
    if (n < 60) return n.toFixed(3) + 's';
    var totalSec = Math.floor(n);
    // Round fractional seconds to 3 decimal places (ms precision).
    var ms = Math.round((n - totalSec) * 1000);
    // Handle carry-over when rounding pushes ms to 1000.
    if (ms >= 1000) { ms -= 1000; totalSec += 1; }
    var frac3 = '.' + String(ms).padStart(3, '0');
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s) + frac3;
    return m + ':' + pad2(s) + frac3;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // Movecount: integers show without decimals ("1202"), floats show 3 decimals ("102.100").
  // User: "often moves are integer but displayed as 1202.000, all .000 should be removed
  // (but floating numbers like 102.100 should keep 3 digits)".
  function fmtMovecount(mv, isSingle) {
    if (mv === null || mv === undefined || mv === '' || isNaN(mv)) return '—';
    var n = Number(mv);
    // Integer check (also handles the isSingle case — singles are always integers).
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(3);
  }
  // TPS: 3 decimal digits for full accuracy.
  function fmtTps(tps) {
    if (tps === null || tps === undefined || tps === '' || isNaN(tps)) return '—';
    return Number(tps).toFixed(3);
  }

  // Format a time delta (current - previous). Negative = improvement.
  // Returns { text, cls } where cls is 'improve' | 'tie' | 'worse' | 'first'.
  function fmtDelta(currTime, prevTime) {
    if (currTime == null || prevTime == null) return { text: '—', cls: 'first' };
    var d = currTime - prevTime;
    if (d < 0) {
      // Improvement — show how much faster (positive number)
      var abs = -d;
      var txt;
      if (abs < 60) txt = '-' + abs.toFixed(3) + 's';
      else if (abs < 3600) txt = '-' + Math.floor(abs/60) + ':' + pad2(Math.round(abs%60)) + 's';
      else txt = '-' + Math.floor(abs/3600) + 'h' + Math.round((abs%3600)/60) + 'm';
      return { text: txt, cls: 'improve' };
    } else if (d === 0) {
      return { text: '±0.000s', cls: 'tie' };
    } else {
      // Shouldn't happen (all records are WRs so time must decrease),
      // but handle gracefully.
      return { text: '+' + d.toFixed(3) + 's', cls: 'worse' };
    }
  }

  // Format an improvement percentage (vs previous record).
  function fmtDeltaPct(currTime, prevTime) {
    if (currTime == null || prevTime == null || prevTime === 0) return '—';
    var pct = ((prevTime - currTime) / prevTime) * 100;
    if (pct < 0) return '+' + Math.abs(pct).toFixed(1) + '%';
    return '-' + pct.toFixed(1) + '%';
  }

  function fmtDate(r) {
    if (!r) return '—';
    var disp = r.dateDisplay;
    if (!disp || disp === '???' || disp === '') return 'date unknown';
    return disp;
  }

  function fmtDateShort(r) {
    if (!r || !r.dateIso) return '?';
    var iso = r.dateIso;
    var parts = iso.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (parts.length >= 2) {
      var yr = parts[0];
      var mo = parseInt(parts[1], 10);
      if (mo >= 1 && mo <= 12) return months[mo - 1] + ' ' + yr;
      return yr;
    }
    return parts[0] || '?';
  }

  function fmtPct(frac, digits) {
    if (frac === null || frac === undefined || isNaN(frac)) return '—';
    var d = digits == null ? 1 : digits;
    return (frac * 100).toFixed(d) + '%';
  }
  function fmtInt(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return String(Math.round(v));
  }
  function fmtNum(v, digits) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    return Number(v).toFixed(digits == null ? 2 : digits);
  }
  // Duration formatting — DAYS-ONLY integers (user request).
  // Was previously "1.5y / 1.5mo" which was incomprehensible.
  // Now: always show an integer number of days (e.g. "547d").
  // For very large values, also append the equivalent years for context.
  function fmtDuration(days) {
    if (days == null || isNaN(days)) return '—';
    var d = Math.round(days);
    if (d < 1) return '<1d';
    if (d < 365) return d + 'd';
    // For long durations, show days + (years) for context — both integers.
    var yrs = Math.floor(d / 365);
    var rem = d - yrs * 365;
    if (rem === 0) return d + 'd (' + yrs + 'y)';
    return d + 'd (' + yrs + 'y ' + rem + 'd)';
  }

  /* ---------- Category-aware stats ----------
   * ALL records are WRs. Every record is a record break.
   * Snipe = first-ever OR beats a different player.
   * Reign = period a player held the WR (from their record until next record).
   */

  // Current WR = last record in the category (sheet is oldest->newest).
  function getCurrentWR(cat, platform) {
    var recs = filterRecords(cat, platform);
    if (!recs.length) return null;
    return recs[recs.length - 1];
  }

  // Snipes: iterate records in order. First record = snipe (first-ever).
  // Subsequent: snipe if player differs from previous record's player.
  function computeSnipes(recs) {
    var snipes = [];
    var prevPlayer = null;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.time == null) continue;
      if (prevPlayer === null) {
        snipes.push({ rec: r, sniper: r.player, victim: null, first: true, idx: i });
      } else if (r.player !== prevPlayer) {
        snipes.push({ rec: r, sniper: r.player, victim: prevPlayer, first: false, idx: i });
      }
      prevPlayer = r.player;
    }
    return snipes;
  }

  // Reigns: each record starts a reign lasting until the next record (or now).
  // Time-travel: when a cutoff is set, the "current" (last) reign ends at the
  // cutoff moment, not at actual NOW — because at the cutoff date, that player
  // was still the holder and had been holding since their record date. Using
  // NOW would inflate the reign duration by the years between cutoff and today.
  function computeReigns(recs) {
    var reigns = [];
    var endTimeNow = TIME_CUTOFF != null ? TIME_CUTOFF : NOW;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      if (r.time == null) continue;
      var startTime = r.dateSortKey || 0;
      var endTime = (i < recs.length - 1) ? (recs[i+1].dateSortKey || startTime) : endTimeNow;
      reigns.push({
        player: r.player,
        record: r,
        startRec: r,
        endRec: recs[i+1] || null,
        startTime: startTime,
        endTime: endTime,
        bestTime: r.time,
        current: (i === recs.length - 1),
        idx: i,
      });
    }
    reigns.forEach(function (rg) {
      rg.durationDays = Math.max(0, Math.round((rg.endTime - rg.startTime) / 86400));
    });
    return reigns;
  }

  // Per-category stats.
  function getCategoryStats(cat, platform) {
    var recs = filterRecords(cat, platform);
    if (!recs.length) return emptyCatStats();

    var holders = {};
    var controls = {};
    recs.forEach(function (r) {
      holders[r.player] = (holders[r.player] || 0) + 1;
      var c = r.control || 'Unknown';
      controls[c] = (controls[c] || 0) + 1;
    });

    var snipes = computeSnipes(recs);
    var reigns = computeReigns(recs);
    var curr = getCurrentWR(cat, platform);
    var first = recs[0];

    return {
      recordCount: recs.length,
      holders: holders,
      controls: controls,
      snipes: snipes,
      reigns: reigns,
      currentWR: curr,
      firstRecord: first,
      holderCount: Object.keys(holders).length,
    };
  }

  function emptyCatStats() {
    return {
      recordCount: 0, holders: {}, controls: {}, snipes: [], reigns: [],
      currentWR: null, firstRecord: null, holderCount: 0,
    };
  }

  /* ---------- Cross-category stats ---------- */

  // Nemesis matrix: how many times A sniped B (across all categories).
  function getNemesisStats(platform) {
    var cats = filterCats(platform);
    var matrix = {}; // sniper -> victim -> count
    var snipeTotals = {}; // sniper -> total snipes
    var victimTotals = {}; // victim -> total times sniped
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      s.snipes.forEach(function (sn) {
        if (!sn.victim) return;
        if (!matrix[sn.sniper]) matrix[sn.sniper] = {};
        matrix[sn.sniper][sn.victim] = (matrix[sn.sniper][sn.victim] || 0) + 1;
        snipeTotals[sn.sniper] = (snipeTotals[sn.sniper] || 0) + 1;
        victimTotals[sn.victim] = (victimTotals[sn.victim] || 0) + 1;
      });
    });
    return { matrix: matrix, snipeTotals: snipeTotals, victimTotals: victimTotals };
  }

  // Per-player: total snipes across all categories.
  // A "snipe" = taking the WR from a DIFFERENT player, OR the first-ever
  // (first documented) record in a category. The count returned here is the
  // sum of both kinds (user clarification: first documented records ARE snipes).
  function getPlayerSnipes(name, platform) {
    var cats = filterCats(platform);
    var count = 0, details = [];
    var firstEverCount = 0;
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      s.snipes.forEach(function (sn) {
        if (sn.sniper === name) {
          count++;
          if (sn.first) firstEverCount++;
          details.push({ cat: c, snipe: sn });
        }
      });
    });
    return { count: count, details: details, firstEverCount: firstEverCount };
  }

  // Per-player: categories where they currently hold WR.
  function getCurrentWRsHeld(name, platform) {
    var cats = filterCats(platform);
    var count = 0, catsHeld = [];
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      if (s.currentWR && s.currentWR.player === name) {
        count++;
        catsHeld.push(c);
      }
    });
    return { count: count, categories: catsHeld };
  }

  // Per-player: categories where they held WR at some point (ever).
  function getRecordsEverHeld(name, platform) {
    var cats = filterCats(platform);
    var count = 0, catsHeld = [];
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      var held = s.reigns.some(function (rg) { return rg.player === name; });
      if (held) { count++; catsHeld.push(c); }
    });
    return { count: count, categories: catsHeld };
  }

  // Per-player: total records (all entries).
  function getPlayerRecords(name, platform) {
    var cats = filterCats(platform);
    var count = 0, details = [];
    cats.forEach(function (c) {
      var recs = filterRecords(c, platform);
      recs.forEach(function (r) {
        if (r.player === name) {
          count++;
          details.push({ cat: c, rec: r });
        }
      });
    });
    return { count: count, details: details };
  }

  /* ---------- Global stats ---------- */
  function getGlobalStats(platform) {
    var cats = filterCats(platform);
    var totalRecords = 0;
    var players = {};
    var controls = {};
    var totalSnipes = 0;
    var totalReplays = 0, totalVideos = 0, totalNotes = 0;
    var totalReigns = 0;
    var currentHolders = {};

    cats.forEach(function (c) {
      var recs = filterRecords(c, platform);
      totalRecords += recs.length;
      recs.forEach(function (r) {
        players[r.player] = (players[r.player] || 0) + 1;
        var ctl = r.control || 'Unknown';
        controls[ctl] = (controls[ctl] || 0) + 1;
        if (r.hasReplay) totalReplays++;
        if (r.hasVideo) totalVideos++;
        if (r.notes) totalNotes++;
      });
      var s = getCategoryStats(c, platform);
      totalSnipes += s.snipes.length;
      totalReigns += s.reigns.length;
      if (s.currentWR) currentHolders[s.currentWR.player] = (currentHolders[s.currentWR.player] || 0) + 1;
    });

    return {
      totalCategories: cats.length,
      totalRecords: totalRecords,
      totalPlayers: Object.keys(players).length,
      totalSnipes: totalSnipes,
      totalReigns: totalReigns,
      totalReplays: totalReplays,
      totalVideos: totalVideos,
      totalNotes: totalNotes,
      players: players,
      controls: controls,
      currentHolders: currentHolders,
    };
  }

  // All players with aggregated stats for the player leaderboard.
  // NOTE: 'recordsEverHeld' and 'totalRecords' are the SAME stat (every record
  // a player has IS a reign they held). We keep only one ('recordsEverHeld')
  // per user request. 'firstEver' removed per user request.
  function getPlayerLeaderboard(platform) {
    var cats = filterCats(platform);
    var pb = {}; // name -> stats

    function ensure(name) {
      if (!pb[name]) pb[name] = {
        name: name,
        recordsEverHeld: 0,   // = total records (every record IS a reign)
        currentWRs: 0,
        snipes: 0,
        categories: 0,
      };
      return pb[name];
    }

    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      var seenPlayers = {};
      s.reigns.forEach(function (rg) {
        var p = ensure(rg.player);
        p.recordsEverHeld++;
        seenPlayers[rg.player] = true;
      });
      Object.keys(seenPlayers).forEach(function (name) { ensure(name).categories++; });

      s.snipes.forEach(function (sn) {
        var p = ensure(sn.sniper);
        p.snipes++;
      });

      if (s.currentWR) ensure(s.currentWR.player).currentWRs++;
    });

    // Default sort: by snipes (per user request)
    return Object.values(pb).sort(function (a, b) {
      return b.snipes - a.snipes || b.currentWRs - a.currentWRs || b.recordsEverHeld - a.recordsEverHeld;
    });
  }

  /* ---------- Records velocity (records per year) ---------- */
  function getRecordsByYear(platform) {
    var cats = filterCats(platform);
    var years = {};
    cats.forEach(function (c) {
      filterRecords(c, platform).forEach(function (r) {
        if (!r.dateIso) return;
        var yr = r.dateIso.slice(0, 4);
        if (yr.length !== 4) return;
        years[yr] = (years[yr] || 0) + 1;
      });
    });
    return Object.keys(years).sort().map(function (yr) {
      return { year: yr, count: years[yr] };
    });
  }

  // Snipes per year — for the velocity "rival" toggle.
  // A snipe = first-ever record OR taking WR from a different player.
  function getSnipesByYear(platform) {
    var cats = filterCats(platform);
    var years = {};
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      s.snipes.forEach(function (sn) {
        var r = sn.rec;
        if (!r.dateIso) return;
        var yr = r.dateIso.slice(0, 4);
        if (yr.length !== 4) return;
        years[yr] = (years[yr] || 0) + 1;
      });
    });
    return Object.keys(years).sort().map(function (yr) {
      return { year: yr, count: years[yr] };
    });
  }

  // Per-player "was sniped" events — when someone took this player's WR.
  // Returns details [{ cat, rec, sniper }]
  function getPlayerWasSniped(name, platform) {
    var cats = filterCats(platform);
    var details = [];
    cats.forEach(function (c) {
      var s = getCategoryStats(c, platform);
      s.snipes.forEach(function (sn) {
        if (sn.victim === name) {
          details.push({ cat: c, rec: sn.rec, sniper: sn.sniper, first: false });
        }
      });
    });
    return { count: details.length, details: details };
  }

  /* ---------- Player self-improvements ----------
   * Records where the player improved their OWN previous WR in a category
   * (i.e. prevPlayer === name). These are NOT snipes (no rival was overtaken)
   * and NOT losses (the player still holds the record). They are a distinct
   * "improved" event type for the unified Record History timeline.
   *
   * User: "This timeline now also includes moments when player improved his
   * own record, colored with some 3rd color. So win - lost - improved.
   * counter icon (21 -> 20 / 20 -> 21) does not change when record is
   * improved (just shows one number '20')".
   *
   * Returns details [{ cat, rec, prev }] — the NEW (improving) record plus a
   * reference to the previous record by the same player (for delta display).
   */
  function getPlayerImprovements(name, platform) {
    var cats = filterCats(platform);
    var details = [];
    cats.forEach(function (c) {
      var recs = filterRecords(c, platform);
      for (var i = 1; i < recs.length; i++) {
        var r = recs[i];
        var prev = recs[i - 1];
        if (r.time == null) continue;
        // Improvement: same player beat their own previous record.
        if (r.player === name && prev.player === name) {
          details.push({ cat: c, rec: r, prev: prev });
        }
      }
    });
    return { count: details.length, details: details };
  }

  /* (Removed: Longest Active Reign / Biggest Snipe / Notable Records — user requested deletion.) */

  /* ---------- URL state ---------- */
  function getHashParams() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('?');
    var route = parts[0] || 'overview';
    var params = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (kv) {
        var p = kv.split('=');
        params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
    }
    return { route: route, params: params };
  }
  function setHash(route, params) {
    var h = '#' + route;
    if (params) {
      var qs = Object.keys(params).filter(function(k){ return params[k] != null && params[k] !== ''; })
        .map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
        .join('&');
      if (qs) h += '?' + qs;
    }
    if (location.hash !== h) location.hash = h;
  }

  /* ---------- YouTube helpers ---------- */
  function youtubeId(url) {
    if (!url) return null;
    var m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  function youtubeThumb(url) {
    var id = youtubeId(url);
    return id ? 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg' : null;
  }
  function youtubeEmbed(url) {
    var id = youtubeId(url);
    return id ? 'https://www.youtube.com/embed/' + id : null;
  }

  /* ---------- Category group/size helpers ---------- */
  function eventGroupLabel(g) {
    if (!g) return '';
    if (g === 'multi') return 'Marathon';
    return g.charAt(0).toUpperCase() + g.slice(1);
  }
  function isSingle(cat) {
    return cat.eventType === 'single';
  }

  /* ---------- Replay link classification ----------
   * Actual replays: slidysim.github.io, raw.githubusercontent.com
   * Data/Info (NOT replays): pastebin.com, imgur.com, reddit.com, dphdmn.github.io
   * User: "pastebin links are not actually replays, they are Data or Info"
   */
  function replayLinkType(url) {
    if (!url) return 'none';
    var u = url.toLowerCase();
    if (u.indexOf('slidysim.github.io') >= 0 || u.indexOf('raw.githubusercontent.com') >= 0) return 'replay';
    if (u.indexOf('pastebin.com') >= 0) return 'data';
    if (u.indexOf('imgur.com') >= 0) return 'info';
    if (u.indexOf('reddit.com') >= 0) return 'info';
    if (u.indexOf('dphdmn.github.io') >= 0) return 'info';
    return 'info'; // default for unknown external links
  }

  /* ---------- Solve-data as note ----------
   * solveData field can be either:
   *   - comma-separated solve times (e.g. "(1.843), (0.694), 0.780, 0.744, 0.898")
   *     → preserve as a "Solve Data" note (user request)
   *   - a URL (reddit/pastebin) → external evidence link, NOT a note
   *   - "In replay" / "???" / empty → placeholder, NOT a note
   * Returns the solve-times string if it's real data, or null otherwise.
   */
  function solveDataAsNote(solveData) {
    if (!solveData || !solveData.trim()) return null;
    var s = solveData.trim();
    if (s.toLowerCase().indexOf('http') === 0) return null; // URL, not data
    if (s === '???' || s === '?') return null; // placeholder
    var lower = s.toLowerCase();
    if (lower === 'in replay' || lower === 'in replay.' || lower.indexOf('in replay') === 0 && lower.length < 15) return null;
    // Must contain a digit to be considered real solve data
    if (!/\d/.test(s)) return null;
    return s;
  }

  /* ---------- Control / Style classification ----------
   * Control: Tablet (drawing tablet), Mouse, Keyboard — only 3 types.
   * Style: Fringe, LBL, or Grids (any "*Grids*" or "*x* Grids") — only 3 types.
   */
  function controlClass(c) {
    if (!c) return 'unknown';
    var v = String(c).toLowerCase();
    if (v.indexOf('tablet') >= 0) return 'tablet';
    if (v.indexOf('mouse') >= 0) return 'mouse';
    if (v.indexOf('keyboard') >= 0) return 'keyboard';
    return 'unknown';
  }
  function styleClass(s) {
    if (!s) return 'unknown';
    var v = String(s).toLowerCase();
    if (v.indexOf('fringe') >= 0) return 'fringe';
    if (v.indexOf('lbl') >= 0) return 'lbl';
    if (v.indexOf('grid') >= 0) return 'grids';
    return 'unknown';
  }

  // Extract the primary dimension (e.g. "5x10") from a grids-style label.
  // Used to give slightly different color shades to different grid dimensions.
  // User: "Different Grids styles (5x10 vs 10x5 etc) should have slightly different colors".
  function gridsDimension(s) {
    if (!s) return '';
    var m = String(s).match(/(\d+)x(\d+)/);
    return m ? m[1] + 'x' + m[2] : '';
  }
  // Stable hue offset (0-360) for a dimension string, used to tint the base
  // olive color. Keeps all grids variants visually green-ish but distinguishable.
  function gridsHueOffset(dim) {
    if (!dim) return 0;
    var parts = dim.split('x');
    var a = parseInt(parts[0]) || 0, b = parseInt(parts[1]) || 0;
    // Map (a*b) and ratio to a small hue range ±25° around olive (75°).
    var sum = a + b;
    var ratio = a / (b || 1);
    // Use ratio to spread hues; clamp to [-25, 25].
    var off = Math.round((Math.log(ratio) / Math.log(2)) * 12);
    if (off > 25) off = 25;
    if (off < -25) off = -25;
    return off;
  }

  /* ---------- HTML escape ---------- */
  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------- CSV escape + download ---------- */
  function csvField(v) {
    if (v == null) return '';
    var s = String(v);
    // Quote if contains comma, quote, newline
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function downloadCsv(filename, rows) {
    var csv = rows.map(function (r) { return r.map(csvField).join(','); }).join('\r\n');
    // BOM for Excel UTF-8 detection
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Download a JSON file — for exporting the full WR dataset with all nested
   * fields (scrambles, solutions, notes, solve data) intact. User: "should
   * not be in csv format, it is broken, this tool uses xlsx, or json, idk,
   * something more complex, just give user full raw data, don't convert into
   * csv or something".
   */
  function downloadJson(filename, data) {
    var json = JSON.stringify(data, null, 2);
    var blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- Records-held-over-time ----------
   * For each player, computes the number of WRs they held at every moment
   * in time (across all categories). Returns a sorted list of change-events
   * plus the resulting step-function points for plotting.
   *
   * A player GAINS a record when they set a new WR (any record in any cat).
   * A player LOSES a record when someone else sets a new WR in a cat they
   * previously held (i.e. they were the previous-record player).
   *
   * IMPORTANT: snipe metadata (victim / sniper / firstEver) is stored ON THE
   * EVENT OBJECT, not on the shared record. Previous implementation mutated
   * `r._victim` / `r._sniper` / `r._firstEver` on the record itself, which
   * broke in Compare mode where the SAME record is a gain for one player and
   * a loss for another — whichever call ran last would overwrite the
   * annotations, so loss tooltips said nothing about who took the record.
   * User: "Compare page - lost records don't say who took the record when
   * player Lost, only the 'took from' is tracked".
   *
   * Each event has:
   *   ev.victim    — who the player took the WR from (for gains; null if first)
   *   ev.sniper    — who took the WR from this player (for losses)
   *   ev.firstEver — true if this was the first documented record in the cat
   *   ev.rec       — the record (unchanged, NOT mutated)
   *   ev.cat       — the category
   *   ev.kind      — 'gain' | 'loss'
   *   ev.delta     — +1 | -1
   *   ev.t         — timestamp
   *
   * Used by:
   *   - Player detail page: "Active records over time" chart.
   *   - Compare page: multi-player active-records comparison.
   */
  function getPlayerRecordsHeldOverTime(name, platform) {
    var cats = filterCats(platform);
    var events = [];
    cats.forEach(function (c) {
      var recs = filterRecords(c, platform);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r.dateSortKey || r.time == null) continue;
        var prevPlayer = i > 0 ? recs[i - 1].player : null;
        if (r.player === name && r.player !== prevPlayer) {
          // Gain: took the WR from someone else (or first-ever).
          // Store metadata on the EVENT, not on the shared record.
          events.push({
            t: r.dateSortKey, delta: +1, rec: r, cat: c, kind: 'gain',
            victim: prevPlayer,            // null when first-ever
            sniper: null,
            firstEver: (prevPlayer === null),
          });
        }
        if (i > 0 && prevPlayer === name && r.player !== name) {
          // Loss: someone else took the WR from this player.
          // The NEW record (r) was set by the sniper. Store metadata on event.
          events.push({
            t: r.dateSortKey, delta: -1, rec: r, cat: c, kind: 'loss',
            victim: null,
            sniper: r.player,              // the player who took the WR
            firstEver: false,
          });
        }
      }
    });
    events.sort(function (a, b) { return a.t - b.t; });
    // Build cumulative points: at each event, count changes by delta.
    // Same-day events (same timestamp) are grouped into ONE point, but we keep
    // the FULL list of events (`evs`) so the tooltip can show every gain AND
    // loss that happened that day. User: "when player gets +1 -1 in same day,
    // in that case it currently only shows metadata of one of the events ...
    // but no info about how he lost the record is added ... restructure this
    // tooltip to cover edge cases".
    var points = [];
    var running = 0;
    var i = 0;
    while (i < events.length) {
      var t = events[i].t;
      var netDelta = 0;
      var gainCount = 0, lossCount = 0;
      var evs = [];
      var sampleRec = null, sampleCat = null;
      while (i < events.length && events[i].t === t) {
        netDelta += events[i].delta;
        if (events[i].delta > 0) gainCount++; else lossCount++;
        evs.push(events[i]);
        if (!sampleRec) { sampleRec = events[i].rec; sampleCat = events[i].cat; }
        i++;
      }
      running += netDelta;
      points.push({ t: t, y: running, gainCount: gainCount, lossCount: lossCount, rec: sampleRec, cat: sampleCat, evs: evs });
    }
    return { events: events, points: points, current: points.length ? points[points.length - 1].y : 0 };
  }

  /* ---------- Total-records-over-time (cumulative, never decreases) ----------
   * "All Records" version of the chart: player never loses records in this
   * view. Each record a player has ever set adds +1, permanently.
   * User: "add a toggle to the graph to show All Records version of this
   * chart, so player never loses his wrs in this version, while other option
   * is current implementation of floating state of records".
   */
  function getPlayerTotalRecordsOverTime(name, platform) {
    var cats = filterCats(platform);
    var events = [];
    cats.forEach(function (c) {
      var recs = filterRecords(c, platform);
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (!r.dateSortKey || r.time == null) continue;
        if (r.player === name) {
          var prevPlayer = i > 0 ? recs[i - 1].player : null;
          // Metadata stored on the EVENT (not on the shared record) — same
          // fix as getPlayerRecordsHeldOverTime, so Compare mode works.
          // `improved` flag: true when the player beat their OWN previous
          // record (prevPlayer === name). In the "All Records" cumulative
          // view every record by the player counts as +1, but a self-
          // improvement is NOT a "took WR from [victim]" event — the tooltip
          // rephrases it to "Improved own record" (cyan) to match the Record
          // History timeline's "improved" event type.
          // User: "Player can 'Take' record from himself according to the
          // graph, fix it by rephrasing tooltip message to 'Improve record'
          // just like in Record History 'Improved' version events".
          events.push({
            t: r.dateSortKey, delta: +1, rec: r, cat: c, kind: 'gain',
            victim: prevPlayer,
            sniper: null,
            firstEver: (prevPlayer === null),
            improved: (prevPlayer === name),
          });
        }
      }
    });
    events.sort(function (a, b) { return a.t - b.t; });
    var points = [];
    var running = 0;
    var i = 0;
    while (i < events.length) {
      var t = events[i].t;
      var netDelta = 0;
      var gainCount = 0;
      var evs = [];
      var sampleRec = null, sampleCat = null;
      while (i < events.length && events[i].t === t) {
        netDelta += events[i].delta;
        gainCount++;
        evs.push(events[i]);
        if (!sampleRec) { sampleRec = events[i].rec; sampleCat = events[i].cat; }
        i++;
      }
      running += netDelta;
      points.push({ t: t, y: running, gainCount: gainCount, lossCount: 0, rec: sampleRec, cat: sampleCat, evs: evs });
    }
    return { events: events, points: points, current: points.length ? points[points.length - 1].y : 0 };
  }

  /* ---------- Time-travel cutoff (public API) ----------
   * setTimeCutoff(ts): set the cutoff (unix seconds). null/undefined = live.
   * getTimeCutoff(): returns current cutoff (null = live).
   * clearTimeCutoff(): shortcut for setTimeCutoff(null).
   * isTimeTravelling(): true when a cutoff is active.
   * getCutoffDateRange(): returns {min, max} timestamps for the slider bounds,
   *   derived from the data's dateRange meta (+ NOW as the live endpoint).
   */
  function setTimeCutoff(ts) {
    TIME_CUTOFF = (ts == null || isNaN(ts)) ? null : ts;
  }
  function getTimeCutoff() { return TIME_CUTOFF; }
  function clearTimeCutoff() { TIME_CUTOFF = null; }
  function isTimeTravelling() { return TIME_CUTOFF != null; }

  // The "effective now" for relative-time computations ("X days ago", "days
  // held"). When time-travelling, this is the cutoff moment — because at the
  // selected past date, "now" was the cutoff, not the real present day.
  // Using real NOW would inflate "days held" by the years between the cutoff
  // and today, which is wrong when viewing history "as of" a past date.
  // User: "'Days ago' counters are not fixed according to selected older date,
  // which covers 'Current WRs summary', and also current record block in
  // details, and other place relative days difference is mentioned".
  function getNow() {
    return TIME_CUTOFF != null ? TIME_CUTOFF : NOW;
  }

  // Slider bounds: from the earliest record date to max(NOW, latest record).
  // The rightmost slider position = "live" (no cutoff). If NOW is somehow
  // before the latest record (clock skew), fall back to the latest record so
  // the live position always includes every record.
  function getCutoffDateRange() {
    var meta = DATA && DATA.meta && DATA.meta.dateRange ? DATA.meta.dateRange : {};
    var minTs = meta.min ? Math.floor(Date.parse(meta.min + 'T00:00:00Z') / 1000) : 0;
    var maxTs = meta.max ? Math.floor(Date.parse(meta.max + 'T00:00:00Z') / 1000) : NOW;
    var liveTs = Math.max(NOW, maxTs);
    return { min: minTs, max: maxTs, live: liveTs };
  }

  /* ---------- Exports ---------- */
  WR.loadData = loadData;
  WR.esc = esc;
  WR.csvField = csvField;
  WR.downloadCsv = downloadCsv;
  WR.downloadJson = downloadJson;
  WR.getData = getData;
  WR.getCategories = getCategories;
  WR.getCategory = getCategory;
  WR.filterCats = filterCats;
  WR.filterRecords = filterRecords;
  WR.setTimeCutoff = setTimeCutoff;
  WR.getTimeCutoff = getTimeCutoff;
  WR.clearTimeCutoff = clearTimeCutoff;
  WR.isTimeTravelling = isTimeTravelling;
  WR.getNow = getNow;
  WR.getCutoffDateRange = getCutoffDateRange;
  WR.playerColor = playerColor;
  WR.refreshPlayerColors = refreshPlayerColors;
  WR.TIER_COLORS = TIER_COLORS;
  WR.TIER_ORDER = TIER_ORDER;

  WR.fmt = fmt;
  WR.fmtTime = fmtTime;
  WR.fmtMovecount = fmtMovecount;
  WR.fmtDelta = fmtDelta;
  WR.fmtDeltaPct = fmtDeltaPct;
  WR.fmtDate = fmtDate;
  WR.fmtDateShort = fmtDateShort;
  WR.fmtPct = fmtPct;
  WR.fmtInt = fmtInt;
  WR.fmtNum = fmtNum;
  WR.fmtDuration = fmtDuration;

  WR.getCurrentWR = getCurrentWR;
  WR.computeSnipes = computeSnipes;
  WR.computeReigns = computeReigns;
  WR.getCategoryStats = getCategoryStats;
  WR.getNemesisStats = getNemesisStats;
  WR.getPlayerSnipes = getPlayerSnipes;
  WR.getCurrentWRsHeld = getCurrentWRsHeld;
  WR.getRecordsEverHeld = getRecordsEverHeld;
  WR.getPlayerRecords = getPlayerRecords;
  WR.getGlobalStats = getGlobalStats;
  WR.getPlayerLeaderboard = getPlayerLeaderboard;
  WR.getRecordsByYear = getRecordsByYear;
  WR.getSnipesByYear = getSnipesByYear;
  WR.getPlayerWasSniped = getPlayerWasSniped;
  WR.getPlayerImprovements = getPlayerImprovements;
  WR.getPlayerRecordsHeldOverTime = getPlayerRecordsHeldOverTime;
  WR.getPlayerTotalRecordsOverTime = getPlayerTotalRecordsOverTime;
  WR.gridsDimension = gridsDimension;
  WR.gridsHueOffset = gridsHueOffset;
  WR.fmtTps = fmtTps;
  WR.isSingle = isSingle;
  WR.eventGroupLabel = eventGroupLabel;

  WR.replayLinkType = replayLinkType;
  WR.solveDataAsNote = solveDataAsNote;
  WR.controlClass = controlClass;
  WR.styleClass = styleClass;

  WR.youtubeId = youtubeId;
  WR.youtubeThumb = youtubeThumb;
  WR.youtubeEmbed = youtubeEmbed;

  WR.getHashParams = getHashParams;
  WR.setHash = setHash;
})();
