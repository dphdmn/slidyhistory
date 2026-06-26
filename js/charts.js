/* ============================================================
 * Slidysim WR History Browser — charts.js
 * Interactive SVG charts with openslidy-inspired styling.
 * - Round, sensible time scales (2.0, 2.1, ... 3.0 not 2,5,7,10)
 * - Tier color palette for players/categories
 * - Tooltips, hover dots, clickable points
 * - Timeline flowchart for "who held the record"
 * ============================================================ */
(function () {
  'use strict';

  var WR = (window.WR = window.WR || {});
  var U = WR;

  /* ---------- Responsive layout helpers ----------
   * Charts compute their viewBox from container.clientWidth at render time.
   * On narrow screens (mobile, or desktop after zoom-in) the fixed margins
   * and tick counts designed for ~1200px charts eat up so much space that
   * the plot area becomes tiny and X-axis labels collapse.
   *
   * These helpers return width-aware margins / tick targets so text stays
   * readable at any width. Combined with the debounced resize re-render in
   * app.js, this fixes: "X axis of pretty much all graphs get collapsed and
   * broken" and "Some long charts appear extremely tiny, or squished".
   */
  function isNarrow(W) { return W < 560; }
  function isVeryNarrow(W) { return W < 400; }
  // Line / progression chart margins — slimmer left axis on narrow screens.
  function lineMargins(W) {
    if (isVeryNarrow(W)) return { top: 20, right: 12, bottom: 34, left: 46 };
    if (isNarrow(W))     return { top: 22, right: 16, bottom: 34, left: 52 };
    return { top: 24, right: 20, bottom: 36, left: 64 };
  }
  // How many year ticks to aim for on the X axis. On a 320px chart, 12 ticks
  // would cram "2013".."2026" into ~24px each (overlap). Reduce to ~6 on
  // narrow so each label gets ~50px.
  function yearTickTarget(W) {
    if (isVeryNarrow(W)) return 5;
    if (isNarrow(W))     return 7;
    return 12;
  }
  // Active-records chart: on narrow screens the legend should live BELOW the
  // chart (right margin 20) instead of eating 140px on the right.
  function activeRecordsMargins(W, singlePlayer) {
    if (singlePlayer) return { top: 20, right: 20, bottom: 34, left: isNarrow(W) ? 44 : 60 };
    if (isNarrow(W))   return { top: 20, right: 20, bottom: 34, left: isNarrow(W) ? 44 : 60 };
    return { top: 20, right: 140, bottom: 36, left: 60 };
  }
  // Reign timeline left margin (player name column). 130px is fine on desktop
  // but eats nearly half a 320px chart. Shrink on narrow.
  function reignMargins(W) {
    var left = isVeryNarrow(W) ? 74 : isNarrow(W) ? 92 : 130;
    return { top: 24, right: 20, bottom: 34, left: left };
  }

  /* Touch-friendly + / − zoom buttons + ◀ ▶ pan buttons. The scrollwheel zoom
   * is invisible to touch users; the preset buttons (1y/3y/5y/All) only offer
   * discrete jumps. These buttons give incremental zoom-in / zoom-out AND
   * panning left/right so a zoomed-in view can be moved around the chart.
   * User: "there are no panning left and right options, so it just zooms
   * somewhere in center and that's it, not very useful without panning".
   * User: "make sure that + - buttons are displayed on one separate line,
   * currently on some screens - stays on top line while + is on lower line".
   *
   * Layout: all 4 buttons live inside a .zoom-touch-group flex row with
   * flex-wrap:nowrap, so they NEVER split across lines. The wrapper itself
   * can wrap to a new line as a unit when the chart card is narrow, but the
   * 4 buttons stay together.
   *
   * `zoomIn` / `zoomOut` / `panLeft` / `panRight` are callbacks that perform
   * the actual operation + re-render. `panLeft`/`panRight` may be omitted
   * (e.g. if a chart's data is too small to pan meaningfully) — in that case
   * only +/− buttons are shown.
   */
  function addTouchZoomButtons(controlsWrap, zoomIn, zoomOut, panLeft, panRight) {
    var sep = document.createElement('span');
    sep.className = 'zoom-touch-sep';
    controlsWrap.appendChild(sep);

    // Group: keeps +/− and ◀/▶ together on one line. Without this wrapper,
    // the buttons were direct children of .chart-controls (flex-wrap:wrap),
    // and on narrow screens the − button would end a line while + wrapped to
    // the next. User: "currently on some screens - stays on top line while +
    // is on lower line".
    var group = document.createElement('div');
    group.className = 'zoom-touch-group';

    var minusBtn = document.createElement('button');
    minusBtn.className = 'zoom-btn zoom-touch-btn';
    minusBtn.type = 'button';
    minusBtn.setAttribute('aria-label', 'Zoom out');
    minusBtn.innerHTML = '&minus;';
    minusBtn.addEventListener('click', zoomOut);
    group.appendChild(minusBtn);

    var plusBtn = document.createElement('button');
    plusBtn.className = 'zoom-btn zoom-touch-btn';
    plusBtn.type = 'button';
    plusBtn.setAttribute('aria-label', 'Zoom in');
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', zoomIn);
    group.appendChild(plusBtn);

    if (panLeft || panRight) {
      var panSep = document.createElement('span');
      panSep.className = 'zoom-touch-sep zoom-touch-sep-pan';
      group.appendChild(panSep);

      if (panLeft) {
        var leftBtn = document.createElement('button');
        leftBtn.className = 'zoom-btn zoom-touch-btn zoom-pan-btn';
        leftBtn.type = 'button';
        leftBtn.setAttribute('aria-label', 'Pan left');
        leftBtn.innerHTML = '&larr;';
        leftBtn.addEventListener('click', panLeft);
        group.appendChild(leftBtn);
      }
      if (panRight) {
        var rightBtn = document.createElement('button');
        rightBtn.className = 'zoom-btn zoom-touch-btn zoom-pan-btn';
        rightBtn.type = 'button';
        rightBtn.setAttribute('aria-label', 'Pan right');
        rightBtn.innerHTML = '&rarr;';
        rightBtn.addEventListener('click', panRight);
        group.appendChild(rightBtn);
      }
    }

    controlsWrap.appendChild(group);
  }

  // Shared zoom-by-factor logic. Returns the new [start,end] window or null
  // to signal "show all". `cur` is the current [start,end] or null (all).
  // `global` is [globalMin, globalMax]. `totalSpan` = globalMax - globalMin.
  // `factor` < 1 zooms in, > 1 zooms out. `hasPoint(start,end)` checks that at
  // least one data point falls in the window (prevents empty zoom).
  function applyZoomFactor(cur, global, totalSpan, factor, hasPoint) {
    var gMin = global[0], gMax = global[1];
    var xMin = cur ? cur[0] : gMin;
    var xMax = cur ? cur[1] : gMax;
    var curSpan = (xMax - xMin) || totalSpan;
    var minSpan = Math.max(86400 * 60, totalSpan * 0.03);
    var newSpan = Math.max(minSpan, Math.min(totalSpan, curSpan * factor));
    // Center on the middle of the current view.
    var mid = (xMin + xMax) / 2;
    var newStart = mid - newSpan / 2;
    var newEnd = newStart + newSpan;
    if (newStart < gMin) { newStart = gMin; newEnd = Math.min(gMax, newStart + newSpan); }
    if (newEnd > gMax) { newEnd = gMax; newStart = Math.max(gMin, newEnd - newSpan); }
    if (!hasPoint(newStart, newEnd)) return cur; // reject empty zoom
    if (newEnd - newStart >= totalSpan - 1) return null; // back to "all"
    return [newStart, newEnd];
  }

  // Shared pan-by-fraction logic. Returns the new [start,end] window or null
  // to signal "show all". Shifts the current window left/right by `fraction`
  // of the current span, clamped to the global range. If the window is null
  // (showing all), panning does nothing (returns null). `hasPoint(start,end)`
  // checks that at least one data point falls in the window.
  // User: "there are no panning left and right options, so it just zooms
  // somewhere in center and that's it, not very useful without panning".
  function applyPan(cur, global, totalSpan, fraction, hasPoint) {
    if (!cur) return cur; // can't pan when showing all
    var gMin = global[0], gMax = global[1];
    var xMin = cur[0], xMax = cur[1];
    var span = xMax - xMin;
    if (span <= 0) return cur;
    var shift = span * fraction;
    var newStart = xMin + shift;
    var newEnd = xMax + shift;
    if (newStart < gMin) { newStart = gMin; newEnd = newStart + span; }
    if (newEnd > gMax) { newEnd = gMax; newStart = newEnd - span; }
    if (!hasPoint(newStart, newEnd)) return cur; // reject empty pan
    return [newStart, newEnd];
  }

  /* Drag-to-pan helper — lets users pan a zoomed-in chart by dragging with
   * the mouse (hold left button + move) or with a finger (touch + move).
   * Works in concert with the existing +/− zoom buttons, ◀ ▶ pan buttons,
   * and scrollwheel zoom.
   * User: "Panning buttons is good, but i want to also pan by just dragging
   * my finger on the graph (or by holding mouse)".
   *
   * `state` is an object with:
   *   getZoom()       -> [start,end] or null
   *   getGlobal()     -> [gMin, gMax]
   *   getWidth()      -> viewBox W (number)
   *   getMargins()    -> {left, right}
   *   hasPoint(a,b)   -> bool (does any data point fall in [a,b]?)
   *   onPan([s,e])    -> apply the new window + re-render
   *   onCursor(state) -> 'grab' | 'default' (update cursor when zoom changes)
   *
   * Implementation notes:
   *   - We attach mousedown/touchstart to the container, but move/up to
   *     document so the drag continues even if the cursor leaves the chart.
   *   - A 5px threshold distinguishes a drag from a click (so dots remain
   *     clickable for tooltips / navigation).
   *   - The SVG element's bounding rect is captured at drag start; we use it
   *     to convert pixel deltas to time deltas via the chart's inner width.
   *   - Dragging right shifts the view content right, which means the time
   *     window shifts LEFT (toward earlier times). Standard map-style UX.
   *   - Touch: only single-finger drags. Two-finger pinch is left to the
   *     browser (we don't preventDefault on multi-touch).
   */
  function addDragPan(container, state) {
    var DRAG_THRESHOLD = 5; // px — smaller than a click jitter
    var drag = null;

    function isInteractiveTarget(el) {
      // Don't start a drag when the user clicks on a button, a chart dot,
      // a legend item, the controls row, or a tooltip — those have their
      // own click handlers. Starting a drag here would break their UX.
      return !!el.closest('button, .chart-controls, .chart-legend, .chart-legend-below, a, .chart-tooltip, .replay-help-icon');
    }

    function start(clientX, clientY) {
      var cur = state.getZoom();
      if (!cur) return; // not zoomed in — nothing to pan
      var svgEl = container.querySelector('svg');
      if (!svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      drag = {
        startX: clientX,
        startY: clientY,
        rectLeft: rect.left,
        rectWidth: rect.width,
        curStart: cur[0],
        curEnd: cur[1],
        moved: false,
      };
    }

    function move(clientX) {
      if (!drag) return;
      var dx = clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        drag.moved = true;
        container.classList.add('dragging');
      }
      // Convert pixel delta to time delta.
      // The viewBox W maps to rect.width screen pixels. The chart's inner
      // width (iw = W - left - right) corresponds to (iw/W) * rect.width
      // screen pixels. Time-per-pixel = curSpan / screenIw.
      var W = state.getWidth();
      var m = state.getMargins();
      var iw = W - m.left - m.right;
      if (iw <= 0) return;
      var screenIw = drag.rectWidth * (iw / W);
      if (screenIw <= 0) return;
      var curSpan = drag.curEnd - drag.curStart;
      // Dragging RIGHT (dx>0) should move the view content right, which
      // means the time window shifts LEFT (toward earlier times). So the
      // shift is NEGATIVE dx.
      var timeShift = -(dx / screenIw) * curSpan;
      var g = state.getGlobal();
      var newStart = drag.curStart + timeShift;
      var newEnd = drag.curEnd + timeShift;
      if (newStart < g[0]) { newStart = g[0]; newEnd = newStart + curSpan; }
      if (newEnd > g[1]) { newEnd = g[1]; newStart = newEnd - curSpan; }
      if (!state.hasPoint(newStart, newEnd)) return;
      state.onPan([newStart, newEnd]);
    }

    function end() {
      if (drag && drag.moved) {
        container.classList.remove('dragging');
      }
      drag = null;
    }

    // Mouse
    container.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; // only left button
      if (isInteractiveTarget(e.target)) return;
      start(e.clientX, e.clientY);
      if (drag) {
        e.preventDefault();
        // Attach move/up to document so the drag continues outside the chart.
        var onMove = function (ev) { move(ev.clientX); };
        var onUp = function () {
          end();
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
    });

    // Touch — passive:false so we can preventDefault on move to stop page scroll
    container.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return; // leave multi-touch to browser
      if (isInteractiveTarget(e.target)) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    container.addEventListener('touchmove', function (e) {
      if (!drag || e.touches.length !== 1) return;
      move(e.touches[0].clientX);
      if (drag.moved) e.preventDefault();
    }, { passive: false });
    container.addEventListener('touchend', function () { end(); });
    container.addEventListener('touchcancel', function () { end(); });

    // Update cursor class whenever zoom state changes.
    // The chart's render() calls state.onCursor after every render.
    // We expose a small API the chart can call.
    return {
      setDraggable: function (isZoomed) {
        if (isZoomed) container.classList.add('draggable');
        else container.classList.remove('draggable');
      },
    };
  }

  /* ---------- SVG helpers ---------- */
  function el(tag, attrs, children) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === 'text') e.textContent = attrs[k];
        else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === 'string') e.appendChild(document.createTextNode(c));
        else e.appendChild(c);
      });
    }
    return e;
  }

  // Nice round number for axis scales.
  function niceNumber(v) {
    if (v <= 0) return 1;
    var exp = Math.floor(Math.log10(v));
    var f = v / Math.pow(10, exp);
    var nf;
    if (f <= 1) nf = 1;
    else if (f <= 2) nf = 2;
    else if (f <= 2.5) nf = 2.5;
    else if (f <= 5) nf = 5;
    else nf = 10;
    return nf * Math.pow(10, exp);
  }

  // Generate nice tick values for a [min, max] range.
  function niceTicks(min, max, targetCount) {
    if (min === max) { max = min + 1; min = min - 1; }
    var range = niceNumber(max - min);
    var step = niceNumber(range / Math.max(1, (targetCount - 1)));
    var niceMin = Math.floor(min / step) * step;
    var niceMax = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = niceMin; v <= niceMax + step * 0.001; v += step) {
      ticks.push(Math.round(v / step) * step);
    }
    return { ticks: ticks, min: niceMin, max: niceMax, step: step };
  }

  // For time-based Y axes on small puzzles: produce round sub-second scales.
  function niceTimeTicks(min, max, targetCount) {
    if (min === max) { max = min * 1.1 || 1; min = min * 0.9 || 0; }
    var range = max - min;
    // choose a step that divides nicely: 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60...
    var candidates = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    var step = candidates[0];
    for (var i = 0; i < candidates.length; i++) {
      if (range / candidates[i] <= targetCount) { step = candidates[i]; break; }
      step = candidates[i];
    }
    var niceMin = Math.floor(min / step) * step;
    var niceMax = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = niceMin; v <= niceMax + step * 0.001; v += step) {
      ticks.push(Math.round(v / step) * step);
    }
    return { ticks: ticks, min: niceMin, max: niceMax, step: step };
  }

  // Format a tick value for display.
  function fmtTick(v, isTime) {
    if (isTime) {
      if (v < 60) return v.toFixed(v < 1 ? 2 : (v < 10 ? 1 : 0));
      if (v < 3600) {
        var m = Math.floor(v / 60), s = Math.round(v % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
      }
      var h = Math.floor(v / 3600), m = Math.round((v % 3600) / 60);
      return h + 'h' + (m > 0 ? m + 'm' : '');
    }
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
  }

  /* ---------- Tooltip ----------
   * IMPORTANT: tooltip is appended to document.body and positioned with
   * position:fixed using viewport coords (e.clientX / e.clientY). This
   * avoids the "tooltip appears in random places" bug that happened when
   * the tooltip was a child of a chart container with overflow:visible
   * and SVG elements that spill outside the container box.
   */
  var activeTooltip = null;
  function makeTooltip(container) {
    var tt = document.createElement('div');
    tt.className = 'chart-tooltip';
    // Append to body so it isn't affected by SVG overflow / transformed ancestors.
    document.body.appendChild(tt);
    var api = {
      show: function (clientX, clientY, html) {
        // hide any other tooltip currently visible (only one at a time)
        if (activeTooltip && activeTooltip !== api) activeTooltip.hide();
        activeTooltip = api;
        tt.innerHTML = html;
        tt.classList.add('visible');
        // measure after content is set
        var ttRect = tt.getBoundingClientRect();
        var pad = 14;
        var px = clientX + pad;
        var py = clientY + pad;
        // flip horizontally if overflows right edge
        if (px + ttRect.width > window.innerWidth - 8) {
          px = clientX - ttRect.width - pad;
        }
        // flip vertically if overflows bottom edge
        if (py + ttRect.height > window.innerHeight - 8) {
          py = clientY - ttRect.height - pad;
        }
        // clamp to viewport
        if (px < 8) px = 8;
        if (py < 8) py = 8;
        tt.style.left = Math.round(px) + 'px';
        tt.style.top = Math.round(py) + 'px';
      },
      hide: function () {
        tt.classList.remove('visible');
        if (activeTooltip === api) activeTooltip = null;
      },
    };
    return api;
  }

  /* Hide every chart tooltip currently visible on the page.
   * Tooltips are position:fixed divs appended to document.body — they are NOT
   * children of the chart container, so they survive container innerHTML
   * rebuilds (route changes, time-travel slider drags, etc.). Their normal
   * hide trigger is the dot/bar `mouseleave` event, but when the container is
   * rebuilt the hovered element is removed from the DOM without firing
   * mouseleave, leaving the tooltip floating orphaned on screen.
   * Calling this at the start of every render() / modal open / search open
   * guarantees no stale tooltip persists across view changes.
   * User: "tooltips, they sometimes persist on the screen when we change some
   * page, while it was visible, and they stay floating until some other
   * tooltip activated".
   */
  function hideAllTooltips() {
    if (activeTooltip) {
      activeTooltip.hide();
      activeTooltip = null;
    }
    // Belt-and-suspenders: also clear any orphaned visible tooltips that might
    // exist from charts whose `activeTooltip` reference was lost (e.g. a chart
    // whose container was destroyed mid-hover).
    var visible = document.querySelectorAll('.chart-tooltip.visible');
    for (var i = 0; i < visible.length; i++) {
      visible[i].classList.remove('visible');
    }
  }

  /* ============================================================
   * Line chart — WR progression over time (within a category).
   * X = date, Y = time. Interactive dots with tooltips.
   * Improvements (per user review):
   *   - More detailed Y scale (8 ticks instead of 5) with horizontal grid lines.
   *   - More years on X axis (target ~8 ticks).
   *   - Time labels above dots, suppressed on overlap when dense.
   *   - Zoom controls (1y / 3y / 5y / All) that filter the date range.
   * ============================================================ */
  function lineChart(container, records, opts) {
    opts = opts || {};
    container.innerHTML = '';

    var allRecs = records.filter(function (r) { return r.time != null && r.dateSortKey > 0; });
    if (!allRecs.length) {
      container.appendChild(emptyChart('No timed records', container.clientWidth || 600, 280));
      return;
    }

    // ---- Zoom state ----
    // zoomWindow = null means "all". Otherwise [tStart, tEnd] in epoch seconds.
    // Replaces the older year-based zoomRange so we can support fine-grained
    // scrollwheel zoom (user: "zooming with scrollwheel should be implemented").
    var zoomWindow = null;
    var globalXMin = Math.min.apply(null, allRecs.map(function (r) { return r.dateSortKey; }));
    var globalXMax = Math.max.apply(null, allRecs.map(function (r) { return r.dateSortKey; }));
    var globalStartYear = new Date(globalXMin * 1000).getUTCFullYear();
    var globalEndYear = new Date(globalXMax * 1000).getUTCFullYear();
    var totalYears = Math.max(1, globalEndYear - globalStartYear + 1);
    var totalSpan = Math.max(1, globalXMax - globalXMin);

    // Zoom preset buttons
    var controlsWrap = document.createElement('div');
    controlsWrap.className = 'chart-controls';
    controlsWrap.style.marginBottom = '6px';
    var presets = [];
    if (totalYears >= 2) presets.push({ label: '1y', years: 1 });
    if (totalYears >= 4) presets.push({ label: '3y', years: 3 });
    if (totalYears >= 8) presets.push({ label: '5y', years: 5 });
    presets.push({ label: 'All', years: 0 });
    var presetBtns = [];
    presets.forEach(function (p) {
      var btn = document.createElement('button');
      btn.className = 'zoom-btn' + (p.years === 0 ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', function () {
        if (p.years === 0) {
          zoomWindow = null;
        } else {
          // last N years (computed via epoch seconds for fine-grained window)
          var sy = Math.max(globalStartYear, globalEndYear - p.years + 1);
          zoomWindow = [Date.UTC(sy, 0, 1) / 1000, globalXMax];
        }
        presetBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        render();
      });
      presetBtns.push(btn);
      controlsWrap.appendChild(btn);
    });
    // Reset-to-all helper that also clears preset button highlights.
    function clearPresetActive() { presetBtns.forEach(function (b) { b.classList.remove('active'); }); }
    var infoSpan = document.createElement('span');
    infoSpan.className = 'zoom-info';
    controlsWrap.appendChild(infoSpan);
    // Scrollwheel hint
    var hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'scroll to zoom';
    controlsWrap.appendChild(hint);
    // Touch + / − zoom buttons + ◀ ▶ pan buttons (work on all devices,
    // essential on phones). Panning lets users explore a zoomed-in view
    // instead of being stuck at the centered zoom window.
    // User: "there are no panning left and right options, so it just zooms
    // somewhere in center and that's it, not very useful without panning".
    addTouchZoomButtons(controlsWrap,
      function zoomIn() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.6,
          function (a, b) { return allRecs.some(function (rc) { return rc.dateSortKey >= a && rc.dateSortKey <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function zoomOut() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 1.6,
          function (a, b) { return allRecs.some(function (rc) { return rc.dateSortKey >= a && rc.dateSortKey <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function panLeft() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, -0.5,
          function (a, b) { return allRecs.some(function (rc) { return rc.dateSortKey >= a && rc.dateSortKey <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      },
      function panRight() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.5,
          function (a, b) { return allRecs.some(function (rc) { return rc.dateSortKey >= a && rc.dateSortKey <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      });
    container.appendChild(controlsWrap);

    // Wheel zoom handler — attached to container.
    // User: "zooming with scrollwheel should be implemented".
    // deltaY < 0 (scroll up) → zoom IN. deltaY > 0 (scroll down) → zoom OUT.
    // The zoom focal point is the mouse X position projected to chart time.
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var svgEl = container.querySelector('svg');
      if (!svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      // Map mouse X (relative to svg) → chart X coordinate (epoch sec).
      var mxRel = (e.clientX - rect.left) / rect.width;
      // The svg viewBox is 0 0 W H. Chart area inside margins:
      //   m.left=64, m.right=20, so iw = W - 84.
      // xScale(v) = m.left + ((v - xMin) / (xMax - xMin)) * iw
      // Inverse: v = xMin + ((mxSvg - m.left) / iw) * (xMax - xMin)
      // mxSvg = mxRel * W
      var W = opts.width || (container.clientWidth || 600);
      var m = lineMargins(W);
      var iw = W - m.left - m.right;
      var mxSvg = mxRel * W;
      var xMin, xMax;
      if (zoomWindow) { xMin = zoomWindow[0]; xMax = zoomWindow[1]; }
      else { xMin = globalXMin; xMax = globalXMax; }
      var focal = xMin + Math.max(0, Math.min(1, (mxSvg - m.left) / iw)) * (xMax - xMin);
      // Zoom factor: scroll up → smaller window (zoom in), scroll down → larger.
      var factor = e.deltaY < 0 ? 0.8 : 1.25;
      var curSpan = (xMax - xMin) || totalSpan;
      // Minimum span: at least 60 days, AND wide enough to include at least
      // 2 records (so the graph never disappears). User: "never zoom so graph
      // disapears".
      var minSpan = Math.max(86400 * 60, totalSpan * 0.03);
      var newSpan = Math.max(minSpan, Math.min(totalSpan, curSpan * factor));
      // Center the new window on the focal point, clamped to global range.
      var newStart = focal - (focal - xMin) * (newSpan / curSpan);
      var newEnd = newStart + newSpan;
      if (newStart < globalXMin) { newStart = globalXMin; newEnd = Math.min(globalXMax, newStart + newSpan); }
      if (newEnd > globalXMax) { newEnd = globalXMax; newStart = Math.max(globalXMin, newEnd - newSpan); }
      // Check: would the new window include at least 1 record? If not, reject.
      var hasRecord = allRecs.some(function (r) {
        return r.dateSortKey >= newStart && r.dateSortKey <= newEnd;
      });
      if (!hasRecord) return;
      if (newEnd - newStart >= totalSpan - 1) {
        zoomWindow = null;
        clearPresetActive();
        // Mark the "All" preset button as active.
        presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
      } else {
        zoomWindow = [newStart, newEnd];
        clearPresetActive();
      }
      render();
    }, { passive: false });

    // Drag-to-pan — hold mouse / touch + move to pan the zoomed view.
    // User: "i want to also pan by just dragging my finger on the graph
    // (or by holding mouse)".
    var dragPan = addDragPan(container, {
      getZoom: function () { return zoomWindow; },
      getGlobal: function () { return [globalXMin, globalXMax]; },
      getWidth: function () { return opts.width || (container.clientWidth || 600); },
      getMargins: function () {
        var W = opts.width || (container.clientWidth || 600);
        return lineMargins(W);
      },
      hasPoint: function (a, b) {
        return allRecs.some(function (r) { return r.dateSortKey >= a && r.dateSortKey <= b; });
      },
      onPan: function (win) { zoomWindow = win; clearPresetActive(); render(); },
    });

    function render() {
      // Update drag cursor — only "grab" when zoomed in.
      dragPan.setDraggable(!!zoomWindow);
      // Remove previous svg + legend + empty-state (keep controls)
      var prevSvg = container.querySelector('svg');
      if (prevSvg) prevSvg.remove();
      var prevLegend = container.querySelector('.chart-legend');
      if (prevLegend) prevLegend.remove();
      var prevEmpty = container.querySelector('.empty-state');
      if (prevEmpty) prevEmpty.remove();

      // Filter records by zoom window
      var recs = allRecs;
      if (zoomWindow) {
        recs = allRecs.filter(function (r) {
          return r.dateSortKey >= zoomWindow[0] && r.dateSortKey <= zoomWindow[1];
        });
      }
      if (!recs.length) {
        // Instead of showing "No records" and destroying the chart, clamp
        // the zoom window back to a range that includes at least the nearest
        // records. User: "never zoom so graph disapears".
        // Find the record closest to the center of the zoom window and
        // expand the window to include it + a reasonable margin.
        var center = (zoomWindow[0] + zoomWindow[1]) / 2;
        var nearest = allRecs.reduce(function (best, r) {
          var d = Math.abs(r.dateSortKey - center);
          if (best === null || d < best.d) return { rec: r, d: d };
          return best;
        }, null);
        if (nearest) {
          var nt = nearest.rec.dateSortKey;
          var margin = Math.max(86400 * 30, totalSpan * 0.05);
          zoomWindow = [Math.max(globalXMin, nt - margin), Math.min(globalXMax, nt + margin)];
          recs = allRecs.filter(function (r) {
            return r.dateSortKey >= zoomWindow[0] && r.dateSortKey <= zoomWindow[1];
          });
        }
        if (!recs.length) {
          zoomWindow = null;
          clearPresetActive();
          presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
          recs = allRecs;
        }
      }

      var shownStartYear = new Date(Math.min.apply(null, recs.map(function (r) { return r.dateSortKey; })) * 1000).getUTCFullYear();
      var shownEndYear = new Date(Math.max.apply(null, recs.map(function (r) { return r.dateSortKey; })) * 1000).getUTCFullYear();
      infoSpan.textContent = recs.length + ' records · ' + shownStartYear + '–' + shownEndYear;

      var W = opts.width || container.clientWidth || 600;
      var H = opts.height || 320;
      var m = lineMargins(W);
      var iw = W - m.left - m.right;
      var ih = H - m.top - m.bottom;

      var xs = recs.map(function (r) { return r.dateSortKey; });
      var ys = recs.map(function (r) { return r.time; });
      var xMin = Math.min.apply(null, xs);
      var xMax = Math.max.apply(null, xs);
      var yMin = Math.min.apply(null, ys);
      var yMax = Math.max.apply(null, ys);
      // pad y a bit
      var yPad = (yMax - yMin) * 0.12 || yMax * 0.05 || 0.1;
      // More detailed Y scale: 8 ticks instead of 5 (user: "Y scale should be
      // more detailed, some categories have huge gaps").
      var tk = niceTimeTicks(Math.max(0, yMin - yPad), yMax + yPad, 8);

      var xScale = function (v) { return m.left + ((v - xMin) / (xMax - xMin || 1)) * iw; };
      var yScale = function (v) { return m.top + (1 - (v - tk.min) / (tk.max - tk.min || 1)) * ih; };

      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
      svg.style.width = '100%';

      // grid lines + Y axis labels (horizontal lines — user asked for these)
      tk.ticks.forEach(function (tv) {
        var y = yScale(tv);
        if (y < m.top || y > m.top + ih) return;
        svg.appendChild(el('line', { class: 'chart-grid-line', x1: m.left, y1: y, x2: m.left + iw, y2: y }));
        svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left - 6, y: y + 3, 'text-anchor': 'end' }, fmtTick(tv, true)));
      });

      // X axis labels (years) — show EVERY year when span is small enough.
      // User: "Horizontal axis should include more years, currently it does
      // not even show each year".
      // Narrow screens use a smaller tick target so labels don't collapse.
      var xTicks = yearTicks(xMin, xMax, yearTickTarget(W));
      xTicks.forEach(function (t) {
        var x = xScale(t);
        var yr = new Date(t * 1000).getUTCFullYear();
        svg.appendChild(el('text', { class: 'chart-axis-label', x: x, y: m.top + ih + 16, 'text-anchor': 'middle' }, String(yr)));
      });

      // axis lines
      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

      // Line SEGMENTS — each segment colored by the player who held the record.
      for (var si = 0; si < recs.length - 1; si++) {
        var ra = recs[si], rb = recs[si + 1];
        var sax = xScale(ra.dateSortKey), say = yScale(ra.time);
        var sbx = xScale(rb.dateSortKey), sby = yScale(rb.time);
        var segColor = U.playerColor(ra.player);
        var segD = 'M' + sax.toFixed(1) + ',' + say.toFixed(1) +
                   ' L' + sbx.toFixed(1) + ',' + sby.toFixed(1);
        svg.appendChild(el('path', { class: 'chart-line', d: segD, stroke: segColor, 'stroke-width': 2.5, opacity: 0.9, 'stroke-linecap': 'round' }));
        var segArea = segD +
          ' L' + sbx.toFixed(1) + ',' + (m.top + ih) +
          ' L' + sax.toFixed(1) + ',' + (m.top + ih) + ' Z';
        svg.appendChild(el('path', { d: segArea, fill: segColor, opacity: 0.08 }));
      }
      if (recs.length === 1) {
        var onlyR = recs[0];
        var oc = U.playerColor(onlyR.player);
        svg.appendChild(el('circle', { cx: xScale(onlyR.dateSortKey).toFixed(1), cy: yScale(onlyR.time).toFixed(1), r: 5, fill: oc, stroke: '#0e0e0e', 'stroke-width': 1.5 }));
      }

      // Time labels above dots — show ALL of them, with background rectangles.
      // User: "get rid of 'safety', try to display all labels above dots, add
      // backgrounds to those label tooltips, so older dots are covered by new
      // dots fully for cluttered groups, zooming feature should help user to
      // see those properly".
      // We paint labels in recs order (oldest first) so newer labels (painted
      // later) cover older ones where they overlap.
      var tooltip = makeTooltip(container);
      recs.forEach(function (r, idx) {
        var x = xScale(r.dateSortKey);
        var y = yScale(r.time);
        var isFirst = idx === 0;
        var isCurrent = idx === recs.length - 1;
        var dot = el('circle', {
          class: 'chart-dot' + (isCurrent ? ' current-wr-dot' : ''),
          cx: x.toFixed(1), cy: y.toFixed(1),
          r: isCurrent ? 5.5 : 4,
          fill: U.playerColor(r.player), stroke: '#0e0e0e', 'stroke-width': 1.5,
        });
        dot.addEventListener('mouseenter', function (e) {
          var tt = '<div class="tt-label">' + U.fmtDate(r) + '</div>' +
            '<div class="tt-value">' + U.fmtTime(r.time) + '</div>' +
            '<div style="color:' + U.playerColor(r.player) + ';font-weight:700">' + U.esc(r.player) + '</div>';
          if (r.movecount != null) tt += '<div class="tt-label">moves: <b style="color:var(--text)">' + U.fmtMovecount(r.movecount, false) + '</b></div>';
          if (r.tps != null) tt += '<div class="tt-label">tps: <b style="color:var(--text)">' + U.fmtTps(r.tps) + '</b></div>';
          if (r.control) tt += '<div class="tt-label">control: <b style="color:var(--text)">' + U.esc(r.control) + '</b></div>';
          if (r.style) tt += '<div class="tt-label">style: <b style="color:var(--text)">' + U.esc(r.style) + '</b></div>';
          if (r.hasReplay) tt += '<div class="tt-label">replay: <b style="color:' + (r.replayAccurate === true ? 'var(--delta-up)' : r.replayAccurate === false ? 'var(--c-keyboard)' : 'var(--text)') + '">' + (r.replayAccurate === true ? 'accurate' : r.replayAccurate === false ? 'inaccurate' : 'yes') + '</b></div>';
          if (isFirst) tt += '<div style="color:var(--cyan-bright);font-size:10px;margin-top:2px">First documented record</div>';
          if (isCurrent) tt += '<div style="color:var(--cyan-bright);font-size:10px;margin-top:2px">● Current WR</div>';
          if (r.notes) tt += '<div class="tt-label" style="margin-top:4px;max-width:240px;white-space:normal">✎ ' + U.esc(r.notes.slice(0,120)) + (r.notes.length > 120 ? '…' : '') + '</div>';
          tooltip.show(e.clientX, e.clientY, tt);
        });
        dot.addEventListener('mouseleave', function () { tooltip.hide(); });
        if (opts.onDotClick) {
          dot.addEventListener('click', function () { opts.onDotClick(r); });
          dot.style.cursor = 'pointer';
        }
        svg.appendChild(dot);

        // Time label above dot — always shown, with a background rect.
        var timeStr = U.fmtTime(r.time);
        var compact = timeStr.replace(/s$/, '');
        var labelY = y - 10;
        if (labelY < m.top + 9) labelY = y + 14;
        // Approximate text width: 5px per char at font-size 9.
        var labW = compact.length * 5 + 4;
        var labH = 11;
        // Background rect (painted before text so text appears on top).
        svg.appendChild(el('rect', {
          x: (x - labW / 2).toFixed(1), y: (labelY - labH + 2).toFixed(1),
          width: labW, height: labH, rx: 2,
          fill: '#0e0e0e', opacity: 0.88,
          'pointer-events': 'none',
        }));
        svg.appendChild(el('text', {
          x: x.toFixed(1), y: labelY.toFixed(1),
          'text-anchor': 'middle', 'font-size': '9', 'font-weight': '700',
          fill: isCurrent ? '#00f1ff' : (isFirst ? '#ffd700' : 'var(--text)'),
          'pointer-events': 'none',
        }, compact));
      });

      container.appendChild(svg);

      // Player legend below chart
      if (opts.legend !== false) {
        var legendPlayers = [];
        var seenP = {};
        recs.forEach(function (r) {
          if (!seenP[r.player]) {
            seenP[r.player] = true;
            legendPlayers.push(r.player);
          }
        });
        var legend = document.createElement('div');
        legend.className = 'chart-legend';
        legend.innerHTML = legendPlayers.map(function (p) {
          var c = U.playerColor(p);
          return '<a class="legend-item clickable" data-player="' + U.esc(p) + '" style="color:' + c + '" title="View ' + U.esc(p) + '">' +
            '<span class="legend-dot" style="background:' + c + '"></span>' +
            U.esc(p) + '</a>';
        }).join('');
        if (opts.onLegendClick) {
          legend.querySelectorAll('.legend-item').forEach(function (it) {
            it.addEventListener('click', function (e) {
              e.preventDefault();
              opts.onLegendClick(it.getAttribute('data-player'));
            });
          });
        }
        container.appendChild(legend);
      }
    }
    render();
  }

  function yearTicks(xMin, xMax, targetCount) {
    // xMin/xMax are epoch seconds. Produce year ticks.
    var startYear = new Date(xMin * 1000).getUTCFullYear();
    var endYear = new Date(xMax * 1000).getUTCFullYear();
    var tc = targetCount || 6;
    // Prefer step=1 (every year) when the span is small enough — user asked
    // for "more years, currently it does not even show each year".
    var span = endYear - startYear;
    var step;
    if (span <= tc) step = 1;
    else step = Math.max(1, Math.ceil(span / tc));
    var ticks = [];
    for (var y = startYear; y <= endYear; y += step) ticks.push(y);
    if (ticks[ticks.length-1] !== endYear) ticks.push(endYear);
    return ticks.map(function (yr) { return Date.UTC(yr, 0, 1) / 1000; });
  }

  /* ============================================================
   * Active Records chart — step line showing # of WRs held over time.
   * Used by:
   *   - Player detail page (single player's active records 2013 → 2026).
   *   - Compare page (multiple players' active records overlaid).
   * Y axis = integer count. Step lines (no interpolation between points).
   * Supports scrollwheel zoom + label backgrounds, same as lineChart.
   *
   * Improvements (per user review):
   *   - Fix "always 1" bug: a player with no records before their first
   *     event now correctly shows 0 records from chart start until their
   *     first gain event (previously the line extended the first point's
   *     y-value back to the chart's left edge, making it look like the
   *     player always had 1 record).
   *   - Fix zoom destroy: empty-state divs are removed on re-render;
   *     zoom is clamped so the graph never disappears.
   *   - Single-player mode (opts.singlePlayer=true): no legend, no
   *     "1 player" info text (user: "remove player name from legend, as
   *     here we only have 1 player. for same reason remove '1 player'").
   *   - Rich tooltips: shows who sniped who + record time + days since
   *     previous event (user: "should show who sniped who and with what
   *     record time after how many days or something").
   * ============================================================ */
  function activeRecordsChart(container, series, opts) {
    opts = opts || {};
    container.innerHTML = '';

    // For each series, prepend a synthetic "pre-gain" point at the first
    // event's time with y = (first.y - first.gainCount) so the step line
    // correctly shows 0 (or the pre-gain count) before the first event.
    // User: "player appears to always have 1 record, even if at the moment
    // in past player had 0 records (before he got his first snipe / record)".
    series = series.map(function (s) {
      var pts = s.points.slice();
      if (pts.length && pts[0].gainCount > 0) {
        var preY = pts[0].y - pts[0].gainCount;
        pts.unshift({
          t: pts[0].t,
          y: preY,
          gainCount: 0,
          lossCount: 0,
          rec: null,
          cat: null,
          synthetic: true,
        });
      }
      return { label: s.label, color: s.color, points: pts };
    });

    var allPoints = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allPoints.push(p); });
    });
    if (!allPoints.length) {
      container.appendChild(emptyChart('No data', container.clientWidth || 800, 320));
      return;
    }

    var globalXMin = Math.min.apply(null, allPoints.map(function (p) { return p.t; }));
    var globalXMax = Math.max.apply(null, allPoints.map(function (p) { return p.t; }));
    var totalSpan = Math.max(1, globalXMax - globalXMin);
    var globalYMax = Math.max.apply(null, allPoints.map(function (p) { return p.y; }));

    var zoomWindow = null;

    // Controls row (info + hint)
    var controlsWrap = document.createElement('div');
    controlsWrap.className = 'chart-controls';
    controlsWrap.style.marginBottom = '6px';
    var infoSpan = document.createElement('span');
    infoSpan.className = 'zoom-info';
    controlsWrap.appendChild(infoSpan);
    var hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'scroll to zoom';
    controlsWrap.appendChild(hint);
    // Touch + / − zoom buttons + ◀ ▶ pan buttons (this chart has no preset
    // buttons, so just toggle zoomWindow directly — same as its wheel handler).
    // User: "there are no panning left and right options, so it just zooms
    // somewhere in center and that's it, not very useful without panning".
    addTouchZoomButtons(controlsWrap,
      function zoomIn() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.6,
          function (a, b) { return allPoints.some(function (p) { return p.t >= a && p.t <= b && !p.synthetic; }); });
        zoomWindow = r;
        render();
      },
      function zoomOut() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 1.6,
          function (a, b) { return allPoints.some(function (p) { return p.t >= a && p.t <= b && !p.synthetic; }); });
        zoomWindow = r;
        render();
      },
      function panLeft() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, -0.5,
          function (a, b) { return allPoints.some(function (p) { return p.t >= a && p.t <= b && !p.synthetic; }); });
        if (r) { zoomWindow = r; render(); }
      },
      function panRight() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.5,
          function (a, b) { return allPoints.some(function (p) { return p.t >= a && p.t <= b && !p.synthetic; }); });
        if (r) { zoomWindow = r; render(); }
      });
    container.appendChild(controlsWrap);

    // Wheel zoom handler (same approach as lineChart, with safety checks).
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var svgEl = container.querySelector('svg');
      if (!svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      var mxRel = (e.clientX - rect.left) / rect.width;
      var W = opts.width || (container.clientWidth || 800);
      var m = activeRecordsMargins(W, opts.singlePlayer);
      var iw = W - m.left - m.right;
      var mxSvg = mxRel * W;
      var xMin = zoomWindow ? zoomWindow[0] : globalXMin;
      var xMax = zoomWindow ? zoomWindow[1] : globalXMax;
      var focal = xMin + Math.max(0, Math.min(1, (mxSvg - m.left) / iw)) * (xMax - xMin);
      var factor = e.deltaY < 0 ? 0.8 : 1.25;
      var curSpan = (xMax - xMin) || totalSpan;
      var minSpan = Math.max(86400 * 60, totalSpan * 0.03);
      var newSpan = Math.max(minSpan, Math.min(totalSpan, curSpan * factor));
      var newStart = focal - (focal - xMin) * (newSpan / curSpan);
      var newEnd = newStart + newSpan;
      if (newStart < globalXMin) { newStart = globalXMin; newEnd = Math.min(globalXMax, newStart + newSpan); }
      if (newEnd > globalXMax) { newEnd = globalXMax; newStart = Math.max(globalXMin, newEnd - newSpan); }
      var hasRecord = allPoints.some(function (p) { return p.t >= newStart && p.t <= newEnd && !p.synthetic; });
      if (!hasRecord) return;
      if (newEnd - newStart >= totalSpan - 1) zoomWindow = null;
      else zoomWindow = [newStart, newEnd];
      render();
    }, { passive: false });

    // Drag-to-pan — hold mouse / touch + move to pan the zoomed view.
    // User: "i want to also pan by just dragging my finger on the graph
    // (or by holding mouse)".
    var dragPan = addDragPan(container, {
      getZoom: function () { return zoomWindow; },
      getGlobal: function () { return [globalXMin, globalXMax]; },
      getWidth: function () { return opts.width || (container.clientWidth || 800); },
      getMargins: function () {
        var W = opts.width || (container.clientWidth || 800);
        return activeRecordsMargins(W, opts.singlePlayer);
      },
      hasPoint: function (a, b) {
        return allPoints.some(function (p) { return p.t >= a && p.t <= b && !p.synthetic; });
      },
      onPan: function (win) { zoomWindow = win; render(); },
    });

    function render() {
      // Update drag cursor — only "grab" when zoomed in.
      dragPan.setDraggable(!!zoomWindow);
      var prevSvg = container.querySelector('svg');
      if (prevSvg) prevSvg.remove();
      var prevEmpty = container.querySelector('.empty-state');
      if (prevEmpty) prevEmpty.remove();

      var W = opts.width || container.clientWidth || 800;
      var H = opts.height || 360;
      // Responsive margins: on narrow screens the legend moves BELOW the
      // chart (rendered after the svg), so the right margin shrinks to 20
      // and the plot area gets the full width. On wide screens the legend
      // sits in the 140px right gutter as before (preserves desktop look).
      var m = activeRecordsMargins(W, opts.singlePlayer);
      var iw = W - m.left - m.right;
      var ih = H - m.top - m.bottom;

      var visXMin = zoomWindow ? zoomWindow[0] : globalXMin;
      var visXMax = zoomWindow ? zoomWindow[1] : globalXMax;
      var visYMax = 0;
      series.forEach(function (s) {
        s.points.forEach(function (p) {
          if (p.t >= visXMin && p.t <= visXMax && p.y > visYMax) visYMax = p.y;
        });
      });
      visYMax = Math.max(visYMax, 1);
      var yMax = Math.ceil(visYMax * 1.1);

      var xScale = function (v) { return m.left + ((v - visXMin) / (visXMax - visXMin || 1)) * iw; };
      var yScale = function (v) { return m.top + (1 - v / (yMax || 1)) * ih; };

      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
      svg.style.width = '100%';

      // Y grid + labels (integer ticks)
      var yTickCount = Math.min(8, yMax);
      var yStep = Math.max(1, Math.ceil(yMax / yTickCount));
      for (var v = 0; v <= yMax; v += yStep) {
        var gy = yScale(v);
        svg.appendChild(el('line', { class: 'chart-grid-line', x1: m.left, y1: gy, x2: m.left + iw, y2: gy }));
        svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left - 6, y: gy + 3, 'text-anchor': 'end' }, String(v)));
      }

      // X labels (years)
      var xTicks = yearTicks(visXMin, visXMax, yearTickTarget(W));
      xTicks.forEach(function (t) {
        var x = xScale(t);
        svg.appendChild(el('text', { class: 'chart-axis-label', x: x, y: m.top + ih + 16, 'text-anchor': 'middle' }, String(new Date(t * 1000).getUTCFullYear())));
      });

      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

      // Draw step lines per series — HORIZONTAL step (constant until next event).
      var tooltip = makeTooltip(container);
      series.forEach(function (s) {
        if (!s.points.length) return;
        // Build the visible list: include the last point before visXMin as a
        // leading anchor (so the line extends to the left edge at the correct
        // pre-window y value, NOT the first in-window point's y).
        var inWindow = s.points.filter(function (p) { return p.t >= visXMin && p.t <= visXMax; });
        var lead = null;
        for (var li = 0; li < s.points.length; li++) {
          if (s.points[li].t < visXMin) lead = s.points[li];
          else break;
        }
        var visible = lead ? [lead].concat(inWindow) : inWindow;
        if (!visible.length) return;

        var d = '';
        visible.forEach(function (p, i) {
          var x = xScale(p.t), y = yScale(p.y);
          if (i === 0) {
            // If first point is before visXMin, clamp x to left edge.
            if (p.t < visXMin) x = m.left;
            d += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
          } else {
            // step: horizontal to current X (at previous Y), then vertical to current Y
            var prevP = visible[i - 1];
            d += ' L' + x.toFixed(1) + ',' + yScale(prevP.y).toFixed(1);
            d += ' L' + x.toFixed(1) + ',' + y.toFixed(1);
          }
        });
        // Extend the final segment to visXMax (current WRs are still held).
        var lastP = visible[visible.length - 1];
        var lastX = xScale(visXMax);
        var lastY = yScale(lastP.y);
        d += ' L' + lastX.toFixed(1) + ',' + lastY.toFixed(1);
        svg.appendChild(el('path', { class: 'chart-line', d: d, stroke: s.color, 'stroke-width': 2.5, fill: 'none', opacity: 0.95, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

        // Dots at change events — with rich tooltips.
        // User: "tooltip should show who sniped who and with what record time
        // after how many days or something".
        visible.forEach(function (p, i) {
          if (p.synthetic) return; // don't draw dot for synthetic pre-gain point
          if (p.t < visXMin || p.t > visXMax) return; // skip leading anchor
          var x = xScale(p.t), y = yScale(p.y);
          var dot = el('circle', {
            class: 'chart-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 3.5,
            fill: s.color, stroke: '#0e0e0e', 'stroke-width': 1,
          });
          // Build rich tooltip.
          var tt = '<div style="color:' + s.color + ';font-weight:700">' + U.esc(s.label) + '</div>';
          if (p.rec) {
            tt += '<div class="tt-label">' + U.fmtDate(p.rec) + '</div>';
          } else {
            tt += '<div class="tt-label">' + U.fmtDate({ dateIso: '', dateDisplay: '', dateSortKey: p.t }) + '</div>';
          }
          tt += '<div class="tt-label">active records: <b style="color:var(--text)">' + p.y + '</b></div>';
          if (p.gainCount || p.lossCount) {
            var parts = [];
            if (p.gainCount) parts.push('+' + p.gainCount);
            if (p.lossCount) parts.push('−' + p.lossCount);
            tt += '<div class="tt-label">change: <b style="color:var(--text)">' + parts.join(' / ') + '</b></div>';
          }
          // Rich snipe info — iterate over EVERY event at this timestamp so
          // same-day +1/-1 edge cases show BOTH the gain and the loss.
          // Each event line keeps the record time + category close together
          // (previously they were far apart). User: "when player gets +1 -1
          // in same day ... currently only shows metadata of one of the events
          // ... also event should be close to time of the record in that
          // tooltip, currently they are far apart, restructure this tooltip".
          if (p.evs && p.evs.length) {
            p.evs.forEach(function (ev) {
              var r = ev.rec, c = ev.cat;
              if (!r || !c) return;
              tt += '<div class="tt-ev" style="margin-top:5px;padding-top:4px;border-top:1px solid rgba(255,255,255,0.08)">';
              // Read snipe metadata from the EVENT object (not the shared
              // record). Previous code read r._victim / r._sniper / r._firstEver
              // which broke in Compare mode — the same record is a gain for
              // one player and a loss for another, so the annotations
              // overwritten each other. User: "Compare page - lost records
              // don't say who took the record when player Lost".
              if (ev.kind === 'gain') {
                if (ev.firstEver) {
                  tt += '<div class="tt-label" style="color:var(--yellow)">★ First documented record</div>';
                } else if (ev.improved) {
                  // Self-improvement: the player beat their OWN previous WR.
                  // This only occurs in the "All Records" (cumulative) version
                  // of the chart, where every record by the player counts as
                  // +1. Rephrase from "took WR from [self]" to "Improved own
                  // record" (cyan) to match the Record History timeline's
                  // "improved" event type.
                  // User: "Player can 'Take' record from himself according to
                  // the graph, fix it by rephrasing tooltip message to
                  // 'Improve record' just like in Record History 'Improved'
                  // version events".
                  tt += '<div class="tt-label" style="color:var(--cyan-bright)">↻ Improved own record</div>';
                } else if (ev.victim) {
                  var vColor = U.playerColor(ev.victim);
                  tt += '<div class="tt-label">took WR from <b style="color:' + vColor + '">' + U.esc(ev.victim) + '</b></div>';
                } else {
                  tt += '<div class="tt-label" style="color:var(--delta-up)">+ gained record</div>';
                }
              } else {
                // loss
                if (ev.sniper) {
                  var sColor = U.playerColor(ev.sniper);
                  tt += '<div class="tt-label">WR taken by <b style="color:' + sColor + '">' + U.esc(ev.sniper) + '</b></div>';
                } else {
                  tt += '<div class="tt-label" style="color:var(--red)">− lost record</div>';
                }
              }
              // Record time + category kept TOGETHER on adjacent lines.
              tt += '<div class="tt-label"><b style="color:var(--cyan-bright)">' + U.fmtTime(r.time) + '</b> · ' + U.esc(c.name) + '</div>';
              tt += '</div>';
            });
          } else if (p.rec && p.cat) {
            // Fallback for points without an evs array (older callers).
            // We no longer store annotations on records, so this fallback
            // can only show a generic gain/loss label.
            if (p.gainCount) {
              tt += '<div class="tt-label" style="margin-top:4px;color:var(--delta-up)">+ gained record</div>';
              tt += '<div class="tt-label"><b style="color:var(--cyan-bright)">' + U.fmtTime(p.rec.time) + '</b> · ' + U.esc(p.cat.name) + '</div>';
            }
            if (p.lossCount) {
              tt += '<div class="tt-label" style="margin-top:4px;color:var(--red)">− lost record</div>';
              tt += '<div class="tt-label">' + U.esc(p.cat.name) + '</div>';
            }
          }
          // Days since previous event in this series.
          if (i > 0) {
            var prevEv = visible[i - 1];
            var daysBetween = Math.round((p.t - prevEv.t) / 86400);
            if (daysBetween > 0) {
              tt += '<div class="tt-label" style="margin-top:4px">after ' + daysBetween + 'd since previous event</div>';
            }
          }
          dot.addEventListener('mouseenter', function (e) { tooltip.show(e.clientX, e.clientY, tt); });
          dot.addEventListener('mouseleave', function () { tooltip.hide(); });
          svg.appendChild(dot);
        });

        // Current count label on the right edge (the player's current total).
        // Skip if the right edge is beyond visXMax (zoomed).
        var currY = yScale(lastP.y);
        var labW = String(lastP.y).length * 7 + 6;
        svg.appendChild(el('rect', {
          x: (lastX - labW - 2).toFixed(1), y: (currY - 9).toFixed(1),
          width: labW, height: 13, rx: 2,
          fill: '#0e0e0e', opacity: 0.88, 'pointer-events': 'none',
        }));
        svg.appendChild(el('text', {
          x: (lastX - 3).toFixed(1), y: (currY + 3).toFixed(1),
          'text-anchor': 'end', 'font-size': '10', 'font-weight': '700',
          fill: s.color, 'pointer-events': 'none',
        }, String(lastP.y)));
      });

      // Legend — ONLY for multi-player mode.
      // User: "Remove player name from legend, as here we only have 1 player.
      // for same reason remove '1 player' from this version of the chart".
      // On narrow screens (m.right === 20, legend has no gutter) render the
      // legend as an HTML row BELOW the svg so it doesn't overlap the chart.
      if (!opts.singlePlayer) {
        if (isNarrow(W)) {
          // Remove any previous below-chart legend from a prior render.
          var prevLegend = container.querySelector('.chart-legend-below');
          if (prevLegend) prevLegend.remove();
          var legendDiv = document.createElement('div');
          legendDiv.className = 'chart-legend chart-legend-below';
          legendDiv.style.padding = '8px 4px 0 4px';
          series.forEach(function (s) {
            var item = document.createElement('span');
            item.className = 'legend-item';
            var dot = document.createElement('span');
            dot.className = 'legend-dot';
            dot.style.background = s.color;
            dot.style.color = s.color;
            item.appendChild(dot);
            item.appendChild(document.createTextNode(s.label + ' (' + (s.points.length ? s.points[s.points.length - 1].y : 0) + ')'));
            legendDiv.appendChild(item);
          });
          container.appendChild(legendDiv);
        } else {
          var legendY = m.top + 4;
          series.forEach(function (s) {
            svg.appendChild(el('rect', { x: m.left + iw + 8, y: legendY, width: 12, height: 12, fill: s.color, rx: 2 }));
            var labText = s.label + ' (' + (s.points.length ? s.points[s.points.length - 1].y : 0) + ')';
            svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left + iw + 24, y: legendY + 10 }, labText));
            legendY += 18;
          });
        }
      }

      container.appendChild(svg);

      // Update info text — single-player mode omits "1 player" prefix.
      var startYear = new Date(visXMin * 1000).getUTCFullYear();
      var endYear = new Date(visXMax * 1000).getUTCFullYear();
      if (opts.singlePlayer) {
        infoSpan.textContent = startYear + '–' + endYear;
      } else {
        infoSpan.textContent = series.length + ' player' + (series.length === 1 ? '' : 's') + ' · ' + startYear + '–' + endYear;
      }
    }
    render();
  }

  /* ============================================================
   * Multi-line chart — for Compare view.
   * Multiple categories, each with distinct color, Y = time.
   * ============================================================ */
  function multiLineChart(container, series, opts) {
    opts = opts || {};
    container.innerHTML = '';

    var allPoints = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { allPoints.push(p); });
    });
    if (!allPoints.length) { container.appendChild(emptyChart('No data', container.clientWidth || 800, 380)); return; }

    var globalXMin = Math.min.apply(null, allPoints.map(function (p) { return p.x; }));
    var globalXMax = Math.max.apply(null, allPoints.map(function (p) { return p.x; }));
    var totalSpan = Math.max(1, globalXMax - globalXMin);
    var zoomWindow = null;

    // Zoom preset buttons — match WR Progression chart (user: "graphs here
    // should not be that much different from WR Progression graphs in history").
    var globalStartYear = new Date(globalXMin * 1000).getUTCFullYear();
    var globalEndYear = new Date(globalXMax * 1000).getUTCFullYear();
    var totalYears = Math.max(1, globalEndYear - globalStartYear + 1);

    var controlsWrap = document.createElement('div');
    controlsWrap.className = 'chart-controls';
    controlsWrap.style.marginBottom = '6px';
    var presets = [];
    if (totalYears >= 2) presets.push({ label: '1y', years: 1 });
    if (totalYears >= 4) presets.push({ label: '3y', years: 3 });
    if (totalYears >= 8) presets.push({ label: '5y', years: 5 });
    presets.push({ label: 'All', years: 0 });
    var presetBtns = [];
    presets.forEach(function (p) {
      var btn = document.createElement('button');
      btn.className = 'zoom-btn' + (p.years === 0 ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', function () {
        if (p.years === 0) {
          zoomWindow = null;
        } else {
          var sy = Math.max(globalStartYear, globalEndYear - p.years + 1);
          zoomWindow = [Date.UTC(sy, 0, 1) / 1000, globalXMax];
        }
        presetBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        render();
      });
      presetBtns.push(btn);
      controlsWrap.appendChild(btn);
    });
    function clearPresetActive() { presetBtns.forEach(function (b) { b.classList.remove('active'); }); }
    var infoSpan = document.createElement('span');
    infoSpan.className = 'zoom-info';
    controlsWrap.appendChild(infoSpan);
    var hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'scroll to zoom';
    controlsWrap.appendChild(hint);
    // Touch + / − zoom buttons + ◀ ▶ pan buttons.
    // User: "there are no panning left and right options, so it just zooms
    // somewhere in center and that's it, not very useful without panning".
    addTouchZoomButtons(controlsWrap,
      function zoomIn() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.6,
          function (a, b) { return allPoints.some(function (p) { return p.x >= a && p.x <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function zoomOut() {
        var r = applyZoomFactor(zoomWindow, [globalXMin, globalXMax], totalSpan, 1.6,
          function (a, b) { return allPoints.some(function (p) { return p.x >= a && p.x <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function panLeft() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, -0.5,
          function (a, b) { return allPoints.some(function (p) { return p.x >= a && p.x <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      },
      function panRight() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalXMin, globalXMax], totalSpan, 0.5,
          function (a, b) { return allPoints.some(function (p) { return p.x >= a && p.x <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      });
    container.appendChild(controlsWrap);

    // Wheel zoom handler (same approach as lineChart, with safety checks).
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var svgEl = container.querySelector('svg');
      if (!svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      var mxRel = (e.clientX - rect.left) / rect.width;
      var W = opts.width || (container.clientWidth || 800);
      var m = isNarrow(W)
        ? { left: isVeryNarrow(W) ? 46 : 52, right: 16 }
        : { left: 60, right: 140 };
      var iw = W - m.left - m.right;
      var mxSvg = mxRel * W;
      var xMin = zoomWindow ? zoomWindow[0] : globalXMin;
      var xMax = zoomWindow ? zoomWindow[1] : globalXMax;
      var focal = xMin + Math.max(0, Math.min(1, (mxSvg - m.left) / iw)) * (xMax - xMin);
      var factor = e.deltaY < 0 ? 0.8 : 1.25;
      var curSpan = (xMax - xMin) || totalSpan;
      var minSpan = Math.max(86400 * 60, totalSpan * 0.03);
      var newSpan = Math.max(minSpan, Math.min(totalSpan, curSpan * factor));
      var newStart = focal - (focal - xMin) * (newSpan / curSpan);
      var newEnd = newStart + newSpan;
      if (newStart < globalXMin) { newStart = globalXMin; newEnd = Math.min(globalXMax, newStart + newSpan); }
      if (newEnd > globalXMax) { newEnd = globalXMax; newStart = Math.max(globalXMin, newEnd - newSpan); }
      var hasRecord = allPoints.some(function (p) { return p.x >= newStart && p.x <= newEnd; });
      if (!hasRecord) return;
      if (newEnd - newStart >= totalSpan - 1) {
        zoomWindow = null;
        clearPresetActive();
        presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
      } else {
        zoomWindow = [newStart, newEnd];
        clearPresetActive();
      }
      render();
    }, { passive: false });

    // Drag-to-pan — hold mouse / touch + move to pan the zoomed view.
    // User: "i want to also pan by just dragging my finger on the graph
    // (or by holding mouse)".
    function mlMargins(W) {
      return isNarrow(W)
        ? { top: 16, right: 16, bottom: 34, left: isVeryNarrow(W) ? 46 : 52 }
        : { top: 16, right: 140, bottom: 36, left: 60 };
    }
    var dragPan = addDragPan(container, {
      getZoom: function () { return zoomWindow; },
      getGlobal: function () { return [globalXMin, globalXMax]; },
      getWidth: function () { return opts.width || (container.clientWidth || 800); },
      getMargins: function () {
        var W = opts.width || (container.clientWidth || 800);
        return mlMargins(W);
      },
      hasPoint: function (a, b) {
        return allPoints.some(function (p) { return p.x >= a && p.x <= b; });
      },
      onPan: function (win) { zoomWindow = win; clearPresetActive(); render(); },
    });

    function render() {
      // Update drag cursor — only "grab" when zoomed in.
      dragPan.setDraggable(!!zoomWindow);
      var prevSvg = container.querySelector('svg');
      if (prevSvg) prevSvg.remove();
      var prevEmpty = container.querySelector('.empty-state');
      if (prevEmpty) prevEmpty.remove();

      var W = opts.width || container.clientWidth || 800;
      var H = opts.height || 380;
      // Responsive margins: legend moves below the chart on narrow screens.
      var m = mlMargins(W);
      var iw = W - m.left - m.right;
      var ih = H - m.top - m.bottom;

      // Filter points by zoom window, but KEEP the last point before the
      // window for each series so lines extend to the left edge (user:
      // "chart lines completely break ... dots on the left are not in
      // zoomed in section"). This "leading point" anchors the line.
      var visXMin = zoomWindow ? zoomWindow[0] : globalXMin;
      var visXMax = zoomWindow ? zoomWindow[1] : globalXMax;
      var visSeries = series.map(function (s) {
        var visible = s.points.filter(function (p) { return p.x >= visXMin && p.x <= visXMax; });
        if (!visible.length) {
          // find the last point before visXMin
          var prev = null;
          for (var i = 0; i < s.points.length; i++) {
            if (s.points[i].x < visXMin) prev = s.points[i];
            else break;
          }
          if (prev) visible = [prev];
        } else {
          // prepend the last point before visXMin as a leading anchor
          var lead = null;
          for (var j = 0; j < s.points.length; j++) {
            if (s.points[j].x < visXMin) lead = s.points[j];
            else break;
          }
          if (lead) visible = [lead].concat(visible);
        }
        return { label: s.label, color: s.color, points: visible };
      });
      var visPoints = [];
      visSeries.forEach(function (s) { s.points.forEach(function (p) { if (p.x >= visXMin && p.x <= visXMax) visPoints.push(p); }); });
      if (!visPoints.length) {
        // Clamp back: reset to All if zoom produced no visible points.
        zoomWindow = null;
        clearPresetActive();
        presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
        visXMin = globalXMin; visXMax = globalXMax;
        visSeries = series.map(function (s) {
          return { label: s.label, color: s.color, points: s.points.slice() };
        });
        visPoints = allPoints.slice();
      }

      var yMin = Math.min.apply(null, visPoints.map(function (p) { return p.y; }));
      var yMax = Math.max.apply(null, visPoints.map(function (p) { return p.y; }));
      var yPad = (yMax - yMin) * 0.08 || 0.1;
      var tk = niceTimeTicks(Math.max(0, yMin - yPad), yMax + yPad, 6);

      var xScale = function (v) { return m.left + ((v - visXMin) / (visXMax - visXMin || 1)) * iw; };
      var yScale = function (v) { return m.top + (1 - (v - tk.min) / (tk.max - tk.min || 1)) * ih; };

      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H });
      svg.style.width = '100%';

      // grid + Y labels
      tk.ticks.forEach(function (tv) {
        var y = yScale(tv);
        if (y < m.top || y > m.top + ih) return;
        svg.appendChild(el('line', { class: 'chart-grid-line', x1: m.left, y1: y, x2: m.left + iw, y2: y }));
        svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left - 6, y: y + 3, 'text-anchor': 'end' }, fmtTick(tv, true)));
      });

      // X labels — show every year when span is small enough.
      var xTicks = yearTicks(visXMin, visXMax, yearTickTarget(W));
      xTicks.forEach(function (t) {
        var x = xScale(t);
        svg.appendChild(el('text', { class: 'chart-axis-label', x: x, y: m.top + ih + 16, 'text-anchor': 'middle' }, String(new Date(t * 1000).getUTCFullYear())));
      });

      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

      var tooltip = makeTooltip(container);
      visSeries.forEach(function (s) {
        if (!s.points.length) return;
        var d = '';
        s.points.forEach(function (p, i) {
          var x = xScale(p.x), y = yScale(p.y);
          // Clamp leading point to left edge so line extends to chart border.
          if (i === 0 && p.x < visXMin) x = m.left;
          d += (i === 0 ? 'M' : ' L') + x.toFixed(1) + ',' + y.toFixed(1);
        });
        svg.appendChild(el('path', { class: 'chart-line', d: d, stroke: s.color, 'stroke-width': 2, opacity: 0.9 }));
        // Show ALL dot labels with backgrounds (user: "no labels over each dot
        // like in history graphs"). Match WR Progression chart style.
        s.points.forEach(function (p, idx) {
          if (p.x < visXMin || p.x > visXMax) return; // skip leading anchor
          var x = xScale(p.x), y = yScale(p.y);
          var dot = el('circle', {
            class: 'chart-dot', cx: x.toFixed(1), cy: y.toFixed(1), r: 3.5,
            fill: s.color, stroke: '#0e0e0e', 'stroke-width': 1,
          });
          dot.addEventListener('mouseenter', function (e) {
            var tt = '<div style="color:' + s.color + ';font-weight:700">' + U.esc(s.label) + '</div>' +
              '<div class="tt-label">' + U.fmtDate(p.rec) + '</div>' +
              '<div class="tt-value">' + U.fmtTime(p.y) + '</div>' +
              '<div style="color:' + U.playerColor(p.rec.player) + '">' + U.esc(p.rec.player) + '</div>';
            if (p.rec.movecount != null) tt += '<div class="tt-label">moves: ' + U.fmtMovecount(p.rec.movecount, false) + '</div>';
            if (p.rec.tps != null) tt += '<div class="tt-label">tps: ' + U.fmtTps(p.rec.tps) + '</div>';
            tooltip.show(e.clientX, e.clientY, tt);
          });
          dot.addEventListener('mouseleave', function () { tooltip.hide(); });
          svg.appendChild(dot);
          // Label with background above EVERY dot (not just the last).
          var lab = U.fmtTime(p.y).replace(/s$/, '');
          var labW = lab.length * 5 + 4;
          var labH = 11;
          var labY = y - 10;
          if (labY < m.top + 9) labY = y + 14;
          svg.appendChild(el('rect', {
            x: (x - labW / 2).toFixed(1), y: (labY - labH + 2).toFixed(1),
            width: labW, height: labH, rx: 2,
            fill: '#0e0e0e', opacity: 0.88, 'pointer-events': 'none',
          }));
          svg.appendChild(el('text', {
            x: x.toFixed(1), y: labY.toFixed(1),
            'text-anchor': 'middle', 'font-size': '9', 'font-weight': '700',
            fill: s.color, 'pointer-events': 'none',
          }, lab));
        });
      });

      // legend — on narrow screens render below the chart as HTML so the
      // 140px right gutter doesn't crush the plot area.
      if (isNarrow(W)) {
        var prevMLLegend = container.querySelector('.chart-legend-below');
        if (prevMLLegend) prevMLLegend.remove();
        var mlLegend = document.createElement('div');
        mlLegend.className = 'chart-legend chart-legend-below';
        mlLegend.style.padding = '8px 4px 0 4px';
        series.forEach(function (s) {
          var item = document.createElement('span');
          item.className = 'legend-item';
          var dot = document.createElement('span');
          dot.className = 'legend-dot';
          dot.style.background = s.color;
          dot.style.color = s.color;
          item.appendChild(dot);
          item.appendChild(document.createTextNode(s.label));
          mlLegend.appendChild(item);
        });
        container.appendChild(mlLegend);
      } else {
        var legendY = m.top + 4;
        series.forEach(function (s) {
          svg.appendChild(el('rect', { x: m.left + iw + 8, y: legendY, width: 12, height: 12, fill: s.color, rx: 2 }));
          svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left + iw + 24, y: legendY + 10 }, s.label));
          legendY += 18;
        });
      }

      container.appendChild(svg);

      var startYear = new Date(visXMin * 1000).getUTCFullYear();
      var endYear = new Date(visXMax * 1000).getUTCFullYear();
      infoSpan.textContent = series.length + ' categor' + (series.length === 1 ? 'y' : 'ies') + ' · ' + startYear + '–' + endYear;
    }
    render();
  }

  /* ============================================================
   * Bar chart — for player stats (current WRs, snipes, records ever, etc.)
   * ============================================================ */
  function barChart(container, items, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var W = opts.width || container.clientWidth || 600;
    var H = opts.height || Math.max(200, items.length * 28 + 40);
    // Responsive left margin for the player-name labels: 140px on desktop,
    // shrinks on mobile so the bars aren't crushed. Player names are short
    // (≤10 chars) so 88px is enough even at the narrowest widths.
    var mLeft = isVeryNarrow(W) ? 84 : isNarrow(W) ? 104 : 140;
    var m = { top: 12, right: 16, bottom: 24, left: mLeft };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;
    var barH = Math.min(24, ih / items.length - 4);

    if (!items.length) { container.appendChild(emptyChart('No data', W, H)); return; }

    var maxVal = Math.max.apply(null, items.map(function (i) { return i.value; }));
    var tk = niceTicks(0, maxVal, 5);

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H });

    // grid + X labels
    tk.ticks.forEach(function (tv) {
      if (tv < 0) return;
      var x = m.left + (tv / (tk.max || 1)) * iw;
      svg.appendChild(el('line', { class: 'chart-grid-line', x1: x, y1: m.top, x2: x, y2: m.top + ih }));
      svg.appendChild(el('text', { class: 'chart-axis-label', x: x, y: m.top + ih + 14, 'text-anchor': 'middle' }, fmtTick(tv, false)));
    });

    svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
    svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

    var tooltip = makeTooltip(container);
    items.forEach(function (item, i) {
      var y = m.top + i * (ih / items.length) + (ih / items.length - barH) / 2;
      var w = (item.value / (tk.max || 1)) * iw;
      var color = item.color || U.playerColor(item.label);
      var bar = el('rect', {
        class: 'chart-bar', x: m.left, y: y, width: Math.max(0, w), height: barH,
        fill: color, opacity: 0.85, rx: 2,
      });
      bar.addEventListener('mouseenter', function (e) {
        tooltip.show(e.clientX, e.clientY,
          '<div style="color:' + color + ';font-weight:700">' + item.label + '</div>' +
          '<div class="tt-value">' + item.value + '</div>' +
          (item.sub ? '<div class="tt-label">' + item.sub + '</div>' : ''));
      });
      bar.addEventListener('mouseleave', function () { tooltip.hide(); });
      if (opts.onBarClick) {
        bar.addEventListener('click', function () { opts.onBarClick(item); });
        bar.style.cursor = 'pointer';
      }
      svg.appendChild(bar);

      // label
      var labCls = 'chart-axis-label' + (opts.onLabelClick ? ' clickable' : '');
      var labStyle = opts.onLabelClick ? 'cursor:pointer;fill:' + color + ';font-weight:700' : 'fill:' + color;
      var labEl = el('text', {
        class: labCls, x: m.left - 6, y: y + barH / 2 + 3,
        'text-anchor': 'end',
        style: labStyle,
        'data-label': String(item.label),
      }, item.label.length > 18 ? item.label.slice(0, 16) + '…' : item.label);
      if (opts.onLabelClick) {
        labEl.addEventListener('click', function () { opts.onLabelClick(item); });
      }
      svg.appendChild(labEl);

      // value at end of bar — ALWAYS show, even for tiny bars (user reported
      // small entries had no numbers). Place just after the bar end.
      svg.appendChild(el('text', {
        class: 'chart-bar-value', x: m.left + Math.max(0, w) + 4, y: y + barH / 2 + 3,
        fill: color, 'font-weight': '700',
      }, String(item.value)));
    });

    container.appendChild(svg);
  }

  /* ============================================================
   * Vertical bar chart — for records-per-year (X = category, Y = count)
   * ============================================================ */
  function vbarChart(container, items, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var W = opts.width || container.clientWidth || 600;
    var H = opts.height || 220;
    // Adaptive bottom margin: when there are MANY bars (e.g. 14 years for
    // 2013..2026) on a NARROW screen, horizontal "2013" labels collide.
    // Rotate them -45° and give the labels more vertical room.
    // User: "Records by Years - X labels still overlap on smaller screens,
    // there are many years".
    var n = items.length;
    // Per-bar slot width (px) inside the chart area. If too narrow for a
    // 4-char "2013" label (~28px at 11px font), switch to rotated labels.
    var slotW = (W - 40 - 16) / Math.max(1, n);
    var rotateLabels = n > 7 && slotW < 36;
    var bottomMargin = rotateLabels ? 64 : 36;
    var m = { top: 16, right: 16, bottom: bottomMargin, left: 40 };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;

    if (!items.length) { container.appendChild(emptyChart('No data', W, H)); return; }

    var maxVal = Math.max.apply(null, items.map(function (i) { return i.value; }));
    var tk = niceTicks(0, maxVal, 5);

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H });

    // grid + Y labels
    tk.ticks.forEach(function (tv) {
      if (tv < 0) return;
      var y = m.top + ih - (tv / (tk.max || 1)) * ih;
      svg.appendChild(el('line', { class: 'chart-grid-line', x1: m.left, y1: y, x2: m.left + iw, y2: y }));
      svg.appendChild(el('text', { class: 'chart-axis-label', x: m.left - 6, y: y + 3, 'text-anchor': 'end' }, fmtTick(tv, false)));
    });

    svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
    svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

    var barW = iw / items.length;
    var gap = barW * 0.18;
    var actualBarW = barW - gap;
    var tooltip = makeTooltip(container);

    items.forEach(function (item, i) {
      var x = m.left + i * barW + gap / 2;
      var h = (item.value / (tk.max || 1)) * ih;
      var y = m.top + ih - h;
      var color = item.color || opts.color || '#00bcd4';
      var bar = el('rect', {
        class: 'chart-bar', x: x.toFixed(1), y: y.toFixed(1),
        width: Math.max(0, actualBarW).toFixed(1), height: Math.max(0, h).toFixed(1),
        fill: color, opacity: 0.85, rx: 2,
      });
      bar.addEventListener('mouseenter', function (e) {
        tooltip.show(e.clientX, e.clientY,
          '<div style="color:' + color + ';font-weight:700">' + item.label + '</div>' +
          '<div class="tt-value">' + item.value + (item.sub ? ' ' + item.sub : '') + '</div>');
      });
      bar.addEventListener('mouseleave', function () { tooltip.hide(); });
      if (opts.onBarClick) {
        bar.addEventListener('click', function () { opts.onBarClick(item); });
        bar.style.cursor = 'pointer';
      }
      svg.appendChild(bar);

      // X label (year). Rotated -45° when bars are narrow so labels never
      // overlap. text-anchor='end' + rotate makes text read up-and-to-the-right.
      var labX = x + actualBarW / 2;
      var labY = m.top + ih + 14;
      if (rotateLabels) {
        svg.appendChild(el('text', {
          class: 'chart-axis-label', x: labX, y: labY,
          'text-anchor': 'end',
          transform: 'rotate(-45 ' + labX + ' ' + labY + ')',
        }, String(item.label)));
      } else {
        svg.appendChild(el('text', {
          class: 'chart-axis-label', x: labX, y: labY,
          'text-anchor': 'middle',
        }, String(item.label)));
      }

      // Value on top of bar — ALWAYS show, even for tiny bars.
      // User: "missing numbers above bars for small values".
      // Clamp Y so the number stays inside the chart area (not above it).
      var valY = Math.max(m.top + 9, y - 4);
      svg.appendChild(el('text', {
        class: 'chart-bar-value', x: x + actualBarW / 2, y: valY,
        'text-anchor': 'middle', fill: color, 'font-weight': '700', 'font-size': '11',
      }, String(item.value)));
    });

    container.appendChild(svg);
  }

  /* ============================================================
   * Timeline chart — "Who held the record, and for how long"
   * X = date (time), Y = player lanes. Each reign = a horizontal bar.
   * This is a proper flowchart-style timeline.
   *
   * Now supports scrollwheel + button zoom (user: "Who Held the Record
   * should have zoom feature as well"). Same zoom safety as lineChart:
   * never zoom so far that the graph disappears.
   * ============================================================ */
  function reignTimeline(container, reigns, opts) {
    opts = opts || {};
    container.innerHTML = '';

    // sort reigns by start time
    reigns = reigns.slice().sort(function (a, b) { return a.startTime - b.startTime; });
    if (!reigns.length) { container.appendChild(emptyChart('No reign data', 900, 200)); return; }

    // collect unique players in order of first reign
    var playerOrder = [];
    var playerSet = {};
    reigns.forEach(function (rg) {
      if (!playerSet[rg.player]) { playerSet[rg.player] = true; playerOrder.push(rg.player); }
    });

    var globalTMin = reigns[0].startTime;
    var globalTMax = Math.max.apply(null, reigns.map(function (r) { return r.endTime; }));
    if (globalTMax <= globalTMin) globalTMax = globalTMin + DAY;
    var totalSpan = Math.max(1, globalTMax - globalTMin);

    var globalStartYear = new Date(globalTMin * 1000).getUTCFullYear();
    var globalEndYear = new Date(globalTMax * 1000).getUTCFullYear();
    var totalYears = Math.max(1, globalEndYear - globalStartYear + 1);

    var zoomWindow = null;

    // Zoom controls (preset buttons + scrollwheel).
    var controlsWrap = document.createElement('div');
    controlsWrap.className = 'chart-controls';
    controlsWrap.style.marginBottom = '6px';
    var presets = [];
    if (totalYears >= 2) presets.push({ label: '1y', years: 1 });
    if (totalYears >= 4) presets.push({ label: '3y', years: 3 });
    if (totalYears >= 8) presets.push({ label: '5y', years: 5 });
    presets.push({ label: 'All', years: 0 });
    var presetBtns = [];
    presets.forEach(function (p) {
      var btn = document.createElement('button');
      btn.className = 'zoom-btn' + (p.years === 0 ? ' active' : '');
      btn.textContent = p.label;
      btn.addEventListener('click', function () {
        if (p.years === 0) {
          zoomWindow = null;
        } else {
          var sy = Math.max(globalStartYear, globalEndYear - p.years + 1);
          zoomWindow = [Date.UTC(sy, 0, 1) / 1000, globalTMax];
        }
        presetBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        render();
      });
      presetBtns.push(btn);
      controlsWrap.appendChild(btn);
    });
    function clearPresetActive() { presetBtns.forEach(function (b) { b.classList.remove('active'); }); }
    var infoSpan = document.createElement('span');
    infoSpan.className = 'zoom-info';
    controlsWrap.appendChild(infoSpan);
    var hint = document.createElement('span');
    hint.className = 'zoom-hint';
    hint.textContent = 'scroll to zoom';
    controlsWrap.appendChild(hint);
    // Touch + / − zoom buttons + ◀ ▶ pan buttons.
    // User: "Same for Whol Held the record and all other graphs used in the project".
    addTouchZoomButtons(controlsWrap,
      function zoomIn() {
        var r = applyZoomFactor(zoomWindow, [globalTMin, globalTMax], totalSpan, 0.6,
          function (a, b) { return reigns.some(function (rg) { return rg.endTime >= a && rg.startTime <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function zoomOut() {
        var r = applyZoomFactor(zoomWindow, [globalTMin, globalTMax], totalSpan, 1.6,
          function (a, b) { return reigns.some(function (rg) { return rg.endTime >= a && rg.startTime <= b; }); });
        if (r === null) { zoomWindow = null; clearPresetActive(); presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); }); }
        else if (r) { zoomWindow = r; clearPresetActive(); }
        render();
      },
      function panLeft() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalTMin, globalTMax], totalSpan, -0.5,
          function (a, b) { return reigns.some(function (rg) { return rg.endTime >= a && rg.startTime <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      },
      function panRight() {
        if (!zoomWindow) return;
        var r = applyPan(zoomWindow, [globalTMin, globalTMax], totalSpan, 0.5,
          function (a, b) { return reigns.some(function (rg) { return rg.endTime >= a && rg.startTime <= b; }); });
        if (r) { zoomWindow = r; clearPresetActive(); render(); }
      });
    container.appendChild(controlsWrap);

    // Wheel zoom handler.
    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      var svgEl = container.querySelector('svg');
      if (!svgEl) return;
      var rect = svgEl.getBoundingClientRect();
      var mxRel = (e.clientX - rect.left) / rect.width;
      var W = container.clientWidth || 900;
      var m = reignMargins(W);
      var iw = W - m.left - m.right;
      var mxSvg = mxRel * W;
      var xMin = zoomWindow ? zoomWindow[0] : globalTMin;
      var xMax = zoomWindow ? zoomWindow[1] : globalTMax;
      var focal = xMin + Math.max(0, Math.min(1, (mxSvg - m.left) / iw)) * (xMax - xMin);
      var factor = e.deltaY < 0 ? 0.8 : 1.25;
      var curSpan = (xMax - xMin) || totalSpan;
      var minSpan = Math.max(86400 * 60, totalSpan * 0.03);
      var newSpan = Math.max(minSpan, Math.min(totalSpan, curSpan * factor));
      var newStart = focal - (focal - xMin) * (newSpan / curSpan);
      var newEnd = newStart + newSpan;
      if (newStart < globalTMin) { newStart = globalTMin; newEnd = Math.min(globalTMax, newStart + newSpan); }
      if (newEnd > globalTMax) { newEnd = globalTMax; newStart = Math.max(globalTMin, newEnd - newSpan); }
      // Check: would the new window overlap at least 1 reign?
      var hasReign = reigns.some(function (rg) {
        return rg.endTime >= newStart && rg.startTime <= newEnd;
      });
      if (!hasReign) return;
      if (newEnd - newStart >= totalSpan - 1) {
        zoomWindow = null;
        clearPresetActive();
        presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
      } else {
        zoomWindow = [newStart, newEnd];
        clearPresetActive();
      }
      render();
    }, { passive: false });

    // Drag-to-pan — hold mouse / touch + move to pan the zoomed view.
    // User: "i want to also pan by just dragging my finger on the graph
    // (or by holding mouse)".
    var dragPan = addDragPan(container, {
      getZoom: function () { return zoomWindow; },
      getGlobal: function () { return [globalTMin, globalTMax]; },
      getWidth: function () {
        var W = container.clientWidth || 900;
        if (W < 200) W = 900;
        return W;
      },
      getMargins: function () {
        var W = container.clientWidth || 900;
        if (W < 200) W = 900;
        return reignMargins(W);
      },
      hasPoint: function (a, b) {
        return reigns.some(function (rg) { return rg.endTime >= a && rg.startTime <= b; });
      },
      onPan: function (win) { zoomWindow = win; clearPresetActive(); render(); },
    });

    function render() {
      // Update drag cursor — only "grab" when zoomed in.
      dragPan.setDraggable(!!zoomWindow);
      var prevSvg = container.querySelector('svg');
      if (prevSvg) prevSvg.remove();
      var prevEmpty = container.querySelector('.empty-state');
      if (prevEmpty) prevEmpty.remove();

      var W = container.clientWidth || 900;
      if (W < 200) W = 900;
      var H = Math.max(160, playerOrder.length * 32 + 60);
      var m = reignMargins(W);
      var iw = W - m.left - m.right;
      var ih = H - m.top - m.bottom;

      var tMin = zoomWindow ? zoomWindow[0] : globalTMin;
      var tMax = zoomWindow ? zoomWindow[1] : globalTMax;
      if (tMax <= tMin) tMax = tMin + DAY;

      // Filter reigns: show any reign that overlaps [tMin, tMax].
      var visReigns = reigns.filter(function (rg) {
        return rg.endTime >= tMin && rg.startTime <= tMax;
      });
      if (!visReigns.length) {
        // Clamp back to All.
        zoomWindow = null;
        clearPresetActive();
        presetBtns.forEach(function (b) { if (b.textContent === 'All') b.classList.add('active'); });
        tMin = globalTMin; tMax = globalTMax;
        visReigns = reigns.slice();
      }

      var xScale = function (t) { return m.left + ((t - tMin) / (tMax - tMin || 1)) * iw; };
      var laneH = ih / playerOrder.length;
      var yScale = function (player) {
        var idx = playerOrder.indexOf(player);
        return m.top + idx * laneH + laneH / 2;
      };

      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H });
      svg.style.width = '100%';

      // X axis: year ticks (responsive target on narrow screens)
      var xTicks = yearTicks(tMin, tMax, yearTickTarget(W));
      // On narrow screens shrink the axis label font so years don't overlap.
      var axisFontSize = isVeryNarrow(W) ? 9 : 10;
      xTicks.forEach(function (t) {
        var x = xScale(t);
        if (x < m.left || x > m.left + iw) return;
        svg.appendChild(el('line', { class: 'chart-grid-line', x1: x, y1: m.top, x2: x, y2: m.top + ih }));
        svg.appendChild(el('text', { class: 'chart-axis-label', x: x, y: m.top + ih + 16, 'text-anchor': 'middle', 'font-size': String(axisFontSize) }, String(new Date(t * 1000).getUTCFullYear())));
      });

      // Y axis: player lane labels — colored and clickable.
      // On narrow screens shrink the label font so long player names still
      // fit in the reduced left margin without being clipped.
      var labFontSize = isVeryNarrow(W) ? 9 : 10;
      playerOrder.forEach(function (p, i) {
        var y = m.top + i * laneH + laneH / 2;
        if (i % 2 === 0) {
          svg.appendChild(el('rect', { x: m.left, y: m.top + i * laneH, width: iw, height: laneH, fill: 'rgba(255,255,255,0.015)' }));
        }
        var lab = el('text', {
          class: 'chart-axis-label clickable', x: m.left - 6, y: y + 4,
          'text-anchor': 'end',
          style: 'fill:' + U.playerColor(p) + ';font-weight:600;font-size:' + labFontSize + 'px',
          'data-player': p,
        }, p);
        if (opts.onPlayerClick) {
          lab.addEventListener('click', function () { opts.onPlayerClick(p); });
        }
        svg.appendChild(lab);
      });

      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top, x2: m.left, y2: m.top + ih }));
      svg.appendChild(el('line', { class: 'chart-axis', x1: m.left, y1: m.top + ih, x2: m.left + iw, y2: m.top + ih }));

      // reign bars
      var tooltip = makeTooltip(container);
      var barH = Math.min(18, laneH - 6);
      visReigns.forEach(function (rg) {
        // Clamp reign bar to the visible window.
        var rs = Math.max(rg.startTime, tMin);
        var re = Math.min(rg.endTime, tMax);
        var x1 = xScale(rs);
        var x2 = xScale(re);
        var y = yScale(rg.player) - barH / 2;
        var w = Math.max(3, x2 - x1);
        var color = U.playerColor(rg.player);
        var bar = el('rect', {
          class: 'chart-bar', x: x1.toFixed(1), y: y.toFixed(1),
          width: w.toFixed(1), height: barH, fill: color, opacity: 0.7, rx: 3,
        });
        if (rg.current) {
          bar.setAttribute('stroke', color);
          bar.setAttribute('stroke-width', '2');
          bar.setAttribute('opacity', '0.9');
        }
        bar.addEventListener('mouseenter', function (e) {
          var days = rg.durationDays;
          // When time-travelling, an open-ended (current) reign ends at the
          // cutoff date, not real "now" — show that date so the tooltip is
          // honest about the time-travelled state.
          var endLabel;
          if (rg.endRec) {
            endLabel = U.fmtDate(rg.endRec);
          } else if (U.isTimeTravelling()) {
            // Build a DD Mon YYYY label from the cutoff timestamp.
            var d = new Date(U.getNow() * 1000);
            var ms = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            endLabel = d.getUTCDate() + ' ' + ms[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
          } else {
            endLabel = 'now';
          }
          var tt = '<div style="color:' + color + ';font-weight:700">' + U.esc(rg.player) + '</div>' +
            '<div class="tt-label">' + U.fmtDate(rg.record) + ' → ' + endLabel + '</div>' +
            '<div class="tt-value">' + U.fmtTime(rg.bestTime) + ' · ' + U.fmtDuration(days) + '</div>';
          if (rg.record.movecount != null) tt += '<div class="tt-label">moves: <b style="color:var(--text)">' + U.fmtMovecount(rg.record.movecount, false) + '</b></div>';
          if (rg.record.tps != null) tt += '<div class="tt-label">tps: <b style="color:var(--text)">' + U.fmtTps(rg.record.tps) + '</b></div>';
          if (rg.record.control) tt += '<div class="tt-label">control: <b style="color:var(--text)">' + U.esc(rg.record.control) + '</b></div>';
          if (rg.record.style) tt += '<div class="tt-label">style: <b style="color:var(--text)">' + U.esc(rg.record.style) + '</b></div>';
          if (rg.record.hasReplay) tt += '<div class="tt-label">replay: <b style="color:' + (rg.record.replayAccurate === true ? 'var(--delta-up)' : rg.record.replayAccurate === false ? 'var(--c-keyboard)' : 'var(--text)') + '">' + (rg.record.replayAccurate === true ? 'accurate' : rg.record.replayAccurate === false ? 'inaccurate' : 'yes') + '</b></div>';
          if (rg.endRec) tt += '<div class="tt-label" style="margin-top:4px">beaten by: <b style="color:' + U.playerColor(rg.endRec.player) + '">' + U.esc(rg.endRec.player) + '</b> (' + U.fmtTime(rg.endRec.time) + ')</div>';
          if (rg.current) tt += '<div class="tt-label" style="color:var(--cyan-bright)">current WR holder</div>';
          if (rg.record.notes) tt += '<div class="tt-label" style="margin-top:4px;max-width:240px;white-space:normal">✎ ' + U.esc(rg.record.notes.slice(0,120)) + (rg.record.notes.length > 120 ? '…' : '') + '</div>';
          tooltip.show(e.clientX, e.clientY, tt);
        });
        bar.addEventListener('mouseleave', function () { tooltip.hide(); });
        if (opts.onReignClick) {
          bar.addEventListener('click', function () { opts.onReignClick(rg); });
          bar.style.cursor = 'pointer';
        }
        svg.appendChild(bar);

        // Time label inside bar — show ONLY the time.
        if (w > 38) {
          svg.appendChild(el('text', {
            x: x1 + w / 2, y: y + barH / 2 + 3,
            'text-anchor': 'middle', 'font-weight': '700', 'font-size': '10',
            style: 'fill:#000;font-family:var(--font-mono)',
          }, U.fmtTime(rg.bestTime).replace(/s$/, '')));
        }
      });

      container.appendChild(svg);

      var startYear = new Date(tMin * 1000).getUTCFullYear();
      var endYear = new Date(tMax * 1000).getUTCFullYear();
      infoSpan.textContent = visReigns.length + ' reign' + (visReigns.length === 1 ? '' : 's') + ' · ' + startYear + '–' + endYear;
    }
    render();
  }

  /* ============================================================
   * Mini sparkline — for category cards
   * SEGMENT-COLORED: each segment between consecutive records is colored
   * by the player who held the record during that period.
   * ============================================================ */
  function sparkline(container, records, opts) {
    opts = opts || {};
    container.innerHTML = '';
    var W = opts.width || container.clientWidth || 280;
    var H = opts.height || 40;
    var m = { top: 4, right: 4, bottom: 4, left: 4 };
    var iw = W - m.left - m.right;
    var ih = H - m.top - m.bottom;

    var recs = records.filter(function (r) { return r.time != null && r.dateSortKey > 0; });
    if (!recs.length) { return; }

    var xs = recs.map(function (r) { return r.dateSortKey; });
    var ys = recs.map(function (r) { return r.time; });
    var xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs);
    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    if (yMax === yMin) yMax = yMin + 1;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none' });
    var xS = function (v) { return m.left + ((v - xMin) / (xMax - xMin || 1)) * iw; };
    var yS = function (v) { return m.top + (1 - (v - yMin) / (yMax - yMin || 1)) * ih; };

    // Draw segments — each colored by the player who held the record during that span.
    // User: "same applied to the category's full graph itself, instead of just coloring the dots".
    for (var i = 0; i < recs.length - 1; i++) {
      var x1 = xS(recs[i].dateSortKey), y1 = yS(recs[i].time);
      var x2 = xS(recs[i+1].dateSortKey), y2 = yS(recs[i+1].time);
      var segColor = U.playerColor(recs[i].player);
      var segD = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ',' + y2.toFixed(1);
      svg.appendChild(el('path', { d: segD, fill: 'none', stroke: segColor, 'stroke-width': 1.5, opacity: 0.85, 'stroke-linecap': 'round' }));
      // area under segment
      var segArea = segD + ' L' + x2.toFixed(1) + ',' + (m.top+ih) + ' L' + x1.toFixed(1) + ',' + (m.top+ih) + ' Z';
      svg.appendChild(el('path', { d: segArea, fill: segColor, opacity: 0.1 }));
    }
    // last dot — colored by current holder
    var last = recs[recs.length - 1];
    svg.appendChild(el('circle', { cx: xS(last.dateSortKey), cy: yS(last.time), r: 2.5, fill: U.playerColor(last.player) }));
    container.appendChild(svg);
  }

  /* ============================================================
   * Heatmap — activity grid (e.g. records by month×player, or by category×player)
   * data = [{ x: label, y: label, v: count }]
   * Redesign: responsive cell sizing, numbers in cells, proper tooltips.
   * ============================================================ */
  function heatmap(container, data, opts) {
    opts = opts || {};
    container.innerHTML = '';
    if (!data.length) { container.appendChild(emptyChart('No data', 400, 200)); return; }

    var xs = unique(data.map(function (d) { return d.x; }));
    var ys = unique(data.map(function (d) { return d.y; }));
    var maxV = Math.max.apply(null, data.map(function (d) { return d.v; })) || 1;

    // Responsive cell sizing: aim for a target chart width, clamp cell size.
    var containerW = container.clientWidth || 800;
    // Allocate more label space to avoid truncation/overlap (user complaint).
    var labelW = opts.labelW || 130;
    // labelH scales with how many X labels there are and their rotation.
    // Steeper rotation (-55°) needs more vertical room.
    var labelH = opts.labelH || 70;
    var gap = 1;
    var targetW = Math.min(containerW, 1200);
    var availW = targetW - labelW - 20;
    var cellW = opts.cellW || Math.max(16, Math.min(40, Math.floor(availW / xs.length) - gap));
    var cellH = opts.cellH || Math.max(20, Math.min(34, cellW));
    var W = labelW + xs.length * (cellW + gap) + 20;
    var H = labelH + ys.length * (cellH + gap) + 20;

    // Always show numbers when there's enough horizontal room (cells >= 16px).
    // User: "Player × Category Heatmap, which is missing numbers".
    // Previous threshold was cellW >= 22 which excluded the 20px cells used
    // by playerCategoryHeatmap. Lowered to 16 so numbers always appear.
    var showNumbers = cellW >= 16 && cellH >= 16;
    // Font size for cell numbers — scaled to cell size.
    var numFont = Math.max(8, Math.min(11, Math.floor(Math.min(cellW, cellH) * 0.42)));

    // Adaptive X-label rotation: when there are MANY categories (e.g. the
    // Player × Category heatmap has 45), -55° labels still overlap.
    // Switch to -90° (vertical) for dense charts to eliminate overlap.
    // User: "Heatmaps still have major overlapping issues with the label axis".
    // FIX: with text-anchor='end' and rotate(-55°), the text extends DOWN
    // into the cells. Switched to text-anchor='start' + rotate(-55°) so
    // text extends UP-and-right (away from cells). For -90°, text-anchor='start'
    // makes text read bottom-to-top directly above the anchor.
    var xRot;
    if (opts.xRot != null) {
      xRot = opts.xRot;
    } else if (xs.length > 22) {
      xRot = -90;                       // vertical labels for dense charts
      labelH = Math.max(labelH, 110);   // room for vertical text (up to ~14 chars)
    } else {
      xRot = -55;
      labelH = Math.max(labelH, 80);    // room for rotated text
    }
    // Recompute H in case labelH changed.
    H = labelH + ys.length * (cellH + gap) + 20;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'xMidYMid meet' });
    // Use the natural intrinsic width (W px) — do NOT shrink to fit the
    // container. The .heatmap-wrap parent has overflow-x:auto so wide
    // heatmaps (e.g. Player × Category with 45 cols × 24px = 1100+ px)
    // scroll horizontally instead of being squished into unreadable cells.
    // User: "Player X Category Heatmap - very tiny on mobile, have too zoom
    // in (there are 45 categories horizontally)".
    // User: "Activity Heatmap - overflows off screen to the right, also its
    // still shifted weirdly even on PC, maybe some weird interaction with
    // legend?" — the shift was caused by SVG being centered via margin:auto
    // while the legend (a separate flex row) was left-aligned. Now both are
    // children of a single .heatmap-inner inline-block wrapper that's
    // centered via text-align:center on the container, so the legend stays
    // aligned with the SVG at every width.
    svg.setAttribute('width', W);
    svg.style.display = 'block';
    // FIX: use text-anchor='start' so rotated text extends UP-and-right
    // (away from cells). Previously text-anchor='end' made text extend
    // DOWN into the cells. Anchor at cell-center; for -90° text reads
    // bottom-to-top directly above the cell.
    var xTrunc = xRot === -90 ? 16 : 12;
    xs.forEach(function (x, i) {
      var cx = labelW + i * (cellW + gap) + cellW / 2;
      var lab = String(x);
      if (lab.length > xTrunc) lab = lab.slice(0, xTrunc - 1) + '…';
      svg.appendChild(el('text', {
        class: 'chart-axis-label' + (opts.onXLabelClick ? ' clickable' : ''),
        x: cx, y: labelH - 4,
        'text-anchor': 'start',
        transform: 'rotate(' + xRot + ' ' + cx + ' ' + (labelH - 4) + ')',
        'data-x': String(x),
      }, lab));
    });
    // Wire clickable X labels (e.g. category names in player×category heatmap)
    if (opts.onXLabelClick) {
      svg.querySelectorAll('.chart-axis-label.clickable[data-x]').forEach(function (t) {
        t.addEventListener('click', function () {
          opts.onXLabelClick(t.getAttribute('data-x'));
        });
      });
    }

    // Y labels (left) — truncate to 15 chars.
    // Y labels are clickable if opts.onYLabelClick is set (e.g. player names).
    ys.forEach(function (y, i) {
      var cy = labelH + i * (cellH + gap) + cellH / 2;
      var lab = String(y);
      if (lab.length > 15) lab = lab.slice(0, 14) + '…';
      var yCol = opts.yColor ? opts.yColor(y) : null;
      // Use inline style for fill because the .chart-axis-label CSS class
      // sets fill:var(--text-dim) which would override the SVG fill attribute.
      var styleStr = yCol ? 'fill:' + yCol + ';font-weight:600' : '';
      var t = el('text', {
        class: 'chart-axis-label' + (opts.onYLabelClick ? ' clickable' : ''),
        x: labelW - 6, y: cy + 3,
        'text-anchor': 'end',
        style: styleStr,
        'data-y': String(y),
      }, lab);
      if (opts.onYLabelClick) {
        t.addEventListener('click', function () { opts.onYLabelClick(y); });
      }
      svg.appendChild(t);
    });

    // cells
    var tooltip = makeTooltip(container);
    data.forEach(function (d) {
      var xi = xs.indexOf(d.x);
      var yi = ys.indexOf(d.y);
      var cx = labelW + xi * (cellW + gap);
      var cy = labelH + yi * (cellH + gap);
      var intensity = d.v / maxV;
      var color = opts.colorFn ? opts.colorFn(intensity, d) : heatColor(intensity);
      var cell = el('rect', {
        x: cx, y: cy, width: cellW, height: cellH, rx: 2,
        fill: color, class: 'heatmap-cell',
      });
      // Always attach tooltip (even on 0-value cells so user gets feedback)
      cell.addEventListener('mouseenter', function (e) {
        var ttHtml = '<div style="font-weight:700;color:' + color + '">' + d.v + ' record' + (d.v !== 1 ? 's' : '') + '</div>' +
          '<div class="tt-label">' + U.esc(d.y) + ' · ' + U.esc(d.x) + '</div>';
        tooltip.show(e.clientX, e.clientY, ttHtml);
      });
      cell.addEventListener('mouseleave', function () { tooltip.hide(); });
      if (opts.onCellClick && d.v > 0) {
        cell.addEventListener('click', function () { opts.onCellClick(d); });
        cell.style.cursor = 'pointer';
      }
      svg.appendChild(cell);

      // Number inside cell (only if value > 0 and cell is big enough)
      if (showNumbers && d.v > 0) {
        // Choose text color based on background intensity for contrast
        var textColor = intensity > 0.55 ? '#000' : 'rgba(255,255,255,0.85)';
        svg.appendChild(el('text', {
          x: cx + cellW / 2, y: cy + cellH / 2 + numFont / 3,
          'text-anchor': 'middle', 'font-size': numFont, 'font-weight': '600',
          fill: textColor, 'pointer-events': 'none',
        }, String(d.v)));
      }
    });

    // Wrap SVG + legend in a single .heatmap-inner inline-block. This keeps
    // the legend horizontally aligned with the SVG (both inside the same
    // wrapper) instead of the SVG being centered while the legend hugs the
    // left edge of the container. User: "still shifted weirdly even on PC,
    // maybe some weird interaction with legend?".
    // inline-block + text-align:center on the parent centers the wrapper when
    // the SVG is narrower than the container; when the SVG is wider, the
    // wrapper overflows and the container's overflow-x:auto scrolls.
    var inner = document.createElement('div');
    inner.className = 'heatmap-inner';
    inner.appendChild(svg);

    // legend
    if (opts.showLegend !== false) {
      var legend = document.createElement('div');
      legend.className = 'heatmap-legend';
      legend.innerHTML = '<span>Less</span>';
      for (var i = 0; i <= 4; i++) {
        var sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = heatColor(i / 4);
        legend.appendChild(sw);
      }
      legend.innerHTML += '<span>More</span>';
      inner.appendChild(legend);
    }
    container.appendChild(inner);
  }

  function heatColor(intensity) {
    // cyan -> pink gradient
    intensity = Math.max(0, Math.min(1, intensity));
    if (intensity === 0) return 'rgba(255,255,255,0.03)';
    var r = Math.round(0 + intensity * 255);
    var g = Math.round(188 - intensity * 154);
    var b = Math.round(212 - intensity * 114);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function unique(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }

  function emptyChart(msg, W, H) {
    var div = document.createElement('div');
    div.className = 'empty-state';
    div.style.height = H + 'px';
    div.style.display = 'flex';
    div.style.alignItems = 'center';
    div.style.justifyContent = 'center';
    div.textContent = msg;
    return div;
  }

  var DAY = 86400;

  /* ---------- Exports ---------- */
  WR.lineChart = lineChart;
  WR.multiLineChart = multiLineChart;
  WR.activeRecordsChart = activeRecordsChart;
  WR.barChart = barChart;
  WR.vbarChart = vbarChart;
  WR.reignTimeline = reignTimeline;
  WR.sparkline = sparkline;
  WR.heatmap = heatmap;
  WR.niceTimeTicks = niceTimeTicks;
  WR.fmtTick = fmtTick;
  WR.hideAllTooltips = hideAllTooltips;
})();
