/* ============================================================
 * Slidysim WR History Browser — Automated Test Suite
 * ------------------------------------------------------------
 * Vanilla JS test runner (no framework). Run with:
 *   bun run test:wr        (or)  node public/wr-history/tests/run.js
 *
 * Tests the core logic in utils.js / charts.js against the real
 * wr-data.json, without needing a browser:
 *   - defensive formatting (no "undefined" / "NaN" / "null")
 *   - getCurrentWR returns all-time best (running minimum)
 *   - computeWRProgression (WR envelope)
 *   - reign computation (running-min based)
 *   - category-aware stats never compare cross-category
 *   - date edge-case formatting
 *   - player color determinism
 *   - chart helpers (niceTicks, trunc)
 *
 * The tests load utils.js into a minimal browser shim (window,
 * document stub, localStorage stub) so the IIFE attaches to
 * window.WR exactly as in the browser.
 * ============================================================ */
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
var DATA_PATH = path.join(ROOT, 'data', 'wr-data.json');
var UTILS_PATH = path.join(ROOT, 'js', 'utils.js');
var CHARTS_PATH = path.join(ROOT, 'js', 'charts.js');

// ---------- minimal browser shim ----------
// The scripts use `window`, `document`, `localStorage`, `history`, `location`.
// We make `window` reference the context itself so window.WR works.
var localStorageStore = {};
var context = vm.createContext({
  console: console,
  document: {
    createElement: function (tag) { return { tagName: tag, style: {}, setAttribute: function(){}, appendChild: function(c){ this.lastChild=c; }, addEventListener: function(){}, appendChild: function(){} }; },
    createElementNS: function (ns, tag) { return { tagName: tag, style: {}, setAttribute: function(){}, appendChild: function(c){ if(!this.children) this.children=[]; this.children.push(c); }, addEventListener: function(){}, textContent: '' }; },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    readyState: 'complete',
  },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(localStorageStore, k) ? localStorageStore[k] : null; },
    setItem: function (k, v) { localStorageStore[k] = String(v); },
  },
  history: { replaceState: function () {} },
  location: { hash: '' },
  Date: Date, Math: Math, parseInt: parseInt, isNaN: isNaN,
  Array: Array, Object: Object, JSON: JSON, String: String, Number: Number,
  setTimeout: setTimeout, Infinity: Infinity,
  addEventListener: function () {},
});
// window references the context itself (so window.WR === WR)
context.window = context;

// ---------- load data ----------
var rawData = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
context.WR_DATA = rawData;

// ---------- load utils.js + charts.js into the shim context ----------
vm.runInContext(fs.readFileSync(UTILS_PATH, 'utf8'), context);
vm.runInContext(fs.readFileSync(CHARTS_PATH, 'utf8'), context);

var WR = context.WR;
if (!WR || !WR.getCategories) {
  console.error('FAIL: WR namespace did not load');
  process.exit(1);
}
WR.loadData();

// ---------- test harness ----------
var passed = 0, failed = 0;
var failures = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.log('  x ' + msg); }
}
function assertEq(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  assert(a === e, msg + ' (got ' + a + ', expected ' + e + ')');
}
function section(name) { console.log('\n-- ' + name + ' --'); }

// ---------- tests ----------
section('Formatting never produces undefined/NaN/null');
assert(WR.fmt(null) === '\u2014', 'fmt(null) -> em dash');
assert(WR.fmt(undefined) === '\u2014', 'fmt(undefined) -> em dash');
assert(WR.fmt('') === '\u2014', 'fmt("") -> em dash');
assert(WR.fmt('x') === 'x', 'fmt("x") -> x');
assert(WR.fmt(null, '?') === '?', 'fmt(null, "?") -> ?');
assert(WR.fmtTime(null) === '\u2014', 'fmtTime(null) -> em dash');
assert(WR.fmtTime(undefined) === '\u2014', 'fmtTime(undefined) -> em dash');
assert(WR.fmtTime(0.337) === '0.337s', 'fmtTime(0.337) -> 0.337s');
assert(WR.fmtTime(12.5) === '12.500s', 'fmtTime(12.5) -> 12.500s (3-digit)');
assert(WR.fmtTime(75) === '1:15.000', 'fmtTime(75) -> 1:15.000');
assert(WR.fmtTime(3725) === '1:02:05.000', 'fmtTime(3725) -> 1:02:05.000');
assert(WR.fmtPct(null) === '\u2014', 'fmtPct(null) -> em dash');
assert(WR.fmtPct(0.5) === '50.0%', 'fmtPct(0.5) -> 50.0%');
assert(WR.fmtInt(null) === '\u2014', 'fmtInt(null) -> em dash');
assert(WR.fmtInt(42) === '42', 'fmtInt(42) -> 42');
assert(WR.fmtNum(null) === '\u2014', 'fmtNum(null) -> em dash');
assert(WR.fmtNum(14.666) === '14.67', 'fmtNum(14.666) -> 14.67');

