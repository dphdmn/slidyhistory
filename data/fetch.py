#!/usr/bin/env python3
"""
Slidysim WR History — comprehensive data fetcher.

Downloads the Google Sheet(s) as xlsx (which preserves hyperlinks, cell notes,
and font colors — none of which the CSV/gviz query exposes) and produces a
clean wr-data.js with the FULL record detail:

  - cell values (date, player, time, movecount, tps, control, style,
    solve data, scramble, solution, video, time-minutes)
  - replay hyperlinks attached to the TIME cell (slidysim.github.io /
    slidysim.online / pastebin) with the green/red accuracy flag
    (green = movetime accurate, red = not accurate) read from the
    cell's font color
  - video hyperlinks (youtube) attached to the VIDEO cell
  - Google-Sheets cell NOTES (comments) per cell
  - platform tag on every record ("exe" or "web") so the in-app
    Exe / Web / Both tabs can filter or merge records.

MULTI-SHEET (exe + web) SUPPORT:
  The fetcher downloads BOTH the EXE spreadsheet and the WEB spreadsheet
  (a separate, parallel workbook for the in-browser version of slidysim).
  Records from each are tagged with `platform` and merged into a single
  category list. Categories that exist in only one sheet appear with
  records from that sheet only; categories in both sheets have records
  from both, sorted by date. The in-app "Both" tab shows the merged
  history; "Exe" / "Web" filter by record platform.

FUTURE-PROOF CATEGORY METADATA:
  Category metadata (id, size, eventType, eventGroup) is now DERIVED from
  the sheet name itself, not loaded from a stale JSON. Any new category
  name that matches the pattern "<size>x<size> <event>" is automatically
  recognized. Supported event types:
    single        -> eventGroup "single"
    ao5, ao12, ao25, ao50, ao100, ao200, ... -> eventGroup "average"
    x10, x42, x100, ...                       -> eventGroup "multi"
    relay                                      -> eventGroup "relay"
  New categories like "4x4 ao25" or "5x5 x100" work without code changes.

Re-runnable. Stdlib only.
"""
import json, re, sys, time, urllib.request, zipfile, io, os, html
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- player name canonicalization -----------------------------------------
# Some players are known by different handles in the spreadsheet vs the
# community. We normalize them at fetch time so the app never has to special-
# case two names for the same person. Renames are applied to EVERY text field
# that could carry a player name (player, victim in notes, etc.). Add more
# entries here as needed — this is the single source of truth for renames.
# User: "rename all entries of ben1996123 to 'eggben' and all 'Daanbe'
# entries to 'Ivy' ... it should be done inside fetch.py script".
PLAYER_RENAMES = {
    "ben1996123": "eggben",
    "Daanbe": "Ivy",
}

def rename_player(name):
    """Apply the canonical player-name map. Returns the renamed string."""
    if not name:
        return name
    return PLAYER_RENAMES.get(name, name)

# ---- source spreadsheets ---------------------------------------------------
# Each entry produces records tagged with `platform`. Add more platforms
# here (e.g. mobile, vr) without touching the rest of the script.
SHEETS = [
    {
        "id": "exe",
        "sheet_id": "1rLoXMkhsMpFkSICEEaRK07D8xwjC-f41tPEqHT4TN8c",
        "platform": "exe",
        "title": "Slidysim EXE",
    },
    {
        "id": "web",
        "sheet_id": "1gAlVGTQ5e9UN6ABkgmlysx_NSlu0T-cbrbqGLk1QPMk",
        "platform": "web",
        "title": "Slidysim Web",
    },
]

# ---- category metadata derivation (future-proof) --------------------------
# Parses category names like:
#   "3x3 ao5", "3x3 ao12", "3x3 ao50", "3x3 ao100", "3x3 ao25" (future)
#   "3x3 x10", "3x3 x42", "3x3 x100" (future)
#   "3x3 relay"
#   "4x4 single", "10x10 single"
# Returns dict with id, name, size, eventType, eventGroup, or None if not
# recognized (so non-category sheets are skipped).
def derive_category_meta(name):
    name = (name or "").strip()
    m = re.match(r"^(\d+)x(\d+)\s+(.+)$", name, re.I)
    if not m:
        return None
    size = int(m.group(1))
    rest = m.group(3).strip().lower()
    if rest == "single":
        event_type, event_group = "single", "single"
    elif rest == "relay":
        event_type, event_group = "relay", "relay"
    elif rest.startswith("ao"):
        try:
            n = int(rest[2:])
            event_type, event_group = "ao" + str(n), "average"
        except ValueError:
            return None
    elif rest.startswith("x"):
        try:
            n = int(rest[1:])
            event_type, event_group = "x" + str(n), "multi"
        except ValueError:
            return None
    else:
        return None
    cat_id = str(size) + "x" + str(size) + "-" + event_type
    return {
        "id": cat_id,
        "name": name,
        "size": size,
        "eventType": event_type,
        "eventGroup": event_group,
    }

