#!/usr/bin/env python3
"""Build the HOPTRACE project report PDF.

    python submission/build/build_report.py [--slot F1 --team 7]

Pipeline: report_body.html (hand-written content) + report.css + SVG diagrams
generated here -> report.html -> headless Chrome/Edge print-to-PDF. A second pass fills
the table of contents with the real page numbers found in the first PDF.

Safety checks: every headline number quoted in the report is asserted against the
repository's own result files before the PDF is written, so the report cannot drift
from evaluate/*.json.

Documentation-only dependencies (NOT needed to run HOPTRACE): Chrome or Edge,
PyMuPDF (page-number lookup / rendering check).
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(ROOT, "submission")

INK, SOFT = "#14181a", "#3d4d55"
MINT100, MINT200 = "#e7eff2", "#d3e3e6"
SIGNAL, STRUCT, HEALTHY, DEGRADED, UNKNOWN = "#2fd3e0", "#6a4dff", "#b4ff3d", "#ff6b4a", "#ffd23f"
FONT = "Instrument Sans, Arial, sans-serif"
MONO = "JetBrains Mono, Consolas, monospace"


# --------------------------------------------------------------------------- numbers
def check_numbers() -> None:
    p4 = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results.json")))["summary"]
    p4b = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results_4b.json")))["summary"]

    def frac(s, k):
        return (s[k]["numerator"], s[k]["denominator"])

    assert frac(p4, "false_attribution_rate") == (3, 12)
    assert frac(p4b, "false_attribution_rate") == (1, 12)
    assert frac(p4, "clean_control_false_positive_rate") == (2, 4)
    assert frac(p4b, "clean_control_false_positive_rate") == (0, 4)
    assert frac(p4, "within_1_hop_accuracy") == (3, 3)
    assert frac(p4b, "within_1_hop_accuracy") == (4, 4)
    assert frac(p4, "exact_hop_accuracy") == (2, 3)
    assert frac(p4b, "exact_hop_accuracy") == (3, 4)
    assert frac(p4, "detection_recall") == (3, 8)
    assert frac(p4b, "detection_recall") == (4, 8)
    b4 = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results.json")))["brier_score"]
    b4b = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results_4b.json")))["brier_score"]
    assert (b4["n"], round(b4["brier"], 3)) == (5, 0.432)
    assert (b4b["n"], round(b4b["brier"], 3)) == (4, 0.04)
    cfg = json.load(open(os.path.join(ROOT, "evaluate", "frozen_config_4b.json")))
    assert cfg["selected_algorithm"] == "mad_sustained"
    assert cfg["onset_detector_params"] == {"k_mad": 5.0, "min_run": 3}
    assert cfg["delta_align_ns"] == 1_500_000_000
    print("report numbers match evaluate/*.json")


# --------------------------------------------------------------------------- svg helpers
def esc(s: str) -> str:
    return html.escape(s, quote=False)


def svg_open(w: int, h: int) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'font-family="{FONT}">'
            f'<defs><marker id="ah" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{INK}"/></marker>'
            f'<marker id="ahc" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="{DEGRADED}"/></marker></defs>')


def box(x, y, w, h, lines, fill="#fff", stroke=INK, dash=False, shadow=True, r=10, sizes=None, fonts=None,
        bold_first=True):
    """Rounded box with centered text lines (first line bold)."""
    out = []
    if shadow:
        out.append(f'<rect x="{x+3}" y="{y+3}" width="{w}" height="{h}" rx="{r}" fill="{INK}"/>')
    d = ' stroke-dasharray="5 3"' if dash else ""
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="2"{d}/>')
    n = len(lines)
    sizes = sizes or [11] + [8.5] * (n - 1)
    fonts = fonts or [FONT] * n
    lh = [s + 3.5 for s in sizes]
    total = sum(lh)
    ty = y + (h - total) / 2 + sizes[0]
    for i, line in enumerate(lines):
        wt = "700" if (i == 0 and bold_first) else "400"
        col = INK if i == 0 else SOFT
        out.append(f'<text x="{x + w/2}" y="{ty:.1f}" text-anchor="middle" font-size="{sizes[i]}" font-weight="{wt}" '
                   f'fill="{col}" font-family="{fonts[i]}">{esc(line)}</text>')
        if i + 1 < n:
            ty += lh[i + 1]
    return "".join(out)


def arrow(x1, y1, x2, y2, color=INK, dash=False, width=2.2, marker="ah", path=None):
    d = ' stroke-dasharray="6 4"' if dash else ""
    if path:
        return (f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{width}"{d} '
                f'marker-end="url(#{marker})"/>')
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{width}"{d} '
            f'marker-end="url(#{marker})"/>')


def text(x, y, s, size=9, anchor="middle", weight="400", fill=INK, family=FONT):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" font-family="{family}">{esc(s)}</text>')


# --------------------------------------------------------------------------- diagrams
def topology_svg() -> str:
    W, H = 760, 330
    s = [svg_open(W, H)]
    nw, nh, y0 = 92, 62, 112
    gap = (W - 20 - 6 * nw) / 5
    xs = [10 + i * (nw + gap) for i in range(6)]
    names = ["ns-client", "ns-r1", "ns-r2", "ns-r3", "ns-r4", "ns-server"]
    roles = ["client", "router", "router", "router", "router", "server"]
    fills = ["#e5defe", MINT100, MINT100, MINT100, MINT100, "#d9f7fa"]
    addrs = [("10.10.1.1", ""), ("10.10.1.2", "10.10.2.1"), ("10.10.2.2", "10.10.3.1"),
             ("10.10.3.2", "10.10.4.1"), ("10.10.4.2", "10.10.5.1"), ("10.10.5.2", "")]
    cy = y0 + nh / 2
    # links first (under nodes)
    for i in range(5):
        x1, x2 = xs[i] + nw, xs[i + 1]
        s.append(f'<line x1="{x1}" y1="{cy}" x2="{x2}" y2="{cy}" stroke="{INK}" stroke-width="4"/>')
        s.append(text((x1 + x2) / 2, cy - 8, f"s{i+1}", 9, weight="700", family=MONO))
    for i, x in enumerate(xs):
        s.append(box(x, y0, nw, nh, [names[i], roles[i]], fill=fills[i], sizes=[11.5, 9]))
        if i >= 1:
            s.append(f'<rect x="{x+nw/2-27}" y="{y0-30}" width="54" height="19" rx="9.5" fill="#fff" stroke="{INK}" stroke-width="1.8"/>')
            s.append(text(x + nw / 2, y0 - 16.5, f"Hop {i}", 9.5, weight="700"))
        else:
            s.append(text(x + nw / 2, y0 - 16.5, "path start", 9, fill=SOFT))
        a, b = addrs[i]
        s.append(text(x + nw / 2, y0 + nh + 14, a, 8.3, family=MONO, fill=SOFT))
        if b:
            s.append(text(x + nw / 2, y0 + nh + 25, b, 8.3, family=MONO, fill=SOFT))
    # co-located measurement box under client
    s.append(box(10, 222, 238, 52, ["Path prober + application client", "co-located: one CLOCK_MONOTONIC clock"],
                 fill="#fff", sizes=[10, 8.5]))
    s.append(f'<line x1="{xs[0]+nw/2}" y1="{y0+nh+30}" x2="{xs[0]+nw/2}" y2="222" stroke="{INK}" stroke-width="1.8" stroke-dasharray="4 3"/>')
    # server app
    s.append(box(W - 10 - 160, 222, 160, 52, ["Application server", "WebSocket echo (app/server.py)"], fill="#fff", sizes=[10, 8.5]))
    s.append(f'<line x1="{xs[5]+nw/2}" y1="{y0+nh+30}" x2="{xs[5]+nw/2}" y2="222" stroke="{INK}" stroke-width="1.8" stroke-dasharray="4 3"/>')
    # fault box under link s3 (leaving ns-r2)
    fx = (xs[2] + nw + xs[3]) / 2
    s.append(box(fx - 112, 222, 224, 52, ["Fault controller (hoptrace-truth)", "tc netem / tbf on ns-r2 egress veth-s3-a"],
                 fill="#ffe3dc", stroke=INK, sizes=[10, 8.3]))
    s.append(arrow(fx, 222, fx, cy + 6, color=DEGRADED, dash=True, marker="ahc", width=2.6))
    s.append(f'<path d="M{fx-9},{cy-9} l7,-13 l-1,9 l8,0 l-7,13 l1,-9 z" fill="{DEGRADED}" stroke="{INK}" stroke-width="1.2"/>')
    s.append(text(fx, 297, "Example only: an impairment on the link leaving Hop 2 is first visible at Hop 3,", 9, fill=INK))
    s.append(text(fx, 310, "because Hop 2's own reply is generated before that link is crossed.", 9, fill=INK))
    s.append(text(10, 326, "Link sN = subnet 10.10.N.0/30 (low node .1, high node .2). A hop's reply comes from its client-facing address, so Hop k is 10.10.k.2.",
                  8, anchor="start", fill=SOFT))
    s.append("</svg>")
    return "".join(s)


def architecture_svg() -> str:
    W, H = 760, 372
    s = [svg_open(W, H)]
    # band labels
    s.append(f'<rect x="2" y="2" width="{W-4}" height="196" rx="14" fill="{MINT100}" opacity="0.55" stroke="{INK}" stroke-width="1.4" stroke-dasharray="6 4"/>')
    s.append(text(14, 20, "OBSERVATION AND ANALYSIS PATH (reads no ground truth)", 8.6, anchor="start", weight="700", fill=SOFT, family=MONO))
    cw, gap = 118, 38
    xs = [10 + i * (cw + gap) for i in range(5)]
    mid_y, mh = 78, 70
    s.append(box(xs[0], mid_y, cw, mh, ["Controlled testbed", "6 network", "namespaces"], fill="#d9f7fa", sizes=[10, 8.5, 8.5]))
    s.append(box(xs[1], 36, cw, 62, ["Path prober", "prober/", "→ hop.jsonl"], fill="#fff", sizes=[10, 8.3, 8.3], fonts=[FONT, MONO, MONO]))
    s.append(box(xs[1], 118, cw, 62, ["App telemetry", "app/", "→ app.jsonl"], fill="#fff", sizes=[10, 8.3, 8.3], fonts=[FONT, MONO, MONO]))
    s.append(box(xs[2], mid_y, cw, mh, ["Correlation engine", "correlate/", "→ EvidenceRecord"], fill="#fff", sizes=[10, 8.3, 8.3], fonts=[FONT, MONO, MONO]))
    s.append(box(xs[3], mid_y, cw, mh, ["Interpretation", "present/", "→ path_bundle.json"], fill="#fff", sizes=[10, 8.3, 7.8], fonts=[FONT, MONO, MONO]))
    s.append(box(xs[4], mid_y, cw, mh, ["Dashboard", "frontend/", "reads stored bundles"], fill="#e5defe", sizes=[10, 8.3, 7.8], fonts=[FONT, MONO, FONT]))
    cy = mid_y + mh / 2
    s.append(arrow(xs[0] + cw, cy - 14, xs[1], 67))
    s.append(arrow(xs[0] + cw, cy + 14, xs[1], 149))
    s.append(arrow(xs[1] + cw, 67, xs[2], cy - 14))
    s.append(arrow(xs[1] + cw, 149, xs[2], cy + 14))
    s.append(arrow(xs[2] + cw, cy, xs[3], cy))
    s.append(arrow(xs[3] + cw, cy, xs[4], cy))
    # separation
    s.append(f'<line x1="2" y1="214" x2="{W-2}" y2="214" stroke="{DEGRADED}" stroke-width="2.4" stroke-dasharray="9 5"/>')
    s.append(f'<rect x="104" y="204" width="412" height="20" rx="10" fill="#fff" stroke="{DEGRADED}" stroke-width="1.8"/>')
    s.append(text(310, 218, "✕  isolation boundary: the engine and the dashboard never read ground truth", 8.6, weight="700", fill=INK))
    # bottom band
    s.append(text(200, 252, "EXPERIMENT CONTROL AND EVALUATION", 8.6, anchor="start", weight="700", fill=SOFT, family=MONO))
    by, bh = 270, 70
    s.append(box(xs[0], by, cw, bh, ["Fault controller", "faultctl/", "tc netem / tbf"], fill="#ffe3dc", sizes=[10, 8.3, 8.3], fonts=[FONT, MONO, MONO]))
    s.append(box(xs[2], by, cw, bh, ["Ground-truth DB", "OS-permission", "isolated (SQLite)"], fill="#fff6c9", sizes=[10, 8.3, 8.3]))
    s.append(box(xs[3], by, cw, bh, ["Evaluation", "evaluate/", "scores vs labels"], fill="#fff", sizes=[10, 8.3, 8.3], fonts=[FONT, MONO, FONT]))
    # fault controller -> testbed (up, crossing boundary) : injects faults
    fx = xs[0] + cw / 2
    s.append(arrow(fx, by, fx, mid_y + mh + 2, color=DEGRADED, dash=True, marker="ahc", width=2.4))
    s.append(f'<rect x="{fx+6}" y="230" width="98" height="16" rx="8" fill="#fff"/>')
    s.append(text(fx + 55, 241.5, "injects faults", 8.6, weight="600"))
    # controller -> GT (labels)
    s.append(arrow(xs[0] + cw, by + bh / 2, xs[2], by + bh / 2))
    s.append(text((xs[0] + cw + xs[2]) / 2, by + bh / 2 - 8, "writes injected-fault labels", 8.6, weight="600"))
    # GT -> evaluation
    s.append(arrow(xs[2] + cw, by + bh / 2, xs[3], by + bh / 2))
    s.append(text(xs[2] + cw + gap / 2, by + bh / 2 - 8, "read", 8.6, weight="600"))
    # engine -> evaluation (EvidenceRecord to score)
    ex = xs[2] + cw / 2
    ex2 = xs[3] + cw / 2
    s.append(arrow(0, 0, 0, 0, path=f"M{ex},{mid_y+mh} L{ex},{184} L{ex2},{184} L{ex2},{by}", dash=True))
    s.append(f'<rect x="{ex+8}" y="171" width="150" height="14" rx="7" fill="#fff"/>')
    s.append(text(ex + 83, 181.5, "EvidenceRecord to score", 8.6, weight="600"))
    s.append("</svg>")
    return "".join(s)


def pipeline_svg() -> str:
    W, H = 760, 168
    s = [svg_open(W, H)]
    labels = [
        (["Raw streams", "hop.jsonl", "app.jsonl"], "#fff"),
        (["Synchronise", "500 ms buckets", "mean RTT / series"], "#fff"),
        (["Onset", "median + 5·MAD", "3 buckets in a row"], "#fff"),
        (["Align", "|Δt| ≤ 1.5 s", "+ downstream hops"], "#fff"),
        (["EvidenceRecord", "5 claim tags", "heuristic confidence"], "#e6ffc2"),
        (["Interpret + export", "path_bundle.json", "→ dashboard"], "#e5defe"),
    ]
    bw, bh = 104, 78
    gap = (W - 20 - 6 * bw) / 5
    y = 36
    for i, (lines, fill) in enumerate(labels):
        x = 10 + i * (bw + gap)
        s.append(box(x, y, bw, bh, lines, fill=fill, sizes=[10, 8.3, 8.3]))
        s.append(text(x + 11, y - 9, f"{i+1}", 10, weight="800", family=MONO))
        if i < 5:
            s.append(arrow(x + bw + 1, y + bh / 2, x + bw + gap - 2, y + bh / 2))
    mods = ["prober/ + app/", "synchronize.py", "onset_candidates_v2.py", "align.py", "evidence.py", "present/"]
    for i, m in enumerate(mods):
        x = 10 + i * (bw + gap)
        s.append(text(x + bw / 2, y + bh + 20, m, 8.2, family=MONO, fill=SOFT))
    s.append(text(W / 2, 160, "The frontend only displays path_bundle.json; it never recomputes an onset, a status or a confidence.", 9, weight="600"))
    s.append("</svg>")
    return "".join(s)


# --------------------------------------------------------------------------- assembly
def find_browser() -> str:
    for c in (os.environ.get("CHROME"),
              r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chrome")):
        if c and os.path.exists(c):
            return c
    sys.exit("Chrome or Edge not found (set CHROME=...)")


def render_pdf(html_path: str, pdf_path: str) -> None:
    exe = find_browser()
    uri = "file:///" + html_path.replace("\\", "/")
    prof = tempfile.mkdtemp(prefix="hoptrace-pdf-")
    cmd = [exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={prof}",
           "--virtual-time-budget=20000", f"--print-to-pdf={pdf_path}", uri]
    subprocess.run(cmd, check=True, capture_output=True, timeout=180)
    shutil.rmtree(prof, ignore_errors=True)


def strip_tags(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def heading_list(body: str):
    out = []
    for m in re.finditer(r"<h([12]) id=\"([^\"]+)\"[^>]*>(.*?)</h\1>", body, flags=re.S):
        out.append((int(m.group(1)), m.group(2), strip_tags(m.group(3))))
    return out


def page_lookup(pdf_path: str, heads, toc_pages: int):
    import fitz  # PyMuPDF
    doc = fitz.open(pdf_path)
    texts = [re.sub(r"\s+", " ", doc[i].get_text()) for i in range(len(doc))]
    pages = {}
    start = toc_pages  # first page index after cover (0) + toc pages
    for lvl, hid, title in heading_list_cache:
        key = re.sub(r"\s+", " ", title)
        for i in range(start, len(doc)):
            if key in texts[i]:
                pages[hid] = i + 1
                start = i  # headings appear in order
                break
    return pages, len(doc)


heading_list_cache: list = []


def build(slot: str, team: str) -> str:
    global heading_list_cache
    check_numbers()
    body = "".join(open(os.path.join(HERE, f), encoding="utf8").read() for f in sorted(os.listdir(HERE)) if re.match(r"report_part\d+\.html$", f))
    css = open(os.path.join(HERE, "report.css"), encoding="utf8").read()

    subs = {
        "{{TOPOLOGY_SVG}}": topology_svg(),
        "{{ARCH_SVG}}": architecture_svg(),
        "{{PIPELINE_SVG}}": pipeline_svg(),
        "{{SLOT}}": slot,
        "{{TEAM}}": team,
    }
    for k, v in subs.items():
        body = body.replace(k, v)
    # slot/team pending highlighting
    pend = lambda v: f'<span class="pending">{esc(v)}</span>' if v.startswith("TEMP") or v == "TO BE CONFIRMED" else esc(v)
    body = body.replace("{{SLOT_HTML}}", pend(slot)).replace("{{TEAM_HTML}}", pend(team))

    heads = heading_list(body)
    heading_list_cache = heads

    def toc_html(pages):
        rows = []
        for lvl, hid, title in heads:
            pg = pages.get(hid, "")
            cls = "" if lvl == 1 else ' class="sub"'
            rows.append(f'<li{cls}><span>{esc(title)}</span><span class="dots"></span><span class="pg">{pg}</span></li>')
        return "<ol>" + "".join(rows) + "</ol>"

    def write_html(pages):
        doc = ("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
               "<title>HOPTRACE Project Report</title>"
               f"<style>{css}</style></head><body>" + body.replace("{{TOC}}", toc_html(pages)) + "</body></html>")
        p = os.path.join(HERE, "report.html")
        open(p, "w", encoding="utf8").write(doc)
        return p

    html_path = write_html({})
    pdf_tmp = os.path.join(HERE, "_pass1.pdf")
    render_pdf(html_path, pdf_tmp)
    toc_pages = 1  # TOC occupies exactly one page after the cover (asserted below)
    import fitz
    _d = fitz.open(pdf_tmp)
    assert "Contents" in _d[1].get_text() and "Contents" not in _d[2].get_text(), "TOC must fit on exactly one page"
    _d.close()
    pages, n = page_lookup(pdf_tmp, heads, 2)
    missing = [t for _, h, t in heads if h not in pages]
    assert not missing, f"headings not found in PDF: {missing}"
    html_path = write_html(pages)
    final_name = f"{slot}_Team{team}_Report.pdf"
    final = os.path.join(OUT_DIR, final_name)
    render_pdf(html_path, final)
    pages2, n2 = page_lookup(final, heads, 2)
    assert pages2 == pages, "page numbers shifted between passes"
    # replace the browser user-agent string in the PDF metadata with accurate, non-personal fields
    d = fitz.open(final)
    d.set_metadata({"title": "HOPTRACE: Network Path Fault Localization through Application-to-Hop Correlation",
                    "author": "Krish Chirag Shah", "subject": "BCSE308P Computer Networks Lab, Assignment 8: Project Report",
                    "keywords": "", "creator": "submission/build/build_report.py", "producer": "headless Chromium print-to-PDF; PyMuPDF"})
    d.save(final + ".tmp", garbage=3, deflate=True)
    d.close()
    os.replace(final + ".tmp", final)
    os.remove(pdf_tmp)
    print(f"wrote {final} ({n2} pages)")
    return final


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--slot", default="F2")
    ap.add_argument("--team", default="24")
    a = ap.parse_args()
    build(a.slot, a.team)