section('Date edge-case formatting');
var exactRec = { dateDisplay: '18.11.2025', dateType: 'exact', dateIso: '2025-11-18' };
var beforeRec = { dateDisplay: '01.08.2020', dateType: 'before', dateIso: '2020-08-01' };
var approxRec = { dateDisplay: '01.12.2013', dateType: 'approximate', dateIso: '2013-12-01' };
var unknownRec = { dateDisplay: '???', dateType: 'unknown', dateIso: null };
assert(WR.fmtDate(exactRec) === '18.11.2025', 'exact date');
assert(WR.fmtDate(beforeRec) === 'before 01.08.2020', 'before date');
assert(WR.fmtDate(approxRec) === '\u2248 01.12.2013', 'approximate date');
assert(WR.fmtDate(unknownRec) === 'date unknown', 'unknown date');
assert(WR.fmtDate(null) === '\u2014', 'null date');
assert(WR.fmtDateShort(exactRec) === 'Nov 2025', 'short date Nov 2025');
assert(WR.fmtDateShort(unknownRec) === '?', 'short unknown date -> ?');

section('getCurrentWR returns all-time best (running minimum)');
var mismatchCount = 0;
WR.getCategories().forEach(function (c) {
  var recs = c.records;
  var timedRecs = recs.filter(function (r) { return r.time != null; });
  if (!timedRecs.length) return;
  var minTime = Math.min.apply(null, timedRecs.map(function (r) { return r.time; }));
  var cur = WR.getCurrentWR(c, 'exe');
  assert(cur !== null, c.id + ': getCurrentWR not null');
  if (cur.time !== minTime) mismatchCount++;
  assert(cur.time === minTime, c.id + ': current WR time (' + cur.time + ') = all-time min (' + minTime + ')');
});
assert(mismatchCount === 0, 'ZERO categories where current WR != all-time min (was 7 before fix)');

section('computeWRProgression is monotonic decreasing');
WR.getCategories().forEach(function (c) {
  var prog = WR.computeWRProgression(c.records);
  if (prog.length < 2) return;
  var ok = true;
  for (var i = 1; i < prog.length; i++) {
    if (!(prog[i].time < prog[i - 1].time)) { ok = false; break; }
  }
  assert(ok, c.id + ': WR progression strictly decreasing');
  var cur = WR.getCurrentWR(c, 'exe');
  assert(prog[prog.length - 1].time === cur.time, c.id + ': last WR progression entry = current WR');
});

section('Category stats are category-internal');
WR.getCategories().forEach(function (c) {
  var s = WR.getCategoryStats(c, 'exe');
  assert(s.recordCount === c.records.length, c.id + ': recordCount matches');
  assert(s.wrImprovementCount >= 1, c.id + ': at least 1 WR improvement');
  assert(s.wrImprovementCount <= s.recordCount, c.id + ': WR improvements <= total records');
  if (s.improvement != null) {
    assert(s.improvement >= 0 && s.improvement <= 1, c.id + ': improvement in [0,1]');
  }
  if (s.biggestJump != null) {
    assert(s.biggestJump >= 0 && s.biggestJump <= 1, c.id + ': biggestJump in [0,1]');
  }
});

section('Reign computation');
WR.getCategories().forEach(function (c) {
  var s = WR.getCategoryStats(c, 'exe');
  if (!s.reigns.length) return;
  assert(s.reigns[s.reigns.length - 1].current === true, c.id + ': last reign is current');
  var allNonNeg = s.reigns.every(function (rg) { return rg.durationDays >= 0; });
  assert(allNonNeg, c.id + ': all reign durations >= 0');
  var totalReign = s.reigns.reduce(function (a, rg) { return a + rg.durationDays; }, 0);
  // reign sum ~ (now - first valid-dated record) since the current reign
  // extends to today. Allow generous tolerance for date edge cases.
  var dated = c.records.filter(function (r) { return r.dateSortKey > 0; });
  if (dated.length >= 1) {
    var nowDays = Math.round((Date.now()/1000 - dated[0].dateSortKey) / 86400);
    assert(totalReign >= nowDays - 30 && totalReign <= nowDays + 30,
      c.id + ': reign sum (' + totalReign + 'd) ~ now-since-first (' + nowDays + 'd)');
  }
});

section('Longest reign removed; snipes computed');
WR.getCategories().forEach(function (c) {
  var s = WR.getCategoryStats(c, 'exe');
  assert(Array.isArray(s.snipes), c.id + ': snipes is an array');
  // every snipe is either first-holder or beats a different player
  s.snipes.forEach(function (sn) {
    if (!sn.first) {
      assert(sn.sniper !== sn.victim, c.id + ': snipe sniper != victim');
    }
  });
});
assert(typeof WR.getNemesisStats === 'function', 'getNemesisStats exists');
assert(typeof WR.getRecordsEverHeld === 'function', 'getRecordsEverHeld exists');
assert(typeof WR.getLongestReign === 'undefined', 'getLongestReign removed');