# Sheets in the workbook that are NOT puzzle categories.
SKIP = {"Master Sheet", "First faster WR", "data", "Sheet1"}

# Display order for event types within a puzzle size.
EVENT_TYPE_ORDER = {
    "single": 0, "ao5": 1, "ao12": 2, "ao25": 3, "ao50": 4, "ao100": 5,
    "ao200": 6, "x10": 7, "x42": 8, "x100": 9, "relay": 10,
}

# ---------------- download xlsx ----------------
def download_xlsx(url, path):
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:
            print("  download attempt " + str(attempt + 1) + " failed: " + str(e), file=sys.stderr)
            time.sleep(3)
    return False

# ---------------- xlsx parsing helpers ----------------
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

def col_letters(ref):
    """A1 -> 'A', AB12 -> 'AB'"""
    return re.match(r"[A-Z]+", ref).group(0)

def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n  # 1-based

def parse_shared_strings(z):
    try:
        raw = z.read("xl/sharedStrings.xml").decode("utf-8")
    except KeyError:
        return []
    strings = []
    # each <si>...</si> may contain multiple <t> (rich text runs)
    for si in re.findall(r"<si>(.*?)</si>", raw, re.S):
        texts = re.findall(r"<t[^>]*>(.*?)</t>", si, re.S)
        # Decode XML entities (&lt; &gt; &amp; &quot; &#60; ...) so cell VALUES
        # display as literal characters, not as the entity string. Same fix as
        # for cell notes — the spreadsheet XML escapes < > & " in text runs.
        strings.append(html.unescape("".join(texts)))
    return strings

def parse_styles(z):
    """Return (fonts, cellxfs) where fonts[i] = {color, underline} and
    cellxfs[i] = fontId."""
    try:
        raw = z.read("xl/styles.xml").decode("utf-8")
    except KeyError:
        return [], []
    # fonts
    fonts = []
    fblock = re.search(r"<fonts[^>]*>(.*?)</fonts>", raw, re.S)
    if fblock:
        for fb in re.findall(r"<font>(.*?)</font>", fblock.group(1), re.S):
            col = re.search(r"<color\s+rgb=\"([0-9A-Fa-f]{8})\"", fb)
            cth = re.search(r"<color\s+theme=\"(\d+)\"", fb)
            fonts.append({
                "rgb": col.group(1) if col else None,
                "theme": cth.group(1) if cth else None,
                "underline": "<u/>" in fb or "<u " in fb,
            })
    # cellXfs
    xfs = []
    xblock = re.search(r"<cellXfs[^>]*>(.*?)</cellXfs>", raw, re.S)
    if xblock:
        for m in re.finditer(r"<xf\b([^>]*?)(?:/>|>)", xblock.group(1)):
            attrs = m.group(1)
            fid = re.search(r'fontId="(\d+)"', attrs)
            xfs.append(int(fid.group(1)) if fid else 0)
    return fonts, xfs

def classify_color(fonts, fontid):
    """Return one of: 'green', 'red', 'white', 'other'."""
    if fontid is None or fontid >= len(fonts):
        return "other"
    f = fonts[fontid]
    rgb = f.get("rgb")
    if rgb:
        rgb = rgb.upper()
        if rgb == "FF00FF00":
            return "green"
        if rgb == "FFFF0000":
            return "red"
        if rgb == "FFFFFFFF":
            return "white"
    return "other"

