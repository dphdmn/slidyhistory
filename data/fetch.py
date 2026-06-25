#!/usr/bin/env python3
"""
Slidysim WR History — comprehensive data fetcher.

Downloads the Google Sheet as xlsx (which preserves hyperlinks, cell notes,
and font colors — none of which the CSV/gviz query exposes) and produces a
clean wr-data.json + wr-data.js with the FULL record detail:

  - cell values (date, player, time, movecount, tps, control, style,
    solve data, scramble, solution, video, time-minutes)
  - replay hyperlinks attached to the TIME cell (slidysim.github.io /
    slidysim.online / pastebin) with the green/red accuracy flag
    (green = movetime accurate, red = not accurate) read from the
    cell's font color
  - video hyperlinks (youtube) attached to the VIDEO cell
  - Google-Sheets cell NOTES (comments) per cell

Re-runnable. Stdlib only.
"""
import json, re, sys, time, urllib.request, zipfile, io, os
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SHEET_ID = "1rLoXMkhsMpFkSICEEaRK07D8xwjC-f41tPEqHT4TN8c"
XLSX_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

# ---- category metadata (id, gid, name, size, eventType, eventGroup) ----
# Loaded from the existing wr-data.json so we keep the same ids/gids.
def load_category_meta():
    with open(os.path.join(HERE, "wr-data.json"), "r", encoding="utf-8") as f:
        d = json.load(f)
    return d["categories"]

# ---------------- download xlsx ----------------
def download_xlsx(path):
    for attempt in range(3):
        try:
            req = urllib.request.Request(XLSX_URL, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception as e:
            print(f"  download attempt {attempt+1} failed: {e}", file=sys.stderr)
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
        strings.append("".join(texts))
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
        out[ref] = "".join(texts).strip()
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

def build_record(row, headers, hlinks, rels, notes, fonts, xfs):
    """Build a record dict from a data row. headers = {col_letter: label}."""
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
    player = val("Name") or val("Player")
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
    print("Downloading xlsx…")
    xlsx_path = os.path.join(HERE, "sheet.xlsx")
    if not download_xlsx(xlsx_path):
        print("FATAL: could not download xlsx", file=sys.stderr)
        sys.exit(1)
    print(f"  saved {os.path.getsize(xlsx_path)} bytes")

    z = zipfile.ZipFile(xlsx_path)
    shared = parse_shared_strings(z)
    fonts, xfs = parse_styles(z)
    print(f"  sharedStrings: {len(shared)}, fonts: {len(fonts)}, cellXfs: {len(xfs)}")

    sheet_map = parse_workbook_sheets(z)
    print(f"  workbook sheets: {len(sheet_map)}")

    cat_meta = load_category_meta()
    meta_by_name = {c["name"]: c for c in cat_meta}

    # skip non-category sheets
    SKIP = {"Master Sheet", "First faster WR", "data", "Sheet1"}

    categories = []
    total_records = 0
    players = {}
    controls = {}
    styles_count = {}
    date_min = None
    date_max = None
    skipped = []

    for name, ws_file in sheet_map:
        if name in SKIP or name not in meta_by_name:
            skipped.append(name)
            continue
        cm = meta_by_name[name]
        rows, hlinks = parse_worksheet(z, ws_file, shared, fonts, xfs)
        rels = parse_sheet_rels(z, ws_file)
        notes = parse_comments(z, ws_file)
        headers = get_headers(rows)
        records = []
        for row in rows[1:]:  # skip header
            if not row:
                continue
            rec = build_record(row, headers, hlinks, rels, notes, fonts, xfs)
            if not rec["player"] and rec["time"] is None:
                continue
            records.append(rec)
        # reverse to oldest-first (sheet is newest-first)
        records.reverse()
        for r in records:
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
        categories.append({
            "id": cm["id"],
            "gid": cm["gid"],
            "name": cm["name"],
            "platform": "exe",
            "size": cm["size"],
            "eventType": cm["eventType"],
            "eventGroup": cm["eventGroup"],
            "recordCount": len(records),
            "records": records,
        })
        print(f"  {cm['name']}: {len(records)} records")

    meta = {
        "source": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit",
        "title": "Slidysim World Records History",
        "platform": "exe",
        "fetchedAt": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "totalCategories": len(categories),
        "totalRecords": total_records,
        "dateRange": {"min": date_min, "max": date_max},
        "players": dict(sorted(players.items(), key=lambda x: -x[1])),
        "controls": dict(sorted(controls.items(), key=lambda x: -x[1])),
        "styles": styles_count,
    }
    out = {"meta": meta, "categories": categories}

    json_path = os.path.join(HERE, "wr-data.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {json_path}: {len(categories)} categories, {total_records} records")

    js_path = os.path.join(HERE, "wr-data.js")
    with open(js_path, "w", encoding="utf-8") as f:
        f.write("window.WR_DATA = ")
        f.write(json.dumps(out, ensure_ascii=False))
        f.write(";\n")
    print(f"Wrote {js_path}")

    if skipped:
        print(f"\nSkipped non-category sheets: {skipped}")

    # quick stats
    with_replay = sum(1 for c in categories for r in c["records"] if r["hasReplay"])
    with_video = sum(1 for c in categories for r in c["records"] if r["hasVideo"])
    with_notes = sum(1 for c in categories for r in c["records"] if r["notes"])
    green = sum(1 for c in categories for r in c["records"] if r["replayAccurate"] is True)
    red = sum(1 for c in categories for r in c["records"] if r["replayAccurate"] is False)
    print(f"\nReplays: {with_replay} (green/accurate: {green}, red/inaccurate: {red})")
    print(f"Videos: {with_video}, Notes: {with_notes}")

if __name__ == "__main__":
    main()