section('Global stats use counts only (no raw times)');
var g = WR.getGlobalStats('exe');
assert(typeof g.categoryCount === 'number' && g.categoryCount > 0, 'categoryCount is positive number');
assert(typeof g.totalRecords === 'number' && g.totalRecords > 0, 'totalRecords is positive number');
assert(typeof g.playerCount === 'number' && g.playerCount > 0, 'playerCount is positive number');
assert(g.bestTime === undefined, 'global stats has no bestTime');
assert(g.fastestTime === undefined, 'global stats has no fastestTime');

section('Player existence + stats');
var allPlayers = WR.getAllPlayers('exe');
assert(allPlayers.length > 0, 'getAllPlayers returns players');
var topPlayer = allPlayers[0].name;
assert(WR.playerExists(topPlayer, 'exe') === true, 'top player exists');
assert(WR.playerExists('ghost_nonexistent', 'exe') === false, 'ghost player does not exist');
var ps = WR.getPlayerStats(topPlayer, 'exe');
assert(ps.recordCount > 0, topPlayer + ': has records');
assert(ps.name === topPlayer, 'player stats name matches');
assert(ps.currentWRCount >= 0, 'currentWRCount >= 0');
var sortedOk = true;
for (var i = 1; i < ps.records.length; i++) {
  if ((ps.records[i].rec.dateSortKey || 0) < (ps.records[i-1].rec.dateSortKey || 0)) { sortedOk = false; break; }
}
assert(sortedOk, topPlayer + ': records sorted oldest->newest');

section('Player color determinism');
var c1 = WR.playerColor('vovker');
var c2 = WR.playerColor('vovker');
assert(c1 === c2, 'playerColor deterministic for same name');
assert(typeof c1 === 'string' && c1[0] === '#', 'color is hex string');

section('Platform filter');
var exeCats = WR.filterCats('exe');
var webCats = WR.filterCats('web');
var bothCats = WR.filterCats('both');
assert(exeCats.length === bothCats.length, 'exe cats = both cats (no web data yet)');
assert(webCats.length === 0, 'web cats = 0 (no web data yet)');

section('Charts: niceTicks');
var t = WR.charts.niceTicks(0, 100, 5);
assert(t.ticks.length >= 2, 'niceTicks returns multiple ticks');
assert(t.ticks[0] >= 0, 'niceTicks first tick >= min');
assert(t.ticks[t.ticks.length - 1] <= 100, 'niceTicks last tick <= max');
var t2 = WR.charts.niceTicks(5, 5, 4);
assert(t2.ticks.length >= 1, 'niceTicks handles min==max');

section('Charts: trunc');
assert(WR.charts.trunc('hello world', 20) === 'hello world', 'trunc no-op when short');
assert(WR.charts.trunc('hello world', 5) === 'hell\u2026', 'trunc adds ellipsis');
assert(WR.charts.trunc('ab', 2) === 'ab', 'trunc exact length');

section('Charts: lineChart produces SVG');
var svg = WR.charts.lineChart([{ points: [{x:0,y:1},{x:1,y:2}], color: '#f00', label: 'test' }], { w: 200, h: 100 });
assert(svg && svg.tagName === 'svg', 'lineChart returns svg element');
var emptySvg = WR.charts.lineChart([], { w: 200, h: 100 });
assert(emptySvg && emptySvg.tagName === 'svg', 'lineChart empty data returns svg');

section('Charts: hbarChart + donutChart + reignBar');
var hb = WR.charts.hbarChart([{label:'a',value:5},{label:'b',value:3}], {});
assert(hb.tagName === 'svg', 'hbarChart returns svg');
var dn = WR.charts.donutChart([{label:'a',value:5,color:'#f00'},{label:'b',value:3,color:'#0f0'}], {});
assert(dn.tagName === 'svg', 'donutChart returns svg');
var rb = WR.charts.reignBar([{player:'a',startTime:0,endTime:1000,durationDays:1,bestTime:5}], {});
assert(rb.tagName === 'svg', 'reignBar returns svg');

section('No undefined fields in raw data');
var leakFound = false;
WR.getCategories().forEach(function (c) {
  c.records.forEach(function (r) {
    if (r.player === undefined || r.time === undefined) { leakFound = true; }
  });
});
assert(!leakFound, 'no undefined player/time fields in raw data');

// ---------- summary ----------
console.log('\n====================================');
console.log('  Passed: ' + passed + '  |  Failed: ' + failed);
console.log('====================================');
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(function (m) { console.log('  - ' + m); });
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
  process.exit(0);
}