def parse_workbook_sheets(z):
    """Return list of (sheet_name, worksheet_filename)."""
    wb = z.read("xl/workbook.xml").decode("utf-8")
    rels = z.read("xl/_rels/workbook.xml.rels").decode("utf-8")
    # name -> r:id
    sheets = re.findall(r'<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"', wb)
    # r:id -> target (worksheets/sheetN.xml)
    relmap = {}
    for m in re.finditer(r'<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"', rels):
        relmap[m.group(1)] = m.group(2)
    out = []
    for name, rid in sheets:
        tgt = relmap.get(rid, "")
        if tgt.startswith("/"):
            tgt = tgt[1:]
        elif not tgt.startswith("xl/"):
            tgt = "xl/" + tgt
        out.append((name, tgt))
    return out

def parse_sheet_rels(z, ws_filename):
    """Return {rId: external_url} for a worksheet."""
    rels_path = ws_filename.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels"
    try:
        raw = z.read(rels_path).decode("utf-8")
    except KeyError:
        return {}
    out = {}
    for m in re.finditer(r'<Relationship[^>]*Id="(rId\d+)"[^>]*Target="([^"]+)"[^>]*TargetMode="External"', raw):
        out[m.group(1)] = m.group(2)
    return out

def parse_comments(z, ws_filename):
    """Return {cell_ref: note_text} for a worksheet.

    CRITICAL: commentsN.xml numbering is INDEPENDENT of sheetN.xml numbering.
    sheet5.xml may point to comments2.xml (not comments5.xml). The correct
    mapping is via the worksheet's .rels file, which contains a Relationship
    with Type=.../comments pointing to the actual comments file.
    """
    rels_path = ws_filename.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels"
    try:
        rels_raw = z.read(rels_path).decode("utf-8")
    except KeyError:
        return {}
    # find the comments relationship target
    comments_target = None
    for m in re.finditer(r'<Relationship[^>]*Type="[^"]*comments"[^>]*Target="([^"]+)"', rels_raw):
        comments_target = m.group(1)
        break
    # also try Target before Type (attr order varies)
    if not comments_target:
        for m in re.finditer(r'<Relationship[^>]*Target="([^"]+)"[^>]*Type="[^"]*comments"', rels_raw):
            comments_target = m.group(1)
            break
    if not comments_target:
        return {}
    # normalize path. Target is relative to the worksheet file location
    # (xl/worksheets/sheetN.xml), so "../comments2.xml" -> "xl/comments2.xml"
    import posixpath
    ws_dir = posixpath.dirname(ws_filename)  # xl/worksheets
    comments_path = posixpath.normpath(posixpath.join(ws_dir, comments_target))
    try:
        raw = z.read(comments_path).decode("utf-8")
    except KeyError:
        return {}
    out = {}
    # comments can be <commentList><comment ref="..." ...>...</comment></commentList>
    for cm in re.findall(r"<comment[^>]*ref=\"([A-Z]+\d+)\"[^>]*>(.*?)</comment>", raw, re.S):
        ref, body = cm
        texts = re.findall(r"<t\b[^>]*>(.*?)</t>", body, re.S)
        # Decode XML/HTML entities. Spreadsheet cell notes routinely contain
        # literal entities like &lt; &gt; &amp; (the source XML escapes them),
        # and without decoding they'd render as the literal string "&lt;" in
        # the UI. html.unescape handles &lt; &gt; &amp; &quot; &apos; and
        # numeric refs like &#60;.
        # User: "notes something have '<' character, it is currently displayed
        # as &lt; ... Date is not exact &lt;19.10.2014".
        out[ref] = html.unescape("".join(texts)).strip()
    return out

def parse_worksheet(z, ws_filename, shared, fonts, xfs):
    """Return list of rows; each row is dict {col_letter: cell_dict}.
    cell_dict = {v: value, s: style_index, t: type}."""
    raw = z.read(ws_filename).decode("utf-8")
    # hyperlinks: ref -> rId
    hlinks = {}
    hm = re.search(r"<hyperlinks>(.*?)</hyperlinks>", raw, re.S)
    if hm:
        for h in re.findall(r"<hyperlink[^>]*?(?:ref=\"([A-Z]+\d+)\"|r:id=\"(rId\d+)\")[^>]*?(?:ref=\"([A-Z]+\d+)\"|r:id=\"(rId\d+)\")", hm.group(1)):
            ref = h[0] or h[2]
            rid = h[1] or h[3]
            if ref and rid:
                hlinks[ref] = rid
    rows = []
    # iterate <row ...> ... </row>
    for rm in re.finditer(r"<row[^>]*>(.*?)</row>", raw, re.S):
        row = {}
        for cm in re.finditer(r"<c\b([^>]*?)(?:/>|>(.*?)</c>)", rm.group(1), re.S):
            attrs = cm.group(1)
            inner = cm.group(2) or ""
            refm = re.search(r'r="([A-Z]+\d+)"', attrs)
            if not refm:
                continue
            ref = refm.group(1)
            t = re.search(r't="([^"]+)"', attrs)
            t = t.group(1) if t else "n"
            sm = re.search(r's="(\d+)"', attrs)
            s = int(sm.group(1)) if sm else 0
            # value
            vm = re.search(r"<v[^>]*>(.*?)</v>", inner, re.S)
            is_ = re.search(r"<is>.*?<t[^>]*>(.*?)</t>.*?</is>", inner, re.S)
            if t == "s" and vm:
                v = shared[int(vm.group(1))] if int(vm.group(1)) < len(shared) else ""
            elif t == "inlineStr" and is_:
                v = is_.group(1)
            elif vm:
                v = vm.group(1)
            else:
                v = ""
            row[col_letters(ref)] = {"v": v, "s": s, "t": t, "ref": ref}
        if row:
            rows.append(row)
    return rows, hlinks

# ---------------- date parsing ----------------
def parse_date(raw):
    """Return dict with dateType, dateIso, dateDisplay, dateSortKey, dayUnknown."""
    raw = (raw or "").strip()
    if not raw or raw == "???" or raw.lower() == "unknown":
        return {"dateType": "unknown", "dateIso": None, "dateDisplay": "date unknown",
                "dateSortKey": 0, "dayUnknown": True}
    # Excel serial date detection (mixed-format spreadsheet issue).
    # The source sheet has occasional cells stored as numeric Excel serials
    # like "44963.0" instead of "06.02.2023". Convert these to ISO dates.
    # Valid Excel serials for our date range (2013..2026) are roughly
    # 41500..46100. Anything in that range with a ".0" or pure-numeric is
    # treated as an Excel serial.
    excel_m = re.match(r"^(\d{4,5})(?:\.\d+)?$", raw)
    if excel_m:
        serial = int(excel_m.group(1))
        if 40000 <= serial <= 50000:
            # Excel 1900-system: serial 25569 = 1970-01-01 (Unix epoch).
            ts = (serial - 25569) * 86400
            d = datetime.fromtimestamp(ts, tz=timezone.utc)
            iso = d.strftime("%Y-%m-%d")
            disp = d.strftime("%d.%m.%Y")
            return {"dateType": "exact", "dateIso": iso, "dateDisplay": disp,
                    "dateSortKey": int(ts), "dayUnknown": False}
    before = raw.startswith("<")
    approx = raw.lower().startswith("xx") or "xx." in raw.lower()
    s = raw.lstrip("<").strip()
    # parse DD.MM.YYYY
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", s)
    if not m:
        # maybe xx.12.2013
        m2 = re.match(r"(?:xx|\d{1,2})\.(\d{1,2})\.(\d{4})", s, re.I)
        if m2:
            mon = int(m2.group(1)); yr = int(m2.group(2))
            iso = f"{yr:04d}-{mon:02d}-01"
            ts = int(datetime(yr, mon, 1, tzinfo=timezone.utc).timestamp())
            return {"dateType": "approximate", "dateIso": iso,
                    "dateDisplay": f"≈ 01.{mon:02d}.{yr}",
                    "dateSortKey": ts, "dayUnknown": True}
        return {"dateType": "unknown", "dateIso": None, "dateDisplay": raw,
                "dateSortKey": 0, "dayUnknown": True}
    d, mon, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
    iso = f"{yr:04d}-{mon:02d}-{d:02d}"
    ts = int(datetime(yr, mon, d, tzinfo=timezone.utc).timestamp())
    if before:
        return {"dateType": "before", "dateIso": iso,
                "dateDisplay": f"before {d:02d}.{mon:02d}.{yr}",
                "dateSortKey": ts, "dayUnknown": False}
    if approx:
        return {"dateType": "approximate", "dateIso": iso,
                "dateDisplay": f"≈ {d:02d}.{mon:02d}.{yr}",
                "dateSortKey": ts, "dayUnknown": True}
    return {"dateType": "exact", "dateIso": iso,
            "dateDisplay": f"{d:02d}.{mon:02d}.{yr}",
            "dateSortKey": ts, "dayUnknown": False}

# ---------------- record building ----------------
def to_num(v):
    if v == "" or v is None:
        return None
    try:
        f = float(str(v).replace(",", ""))
        return f
    except ValueError:
        return None

def is_url(s):
    return isinstance(s, str) and s.startswith(("http://", "https://"))

def normalize_replay_url(url):
    """Normalize replay URLs to canonical https://slidysim.github.io/replay?r=...
    - slidysim.online/replay?r=...  -> slidysim.github.io/replay?r=...
    - slidysim.online/lb?r=...      -> slidysim.github.io/replay?r=...  (old path)
    - slidysim.github.io/lb?r=...   -> slidysim.github.io/replay?r=...  (old path)
    - slidysim.github.io/replay?r=... -> kept as-is (already canonical)
    - raw.githubusercontent.com/...    -> kept as-is (text evidence files)
    - pastebin.com, imgur.com, reddit.com, dphdmn.github.io -> kept as-is
      (external evidence, not slidysim replays)
    """
    if not url:
        return url
    # Rewrite deprecated slidysim.online host -> slidysim.github.io
    if "://slidysim.online/" in url:
        url = url.replace("://slidysim.online/", "://slidysim.github.io/", 1)
    # Rewrite old /lb?r= path -> /replay?r= (canonical replay path)
    if "://slidysim.github.io/lb?r=" in url:
        url = url.replace("://slidysim.github.io/lb?r=", "://slidysim.github.io/replay?r=", 1)
    return url

def build_record(row, headers, hlinks, rels, notes, fonts, xfs, platform):
    """Build a record dict from a data row. headers = {col_letter: label}.

    `platform` is the source spreadsheet tag ("exe" or "web") — set on every
    record so the in-app Exe / Web / Both tabs can filter or merge.
    """
    # map header label -> col letter (case-insensitive)
    hl = {v.lower().strip(): k for k, v in headers.items()}

    def cell_of(*labels):
        for lab in labels:
            c = hl.get(lab.lower())
            if c:
                return c
        return None

    def val(label):
        c = cell_of(label)
        return row.get(c, {}).get("v", "") if c else ""

    def style_of(label):
        c = cell_of(label)
        return row.get(c, {}).get("s") if c else None

    def ref_of(label):
        c = cell_of(label)
        return row.get(c, {}).get("ref") if c else None

    def hyperlink_of(label):
        c = cell_of(label)
        if not c:
            return ""
        ref = row.get(c, {}).get("ref")
        if not ref:
            return ""
        rid = hlinks.get(ref)
        if not rid:
            return ""
        return rels.get(rid, "")

    def note_of(label):
        c = cell_of(label)
        if not c:
            return ""
        ref = row.get(c, {}).get("ref")
        if not ref:
            return ""
        return notes.get(ref, "")

    date_raw = val("Date")
    # Apply canonical player renames (ben1996123 -> eggben, Daanbe -> Ivy, ...).
    # Done at fetch time so the entire app sees only the canonical names.
    player = rename_player(val("Name") or val("Player"))
    time_v = to_num(val("Time"))
    time_raw = str(val("Time"))
    mv = to_num(val("Movecount"))
    tps = to_num(val("TPS"))
    control = val("Control")
    style = val("Style")
    solve_data = val("Solve Data") or val("Solvedata")
    scramble = val("Scramble")
    solution = val("Solution")
    video = val("Video")
    time_min = val("Time (Minutes)") or val("Time (minutes)") or val("Time Minutes")

    # replay: hyperlink on the TIME cell, with green/red accuracy from font color
    time_ref = ref_of("Time")
    replay_url = ""
    replay_accurate = None
    if time_ref and time_ref in hlinks:
        rid = hlinks[time_ref]
        url = rels.get(rid, "")
        if is_url(url):
            replay_url = normalize_replay_url(url)
            # accuracy from font color of the time cell
            si = style_of("Time")
            fontid = xfs[si] if si is not None and si < len(xfs) else None
            color = classify_color(fonts, fontid)
            if color == "green":
                replay_accurate = True
            elif color == "red":
                replay_accurate = False
    # fallback: if solve data cell has an external hyperlink, treat as replay too
    if not replay_url:
        sd_ref = ref_of("Solve Data")
        if sd_ref and sd_ref in hlinks:
            url = rels.get(hlinks[sd_ref], "")
            if is_url(url):
                replay_url = normalize_replay_url(url)
                replay_accurate = None  # unknown accuracy for solve-data links

    # video: hyperlink on VIDEO cell, or the value itself if a URL
    video_url = ""
    video_ref = ref_of("Video")
    if video_ref and video_ref in hlinks:
        video_url = rels.get(hlinks[video_ref], "")
    if not video_url and is_url(video):
        video_url = video

    # notes: collect from any cell in the row
    note = ""
    for lab in ("Date", "Name", "Time", "Movecount", "TPS", "Control", "Style",
                "Solve Data", "Scramble", "Solution", "Video", "Time (Minutes)"):
        n = note_of(lab)
        if n:
            note = (note + " | " + n) if note else n

    # movecount: integer for singles (eventType == 'single'), float for averages
    # Singles ALWAYS have integer movecounts. Averages may have decimal movecounts.
    if mv is not None:
        has_scramble = bool(cell_of("Scramble"))
        if has_scramble:
            mv = int(round(mv))
    # time: keep float; format 3-digit downstream
    date = parse_date(date_raw)

    rec = {
        "dateRaw": date_raw,
        "dateType": date["dateType"],
        "dateIso": date["dateIso"],
        "dateDisplay": date["dateDisplay"],
        "dateSortKey": date["dateSortKey"],
        "dayUnknown": date["dayUnknown"],
        "player": player,
        "platform": platform,  # NEW: per-record platform tag
        "time": time_v,
        "timeRaw": time_raw,
        "timeMinutes": time_min if time_min else None,
        "movecount": mv,
        "tps": tps,
        "control": control,
        "style": style,
        "solveData": solve_data,
        "scramble": scramble or None,
        "solution": solution or None,
        "video": video,
        "videoUrl": video_url,
        "hasVideo": bool(video_url),
        "replayUrl": replay_url,
        "hasReplay": bool(replay_url),
        "replayAccurate": replay_accurate,  # True/False/None(unknown)
        "notes": note or None,
    }
    return rec

def get_headers(rows):
    """First row -> {col_letter: label}."""
    if not rows:
        return {}
    return {col: cell["v"] for col, cell in rows[0].items()}

# ---------------- main ----------------
def main():
    # Map: cat_id -> {"meta": cm, "records": []}
    cats_by_id = {}

    for sheet_info in SHEETS:
        platform = sheet_info["platform"]
        sheet_id = sheet_info["sheet_id"]
        xlsx_url = "https://docs.google.com/spreadsheets/d/" + sheet_id + "/export?format=xlsx"
        xlsx_path = os.path.join(HERE, "sheet-" + platform + ".xlsx")
        print("\n=== Fetching [" + platform + "] " + sheet_id + " ===")
        if not download_xlsx(xlsx_url, xlsx_path):
            print("WARN: could not download " + platform + " sheet, skipping", file=sys.stderr)
            continue
        print("  saved " + str(os.path.getsize(xlsx_path)) + " bytes")

        z = zipfile.ZipFile(xlsx_path)
        shared = parse_shared_strings(z)
        fonts, xfs = parse_styles(z)
        print("  sharedStrings: " + str(len(shared)) + ", fonts: " + str(len(fonts)) + ", cellXfs: " + str(len(xfs)))

        sheet_map = parse_workbook_sheets(z)
        print("  workbook sheets: " + str(len(sheet_map)))

        skipped = []
        for name, ws_file in sheet_map:
            if name in SKIP:
                skipped.append(name)
                continue
            cm = derive_category_meta(name)
            if not cm:
                skipped.append(name + " (unrecognized)")
                continue
            rows, hlinks = parse_worksheet(z, ws_file, shared, fonts, xfs)
            rels = parse_sheet_rels(z, ws_file)
            notes = parse_comments(z, ws_file)
            headers = get_headers(rows)
            records = []
            for row in rows[1:]:  # skip header
                if not row:
                    continue
                rec = build_record(row, headers, hlinks, rels, notes, fonts, xfs, platform)
                if not rec["player"] and rec["time"] is None:
                    continue
                records.append(rec)
            # reverse to oldest-first (sheet is newest-first)
            records.reverse()
            if not records:
                # Empty sheet (web is work in progress for many categories).
                # Don't add the category if it has no records — it would just
                # clutter the UI with empty entries.
                continue
            # merge into cats_by_id
            if cm["id"] not in cats_by_id:
                cats_by_id[cm["id"]] = {"meta": cm, "records": []}
            cats_by_id[cm["id"]]["records"].extend(records)
            print("  [" + platform + "] " + name + ": +" + str(len(records)) + " records")

        # cleanup the xlsx cache (don't leave binary blobs lying around)
        try:
            os.remove(xlsx_path)
        except OSError:
            pass
        if skipped:
            print("  skipped sheets: " + str(skipped))

    # Sort categories: by size, then eventType order, then eventType name.
    def sort_key(c):
        m = c["meta"]
        return (m["size"], EVENT_TYPE_ORDER.get(m["eventType"], 99), m["eventType"])

    sorted_cats = sorted(cats_by_id.values(), key=sort_key)

    # Build output + global stats.
    total_records = 0
    players = {}
    controls = {}
    styles_count = {}
    date_min = None
    date_max = None
    cat_list = []

    for c in sorted_cats:
        m = c["meta"]
        recs = c["records"]
        # Sort merged records by dateSortKey (oldest first). Stable sort
        # preserves sheet-internal order for same-day records.
        recs.sort(key=lambda r: r.get("dateSortKey") or 0)
        for r in recs:
            total_records += 1
            p = r["player"]
            if p:
                players[p] = players.get(p, 0) + 1
            if r["control"]:
                controls[r["control"]] = controls.get(r["control"], 0) + 1
            if r["style"]:
                styles_count[r["style"]] = styles_count.get(r["style"], 0) + 1
            if r["dateIso"]:
                if date_min is None or r["dateIso"] < date_min:
                    date_min = r["dateIso"]
                if date_max is None or r["dateIso"] > date_max:
                    date_max = r["dateIso"]
        cat_list.append({
            "id": m["id"],
            "name": m["name"],
            "size": m["size"],
            "eventType": m["eventType"],
            "eventGroup": m["eventGroup"],
            # Top-level platforms: which platforms have records in this category.
            # Derived from the records themselves — used for display badges.
            "platforms": sorted(set(r["platform"] for r in recs if r.get("platform"))),
            "recordCount": len(recs),
            "records": recs,
        })
        print("  merged " + m["name"] + ": " + str(len(recs)) + " records [" + ",".join(cat_list[-1]["platforms"]) + "]")

    meta = {
        "source": "https://docs.google.com/spreadsheets/d/" + SHEETS[0]["sheet_id"] + "/edit",
        "sources": [
            {"platform": s["platform"], "sheet_id": s["sheet_id"], "title": s["title"]}
            for s in SHEETS
        ],
        "title": "Slidysim World Records History",
        "fetchedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "totalCategories": len(cat_list),
        "totalRecords": total_records,
        "dateRange": {"min": date_min, "max": date_max},
        "players": dict(sorted(players.items(), key=lambda x: -x[1])),
        "controls": dict(sorted(controls.items(), key=lambda x: -x[1])),
        "styles": styles_count,
    }
    out = {"meta": meta, "categories": cat_list}

    # ONLY write wr-data.js (no JSON duplication — the .js file is the single
    # source of truth, loaded via <script src="data/wr-data.js">).
    js_path = os.path.join(HERE, "wr-data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.WR_DATA = ")
        f.write(json.dumps(out, ensure_ascii=False))
        f.write(";\n")
    print("\nWrote " + js_path + ": " + str(len(cat_list)) + " categories, " + str(total_records) + " records")

    # quick stats
    with_replay = sum(1 for c in cat_list for r in c["records"] if r["hasReplay"])
    with_video = sum(1 for c in cat_list for r in c["records"] if r["hasVideo"])
    with_notes = sum(1 for c in cat_list for r in c["records"] if r["notes"])
    green = sum(1 for c in cat_list for r in c["records"] if r["replayAccurate"] is True)
    red = sum(1 for c in cat_list for r in c["records"] if r["replayAccurate"] is False)
    exe_recs = sum(1 for c in cat_list for r in c["records"] if r.get("platform") == "exe")
    web_recs = sum(1 for c in cat_list for r in c["records"] if r.get("platform") == "web")
    print("\nReplays: " + str(with_replay) + " (green/accurate: " + str(green) + ", red/inaccurate: " + str(red) + ")")
    print("Videos: " + str(with_video) + ", Notes: " + str(with_notes))
    print("By platform: exe=" + str(exe_recs) + ", web=" + str(web_recs))

if __name__ == "__main__":
    main()
