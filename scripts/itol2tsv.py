#!/usr/bin/env python3
"""Convert iTOL annotation files into the plain TSV tables mitol loads.

mitol reads simple tab-separated tables: an `id` column of leaf names plus one
column per annotation (a row id "A|B" means the clade of leaves A and B), or
`source` / `target` columns for connections. This script turns iTOL dataset
files into such tables, so existing iTOL annotations load without iTOL's
header syntax, and writes a colour key and a short guide next to them.

Usage:
  python3 scripts/itol2tsv.py INPUT [INPUT ...] [-o OUTDIR] [--tree TREE.nwk] [--recursive]

  INPUT       iTOL files or folders of them. Files that are not iTOL datasets
              (plain TSVs, FASTA, ...) are skipped with a one-line note, and so
              are the files this script wrote itself.
  -o OUTDIR   default: INPUT/mitol_converted for a folder, else a
              mitol_converted folder next to the first input file. Nothing is
              written outside it, and nothing at all when no iTOL dataset is
              found.
  --tree      Newick tree: ids missing from the tree are reported, and clade
              references in per-leaf datasets ("A|B" = last common ancestor of
              A and B, an internal node name, or iTOL's CONTAINS==<regexp>)
              become one row per leaf below that node; a leaf takes the whole
              row of the smallest node that names it (its own row first).
              Decoration columns (branch colours / widths, node symbols, node
              pies) keep clade rows, written with one spelling per clade so
              mitol merges them; iTOL clade-wide branch widths go on every
              branch of the clade, and a clade colour is split around leaves
              that have their own branch colour.
  --recursive also read sub-folders of folder inputs.

Outputs (in OUTDIR):
  <stem>.tsv              one table per iTOL dataset: id + one column per value
                          (column names from DATASET_LABEL / FIELD_LABELS,
                          unique across the run and the tables in OUTDIR)
  <stem>.connections.tsv  DATASET_CONNECTION: source, target, width, color, style, label
  colors.tsv              colour key: column, value, color, shape (value = a category,
                          "(color)" for a numeric column's bar / field colour,
                          "(low)" / "(mid)" / "(high)" for gradient stops; shape =
                          the iTOL symbol shape, used by mitol's Leaf markers)
  README.md               source → output table and the mitol clicks per file
  .itol2tsv.json          manifest: the files this script wrote in OUTDIR (sources
                          relative to OUTDIR, so a copied folder keeps working)

OUTDIR may be shared with other tools: files the manifest does not list are
never overwritten. Re-running overwrites this script's own files. Tables made
earlier from other inputs are kept (and stay in colors.tsv and README.md);
tables whose source file is gone, or no longer converts, are removed.

Supported: DATASET_COLORSTRIP, SIMPLEBAR, GRADIENT, MULTIBAR, HEATMAP,
EXTERNALSHAPE, PIECHART, BINARY, SYMBOL, DOMAINS, TEXT, CONNECTION, STYLE,
ALIGNMENT, BOXPLOT, LINECHART, RANGE, TREE_COLORS, LABELS, COLLAPSE, METADATA.
POPUP_INFO, DATASET_IMAGE, AUTO_TAXONOMY and other types, and datasets without
data rows, are skipped with a note.

Python 3 standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import signal
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Container, Dict, Iterable, List, Optional, Set, Tuple

# ============================================================
# Constants
# ============================================================

ITOL_HEADERS = {"TREE_COLORS", "LABELS", "COLLAPSE", "POPUP_INFO", "METADATA", "MULTI_STYLE", "PRUNE", "SPACING",
                "AUTO_TAXONOMY"}
SEPARATORS = {"TAB": "\t", "COMMA": ",", "SPACE": " "}

# Every setting key of the official iTOL templates. Right after the DATA line (before the first data row) a line
# starting with one of these is a setting, not a data row.
KNOWN_SETTINGS = {
    "ALIGN_FIELDS", "ALIGN_TO_LABELS", "ALIGN_TO_TREE", "ALL_LABELS_ROTATION", "ARROW_SIZE", "AUTO_LEGEND",
    "AUTO_SCALE", "AXIS_X", "AXIS_Y", "BACKBONE_COLOR", "BACKBONE_HEIGHT", "BACKGROUND_COLOR", "BAR_LABEL_COLOR",
    "BAR_SHIFT", "BAR_ZERO", "BORDER_COLOR", "BORDER_DASHED", "BORDER_WIDTH", "BRACKET_BEHIND_DATASETS",
    "BRACKET_SHIFT", "BRACKET_SIZE", "BRACKET_STYLE", "CENTER_CURVES", "CHART_SHIFT", "COLOR", "COLORED_DOTS",
    "COLOR_BRANCHES", "COLOR_FILL", "COLOR_GRAPH", "COLOR_MAX", "COLOR_MID", "COLOR_MIN", "COLOR_NAN",
    "COLOR_SCHEME", "COLUMN_LABELS", "COLUMN_LABEL_ROTATION", "COLUMN_LABEL_SHIFT_X", "COLUMN_LABEL_SHIFT_Y",
    "COLUMN_LABEL_SIZE_FACTOR", "COMPLETE_BORDER", "CONNECTION_CURVE", "CONNECTION_MARGIN_LEFT",
    "CONNECTION_MARGIN_RIGHT", "CONNECTION_TAIL", "CONSENSUS_THRESHOLD", "COVER_DATASETS", "COVER_LABELS",
    "COVER_TREE", "CURVE_ANGLE", "CUSTOM_COLOR_SCHEME", "DASHED_LINES", "DATASET_LABEL", "DATASET_SCALE",
    "DATA_NORMALIZATION", "DEFAULT_CONNECTION_COLOR", "DEFAULT_CONNECTION_STYLE", "DEFAULT_CONNECTION_WIDTH",
    "DEFAULT_DOT_COLOR", "DEFAULT_LINE_COLOR", "DISPLAY_CONSENSUS", "DISPLAY_CONSERVATION", "DISPLAY_VALUES",
    "DOT_SIZE", "DRAW_ARROWS", "END_POSITION", "END_TANGLEGRAM_TREE", "EXCLUDE_LABELS", "EXTERNAL_LABEL_SHIFT",
    "FIELD_COLORS", "FIELD_LABELS", "FIELD_SHAPES", "FIELD_TREE", "FIT_LABELS", "GRADIENT_FILL", "GRID_COLOR",
    "GRID_WIDTH", "HEIGHT_FACTOR", "HIGHLIGHT_DISAGREEMENTS", "HIGHLIGHT_REFERENCES", "HIGHLIGHT_TYPE",
    "HORIZONTAL_GRID", "IGNORE_GAPS", "IMAGE_ROTATION", "IMAGE_SHIFT_H", "IMAGE_SHIFT_V", "INCLUDE_ONLY",
    "INVERSE_GAPS", "LABELS_BELOW", "LABELS_ON_TOP", "LABELS_VERTICAL", "LABEL_ALIGN", "LABEL_ALIGN_TO_TREE",
    "LABEL_AUTO_COLOR", "LABEL_OUTLINE_COLOR", "LABEL_OUTLINE_WIDTH", "LABEL_POSITION", "LABEL_ROTATION",
    "LABEL_SEPARATOR", "LABEL_SHIFT", "LABEL_SHIFT_X", "LABEL_SHIFT_Y", "LABEL_SIZE_FACTOR", "LEGEND_COLORS",
    "LEGEND_HORIZONTAL", "LEGEND_LABELS", "LEGEND_POSITION_X", "LEGEND_POSITION_Y", "LEGEND_SCALE", "LEGEND_SHAPES",
    "LEGEND_SHAPE_INVERT", "LEGEND_SHAPE_SCALES", "LEGEND_TITLE", "LEGEND_VISIBLE", "LINE_COLOR", "LINE_COLORS",
    "LINE_WIDTH", "LOG_SCALE", "LOOP_SIZE", "MARGIN", "MARK_REFERENCES", "MAXIMUM_LINE_WIDTH", "MAXIMUM_SIZE",
    "MAXIMUM_SYMBOL_SIZE", "NORMALIZATION_RANGE", "NORMALIZATION_TYPE", "ON_BRANCH", "PARTS_REQUIRED",
    "POLAR_AREA_DIAGRAM", "POSITION_ABOVE", "RANGE_COVER", "RANGE_LABEL_AUTO_COLOR", "RANGE_LABEL_COLOR",
    "RANGE_LABEL_POSITION", "RANGE_LABEL_ROTATION", "RANGE_LABEL_SHIFT_X", "RANGE_LABEL_SHIFT_Y", "RANGE_LABEL_SIZE",
    "RANGE_TYPE", "REFERENCE_BOX_BORDER_COLOR", "REFERENCE_BOX_BORDER_WIDTH", "REFERENCE_BOX_FILL_COLOR",
    "ROTATE_ALIGNED_LABELS", "ROUND_VALUES", "SCALING_FACTOR", "SEPARATOR", "SHAPE_SPACING", "SHAPE_TYPE",
    "SHOW_ARROW_LABELS", "SHOW_COLUMN_LABELS", "SHOW_DOMAIN_LABELS", "SHOW_DOTS", "SHOW_INTERNAL", "SHOW_LABELS",
    "SHOW_LINE", "SHOW_RANGES", "SHOW_RANGE_LABELS", "SHOW_STRIPS", "SHOW_STRIP_LABELS", "SHOW_SYMBOLS",
    "SHOW_TITLE", "SHOW_TREE", "SHOW_VALUE", "SHOW_VALUES", "SHOW_VALUE_LABELS", "SIDE_STACKED", "SIZE_FACTOR",
    "START_POSITION", "STRAIGHT_LABELS", "STRIP_BORDER_COLOR", "STRIP_BORDER_WIDTH", "STRIP_LABEL_AUTO_COLOR",
    "STRIP_LABEL_COLOR", "STRIP_LABEL_OUTLINE", "STRIP_LABEL_POSITION", "STRIP_LABEL_ROTATION", "STRIP_LABEL_SHIFT",
    "STRIP_LABEL_SIZE_FACTOR", "STRIP_SPACING", "STRIP_WIDTH", "SYMBOL_BORDER_COLOR", "SYMBOL_BORDER_WIDTH",
    "SYMBOL_SPACING", "TANGLEGRAM_EXTERNAL_MARGIN", "TANGLEGRAM_TREE", "TITLE_COLOR", "TITLE_SHIFT_X",
    "TITLE_SHIFT_Y", "TITLE_SIZE", "TREE_PAN_H", "TREE_PAN_V", "TREE_SCALE_H", "TREE_SCALE_V", "UNROOTED_SMOOTH",
    "USER_MAX_VALUE", "USER_MID_VALUE", "USER_MIN_VALUE", "USE_MID_COLOR", "VALUES_SCI_NOTATION", "VALUE_AUTO_COLOR",
    "VALUE_COLOR", "VALUE_LABEL_ROTATION", "VALUE_LABEL_SHIFT", "VALUE_LABEL_SIZE_FACTOR", "VALUE_ROTATION",
    "VALUE_SHIFT", "VALUE_SIZE_FACTOR", "VERTICAL_CHART", "VERTICAL_GRID", "VERTICAL_SHIFT", "VERTICAL_SHRINK",
    "WIDTH",
}
# An unknown key of the same shape (CAPITALS_WITH_UNDERSCORES) there is read as a setting too, with a warning,
# unless it is an id of the tree.
SETTING_LIKE = re.compile(r"[A-Z]+(?:_[A-Z]+)+")

# Short type names: suffix for clashing column names, and the README.
SHORT_TYPE = {
    "DATASET_COLORSTRIP": "strip", "DATASET_SIMPLEBAR": "bar", "DATASET_GRADIENT": "gradient",
    "DATASET_MULTIBAR": "multibar", "DATASET_HEATMAP": "heatmap", "DATASET_EXTERNALSHAPE": "shapes",
    "DATASET_PIECHART": "pie", "DATASET_BINARY": "binary", "DATASET_SYMBOL": "symbols",
    "DATASET_DOMAINS": "domains", "DATASET_TEXT": "text", "DATASET_CONNECTION": "connections",
    "DATASET_STYLE": "style", "DATASET_ALIGNMENT": "alignment", "DATASET_BOXPLOT": "boxplot",
    "DATASET_LINECHART": "linechart", "DATASET_RANGE": "range", "TREE_COLORS": "tree colors",
    "LABELS": "labels", "COLLAPSE": "collapse", "METADATA": "metadata",
}

UNSUPPORTED = {
    "POPUP_INFO": "mouse-over popups have no mitol equivalent (mitol's hover shows each row's annotation values)",
    "DATASET_IMAGE": "images are not supported by mitol",
    "DATASET_ARROWS": "arrow datasets are not supported by mitol",
    "DATASET_TANGLEGRAM": "tanglegrams are not supported by mitol",
    "DATASET_TIMESCALE": "timescales are not supported by mitol",
    "MULTI_STYLE": "per-word label styles are not supported by mitol",
    "PRUNE": "pruning lists are not annotations (mitol: select leaves and use Hide)",
    "SPACING": "per-leaf spacing is not supported by mitol",
    "AUTO_TAXONOMY": "taxonomy assignment files are not annotations (iTOL uses them to look up NCBI / GTDB taxa)",
}

# Fewest fields (id included) a DATA row needs to give a value; shorter rows are skipped with a warning.
MIN_FIELDS = {
    "DATASET_COLORSTRIP": 2, "DATASET_SIMPLEBAR": 2, "DATASET_GRADIENT": 2, "DATASET_MULTIBAR": 2,
    "DATASET_HEATMAP": 2, "DATASET_EXTERNALSHAPE": 2, "DATASET_PIECHART": 4, "DATASET_BINARY": 2,
    "DATASET_SYMBOL": 6, "DATASET_DOMAINS": 2, "DATASET_TEXT": 2, "DATASET_CONNECTION": 2,
    "DATASET_STYLE": 4, "DATASET_BOXPLOT": 6, "DATASET_LINECHART": 2, "DATASET_RANGE": 3,
    "TREE_COLORS": 3, "LABELS": 2, "METADATA": 2,
}

# iTOL help, "Matching multiple IDs": an id CONTAINS==<JavaScript RegExp> matches every node id it finds,
# in these file types only.
CONTAINS = "CONTAINS=="
CONTAINS_TYPES = {"TREE_COLORS", "DATASET_RANGE", "DATASET_STYLE", "DATASET_COLORSTRIP", "DATASET_SYMBOL", "DATASET_TEXT"}

# iTOL types that show a clade's value only while the clade is collapsed (or with SHOW_INTERNAL 1).
SHOWN_WHEN_COLLAPSED = {
    "DATASET_COLORSTRIP", "DATASET_SIMPLEBAR", "DATASET_GRADIENT", "DATASET_MULTIBAR", "DATASET_HEATMAP",
    "DATASET_EXTERNALSHAPE", "DATASET_BINARY", "DATASET_TEXT", "DATASET_BOXPLOT", "DATASET_LINECHART",
    "DATASET_DOMAINS",
}

# Column names mitol's parser treats specially (id / connection columns), compared lower-case.
RESERVED_COLUMNS = {"id", "name", "source", "target", "node1", "node2", "leaf1", "leaf2", "id1", "id2", "from", "to"}
MANIFEST = ".itol2tsv.json"
RESERVED_FILES = {"colors.tsv", "readme.md", MANIFEST}

# iTOL symbol / field shape numbers → mitol shape names (SHAPE_CHOICES labels).
ITOL_SHAPES = {"1": "Square", "2": "Circle", "3": "Star", "4": "Triangle →", "5": "Triangle ←", "6": "Check mark"}
# iTOL symbol codes → mitol shape names (colour-key shape column, read by Leaf markers).
MITOL_SHAPES = {"1": "square", "2": "circle", "3": "star", "4": "triangle-right", "5": "triangle-left", "6": "check"}
DOMAIN_SHAPES = {"RE", "HH", "HV", "EL", "DI", "TR", "TL", "PL", "PR", "PU", "PD", "OC", "GP"}
# iTOL COLOR_SCHEME → mitol alignment "Colour scheme" label.
ALIGNMENT_SCHEMES = {
    "clustal": "Clustal X (protein)", "zappo": "Zappo (protein)", "taylor": "Taylor (protein)",
    "hphob": "Hydrophobicity (protein)", "helix": "Helix propensity", "strand": "Strand propensity",
    "turn": "Turn propensity", "buried": "Buried index", "none": "Mono (one colour)",
}

# Values JavaScript's Number() reads as a number (mitol: a column is numeric when every non-blank cell is).
JS_NUMBER = re.compile(
    r"[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|Infinity)|0[xX][0-9a-fA-F]+|0[oO][0-7]+|0[bB][01]+"
)
HEX_COLOR = re.compile(r"#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})")
RGB_COLOR = re.compile(r"rgba?\(\s*([^,()\s]+)\s*,\s*([^,()\s]+)\s*,\s*([^,()\s]+)\s*(?:,\s*([^,()\s]+)\s*)?\)", re.I)
# iTOL rich-text tags (text label datasets): <n> <b> <i> <bi> <sub> <sup>, lowercase, with optional attributes.
ITOL_TAG = re.compile(r"</?(?:n|b|i|bi|sub|sup)(?:\s[^<>]*)?>")


def is_number(s: str) -> bool:
    """True when JavaScript's Number(s) is not NaN (blank excluded)."""
    s = s.strip()
    return s != "" and JS_NUMBER.fullmatch(s) is not None


def js_number(s: str) -> Optional[float]:
    """JavaScript's Number(s) when it is finite; None for blank, NaN and ±Infinity (as mitol's readers)."""
    s = (s or "").strip()
    if not s or JS_NUMBER.fullmatch(s) is None:
        return None
    try:
        v = float(int(s, 0)) if s[:2] in ("0x", "0X", "0o", "0O", "0b", "0B") else float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def fmt_num(x: float) -> str:
    """Compact number: 3 decimals at most, no trailing zeros."""
    s = f"{x:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def norm_color(raw: str) -> Optional[str]:
    """Hex (#rgb, #rgba, #rrggbb, #rrggbbaa), rgb() or rgba() → lowercase #rrggbb (#rrggbbaa if alpha < 1)."""
    s = (raw or "").strip()
    m = HEX_COLOR.fullmatch(s)
    if m:
        h = m.group(1).lower()
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        return "#" + (h[:6] if h[6:] == "ff" else h)
    m = RGB_COLOR.fullmatch(s)
    if not m:
        return None

    def part(t: str, scale: float) -> float:
        v = float(t[:-1]) / 100 * scale if t.endswith("%") else float(t)
        return max(0.0, min(scale, v))

    try:
        rgb = [round(part(m.group(i), 255)) for i in (1, 2, 3)]
        alpha = part(m.group(4), 1) if m.group(4) else 1.0
    except ValueError:
        return None
    out = "#" + "".join(f"{v:02x}" for v in rgb)
    return out + f"{round(alpha * 255):02x}" if alpha < 1 else out


def short_list(items: Iterable[str], n: int = 3) -> str:
    items = list(items)
    head = ", ".join(f"'{x}'" for x in items[:n])
    return head + (f" … (+{len(items) - n})" if len(items) > n else "")


def plural(n: int, word: str, many: Optional[str] = None) -> str:
    return f"{n:,} {word if n == 1 else (many or word + 's')}"


# ============================================================
# Reading iTOL files
# ============================================================

def utf16_without_bom(data: bytes) -> Optional[str]:
    """'utf-16-le' / 'utf-16-be' when the start of the file looks like UTF-16 text without a BOM (mostly ASCII:
    every other byte is zero), else None."""
    head = data[:400]
    if len(head) < 8 or b"\x00" not in head:
        return None
    even, odd = (part.count(0) / max(1, len(part)) for part in (head[0::2], head[1::2]))
    if odd > 0.7 and even < 0.05:
        return "utf-16-le"
    if even > 0.7 and odd < 0.05:
        return "utf-16-be"
    return None


def decode(data: bytes) -> Tuple[str, Optional[str]]:
    """Text of a file and a note when it was not UTF-8: UTF-16 (with a BOM, or plain ASCII text without one);
    else UTF-8 line by line, and Windows-1252 (or Latin-1) only for the lines that are not UTF-8."""
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace"), "UTF-16 file: read as UTF-16 (iTOL expects UTF-8)"
    enc16 = utf16_without_bom(data)
    if enc16:
        return data.decode(enc16, errors="replace"), "UTF-16 file without a BOM: read as UTF-16 (iTOL expects UTF-8)"
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        pass
    lines, bad = [], []
    for i, raw in enumerate(data.split(b"\n"), start=1):
        try:
            lines.append(raw.decode("utf-8"))
        except UnicodeDecodeError:
            bad.append(i)
            try:
                lines.append(raw.decode("cp1252"))
            except UnicodeDecodeError:
                lines.append(raw.decode("latin-1"))
    where = ", ".join(str(i) for i in bad[:5]) + (" …" if len(bad) > 5 else "")
    return "\n".join(lines), (f"{plural(len(bad), 'line')} not UTF-8 (line {where}): read as Windows-1252 / Latin-1; "
                              "check the accented characters there")


def read_text(path: str) -> Tuple[str, Optional[str]]:
    with open(path, "rb") as fh:
        return decode(fh.read())


def text_lines(text: str) -> List[str]:
    """Lines split on \\n, \\r\\n or \\r only (str.splitlines would also split on U+2028, \\x0c, \\x1e …)."""
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


@dataclass
class Setting:
    values: List[str]  # fields after the key (trailing empty fields dropped)
    raw: str           # the rest of the line after the key (labels that contain the separator)


@dataclass
class ItolFile:
    path: str
    kind: str
    sep: str = "\t"
    sep_name: str = "TAB"
    settings: Dict[str, List[Setting]] = field(default_factory=dict)
    rows: List[List[str]] = field(default_factory=list)   # DATA rows split into fields
    lines: List[str] = field(default_factory=list)        # DATA rows as text (FASTA alignments)
    has_data: bool = False
    notes: List[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        return os.path.basename(self.path)

    @property
    def stem(self) -> str:
        return os.path.splitext(self.name)[0]

    def has(self, key: str) -> bool:
        return key in self.settings

    def get(self, key: str, default: str = "") -> str:
        """A single-valued setting (last occurrence, first field, as iTOL reads it), e.g. COLOR."""
        s = self.settings.get(key)
        return s[-1].values[0] if s and s[-1].values else default

    def text(self, key: str, default: str = "") -> str:
        """A free-text setting (DATASET_LABEL): the rest of the line, so it may contain the separator."""
        s = self.settings.get(key)
        return s[-1].raw if s else default

    def values(self, key: str) -> List[str]:
        """A list-valued setting (last occurrence), e.g. FIELD_LABELS."""
        s = self.settings.get(key)
        return list(s[-1].values) if s else []


def itol_header(path: str) -> Tuple[Optional[str], str]:
    """(iTOL keyword, first meaningful line); when the file is not an iTOL file: (None, why it is skipped)."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(65536)
    except OSError as e:
        return None, f"cannot read: {e.strerror or e}"
    enc16 = "utf-16" if head[:2] in (b"\xff\xfe", b"\xfe\xff") else utf16_without_bom(head)
    text = head.decode(enc16 or "utf-8-sig", errors="replace")
    for line in text_lines(text):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        tok = re.split(r"[\t, ]", s, maxsplit=1)[0]
        if tok.startswith("DATASET_") or tok in ITOL_HEADERS:
            return tok, s
        odd = sum(1 for ch in s[:200] if ch == "\ufffd" or (ord(ch) < 32 and ch != "\t"))
        if "\x00" in text or odd > len(s[:200]) / 10:
            return None, "binary file, not an iTOL file"
        return None, f"not an iTOL file (first line: {s[:50]!r})"
    return None, "empty file" if not head.strip() else "not an iTOL file (only comments)"


def split_fields(line: str, sep: str) -> List[str]:
    fields = line.split() if sep == " " else [x.strip() for x in line.split(sep)]
    while len(fields) > 1 and fields[-1] == "":  # trailing separators (spreadsheet exports)
        fields.pop()
    return fields


def parse_setting(line: str, sep: str) -> Optional[Tuple[str, Setting]]:
    """'KEY<sep>value<sep>value' → (KEY, Setting); tolerates another separator after the key."""
    m = re.match(r"([A-Z][A-Z_]*[A-Z])(?:([\t ,]+)(.*))?$", line)
    if not m:
        return None
    key, gap, rest = m.group(1), m.group(2) or "", m.group(3) or ""
    if sep != " " and sep in gap:  # 'KEY<sep>rest': split the rest on the declared separator
        rest = line.split(sep, 1)[1]
    rest = rest.strip()
    values = split_fields(rest, sep) if rest else []
    return key, Setting([] if values == [""] else values, rest.rstrip(sep + " \t"))


SEPARATOR_LINE = re.compile(r"\s*SEPARATOR(?:$|[\t ,]+(\S*))")


def read_itol(path: str, kind: str, ids: Optional[Container[str]] = None) -> ItolFile:
    """Settings and DATA rows of an iTOL file (ids: the tree's node names, to tell ids from settings)."""
    text, enc_note = read_text(path)
    lines = text_lines(text)
    f = ItolFile(path, kind)
    if enc_note:
        f.notes.append(enc_note)
    declared = None
    for ln in lines:
        m = SEPARATOR_LINE.match(ln)
        if m:
            declared = (m.group(1) or "").strip(",").upper()
            break
    if declared in SEPARATORS:
        sep_name = declared
    else:
        body = "\n".join(ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#"))
        sep_name = "TAB" if "\t" in body else "COMMA" if "," in body else "SPACE"
        if declared is not None:
            f.notes.append(f"SEPARATOR {declared or '(blank)'} is not an iTOL separator (TAB, COMMA or SPACE); "
                           f"guessed {sep_name}")
        elif kind != "COLLAPSE":
            f.notes.append(f"no SEPARATOR line; guessed {sep_name}")
    f.sep, f.sep_name = SEPARATORS[sep_name], sep_name

    header_seen = in_data = rows_started = False
    stray = 0
    unknown: List[str] = []
    for ln in lines:
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        if not header_seen:
            header_seen = True
            continue
        if SEPARATOR_LINE.match(s):
            continue
        if not in_data:
            if re.fullmatch(r"DATA[\t ,]*", s):
                in_data = f.has_data = True
                continue
            kv = parse_setting(s, f.sep)
            if kv:
                f.settings.setdefault(kv[0], []).append(kv[1])
            else:
                stray += 1
            continue
        if not rows_started:  # settings may follow DATA before the first row
            kv = parse_setting(s, f.sep)
            if kv and (kv[0] in KNOWN_SETTINGS or (SETTING_LIKE.fullmatch(kv[0]) and kv[0] not in (ids or ()))):
                f.settings.setdefault(kv[0], []).append(kv[1])
                if kv[0] not in KNOWN_SETTINGS:
                    unknown.append(kv[0])
                continue
        rows_started = True
        f.lines.append(s)
        f.rows.append(split_fields(s, f.sep))
    if not f.has_data:
        f.notes.append("no DATA line: no data rows read")
    if stray:
        f.notes.append(f"{plural(stray, 'line')} before DATA ignored (not a setting: KEY, separator, values)")
    if unknown:
        f.notes.append(f"{plural(len(unknown), 'line')} right after DATA read as "
                       f"{'a setting, not a data row' if len(unknown) == 1 else 'settings, not data rows'} "
                       f"({short_list(unknown)}): not an iTOL setting name"
                       + (", nor an id of the tree" if ids is not None else "; pass --tree if it is a leaf id"))
    if f.lines and kind not in ("DATASET_ALIGNMENT", "COLLAPSE") and not any(f.sep in ln for ln in f.lines):
        other = [n for n, ch in SEPARATORS.items() if n != sep_name and sum(ch in ln for ln in f.lines) >= len(f.lines) / 2]
        if other:
            f.notes.append(f"no DATA row contains the declared separator ({sep_name}) but most contain "
                           f"{' / '.join(other)}: is the SEPARATOR line right?")
    return f


# ============================================================
# Newick tree (same reading rules as mitol's parseNewick / buildTree)
# ============================================================

class Tree:
    def __init__(self, text: str):
        self.parent: List[int] = []
        self.children: List[List[int]] = []
        self.name: List[Optional[str]] = []  # raw Newick names (leaves and internal)
        self._parse(text)
        n = len(self.parent)
        self.leaves = [i for i in range(n) if not self.children[i]]
        self.L = [0] * n
        self.R = [0] * n
        pos = {leaf: k for k, leaf in enumerate(self.leaves)}
        for i in range(n - 1, -1, -1):  # children always have larger ids than their parent
            if not self.children[i]:
                self.L[i], self.R[i] = pos[i], pos[i] + 1
            else:
                self.L[i] = min(self.L[c] for c in self.children[i])
                self.R[i] = max(self.R[c] for c in self.children[i])
        # Name index (mitol's nodeNameIndex): leaf names first, then internal labels that are not support values.
        self.by_name: Dict[str, int] = {}
        for i in self.leaves:
            nm = self.name[i]
            if nm and nm not in self.by_name:
                self.by_name[nm] = i
        for i in range(n):
            nm = self.name[i]
            if self.children[i] and nm and not _is_support(nm) and nm not in self.by_name:
                self.by_name[nm] = i

    def _new(self, parent: Optional[int]) -> int:
        self.parent.append(-1 if parent is None else parent)
        self.children.append([])
        self.name.append(None)
        k = len(self.parent) - 1
        if parent is not None:
            self.children[parent].append(k)
        return k

    def _parse(self, s: str) -> None:
        n, i = len(s), 0
        node = self._new(None)
        stack: List[int] = []
        expect_subtree = True

        def skip_ws(j: int) -> int:
            while j < n and s[j].isspace():
                j += 1
            return j

        def read_length(j: int) -> int:
            j = skip_ws(j)
            if j < n and s[j] == ":":
                j += 1
                while j < n and s[j] not in "),;" and not s[j].isspace():
                    j += 1
            return j

        while True:
            i = skip_ws(i)
            if expect_subtree:
                if i < n and s[i] == "(":
                    stack.append(node)
                    node = self._new(node)
                    i += 1
                    continue
                j = i
                while j < n and s[j] not in ":),;" and not s[j].isspace():
                    j += 1
                self.name[node] = s[i:j] or None
                i = read_length(j)
                expect_subtree = False
                continue
            c = s[i] if i < n else ""
            if c == "," and stack:
                node = self._new(stack[-1])
                expect_subtree = True
                i += 1
            elif c == ")" and stack:
                node = stack.pop()
                i = skip_ws(i + 1)
                j = i
                while j < n and re.match(r"[A-Za-z0-9_./\-]", s[j]):
                    j += 1
                self.name[node] = s[i:j] or None
                i = read_length(j)
            elif c == ";" and not stack:
                return
            else:
                raise ValueError(f"Newick parse error at position {i}")

    @classmethod
    def from_file(cls, path: str) -> "Tree":
        return cls(read_text(path)[0])

    def is_leaf(self, node: int) -> bool:
        return not self.children[node]

    def size(self, node: int) -> int:
        return self.R[node] - self.L[node]

    def subtree(self, node: int) -> List[int]:
        """The node and every node below it."""
        out, stack = [], [node]
        while stack:
            u = stack.pop()
            out.append(u)
            stack.extend(self.children[u])
        return out

    def leaf_name(self, pos: int) -> str:
        return self.name[self.leaves[pos]] or ""

    def leaf_names(self, lo: int, hi: int) -> List[str]:
        return [self.leaf_name(k) for k in range(lo, hi)]

    def lca(self, a: int, b: int) -> int:
        u = a
        while u != -1:
            if self.L[u] <= self.L[b] and self.R[b] <= self.R[u]:
                return u
            u = self.parent[u]
        return 0

    def resolve(self, ref: str) -> Optional[int]:
        """Node for a leaf name, an internal node name, or "A|B" / "A---B" (last common ancestor)."""
        s = ref.strip()
        if s in self.by_name:
            return self.by_name[s]
        parts = s.split("---") if "---" in s else s.split("|")
        if len(parts) >= 2:
            a, b = self.by_name.get(parts[0].strip()), self.by_name.get(parts[1].strip())
            if a is not None and b is not None:
                return self.lca(a, b)
        return None

    def match(self, pattern: str) -> Optional[List[int]]:
        """Nodes whose name contains a match of the regexp (iTOL CONTAINS==); None if it is not a valid regexp."""
        try:
            rx = re.compile(pattern)
        except re.error:
            return None
        return sorted({i for nm, i in self.by_name.items() if rx.search(nm)})

    def ref(self, node: int) -> str:
        """One spelling per node: a leaf's name; an internal node's name, else 'first leaf|last leaf'."""
        nm = self.name[node]
        if nm and self.by_name.get(nm) == node:
            return nm
        a, b = self.leaf_name(self.L[node]), self.leaf_name(self.R[node] - 1)
        for spelling in (f"{a}|{b}", f"{a}---{b}"):
            if self.resolve(spelling) == node:
                return spelling
        return ""


def _is_support(name: str) -> bool:
    """mitol's parseSupportLabel: every '/'-part is blank or a finite number, and one at least is a number."""
    parts = [p.strip() for p in name.split("/")]
    nums = [js_number(p) for p in parts]
    return any(v is not None for v in nums) and all(p == "" or v is not None for p, v in zip(parts, nums))


def uniform_clades(tree: Tree, value: Dict[int, str], min_size: int = 2) -> List[Tuple[int, str]]:
    """mitol's uniformClades (Coloured Ranges → From a column): the largest clades whose leaves all share one
    value (value: leaf position → value); never single leaves or the root; minSize counts the value's leaves."""
    val: List[Optional[str]] = [None] * len(tree.parent)
    total: Counter = Counter()
    for i in range(len(tree.parent) - 1, -1, -1):  # children before parents
        if tree.is_leaf(i):
            val[i] = value.get(tree.L[i])
            if val[i] is not None:
                total[val[i]] += 1
        else:
            v0 = val[tree.children[i][0]]
            val[i] = v0 if v0 is not None and all(val[c] == v0 for c in tree.children[i]) else None
    out, stack = [], [0]
    while stack:
        u = stack.pop()
        v = val[u]
        if u != 0 and v is not None and not tree.is_leaf(u) and total[v] >= min_size:
            out.append((u, v))
            continue
        stack.extend(tree.children[u])
    return out


# ============================================================
# Conversion result for one iTOL dataset
# ============================================================

@dataclass
class Column:
    key: str              # key within the dataset; text refers to it as [[key]]
    want: str             # preferred name
    kind: str             # numeric, category, text, binary, list, domains, sequence, colour
    policy: str = "specific"  # with --tree: specific / outer = expand clade rows to leaves; keep = leave "A|B" rows
    field_of: Optional[str] = None  # dataset label, for FIELD_LABELS columns
    optional: bool = False  # dropped when empty
    group: str = "main"   # columns one iTOL row sets together: with --tree a leaf takes all of them from one row
    name: str = ""


class Dataset:
    """What one iTOL file becomes: rows, columns, colour key rows and guide text."""

    def __init__(self, f: ItolFile, tree: Optional[Tree]):
        self.f = f
        self.tree = tree
        self.kind = f.kind
        self.short = SHORT_TYPE.get(f.kind, f.kind.lower())
        self.label = re.sub(r"\s+", " ", f.text("DATASET_LABEL")).strip()
        self.columns: List[Column] = []
        self.rows: Dict[str, Dict[str, str]] = {}
        self.claims: Dict[str, Set[str]] = {}  # row id → column groups its iTOL row sets (blank values included)
        self.colors: List[Tuple[str, str, str]] = []  # (column key, value, colour)
        self.shapes: Dict[Tuple[str, str], str] = {}  # (column key, value) → mitol shape name (symbols)
        self.connections: Optional[List[Dict[str, str]]] = None
        self.pairs: List[Tuple[str, str, str]] = []  # (domains key, length key, stem) named together
        self.feature = ""
        self.steps: List[str] = []
        self.by_hand: List[str] = []  # settings with a mitol option to set by hand
        self.by_hand_where = "the ring's **Style ▾** options unless said otherwise"
        self.notes: List[str] = []
        self.renamed: List[str] = []  # column renamed because its name is taken (summary + README)
        self.warnings: List[str] = list(f.notes)
        self.not_carried: List[str] = []
        self.used = {"SEPARATOR", "DATASET_LABEL", "COLOR", "LEGEND_TITLE", "LEGEND_SHAPES", "LEGEND_COLORS", "LEGEND_LABELS"}
        self.out_file = ""
        self.display = f.name  # input name shown in the summary / README (relative to its folder)
        self.after_tree: List[Callable[[], None]] = []  # converter steps that need the expanded rows (--tree)
        self.wants: Dict[str, str] = {}  # column key → preferred name, also for columns dropped as empty
        self._group: Dict[str, str] = {}  # column key → its group
        self._last_claim: Tuple[str, str] = ("", "")
        self._auto: Dict[str, Tuple[str, str]] = {}  # column key → (ring, colour note): rings mitol adds by itself
        self._bad_numbers: Dict[str, List[str]] = {}
        self._bad_colors: Counter = Counter()
        self._dupes = 0
        self.unexpanded = False  # clade rows or CONTAINS== patterns left as written (no --tree)
        if not self.label and f.kind.startswith("DATASET_"):
            self.label = f.stem
            self.notes.append(f"no DATASET_LABEL: columns are named after the file ({f.stem})")
        self.label = self.label or f.stem
        need = MIN_FIELDS.get(f.kind, 1)
        short = [r for r in f.rows if len(r) < need]
        if short:
            f.rows = [r for r in f.rows if len(r) >= need]
            self.warnings.append(f"{plural(len(short), 'data row')} with fewer than {need} fields skipped "
                                 f"({short_list(r[0] for r in short)}); the file uses SEPARATOR {f.sep_name}: "
                                 "check the separator of those rows")

    # ---------- building ----------

    def add(self, key: str, want: str, kind: str, policy: str = "specific", field_of: Optional[str] = None,
            optional: bool = False, group: str = "main") -> str:
        self.columns.append(Column(key, want, kind, policy, field_of, optional, group))
        self.wants[key] = want
        self._group[key] = group
        return key

    def col(self, key: str) -> Column:
        return next(c for c in self.columns if c.key == key)

    def auto_ring(self, key: str, ring: str, colours: str) -> None:
        """A column mitol shows as a ring by itself; the README step is written in finish()."""
        self._auto[key] = (ring, colours)

    def claim(self, rid: str, key: str) -> None:
        """Row `rid` sets the group of column `key` (even when its value there is blank or 'X')."""
        claim = (rid.strip(), self._group.get(key, "main"))
        if claim != self._last_claim:  # consecutive cells of one row claim the same group
            self.claims.setdefault(claim[0], set()).add(claim[1])
            self._last_claim = claim

    def put(self, rid: str, key: str, value: str) -> None:
        rid, value = rid.strip(), value.strip()
        if not rid:
            return
        self.claim(rid, key)
        if value == "":
            return
        row = self.rows.setdefault(rid, {})
        if key in row and row[key] != value:
            self._dupes += 1
        row[key] = value

    def put_number(self, rid: str, key: str, raw: str, blanks: Tuple[str, ...] = ()) -> None:
        """A number cell; blank, `blanks` (iTOL's 'X') and unreadable values leave the cell empty (the latter
        counted for a warning). Infinity and overflowing values count as unreadable: mitol reads them as blank."""
        v = raw.strip()
        if v == "" or v in blanks or js_number(v) is None:
            if rid.strip():
                self.claim(rid, key)
            if v and v not in blanks:
                self._bad_numbers.setdefault(key, []).append(v)
            return
        self.put(rid, key, v)

    def color(self, raw: str) -> str:
        """Normalised colour, or "" (unreadable colours are counted for a warning)."""
        if not raw.strip():
            return ""
        c = norm_color(raw)
        if c is None:
            self._bad_colors[raw.strip()] += 1
            return ""
        return c

    def key_colors(self, key: str, pairs: Iterable[Tuple[str, str]]) -> None:
        """Colour key rows for a categorical column: each value's most common colour."""
        by_value: Dict[str, Counter] = {}
        for value, c in pairs:
            value = value.strip()
            if value and c:
                by_value.setdefault(value, Counter())[c] += 1
        clashes = []
        for value, cnt in by_value.items():
            self.colors.append((key, value, cnt.most_common(1)[0][0]))
            if len(cnt) > 1:
                top = cnt.most_common(3)
                more = f", +{len(cnt) - 3} more" if len(cnt) > 3 else ""
                clashes.append(f"'{value}' ({', '.join(f'{c} ×{n}' for c, n in top)}{more})")
        if clashes:
            self.warnings.append(f"[[{key}]]: {plural(len(clashes), 'value')} drawn in several colours, the most "
                                 "common is used: " + "; ".join(clashes[:3]) + (" …" if len(clashes) > 3 else ""))

    def key_color(self, key: str, value: str, raw: str) -> None:
        c = self.color(raw)
        if c:
            self.colors.append((key, value, c))

    def legend(self) -> List[Tuple[str, str, str]]:
        """(shape, colour, label) per legend entry."""
        sh, co, la = (self.f.values(k) for k in ("LEGEND_SHAPES", "LEGEND_COLORS", "LEGEND_LABELS"))
        n = max(len(sh), len(co), len(la))
        return [(row_get(sh, i), norm_color(row_get(co, i)) or "", row_get(la, i)) for i in range(n)]

    def field_labels(self, n_data: int) -> List[str]:
        labels = self.f.values("FIELD_LABELS")
        self.used.add("FIELD_LABELS")
        if labels and n_data > len(labels):
            self.warnings.append(f"{n_data} values per row but {len(labels)} FIELD_LABELS; extra columns are named 'field N'")
        if not labels and n_data:
            self.notes.append("no FIELD_LABELS: columns are named 'field 1', 'field 2' …")
        n = max(len(labels), n_data)
        return [labels[i] if i < len(labels) and labels[i] else f"field {i + 1}" for i in range(n)]

    def field_columns(self, first: int, kind: str, policy: str = "specific") -> List[str]:
        """One column per FIELD_LABELS entry; data values start at row field `first`."""
        n_data = max((len(r) - first for r in self.f.rows), default=0)
        labels = self.field_labels(max(0, n_data))
        return [self.add(f"f{i}", lab, kind, policy, field_of=self.label) for i, lab in enumerate(labels)]

    def field_colors(self, keys: List[str], fallback: str = "") -> None:
        """'(color)' key rows from FIELD_COLORS (or one colour for every field)."""
        cols = self.f.values("FIELD_COLORS")
        self.used.add("FIELD_COLORS")
        for i, k in enumerate(keys):
            raw = cols[i] if i < len(cols) else fallback
            if raw:
                self.key_color(k, "(color)", raw)

    def gradient_colors(self, key: str) -> bool:
        """'(low)' / '(mid)' / '(high)' key rows from COLOR_MIN / COLOR_MID / COLOR_MAX."""
        self.used.update({"COLOR_MIN", "COLOR_MID", "COLOR_MAX", "USE_MID_COLOR"})
        found = False
        for setting, value in (("COLOR_MIN", "(low)"), ("COLOR_MID", "(mid)"), ("COLOR_MAX", "(high)")):
            if setting == "COLOR_MID" and self.f.get("USE_MID_COLOR") != "1":
                continue
            if self.f.has(setting):
                self.key_color(key, value, self.f.get(setting))
                found = True
        return found

    def gradient_text(self) -> str:
        stops = [self.f.get(k) for k in ("COLOR_MIN", "COLOR_MID", "COLOR_MAX")
                 if self.f.has(k) and (k != "COLOR_MID" or self.f.get("USE_MID_COLOR") == "1")]
        return " → ".join(norm_color(s) or s for s in stops)

    def hint(self, key: str, text: Callable[[str], Optional[str]]) -> None:
        """A setting with a mitol option: listed under 'Set by hand' (None = nothing to set)."""
        if not self.f.has(key):
            return
        self.used.add(key)
        v = self.f.get(key)
        t = text(v)
        if t:
            self.by_hand.append(f"{key} {v} → {t}")

    def hints(self, table: Dict[str, Callable[[str], Optional[str]]]) -> None:
        for k, fn in table.items():
            self.hint(k, fn)

    def is_internal(self, rid: str) -> bool:
        """Clade reference ("A|B", or an internal node name when a tree is given); CONTAINS== rows are not."""
        if rid.startswith(CONTAINS):
            return False
        if self.tree is not None:
            node = self.tree.resolve(rid)
            if node is not None:
                return not self.tree.is_leaf(node)
        return "|" in rid or "---" in rid

    def is_pattern(self, rid: str) -> bool:
        return rid.startswith(CONTAINS) and self.kind in CONTAINS_TYPES

    # ---------- finishing ----------

    def finish(self) -> None:
        literal = [rid for rid in self.rows if rid.startswith(CONTAINS) and not self.is_pattern(rid)]
        if literal:
            self.warnings.append(f"{plural(len(literal), 'CONTAINS== row')} kept as written ({short_list(literal)}): "
                                 "iTOL accepts CONTAINS== only in TREE_COLORS, range, style, colour strip, symbol and "
                                 "text files")
        if self.tree is not None:
            self._apply_tree()
            for step in self.after_tree:
                step()
        else:
            self._warn_clade_rows()
        present = {k for r in self.rows.values() for k in r}
        dropped = {f"[[{c.key}]]" for c in self.columns if c.optional and c.key not in present}
        self.columns = [c for c in self.columns if not (c.optional and c.key not in present)]
        self.steps = [s for s in self.steps if not any(k in s for k in dropped)]  # steps for emptied columns
        for key, bad in self._bad_numbers.items():
            self.warnings.append(f"[[{key}]]: {plural(len(bad), 'value')} that {'is' if len(bad) == 1 else 'are'} not "
                                 f"a finite number left blank ({short_list(sorted(set(bad)))})")
        if self._bad_colors:
            self.warnings.append(f"{plural(sum(self._bad_colors.values()), 'unreadable colour')} ignored "
                                 f"({short_list(sorted(self._bad_colors))})")
        if self._dupes:
            self.warnings.append(f"{plural(self._dupes, 'cell')} given twice for the same id; the last one is used")
        # Colour key rows only for values that are still in the column (clade rows may have been overridden).
        keyed = {k for k, v, _ in self.colors if not v.startswith("(")}
        values: Dict[str, Set[str]] = {k: set() for k in keyed}
        if keyed:
            for r in self.rows.values():
                for k in keyed & r.keys():
                    values[k].add(r[k])
        self.colors = [(k, v, c) for k, v, c in self.colors if v.startswith("(") or v in values.get(k, ())]
        self._ring_steps()
        for k in self.f.settings:  # settings without a mitol equivalent ("0" = off / none: nothing lost)
            vals = self.f.values(k)
            if k not in self.used and self.f.get(k).strip() not in ("", "0"):
                self.not_carried.append(f"{k} {' '.join(vals) if len(vals) > 1 else self.f.get(k)}".strip())

    def unusable(self) -> Optional[str]:
        """Why nothing can be written for this dataset (None when it has rows and columns)."""
        if self.connections is not None:
            if self.connections:
                return None
        elif self.rows and self.columns:
            return None
        if not self.f.has_data:
            return "no DATA line"
        if not self.f.rows and not self.f.lines:
            return "no data rows"
        why = [w for w in self.warnings if not w.startswith("no SEPARATOR line")]
        return "no usable rows" + (f" ({render(self, why[0], quote=chr(39))})" if why else "")

    def _ring_steps(self) -> None:
        """Steps for columns mitol shows as rings by itself, and for category or coloured text columns that hold
        only numbers (mitol reads those as numeric, without category colours)."""
        front = []
        for c in self.columns:
            vals = [r[c.key] for r in self.rows.values() if c.key in r]
            keyed = any(k == c.key for k, v, _ in self.colors if not v.startswith("("))
            numeric = (c.kind == "category" or (c.kind == "text" and keyed)) and bool(vals) and all(is_number(v) for v in vals)
            if numeric:
                self.warnings.append(f"[[{c.key}]]: every value is a number, so mitol reads it as numeric "
                                     "(see the first step for this file)")
            if c.key in self._auto:
                ring, colours = self._auto[c.key]
                if numeric:
                    front.append(f"Annotation Tracks: [[{c.key}]] holds only numbers, so mitol adds it as a bar ring: "
                                 "choose **Categorical** on its row, then **Style ▾ → Load colours… → colors.tsv** "
                                 "for the iTOL colours.")
                    continue
                step = f"Annotation Tracks: [[{c.key}]] is added as a {ring} automatically ({colours})."
                n = len(set(vals))
                if n > 100 and n > 0.3 * len(vals):
                    step += f" It starts hidden ({n:,} distinct values): tick it first."
                front.append(step)
            elif numeric:
                front.append(f"[[{c.key}]] holds only numbers, so mitol loads it as a numeric ring: choose "
                             "**Categorical** on its row in Annotation Tracks"
                             + (", then **Style ▾ → Load colours… → colors.tsv**" if keyed else "") + ", before using it.")
        self.steps[:0] = front

    def _warn_clade_rows(self) -> None:
        expand = {c.key for c in self.columns if c.policy != "keep"}
        patterns = [rid for rid in self.rows if self.is_pattern(rid)]
        self.unexpanded = bool(patterns)
        if patterns:
            self.warnings.append(f"{plural(len(patterns), 'CONTAINS== pattern row')} kept as written "
                                 f"({short_list(patterns)}); mitol matches ids exactly: re-run with --tree to apply "
                                 "them to every matching leaf")
        n = sum(1 for rid, r in self.rows.items()
                if not rid.startswith(CONTAINS) and ("|" in rid or "---" in rid) and expand & set(r))
        if n:
            self.unexpanded = True
            self.warnings.append(f"{plural(n, 'row id')} with '|' in per-leaf columns: if they are clade references "
                                 "('A|B'), mitol ignores them in rings, label decorations and From a column, so re-run "
                                 "with --tree to expand them to leaves (leaf names that contain '|' are fine)")

    def _apply_tree(self) -> None:
        """Resolve row ids on the tree. Clade rows and CONTAINS== patterns of expanded columns become leaf rows:
        per leaf and column group, the whole row of the smallest node naming the leaf wins (its own row first;
        "outer" columns: the largest node); a pattern ranks by the size of the node it matches and loses ties
        to an explicit row; then the later row wins. Other cells stay with their row (renamed to the leaf when
        "A|A" names a leaf); patterns fill only what explicit rows left empty there."""
        tree = self.tree
        assert tree is not None
        expand = {c.key: c for c in self.columns if c.policy != "keep"}
        groups: Dict[str, List[str]] = {}
        for c in expand.values():
            groups.setdefault(c.group, []).append(c.key)
        outer = {g for g, ks in groups.items() if expand[ks[0]].policy == "outer"}
        ids = list(dict.fromkeys(list(self.claims) + list(self.rows)))
        targets: Dict[str, List[int]] = {}  # row id → the nodes it applies to
        patterns: List[str] = []
        missing, bad_rx = [], []
        for rid in ids:
            if self.is_pattern(rid):
                patterns.append(rid)
                found = tree.match(rid[len(CONTAINS):])
                if found is None:
                    bad_rx.append(rid)
                targets[rid] = found or []
                continue
            node = tree.resolve(rid)
            if node is None:
                missing.append(rid)
            targets[rid] = [] if node is None else [node]
        if missing:
            self.warnings.append(f"{plural(len(missing), 'id')} not found in the tree: {short_list(missing)}")
        if bad_rx:
            self.warnings.append(f"{plural(len(bad_rx), 'CONTAINS== pattern')} skipped (not a valid regular "
                                 f"expression): {short_list(bad_rx)}")
        empty = [rid for rid in patterns if rid not in bad_rx and not targets[rid]]
        if empty:
            self.warnings.append(f"{plural(len(empty), 'CONTAINS== pattern')} {'matches' if len(empty) == 1 else 'match'} "
                                 f"no node of the tree: {short_list(empty)}")
        pset, gset = set(patterns), set(groups)
        clade_rows, big = 0, []
        for rid in ids:
            if rid not in pset and targets[rid] and not tree.is_leaf(targets[rid][0]) and self.claims.get(rid, set()) & gset:
                clade_rows += 1
                if tree.size(targets[rid][0]) > len(tree.leaves) / 2:
                    big.append(rid)
        dest_of = {rid: tree.ref(targets[rid][0]) if tree.is_leaf(targets[rid][0]) else rid
                   for rid in ids if rid not in pset and targets[rid]}

        if not patterns and not clade_rows and len(set(dest_of.values())) == len(dest_of):
            # Every row names its own leaf (or a node without expanded cells): rename only, no copies.
            self.rows = {dest_of.get(rid, rid): r for rid, r in self.rows.items() if r}
            return

        best: Dict[Tuple[int, str], Tuple[Tuple[int, int, int], str]] = {}  # (leaf position, group) → (rank, row id)
        for order, rid in enumerate(ids):
            gs = [g for g in self.claims.get(rid, ()) if g in groups]
            if not gs:
                continue
            weak = int(rid in pset)
            for node in targets[rid]:
                size = tree.size(node)
                for g in gs:
                    rank = (-size if g in outer else size, weak, -order)
                    for k in range(tree.L[node], tree.R[node]):
                        cur = best.get((k, g))
                        if cur is None or rank < cur[0]:
                            best[(k, g)] = (rank, rid)

        new_rows: Dict[str, Dict[str, str]] = {}
        for rid in ids:
            row = self.rows.get(rid, {})
            if rid in pset or not row:
                continue
            if not targets[rid]:
                new_rows.setdefault(rid, {}).update(row)
                continue
            dest = new_rows.setdefault(dest_of[rid], {})
            for k, v in row.items():
                if k not in expand:
                    if k in dest and dest[k] != v:
                        self._dupes += 1
                    dest[k] = v
        matched = 0
        for rid in patterns:
            keep = {k: v for k, v in self.rows.get(rid, {}).items() if k not in expand}
            matched += len(targets[rid])
            for node in targets[rid]:
                dest = new_rows.setdefault(tree.ref(node), {})
                for k, v in keep.items():
                    dest.setdefault(k, v)
        for (k, g), (_, rid) in sorted(best.items()):
            row = self.rows.get(rid, {})
            cells = {key: row[key] for key in groups[g] if key in row}
            if cells:
                new_rows.setdefault(tree.leaf_name(k), {}).update(cells)
        self.rows = {rid: r for rid, r in new_rows.items() if r}
        if clade_rows:
            note = f"{plural(clade_rows, 'clade row')} expanded to the leaves below {'it' if clade_rows == 1 else 'them'} (--tree)"
            if self.kind in SHOWN_WHEN_COLLAPSED:
                note += ("; iTOL shows a clade's value only while that clade is collapsed (or with SHOW_INTERNAL 1), "
                         "here it applies to every leaf below it that has no row of its own")
            self.notes.append(note + ".")
        if matched:
            self.notes.append(f"{plural(len(patterns) - len(bad_rx) - len(empty), 'CONTAINS== pattern row')} applied "
                              f"to the {plural(matched, 'matching node')} (leaves and named internal nodes). Like other "
                              "rows, a pattern counts for the node it matches (a leaf it matches by name wins over a "
                              "clade row above it); on the same node an explicit row wins.")
        if big:
            self.warnings.append(f"{plural(len(big), 'clade')} {'covers' if len(big) == 1 else 'cover'} more than half "
                                 f"of the tree ({short_list(big)}); check the rooting (iTOL and mitol use the tree as "
                                 "rooted in the file)")


# ============================================================
# Converters: one per iTOL dataset type
# ============================================================

def row_get(row: List[str], i: int) -> str:
    return row[i] if i < len(row) else ""


def ticks(keys: Iterable[str]) -> str:
    keys = list(keys)
    if len(keys) > 8:
        return ", ".join(f"[[{k}]]" for k in keys[:3]) + f" … [[{keys[-1]}]] ({len(keys)} columns)"
    return ", ".join(f"[[{k}]]" for k in keys)


def on(v: str) -> bool:
    return v.strip() == "1"


def on_off(v: str) -> str:
    return "on" if on(v) else "off"


def positive(v: str) -> bool:
    return (js_number(v) or 0) > 0


def conv_colorstrip(d: Dataset) -> None:
    by_color: Dict[str, List[str]] = {}  # legend colour → its labels
    for _, c, lab in d.legend():
        if c and lab and lab not in by_color.get(c, []):
            by_color.setdefault(c, []).append(lab)
    k = d.add("strip", d.label, "category")
    pairs = []
    ambiguous: Counter = Counter()
    for row in d.f.rows:
        c = d.color(row_get(row, 1))
        label = " ".join(row[2:]) if d.f.sep == " " else row_get(row, 2)  # SPACE: the label is the rest
        labs = by_color.get(c, [])
        value = label or " / ".join(labs) or c
        if not label and len(labs) > 1:
            ambiguous[value] += 1
        d.put(row[0], k, value)
        pairs.append((value, c))
    d.key_colors(k, pairs)
    if ambiguous:
        d.warnings.append(f"{plural(sum(ambiguous.values()), 'row')} without a label {'has' if sum(ambiguous.values()) == 1 else 'have'} "
                          "a colour that several legend entries use; their value names all of them: "
                          f"{short_list(sorted(ambiguous))}")
    d.feature = "colour strip ring"
    d.by_hand_where = "Annotation Tracks"
    d.auto_ring(k, "colour strip ring", "colours from colors.tsv")
    d.hint("COLOR_BRANCHES", lambda v: "Tree decorations → Branch colour: [[strip]]" if on(v) else None)
    d.hint("STRIP_WIDTH", lambda v: f"ring thickness: {v} in the px box on the [[strip]] row")


def conv_simplebar(d: Dataset) -> None:
    k = d.add("value", d.label, "numeric")
    kl = d.add("label", f"{d.label} label", "text", optional=True)
    for row in d.f.rows:
        d.put_number(row[0], k, row_get(row, 1))
        d.put(row[0], kl, row_get(row, 2))
    d.key_color(k, "(color)", d.f.get("COLOR"))
    d.feature = "bar ring"
    d.by_hand_where = "Annotation Tracks"
    d.steps.append("Annotation Tracks: [[value]] is added as a bar ring automatically (bar colour from colors.tsv).")
    d.hint("LOG_SCALE", lambda v: "[[value]] → Style ▾ → Scale: Log" if on(v) else None)
    d.hint("WIDTH", lambda v: f"ring thickness: {v} in the px box on the [[value]] row")


def conv_gradient(d: Dataset) -> None:
    k = d.add("value", d.label, "numeric")
    lowest: Optional[Tuple[float, str]] = None
    for row in d.f.rows:
        raw = row_get(row, 1).strip()
        d.put_number(row[0], k, raw)
        v = js_number(raw)
        if v is not None and (lowest is None or v < lowest[0]):
            lowest = (v, raw)
    d.feature = "gradient ring"
    d.by_hand_where = "Annotation Tracks"
    if d.gradient_colors(k):
        stops = d.gradient_text()
    else:  # iTOL still draws a gradient: keep one (white → COLOR), so mitol does not draw bars
        c = norm_color(d.f.get("COLOR"))
        stops = f"#ffffff → {c}" if c else ""
        if c:  # only "(high)": mitol starts such a gradient at white by itself
            d.colors.append((k, "(high)", c))
            d.notes.append(f"No COLOR_MIN / COLOR_MAX: colors.tsv gives only the high end (COLOR {c}), so mitol draws "
                           "a white → COLOR gradient; iTOL's default gradient colours are not documented.")
    d.steps.append("Annotation Tracks: [[value]] is added as a ring automatically"
                   + (f"; colors.tsv makes it a colour gradient ({stops})." if stops else
                      "; choose Display: Colour gradient in its Style ▾ options."))
    if lowest is not None and lowest[0] > 0:
        d.by_hand.append(f"COLOR_MIN at the lowest value ({lowest[1]}) → [[value]] → Style ▾ → Min: {lowest[1]} "
                         "(mitol's scale starts at 0 until Min is set)")
    d.hint("STRIP_WIDTH", lambda v: f"ring thickness: {v} in the px box on the [[value]] row")


def conv_multibar(d: Dataset) -> None:
    keys = d.field_columns(1, "numeric")
    for row in d.f.rows:
        for i, k in enumerate(keys):
            d.put_number(row[0], k, row_get(row, 1 + i))
    d.field_colors(keys)
    d.feature = "Multi-value bars ring"
    d.steps.append(f"Annotation Tracks → + Add ring… → Type: Multi-value bars → tick {ticks(keys)} → Add ring "
                   "(Field colours from colors.tsv).")
    d.hints({
        "ALIGN_FIELDS": lambda v: "Layout: Aligned columns (one per field)" if on(v) else None,
        "SIDE_STACKED": lambda v: "Layout: Side by side (thin bar per field)" if on(v) else None,
        "LOG_SCALE": lambda v: "Scale: Logarithmic" if on(v) else None,
        "WIDTH": lambda v: f"Width: {v}",
        "HEIGHT_FACTOR": lambda v: f"Bar thickness: {v}",
        "BORDER_WIDTH": lambda v: f"Border width: {v}" if positive(v) else None,
        "BORDER_COLOR": lambda v: f"Border colour: {v}" if positive(d.f.get('BORDER_WIDTH')) else None,
        "SHOW_VALUE": lambda v: "Show values: on" if on(v) else None,
    })


def conv_heatmap(d: Dataset) -> None:
    keys = d.field_columns(1, "numeric")
    x_cells = 0  # iTOL's "no value" cells
    for row in d.f.rows:
        for i, k in enumerate(keys):
            raw = row_get(row, 1 + i)
            x_cells += raw == "X"
            d.put_number(row[0], k, raw, blanks=("X",))
    for k in keys:
        d.gradient_colors(k)
    d.feature = "Heatmap ring"
    stops = d.gradient_text()
    d.steps.append(f"Annotation Tracks → + Add ring… → Type: Heatmap → tick {ticks(keys)} → Add ring"
                   + (f" (Colours {stops} from colors.tsv)." if stops else "."))
    _heatmap_missing(d, x_cells)
    norm = {"rows": "Colour range: Each leaf separately", "columns": "Colour range: Each column separately"}
    d.hints({
        "USER_MIN_VALUE": lambda v: f"Minimum: {v}",
        "USER_MID_VALUE": lambda v: f"Mid value: {v}",
        "USER_MAX_VALUE": lambda v: f"Maximum: {v}",
        "STRIP_WIDTH": lambda v: f"Cell width: {v}",
        "DATA_NORMALIZATION": lambda v: norm.get(v.strip().lower()),
        "NORMALIZATION_TYPE": lambda v: {"scaling": "Normalisation: z-score", "normal": "Normalisation: Min → max"}.get(v.strip().lower()),
        "BORDER_WIDTH": lambda v: f"Cell borders: on, Border width: {v}" if positive(v) else None,
        "BORDER_COLOR": lambda v: f"Border colour: {v}" if positive(d.f.get('BORDER_WIDTH')) else None,
        "SHOW_LABELS": lambda v: "Column labels: off" if v.strip() == "0" else None,
        "DISPLAY_VALUES": lambda v: "Show values: on",
        "ROUND_VALUES": lambda v: f"Decimals: {v}",
        "VALUE_COLOR": lambda v: f"Value colour: {v}",
    })


def _heatmap_missing(d: Dataset, x_cells: int) -> None:
    """mitol's No-value colour fills every blank cell of a leaf that has a row in any loaded file, iTOL's
    COLOR_NAN only the 'X' cells: say when to keep or clear it."""
    d.used.add("COLOR_NAN")
    nan = d.f.get("COLOR_NAN")
    nan = norm_color(nan) or nan
    unlisted: Optional[int] = None
    if d.tree is not None:
        tree, listed = d.tree, set()
        for row in d.f.rows:
            n = tree.resolve(row[0])
            if n is not None:
                listed.update(range(tree.L[n], tree.R[n]))
        unlisted = len(tree.leaves) - len(listed)
    if unlisted == 0:
        if x_cells and nan:
            d.by_hand.append(f"COLOR_NAN {nan} → No-value colour: {nan}")
        return
    where = (f"{plural(unlisted, 'leaf', 'leaves')} of the tree {'is' if unlisted == 1 else 'are'} not in this file"
             if unlisted else "for leaves this file does not list")
    if x_cells and nan:
        d.by_hand.append(f"COLOR_NAN {nan} → No-value colour: {nan} colours the 'X' cells, but mitol also fills every "
                         f"leaf without a value here with it ({where}), which iTOL leaves empty: clear it unless that "
                         "is wanted")
    else:
        d.by_hand.append(f"No-value colour: clear it; mitol fills every leaf without a value here in grey ({where}), "
                         "iTOL leaves them empty")


def conv_externalshape(d: Dataset) -> None:
    keys = d.field_columns(1, "numeric")
    for row in d.f.rows:
        for i, k in enumerate(keys):
            d.put_number(row[0], k, row_get(row, 1 + i))
    d.field_colors(keys)
    d.feature = "Shapes sized by value ring"
    d.steps.append(f"Annotation Tracks → + Add ring… → Type: Shapes sized by value → tick {ticks(keys)} → Add ring "
                   "(Field colours from colors.tsv).")
    d.hints({
        "SHAPE_TYPE": lambda v: f"Shape: {ITOL_SHAPES[v.strip()]}" if v.strip() in ITOL_SHAPES else None,
        "COLOR_FILL": lambda v: "Filled shapes: off" if v.strip() == "0" else None,
        "SHAPE_SPACING": lambda v: f"Column spacing: {v}",
        "HORIZONTAL_GRID": lambda v: f"Horizontal grid lines: {on_off(v)}",
        "VERTICAL_GRID": lambda v: f"Vertical grid lines: {on_off(v)}",
        "GRID_COLOR": lambda v: f"Grid colour: {v}",
        "GRID_WIDTH": lambda v: f"Grid line width: {v}",
        "SHOW_VALUES": lambda v: "Show values: on" if on(v) else None,
        "VALUE_COLOR": lambda v: f"Value colour: {v}",
        "VALUE_AUTO_COLOR": lambda v: "Auto black / white values: on" if on(v) else None,
    })


def conv_piechart(d: Dataset) -> None:
    """External pies (position -1) → a Pie charts ring; pies on internal nodes or on branches (position 0–1)
    → '<field> (node)' columns for Tree decorations → Node pie charts, so no pie is drawn twice."""
    ext_rows, node_rows = [], []
    for row in d.f.rows:
        pos = js_number(row_get(row, 1))
        (node_rows if d.is_internal(row[0]) or (pos is not None and pos >= 0) else ext_rows).append(row)
    labels = d.field_labels(max(0, max((len(r) - 3 for r in d.f.rows), default=0)))
    keys = [d.add(f"f{i}", lab, "numeric", "keep", field_of=d.label) for i, lab in enumerate(labels)] if ext_rows else []
    nkeys = [d.add(f"n{i}", f"{lab} (node)" if ext_rows else lab, "numeric", "keep", field_of=d.label)
             for i, lab in enumerate(labels)] if node_rows else []
    for rows, ks in ((ext_rows, keys), (node_rows, nkeys)):
        for row in rows:
            for i, k in enumerate(ks):
                d.put_number(row[0], k, row_get(row, 3 + i))
    d.field_colors(keys)
    d.field_colors(nkeys)
    d.used.add("MAXIMUM_SIZE")
    d.feature = " + ".join(x for x, n in (("Pie charts ring", ext_rows), ("Node pie charts (decoration)", node_rows)) if n)
    if ext_rows:
        d.steps.append(f"Annotation Tracks → + Add ring… → Type: Pie charts → tick {ticks(keys)} → Add ring "
                       f"({plural(len(ext_rows), 'external pie')}; slice colours from colors.tsv).")
        d.hints({
            "POLAR_AREA_DIAGRAM": lambda v: "Style: Polar area diagram" if on(v) else None,
            "BORDER_WIDTH": lambda v: f"Border width: {v}" if positive(v) else None,
            "BORDER_COLOR": lambda v: f"Border colour: {v}" if positive(d.f.get('BORDER_WIDTH')) else None,
        })
    if node_rows:
        mx = js_number(d.f.get("MAXIMUM_SIZE"))
        radius = f", radius {int(min(40, max(3, round(mx))))} (MAXIMUM_SIZE)" if mx else ""
        d.steps.append(f"Tree decorations → Node pie charts → tick {ticks(nkeys)}{radius} ({plural(len(node_rows), 'pie')} "
                       "on internal nodes or branches). Node pie slice colours follow the tick order (mitol palette), "
                       "not colors.tsv.")
    radii = {row_get(r, 2).strip() for r in node_rows}
    if len(radii) > 1:
        d.notes.append("Per-pie radii are not carried over: iTOL sizes internal pies by their RADIUS field, mitol's "
                       "node pies have one radius ('size by total' sizes them by their sum instead).")
    if ext_rows and node_rows:
        d.notes.append("External pies (position -1) and pies on nodes / branches are in separate columns "
                       f"({ticks(keys[:1] + nkeys[:1])} …), so each pie is drawn once.")


def conv_binary(d: Dataset) -> None:
    keys = d.field_columns(1, "binary")
    odd = Counter()
    for row in d.f.rows:
        for i, k in enumerate(keys):
            v = row_get(row, 1 + i)
            if v not in ("1", "0", "-1", ""):
                odd[v] += 1
            d.put(row[0], k, v)
    if odd:
        d.warnings.append(f"{plural(sum(odd.values()), 'value')} other than 1 / 0 / -1 kept as is ({short_list(sorted(odd))})")
    d.field_colors(keys, fallback=d.f.get("COLOR"))
    shapes = d.f.values("FIELD_SHAPES")
    d.used.add("FIELD_SHAPES")
    d.feature = "Binary (presence / absence) ring"
    d.steps.append(f"Annotation Tracks → + Add ring… → Type: Binary (presence / absence) → tick {ticks(keys)} → Add ring "
                   "(Colours from colors.tsv).")
    if shapes:
        named = [f"[[{k}]] {ITOL_SHAPES.get(s, f'iTOL shape {s} (no equivalent)')}" for k, s in zip(keys, shapes)]
        d.steps.append("on the new ring, **Style ▾** → Shapes: " + ", ".join(named) + ".")
    d.hints({
        "SYMBOL_SPACING": lambda v: f"Column width: {v}",
        "HORIZONTAL_GRID": lambda v: f"Horizontal grid: {on_off(v)}",
        "VERTICAL_GRID": lambda v: f"Vertical grid: {on_off(v)}",
        "GRID_COLOR": lambda v: f"Grid colour: {v}",
        "GRID_WIDTH": lambda v: f"Grid width: {v}",
        "SHOW_LABELS": lambda v: "Field labels: off" if v.strip() == "0" else None,
    })


def _symbol_slot(pos: str) -> str:
    p = js_number(pos)
    if p is not None and p < 0:
        return f"external {int(-p)}"
    return "on branch"


def conv_symbol(d: Dataset) -> None:
    legend = d.legend()
    ambiguous: Counter = Counter()

    def value_of(shape: str, c: str, lab: str) -> str:
        exact = list(dict.fromkeys(L for s, lc, L in legend if L and s == shape and lc == c))
        if len(exact) == 1:
            return exact[0]
        if len(exact) > 1:
            if lab in exact:
                return lab
            ambiguous[" / ".join(exact)] += 1
            return " / ".join(exact)
        if lab:
            return lab
        by_color = list(dict.fromkeys(L for _, lc, L in legend if L and lc == c))
        return by_color[0] if len(by_color) == 1 else c

    # One column per symbol slot: position class (on branch / external N), then repeats within it.
    entries = []
    seen: Counter = Counter()
    for row in d.f.rows:
        shape, size, c, fill, pos, lab = (row_get(row, i) for i in range(1, 7))
        c = d.color(c)
        slot = _symbol_slot(pos)
        seen[(row[0], slot)] += 1
        entries.append((row[0], (slot, seen[(row[0], slot)]), shape.strip(), size, c, fill, value_of(shape.strip(), c, lab)))
    slots = list(dict.fromkeys(e[1] for e in entries)) or [("on branch", 1)]
    multi = len(slots) > 1
    keys = {}
    for i, (slot, n) in enumerate(slots):
        want = d.label if i == 0 else f"{d.label} ({slot}{'' if n == 1 else f' {n}'})"
        keys[(slot, n)] = d.add(f"s{i}", want, "category", policy="keep")
    # A shape column (mitol shape names) for slots whose symbols use several shapes: Leaf markers → shape from.
    hkeys = {}
    for i, s in enumerate(slots):
        if len({e[2] for e in entries if e[1] == s}) > 1:
            hkeys[s] = d.add(f"h{i}", f"{d.col(keys[s]).want} shape", "category", policy="keep")
    zkeys = {}  # a size column for slots whose symbol sizes vary
    for i, s in enumerate(slots):
        if len({e[3] for e in entries if e[1] == s}) > 1:
            zkeys[s] = d.add(f"z{i}", f"{d.col(keys[s]).want} size", "numeric", policy="keep")
    pairs: Dict[str, List[Tuple[str, str]]] = {k: [] for k in keys.values()}
    shapes_by_value: Dict[str, Counter] = {}
    for rid, slot, shape, size, c, fill, value in entries:
        d.put(rid, keys[slot], value)
        if slot in hkeys and shape in MITOL_SHAPES:
            d.put(rid, hkeys[slot], MITOL_SHAPES[shape])
        pairs[keys[slot]].append((value, c))
        shapes_by_value.setdefault(value, Counter())[shape] += 1
        if slot in zkeys:
            d.put_number(rid, zkeys[slot], size)
    for k, p in pairs.items():
        d.key_colors(k, p)
    # Each value's most common iTOL shape, for Leaf markers' "per value" shapes.
    for rid, slot, shape, size, c, fill, value in entries:
        cnt = shapes_by_value.get(value)
        if cnt and value.strip():
            code = cnt.most_common(1)[0][0]
            if code in MITOL_SHAPES:
                d.shapes[(keys[slot], value.strip())] = MITOL_SHAPES[code]
    if ambiguous:
        d.warnings.append(f"{plural(sum(ambiguous.values()), 'symbol')} match several legend entries (same shape and "
                          f"colour); their value names all of them: {short_list(sorted(ambiguous))}")

    shape_count = Counter(e[2] for e in entries)
    main_shape = shape_count.most_common(1)[0][0] if shape_count else "2"
    fills = Counter(e[5].strip() for e in entries)
    max_size = js_number(d.f.get("MAXIMUM_SIZE")) or 0
    d.used.add("MAXIMUM_SIZE")
    size_txt = f", size {int(min(30, max(3, round(max_size))))}" if max_size else ""
    filled = "untick filled" if fills and set(fills) == {"0"} else "filled"
    d.feature = "Leaf markers (decoration)"
    if len(shape_count) > 1:
        shape_txt = ("shape from [[h0]] (or tick per value: shapes from colors.tsv)" if hkeys
                     else "tick per value (shapes from colors.tsv)")
    else:
        shape_txt = f"shape {ITOL_SHAPES.get(main_shape, 'Circle')}"
    d.steps.append(f"Tree decorations → Leaf markers → + Add marker rule → column [[s0]] (has a value); {shape_txt}, "
                   f"column colours{size_txt}, {filled}. [[s0]] also works as a colour strip ring.")
    if multi:
        d.steps.append(f"Symbols in other positions are in {ticks(list(keys.values())[1:])} (one column per position).")
    if any(s[0].startswith("external") for s in slots):
        d.notes.append("iTOL draws external symbols (negative position) in columns outside the tree: in mitol use the "
                       "column as a colour strip ring, or as Leaf markers at the tips.")
    if zkeys:
        d.notes.append(f"Symbol sizes vary ({ticks(zkeys.values())}); a Leaf markers rule has one size (use one rule per size with is / ≥ conditions).")


def conv_domains(d: Dataset) -> None:
    stem = d.label[: -len(" domains")] if d.label.endswith(" domains") else d.label
    kd = d.add("domains", f"{stem} domains", "domains")
    kl = d.add("length", f"{stem} length", "numeric", optional=True)
    d.pairs.append((kd, kl, stem))
    bad, odd_shape, backwards, bad_len = Counter(), Counter(), [], Counter()
    for row in d.f.rows:
        items = []
        for it in row[2:]:
            if not it.strip():
                continue
            p = [x.strip() for x in it.split("|")]
            shape, start, end = (p[0].upper() if p else ""), row_get(p, 1), row_get(p, 2)
            if not (re.fullmatch(r"-?\d+(?:\.\d+)?", start) and re.fullmatch(r"\d+(?:\.\d+)?", end)):
                bad[it] += 1
                continue
            if float(start) > float(end):
                backwards.append(it)
                continue
            name = re.sub(r"\s+", " ", re.sub(r"[;|]", " ", row_get(p, 4))).strip()
            item = f"{name}:{start}-{end}"
            if shape in DOMAIN_SHAPES:
                item += f":{shape}"
            elif shape:
                odd_shape[p[0]] += 1
            c = d.color(row_get(p, 3))
            if c:
                item += f":{c}"
            items.append(item)
        length = row_get(row, 1).strip()
        if re.fullmatch(r"\d+(?:\.\d+)?", length) and float(length) > 0:
            items.append(f"len={length}")
            d.put(row[0], kl, length)
        elif length:
            bad_len[length] += 1
        d.put(row[0], kd, ";".join(items))
    if bad:
        d.warnings.append(f"{plural(sum(bad.values()), 'unreadable domain item')} skipped (SHAPE|START|END|COLOR|LABEL "
                          f"needs numbers for START and END): {short_list(sorted(bad))}")
    if backwards:
        d.warnings.append(f"{plural(len(backwards), 'domain')} with START after END skipped, as iTOL skips them "
                          f"(mitol would swap the ends): {short_list(backwards)}")
    if odd_shape:
        n = sum(odd_shape.values())
        d.warnings.append(f"{plural(n, 'domain')} with an unknown shape code {'is' if n == 1 else 'are'} drawn with the "
                          f"ring's default shape: {short_list(sorted(odd_shape))}")
    if bad_len:
        d.warnings.append(f"{plural(sum(bad_len.values()), 'protein length')} that {'is' if sum(bad_len.values()) == 1 else 'are'} "
                          f"not a positive number left blank: {short_list(sorted(bad_len))}")
    d.feature = "Protein domains ring"
    has_length = any(kl in r for r in d.rows.values())
    d.steps.append("Annotation Tracks → + Add ring… → Type: Protein domains → choose [[domains]] → Add ring"
                   + (" (Protein length column fills in with [[length]])." if has_length else "."))
    d.hints({
        "WIDTH": lambda v: f"Width: {v}",
        "HEIGHT_FACTOR": lambda v: f"Height factor: {v}",
        "BACKBONE_COLOR": lambda v: f"Backbone colour: {v}",
        "BACKBONE_HEIGHT": lambda v: f"Backbone height: {v}",
        "BORDER_WIDTH": lambda v: f"Domain border width: {v}" if positive(v) else None,
        "BORDER_COLOR": lambda v: f"Domain border colour: {v}" if positive(d.f.get('BORDER_WIDTH')) else None,
        "SHOW_DOMAIN_LABELS": lambda v: "Domain labels: off" if v.strip() == "0" else None,
        "LABEL_SIZE_FACTOR": lambda v: f"Label size factor: {v}",
        "LABELS_ON_TOP": lambda v: "Show labels that don't fit: on" if on(v) else None,
        "LABEL_ROTATION": lambda v: f"Label rotation: {v}",
        "LABEL_AUTO_COLOR": lambda v: "Automatic label colour: off" if v.strip() == "0" else None,
        "DATASET_SCALE": lambda v: "Scale lines: " + ", ".join(x.split("-")[0] for x in d.f.values("DATASET_SCALE")),
    })


def strip_tags(txt: str) -> str:
    """Text of an iTOL rich-text label: the <n> <b> <i> <bi> <sub> <sup> tags removed, other text kept. A sub- or
    superscript joins its word ("H<sub>2</sub>O" → "H2O", "Na<sup>+</sup>" → "Na+") unless it is a word itself
    ("sapiens<sup>citation</sup>" → "sapiens citation")."""
    txt = re.sub(r"<(sub|sup)(?:\s[^<>]*)?>(.*?)</\1>",
                 lambda m: (" " if re.search(r"[^\W\d_]{2}", m.group(2)) else "") + m.group(2), txt)
    return re.sub(r"\s+", " ", ITOL_TAG.sub("", txt)).strip()


def conv_text(d: Dataset) -> None:
    k = d.add("text", d.label, "text")
    pairs = []
    styles, sizes, rotations = Counter(), Counter(), Counter()
    tagged = on_leaf_branch = 0
    on_clade_branch: List[str] = []
    for row in d.f.rows:
        txt = row_get(row, 1)
        if ITOL_TAG.search(txt):
            tagged += 1
            txt = strip_tags(txt)
        pos = js_number(row_get(row, 2))
        if pos is not None and pos >= 0:  # 0–1: a label on the node's branch, not an external label
            if d.is_internal(row[0]):
                on_clade_branch.append(txt or row[0])
                continue
            on_leaf_branch += 1
        d.put(row[0], k, txt)
        pairs.append((txt.strip(), d.color(row_get(row, 3))))
        styles[row_get(row, 4).strip().lower() or "normal"] += 1
        sizes[row_get(row, 5).strip() or "1"] += 1
        rotations[row_get(row, 6).strip() or "0"] += 1
    colours = {c for _, c in pairs if c}
    d.feature = "Text labels ring"
    d.steps.append("Annotation Tracks → + Add ring… → Type: Text labels → choose [[text]] → Add ring.")
    if len(colours) == 1:
        d.steps.append(f"on the new ring, **Style ▾** → Colour: {colours.pop()}.")
    elif colours:
        d.key_colors(k, pairs)
        d.steps.append("on the new ring, **Style ▾** → tick 'Use the column's category colours' (per-label colours "
                       "are in colors.tsv).")
    if len(styles) == 1 and next(iter(styles)) in ("bold", "italic", "bold-italic"):
        st = next(iter(styles))
        d.steps.append("on the new ring, **Style ▾** → tick " + " and ".join(f"'{w.capitalize()}'" for w in st.split("-")) + ".")
    elif len(styles) > 1:
        d.notes.append(f"Per-label font styles are not carried over ({', '.join(sorted(styles))}); Bold / Italic apply to the whole ring.")
    if set(sizes) - {"1"}:
        d.notes.append(f"Per-label size factors are not carried over ({', '.join(sorted(sizes))}); use Font size.")
    if set(rotations) - {"0"}:
        d.notes.append(f"Per-label rotations are not carried over ({', '.join(sorted(rotations))}); use Rotation.")
    if on_leaf_branch:
        d.notes.append(f"{plural(on_leaf_branch, 'label')} that iTOL places on a leaf's branch (position 0–1) "
                       "are shown in the text ring at that leaf.")
    if on_clade_branch:
        d.warnings.append(f"{plural(len(on_clade_branch), 'label')} on internal branches (position 0–1) skipped: "
                          f"mitol has no branch labels ({short_list(on_clade_branch)})")
    if tagged:
        d.warnings.append(f"{plural(tagged, 'label')} had iTOL rich-text tags (<b>, <i>, <sup> …); the tags were removed")
    d.hints({
        "ALL_LABELS_ROTATION": lambda v: f"Rotation: {v}" if v.strip() != "0" else None,
        "ALIGN_TO_TREE": lambda v: "Orientation: Tangential (along the ring)" if on(v) else None,
        "SIZE_FACTOR": lambda v: f"Font size: about 11 × {v}" if v.strip() != "1" else None,
    })


def conv_connection(d: Dataset) -> None:
    widths = [js_number(row_get(r, 2)) for r in d.f.rows]
    bad_w = Counter(row_get(r, 2).strip() for r, w in zip(d.f.rows, widths)
                    if row_get(r, 2).strip() and (w is None or w <= 0))
    max_w = max((w for w in widths if w is not None and w > 0), default=0)
    max_line = js_number(d.f.get("MAXIMUM_LINE_WIDTH"))
    d.used.add("MAXIMUM_LINE_WIDTH")
    scale = max_line / max_w if max_line and max_w else None
    d.connections = []
    one_end, not_found = 0, Counter()
    for row, w in zip(d.f.rows, widths):
        a, b = row_get(row, 0), row_get(row, 1)
        if not a or not b:
            one_end += 1
            continue
        if d.tree is not None:
            for end in (a, b):
                if d.tree.resolve(end) is None:
                    not_found[end] += 1
        width = "" if w is None or w <= 0 else fmt_num(w * scale) if scale else row_get(row, 2)
        d.connections.append({
            "source": a, "target": b, "width": width, "color": d.color(row_get(row, 3)),
            "style": row_get(row, 4).lower(), "label": row_get(row, 5),
        })
    if one_end:
        d.warnings.append(f"{plural(one_end, 'row')} without both ends skipped")
    if bad_w:
        n = sum(bad_w.values())
        d.warnings.append(f"{plural(n, 'width')} that {'is' if n == 1 else 'are'} not a positive number left blank "
                          f"(mitol's default width): {short_list(sorted(bad_w))}")
    if not_found:
        d.warnings.append(f"{plural(sum(not_found.values()), 'connection end')} not found in the tree: {short_list(sorted(not_found))}")
    if scale:
        d.notes.append(f"Widths scaled like iTOL: the widest line = MAXIMUM_LINE_WIDTH {d.f.get('MAXIMUM_LINE_WIDTH')} px.")
    elif max_w:
        d.notes.append("No MAXIMUM_LINE_WIDTH: widths are written as given (mitol reads them as px).")
    d.feature = "Connections (decoration)"
    d.by_hand_where = "Tree decorations → Connections"
    d.steps.append("Tree decorations → Connections: Show connections (the file chip shows ⇄).")
    c = norm_color(d.f.get("COLOR"))
    if c:
        d.steps.append(f"Tree decorations → Connections → default colour swatch: {c} (used by rows without a colour).")
    d.hints({
        "DRAW_ARROWS": lambda v: "Arrowheads at the target: on" if on(v) else None,
        "CENTER_CURVES": lambda v: "Curve: Through the centre (radial)" if on(v) else None,
        "CURVE_ANGLE": lambda v: "Curve: Straight" if v.strip() == "0" and not on(d.f.get("CENTER_CURVES")) else None,
    })


def _branch_label_columns(d: Dataset, background_row: bool) -> Dict[str, str]:
    """Decoration columns shared by DATASET_STYLE and TREE_COLORS (dropped when empty). Label colour and style
    come from one iTOL row; so does the background in DATASET_STYLE (`background_row` False), while TREE_COLORS
    sets it on a row of its own."""
    return {
        "bc": d.add("bc", f"{d.label} branch color", "colour", policy="keep", optional=True),
        "bw": d.add("bw", f"{d.label} branch width", "numeric", policy="keep", optional=True),
        "lc": d.add("lc", f"{d.label} label color", "colour", optional=True, group="label"),
        "ls": d.add("ls", f"{d.label} label style", "category", optional=True, group="label"),
        "lb": d.add("lb", f"{d.label} label background", "colour", optional=True,
                    group="background" if background_row else "label"),
    }


# Approximations counted per decoration file: (one, many, rest of the warning).
NARROW = ("branch width factor below 1", "branch width factors below 1",
          ": mitol cannot draw thinner branches (Branch width by widens 1–3× by value), so these come out wider "
          "than unlisted branches")
ONE_INTERNAL_BRANCH = ("single-branch colour on an internal node", "single-branch colours on internal nodes",
                       ": mitol colours the whole clade")
CLADE_WIDTH_NO_TREE = ("clade branch width", "clade branch widths",
                       ": mitol widens only the branch leading to the clade (pass --tree to write the factor on "
                       "every branch of the clade, as iTOL draws it)")
DASHED = ("dashed branch style", "dashed branch styles", " not carried over (mitol has no dashed branches)")
INTERNAL_LABEL = ("internal-node label style", "internal-node label styles", " skipped (mitol styles leaf labels only)")
LABEL_SIZE = ("label size factor", "label size factors", " not carried over")


def _branch_width(d: Dataset, rid: str, key: str, factor: str, approx: Counter) -> None:
    d.put_number(rid, key, factor)
    w = js_number(factor)
    if w is not None and w < 1:
        approx[NARROW] += 1


def _clade_widths(d: Dataset, key: str, clade_widths: List[Tuple[str, str]], approx: Counter) -> None:
    """iTOL's 'clade' width factor widens every branch of the clade, mitol's Branch width by one branch per row:
    with --tree, write the factor on every node of the clade (a node's own row, then the smallest clade, wins)."""
    tree = d.tree
    if tree is None:
        for rid, factor in clade_widths:
            _branch_width(d, rid, key, factor, approx)
        if clade_widths:
            approx[CLADE_WIDTH_NO_TREE] += len(clade_widths)
        return
    explicit = {n for n in (tree.resolve(rid) for rid, r in d.rows.items() if key in r) if n is not None}
    own: Dict[int, str] = {}  # clade node → its factor (the later row wins)
    for rid, factor in clade_widths:
        node, w = tree.resolve(rid), js_number(factor)
        if node is None or w is None:
            _branch_width(d, rid, key, factor, approx)  # reported as not found / not a number
            continue
        own[node] = factor
        if w < 1:
            approx[NARROW] += 1
    unnamed = 0
    inherited: List[Optional[str]] = [None] * len(tree.parent)
    for v in range(len(tree.parent)):  # parents come before their children
        p = tree.parent[v]
        factor = own.get(v, inherited[p] if p != -1 else None)
        inherited[v] = factor
        if factor is None or v in explicit:
            continue
        rid = tree.ref(v)
        if rid:
            d.put_number(rid, key, factor)
        else:
            unnamed += 1
    if own:
        d.notes.append(f"{plural(len(own), 'clade branch width')} written on every branch of {'its' if len(own) == 1 else 'their'} "
                       "clade (iTOL widens them all; --tree); rows of single branches kept.")
    if unnamed:
        d.warnings.append(f"{plural(unnamed, 'branch', 'branches')} inside wide clades left out: no name or "
                          "'first leaf|last leaf' spelling resolves to them")


def _split_branch_colours(d: Dataset, key: str) -> None:
    """mitol paints a clade row's colour over every branch below it, leaves included, while iTOL keeps a leaf's
    own branch colour inside a coloured clade. Clade rows above such leaves are split into rows for their largest
    parts without them, so those leaves keep their colour; the branches on the way to them lose the clade colour."""
    tree = d.tree
    assert tree is not None
    clade: Dict[int, List[str]] = {}  # internal node → its row ids (one spelling after unify_clade_ids)
    leaf_colour: Dict[int, str] = {}
    for rid, row in d.rows.items():
        n = tree.resolve(rid) if row.get(key) else None
        if n is None:
            continue
        if tree.is_leaf(n):
            leaf_colour[n] = row[key]
        else:
            clade.setdefault(n, []).append(rid)
    if not clade or not leaf_colour:
        return
    colour_of = {n: d.rows[rids[-1]][key] for n, rids in clade.items()}  # the last row wins, as in mitol
    cover: List[Optional[int]] = [None] * len(tree.parent)  # the smallest clade row containing each node
    for v in range(len(tree.parent)):  # parents come before their children
        p = tree.parent[v]
        cover[v] = v if v in clade else cover[p] if p != -1 else None
    conflict = [v for v, c in leaf_colour.items() if cover[v] is not None and colour_of[cover[v]] != c]
    if not conflict:
        return
    blocked: Set[int] = set()  # internal nodes above those leaves
    for v in conflict:
        u = tree.parent[v]
        while u != -1 and u not in blocked:
            blocked.add(u)
            u = tree.parent[u]
    removed = 0
    for n in blocked & set(clade):
        for rid in clade[n]:
            del d.rows[rid][key]
            if not d.rows[rid]:
                del d.rows[rid]
        removed += 1
    added = lost = 0
    for u in sorted(blocked):
        if cover[u] is not None:
            lost += 1
        for v in tree.children[u]:
            if v in blocked or v in clade or v in leaf_colour:
                continue  # on the way to a leaf, or a node with its own row
            cv, rid = cover[v], tree.ref(v)
            if cv is not None and rid:
                d.rows.setdefault(rid, {})[key] = colour_of[cv]
                added += 1
    names = [tree.name[v] or "" for v in sorted(conflict, key=lambda x: tree.L[x])]
    d.warnings.append(f"{plural(len(conflict), 'leaf', 'leaves')} with {'its' if len(conflict) == 1 else 'their'} own "
                      f"branch colour inside a coloured clade ({short_list(names)}): mitol paints a clade row over "
                      f"every branch below it, so {plural(removed, 'clade row')} {'was' if removed == 1 else 'were'} "
                      f"split into {plural(added, 'row')} for the parts without those leaves; "
                      f"{plural(lost, 'branch', 'branches')} on the way to them {'loses' if lost == 1 else 'lose'} "
                      "the clade colour")


def _decoration_steps(d: Dataset, keys: Dict[str, str], approx: Counter) -> None:
    present = {k for r in d.rows.values() for k in r}
    for k in ("lc", "lb", "bc"):
        d.key_colors(keys[k], [(v, v) for r in d.rows.values() for kk, v in r.items() if kk == keys[k]])
    if keys["bc"] in present:
        d.steps.append("Tree decorations → Branch colour: [[bc]]; untick 'Colour a clade's branches when all its "
                       "leaves agree' (iTOL colours only the branches it lists).")
        if d.tree is not None:
            d.after_tree.append(lambda: _split_branch_colours(d, keys["bc"]))
        elif any(d.is_internal(rid) for rid, r in d.rows.items() if keys["bc"] in r):
            d.notes.append("mitol paints a clade's branch colour over every branch below it, so a leaf with its own "
                           "branch colour inside a coloured clade takes the clade colour; pass --tree to split such "
                           "clade rows.")
    if keys["bw"] in present:
        d.steps.append("Tree decorations → Branch width by: [[bw]] (mitol widens 1–3× in proportion to the value, "
                       "not by iTOL's exact factor).")
    if keys["lc"] in present:
        d.steps.append("Tree decorations → Label colour: [[lc]].")
    if keys["lb"] in present:
        d.steps.append("Tree decorations → Label background: [[lb]]; set Background opacity to 1 (mitol starts at "
                       "0.35; iTOL draws the full colour).")
    if keys["ls"] in present:
        d.steps.append("Tree decorations → Label style (bold/italic): [[ls]].")
    for (one, many, rest), n in approx.items():
        d.warnings.append(f"{plural(n, one, many)}{rest}")


def conv_style(d: Dataset) -> None:
    keys = _branch_label_columns(d, background_row=False)
    approx: Counter = Counter()
    clade_widths: List[Tuple[str, str]] = []
    for row in d.f.rows:
        rid, typ, what = row[0], row_get(row, 1).lower(), row_get(row, 2).lower()
        c, factor, style, bg = d.color(row_get(row, 3)), row_get(row, 4), row_get(row, 5).lower(), row_get(row, 6)
        internal = d.is_internal(rid)
        if typ == "branch":
            d.put(rid, keys["bc"], c)
            if internal and what == "node" and c:
                approx[ONE_INTERNAL_BRANCH] += 1
            if factor and factor != "1":
                if internal and what == "clade":
                    clade_widths.append((rid, factor))
                else:
                    _branch_width(d, rid, keys["bw"], factor, approx)
            if style == "dashed":
                approx[DASHED] += 1
        elif typ == "label":
            if internal and what == "node":
                approx[INTERNAL_LABEL] += 1
                continue
            d.put(rid, keys["lc"], c)
            if style in ("bold", "italic", "bold-italic"):
                d.put(rid, keys["ls"], style)
            d.put(rid, keys["lb"], d.color(bg))
            if factor and factor != "1":
                approx[LABEL_SIZE] += 1
        else:
            approx[(f"row with unknown type '{typ}'", f"rows with unknown type '{typ}'", " skipped")] += 1
    _clade_widths(d, keys["bw"], clade_widths, approx)
    d.feature = "Tree decorations (branch / label style)"
    _decoration_steps(d, keys, approx)


@dataclass
class Span:
    """A coloured range over leaf positions lo..hi-1 (tree order)."""
    lo: int
    hi: int
    value: str
    color: str
    order: int
    weak: bool = False  # from CONTAINS==: loses to an explicit range of the same size


def range_columns(d: Dataset, key: str, want: str, spans: List[Span]) -> List[str]:
    """Per-leaf range columns (with --tree), one per nesting level, outermost first, so a range nested in
    another one does not cut it up; within a level the smaller (then later) range wins a leaf, and a
    CONTAINS== range loses to a range of the same size."""
    tree = d.tree
    assert tree is not None
    spans = sorted(spans, key=lambda s: (-(s.hi - s.lo), not s.weak, s.order))
    level: List[int] = []
    for i, s in enumerate(spans):
        lv = 1
        for j in range(i):
            q = spans[j]
            if q.hi - q.lo > s.hi - s.lo and q.lo <= s.lo and s.hi <= q.hi:
                lv = max(lv, level[j] + 1)
        level.append(lv)
    depth = max(level, default=1)
    keys = [d.add(key if n == 1 else f"{key}{n}", want if n == 1 else f"{want} (level {n})", "category", policy="keep")
            for n in range(1, depth + 1)]
    lost: Dict[str, List[str]] = {}  # range value → leaves Coloured Ranges → From a column will leave out
    for n, k in enumerate(keys, start=1):
        cells: Dict[int, str] = {}
        todo = [s for s, lv in zip(spans, level) if lv == n]
        for s in todo:
            for pos in range(s.lo, s.hi):
                cells[pos] = s.value
        for pos in sorted(cells):
            d.put(tree.leaf_name(pos), k, cells[pos])
        d.key_colors(k, [(s.value, s.color) for s in todo])
        for v, names in uncovered_leaves(tree, cells).items():
            lost.setdefault(v, []).extend(names)
    if depth > 1:
        d.notes.append(f"Nested ranges are split into {depth} columns, one per nesting level ({ticks(keys)}), so each "
                       "range can still form a whole clade.")
    if lost:
        n = sum(len(x) for x in lost.values())
        d.warnings.append(f"{plural(n, 'leaf', 'leaves')} of {plural(len(lost), 'range')} will not be covered by "
                          "Coloured Ranges → From a column (the range is not a whole clade of this tree, or is a single "
                          "leaf or the whole tree): "
                          + "; ".join(f"'{v}' ({short_list(names)})" for v, names in list(lost.items())[:3])
                          + (" …" if len(lost) > 3 else ""))
    return keys


def uncovered_leaves(tree: Tree, cells: Dict[int, str]) -> Dict[str, List[str]]:
    """Per value, the leaves that Coloured Ranges → From a column (mitol's uniformClades, min 2) leaves out."""
    covered: Set[int] = set()
    for node, _ in uniform_clades(tree, cells):
        covered.update(range(tree.L[node], tree.R[node]))
    lost: Dict[str, List[str]] = {}
    for pos, v in sorted(cells.items()):
        if pos not in covered:
            lost.setdefault(v, []).append(tree.leaf_name(pos))
    return lost


def _range_step(keys: List[str]) -> str:
    step = f"Coloured Ranges → From a column → [[{keys[0]}]], min 2 → Add ranges (range colours from colors.tsv)"
    if len(keys) > 1:
        step += f"; then the same for {ticks(keys[1:])} (ranges nested inside others)"
    return step + "."


def conv_tree_colors(d: Dataset) -> None:
    keys = _branch_label_columns(d, background_row=True)
    approx: Counter = Counter()
    ranges: List[Tuple[str, str, str, int]] = []  # (id, value, colour, order)
    clade_widths: List[Tuple[str, str]] = []
    for order, row in enumerate(d.f.rows):
        rid, typ, c = row[0], row_get(row, 1).lower(), d.color(row_get(row, 2))
        f4, f5 = row_get(row, 3), row_get(row, 4)
        if typ == "range":
            ranges.append((rid, f4 or c, c, order))
        elif typ in ("clade", "branch"):
            d.put(rid, keys["bc"], c)
            if typ == "branch" and d.is_internal(rid) and c:
                approx[ONE_INTERNAL_BRANCH] += 1
            if f4.lower() == "dashed":
                approx[DASHED] += 1
            if f5 and f5 != "1":
                if typ == "clade" and d.is_internal(rid):
                    clade_widths.append((rid, f5))
                else:
                    _branch_width(d, rid, keys["bw"], f5, approx)
        elif typ == "label":
            d.put(rid, keys["lc"], c)
            if f4.lower() in ("bold", "italic", "bold-italic"):
                d.put(rid, keys["ls"], f4.lower())
            if f5 and f5 != "1":
                approx[LABEL_SIZE] += 1
        elif typ == "label_background":
            d.put(rid, keys["lb"], c)
        else:
            approx[(f"row with unknown type '{typ}'", f"rows with unknown type '{typ}'", " skipped")] += 1
    _clade_widths(d, keys["bw"], clade_widths, approx)
    range_keys: List[str] = []
    if ranges and d.tree is None:
        kr = d.add("rg", f"{d.label} range", "category")
        for rid, value, _, _ in ranges:
            d.put(rid, kr, value)
        d.key_colors(kr, [(v, c) for _, v, c, _ in ranges])
        range_keys = [kr]
    elif ranges:
        tree = d.tree
        spans, missing, bad = [], [], []
        for rid, value, c, order in ranges:
            if d.is_pattern(rid):
                nodes = tree.match(rid[len(CONTAINS):])
                if nodes is None:
                    bad.append(rid)
                spans += [Span(tree.L[n], tree.R[n], value, c, order, weak=True) for n in nodes or []]
                continue
            n = tree.resolve(rid)
            if n is None:
                missing.append(rid)
            else:
                spans.append(Span(tree.L[n], tree.R[n], value, c, order))
        if missing:
            d.warnings.append(f"{plural(len(missing), 'range id')} not found in the tree: {short_list(missing)}")
        if bad:
            d.warnings.append(f"{plural(len(bad), 'CONTAINS== range pattern')} skipped (not a valid regular "
                              f"expression): {short_list(bad)}")
        range_keys = range_columns(d, "rg", f"{d.label} range", spans)
    d.feature = "Tree decorations (branch / label colours, ranges)"
    _decoration_steps(d, keys, approx)
    if range_keys:
        d.steps.append(_range_step(range_keys))


def conv_range(d: Dataset) -> None:
    rows = d.f.rows
    if any(any(row_get(r, i) for i in (3, 4, 5, 6, 8, 9, 10)) for r in rows):
        d.notes.append("Per-range gradient colours, borders and label styles are not carried over (mitol ranges have "
                       "one fill colour and a label).")
    if d.tree is None:
        k = d.add("range", d.label, "category", policy="keep")
        pairs = []
        for row in rows:
            a, b = row_get(row, 0), row_get(row, 1)
            c = d.color(row_get(row, 2))
            value = row_get(row, 7) or c
            d.put(f"{a}|{b}" if b and b != a and not a.startswith(CONTAINS) else a, k, value)
            pairs.append((value, c))
        d.key_colors(k, pairs)
        if rows:
            d.unexpanded = True
            d.warnings.append("ranges are written as 'start|end' rows: re-run with --tree to write one row per leaf "
                              "('From a column' needs leaf rows)")
        keys = [k]
    else:
        tree = d.tree
        spans, missing, bad_rx, empty = [], [], [], []
        patterns = matched = 0
        for order, row in enumerate(rows):
            a, b = row_get(row, 0), row_get(row, 1) or row_get(row, 0)
            c = d.color(row_get(row, 2))
            if a.startswith(CONTAINS):  # iTOL: one range per matching node, END_NODE_ID ignored
                patterns += 1
                nodes = tree.match(a[len(CONTAINS):])
                if nodes is None:
                    bad_rx.append(a)
                elif not nodes:
                    empty.append(a)
                for n in nodes or []:
                    spans.append(Span(tree.L[n], tree.R[n], row_get(row, 7) or c, c, order, weak=True))
                    matched += 1
                continue
            na, nb = tree.resolve(a), tree.resolve(b)
            if na is None or nb is None:
                missing.append(a if na is None else b)
                continue
            lo, hi = min(tree.L[na], tree.L[nb]), max(tree.R[na], tree.R[nb])
            spans.append(Span(lo, hi, row_get(row, 7) or c, c, order))
        if missing:
            d.warnings.append(f"{plural(len(missing), 'range end')} not found in the tree: {short_list(missing)}")
        if matched:
            d.notes.append(f"{plural(patterns - len(bad_rx) - len(empty), 'CONTAINS== range row')} made "
                           f"{plural(matched, 'range')}, one per matching node (as iTOL; END_NODE_ID is ignored there).")
        if bad_rx:
            d.warnings.append(f"{plural(len(bad_rx), 'CONTAINS== range pattern')} skipped (not a valid regular "
                              f"expression): {short_list(bad_rx)}")
        if empty:
            d.warnings.append(f"{plural(len(empty), 'CONTAINS== range pattern')} {'matches' if len(empty) == 1 else 'match'} "
                              f"no node of the tree: {short_list(empty)}")
        keys = range_columns(d, "range", d.label, spans)
        if spans:
            d.notes.append("Each range covers the leaves from START to END in the tree file's leaf order.")
    d.feature = "Coloured ranges (From a column)"
    d.steps.append(_range_step(keys))


def conv_labels(d: Dataset) -> None:
    k = d.add("label", d.label, "text", policy="keep")
    kc = d.add("class", f"{d.label} class", "category", policy="keep", optional=True)
    internal = 0
    for row in d.f.rows:
        d.put(row[0], k, row_get(row, 1))
        d.put(row[0], kc, row_get(row, 2))
        internal += d.is_internal(row[0])
    if internal:
        d.notes.append(f"{plural(internal, 'internal node name')} kept as they are; mitol renames leaf labels only.")
    d.feature = "Rename labels (decoration)"
    d.steps.append("Tree decorations → Rename labels from: [[label]].")


def conv_alignment(d: Dataset) -> None:
    k = d.add("seq", d.label, "sequence")
    seqs: Dict[str, List[str]] = {}
    repeated: List[str] = []
    cur = None
    for line in d.f.lines:
        if line.startswith(">"):
            name = line[1:].strip()
            if name in seqs:  # keep the first sequence of a repeated id
                repeated.append(name)
                cur = None
            else:
                cur = name
                seqs[name] = []
        elif cur is not None:
            seqs[cur].append(re.sub(r"\s+", "", line))
    for rid, parts in seqs.items():
        d.put(rid, k, "".join(parts))
    first = next((i for i, line in enumerate(d.f.lines) if line.startswith(">")), len(d.f.lines))
    if not seqs and d.f.lines:
        d.warnings.append("no FASTA record found: the DATA section of an alignment dataset is '>id' lines, each "
                          "followed by its sequence")
    elif first:
        d.warnings.append(f"{plural(first, 'line')} before the first '>id' line ignored")
    if repeated:
        d.warnings.append(f"{plural(len(repeated), 'repeated sequence id')}; the first sequence of each is kept "
                          f"({short_list(repeated)})")
    lengths = Counter(len("".join(p)) for p in seqs.values())
    if len(lengths) > 1:
        d.warnings.append(f"sequences have different lengths ({', '.join(str(n) for n in sorted(lengths))})")
    d.feature = "Sequence alignment ring"
    d.steps.append("Annotation Tracks → + Add ring… → Type: Sequence alignment → choose [[seq]] → Add ring.")
    d.hints({
        "COLOR_SCHEME": lambda v: f"Colour scheme: {ALIGNMENT_SCHEMES.get(v.strip().lower(), v + ' (custom, not carried over)')}",
        "START_POSITION": lambda v: f"First column: {v}",
        "END_POSITION": lambda v: f"Last column: {v}",
        "HIGHLIGHT_TYPE": lambda v: {"consensus": "Dot highlighting: Against consensus",
                                     "reference": "Dot highlighting: Against reference leaf"}.get(v.strip().lower()),
        "HIGHLIGHT_REFERENCES": lambda v: f"Reference leaf: {d.f.values('HIGHLIGHT_REFERENCES')[0]}" if d.f.values("HIGHLIGHT_REFERENCES") else None,
        "HIGHLIGHT_DISAGREEMENTS": lambda v: "Highlight differences instead: on" if on(v) else None,
        "COLORED_DOTS": lambda v: f"Coloured dots: {on_off(v)}",
        "MARK_REFERENCES": lambda v: f"Box around reference: {on_off(v)}",
        "INVERSE_GAPS": lambda v: "Inverse gaps (dark cell, white bar): on" if on(v) else None,
        "DISPLAY_CONSENSUS": lambda v: f"Consensus row: {on_off(v)}",
        "CONSENSUS_THRESHOLD": lambda v: f"Consensus threshold: {v}",
        "IGNORE_GAPS": lambda v: f"Ignore gaps in consensus: {on_off(v)}",
        "DISPLAY_CONSERVATION": lambda v: f"Conservation graph: {on_off(v)}",
        "COLOR_GRAPH": lambda v: f"Colour conservation bars: {on_off(v)}",
    })


def box_format(cells: List[str]) -> str:
    """mitol's boxplot.ts detectFormat (summary vs raw samples), on the cells we write."""
    seen = raw = summary = 0
    for cell in cells:
        xs = [x for x in (js_number(t) for t in re.split(r"[,;|\s]+", cell.strip()) if t) if x is not None]
        if not xs:
            continue
        seen += 1
        vote = 0
        if len(xs) < 5:
            vote = -1
        else:
            if any(xs[i] < xs[i - 1] for i in range(1, 5)):
                vote = -1
            if not vote and len(xs) > 5:
                srt = True
                for i in range(5, len(xs)):
                    if xs[0] <= xs[i] <= xs[4]:
                        vote = -1
                        break
                    if xs[i] < xs[i - 1]:
                        srt = False
                if not vote and not srt:
                    vote = 1
        raw += vote < 0
        summary += vote > 0
        if seen >= 5000:
            break
    return "summary" if summary > 0 and raw <= 0.05 * seen else "raw"


def conv_boxplot(d: Dataset) -> None:
    k = d.add("box", d.label, "list")
    cells, bad, unsorted, extremes, dropped = [], [], 0, 0, Counter()
    for row in d.f.rows:
        vals = [v.strip() for v in row[1:] if v.strip()]
        nums = [js_number(v) for v in vals]  # JavaScript's Number(), as mitol reads the cell
        if len(vals) < 5 or any(x is None for x in nums[:5]):
            bad.append(row[0])
            continue
        five = vals[:5]
        extra = sorted(((x, v) for x, v in zip(nums[5:], vals[5:]) if x is not None), key=lambda t: -t[0])
        for x, v in zip(nums[5:], vals[5:]):
            if x is None:
                dropped[v] += 1
        if any(nums[i] < nums[i - 1] for i in range(1, 5)):
            unsorted += 1
        extremes += bool(extra)
        cell = ",".join(five + [v for _, v in extra])
        d.put(row[0], k, cell)
        cells.append(cell)
    if bad:
        d.warnings.append(f"{plural(len(bad), 'row')} without 5 numbers (min, Q1, median, Q3, max) skipped "
                          f"({short_list(bad)})")
    if dropped:
        d.warnings.append(f"{plural(sum(dropped.values()), 'extreme value')} that are not numbers dropped "
                          f"({short_list(sorted(dropped))})")
    if unsorted:
        d.warnings.append(f"{plural(unsorted, 'row')} whose min, Q1, median, Q3, max are not in order")
    d.key_color(k, "(color)", d.f.get("COLOR"))
    d.hint("COLOR", lambda v: f"Box fill: {norm_color(v) or v}")
    d.feature = "Box plot ring"
    detected = box_format(cells)
    fmt = "Summary: min, Q1, median, Q3, max[, extremes…]"
    if extremes:
        how = "detected automatically" if detected == "summary" else "set it by hand: mitol would guess Samples here"
        d.steps.append(f"Annotation Tracks → + Add ring… → Type: Box plot → choose [[box]] → Add ring; on the new ring "
                       f"**Style ▾** → Cell format: {fmt} ({how}).")
    else:
        d.steps.append("Annotation Tracks → + Add ring… → Type: Box plot → choose [[box]] → Add ring (five numbers per "
                       "cell: either Cell format draws iTOL's box exactly).")
    if extremes:
        d.notes.append("Cells are min, Q1, median, Q3, max, then the extremes from high to low (their order does not "
                       "matter to iTOL; it lets mitol recognise the summary format).")
    d.hints({"WIDTH": lambda v: f"Width: {v}"})


def conv_linechart(d: Dataset) -> None:
    k = d.add("line", d.label, "list")
    bad: List[str] = []
    for row in d.f.rows:
        pts = []
        for p in row[1:]:
            xy = [t.strip() for t in p.split("|")]
            if len(xy) == 2 and js_number(xy[0]) is not None and js_number(xy[1]) is not None:
                pts.append(f"{xy[0]}:{xy[1]}")
            elif p.strip():
                bad.append(p.strip())
        d.put(row[0], k, " ".join(pts))
    if bad:
        d.warnings.append(f"{plural(len(bad), 'point')} that {'is' if len(bad) == 1 else 'are'} not an 'X|Y' pair of "
                          f"numbers skipped: {short_list(bad)}")
    line = d.f.get("DEFAULT_LINE_COLOR") or d.f.get("COLOR")
    d.used.add("DEFAULT_LINE_COLOR")
    d.key_color(k, "(color)", line)
    d.feature = "Line chart ring"
    d.steps.append("Annotation Tracks → + Add ring… → Type: Line chart → choose [[line]] → Add ring.")
    if line:
        d.steps.append(f"on the new ring, **Style ▾** → Line colour: {norm_color(line) or line}.")
    d.hints({
        "LINE_COLORS": lambda v: f"Colour by Y: {' '.join(d.f.values('LINE_COLORS'))}",
        "AXIS_X": lambda v: f"Lines at Y: {' '.join(d.f.values('AXIS_X'))}",
        "AXIS_Y": lambda v: f"Lines at X: {' '.join(d.f.values('AXIS_Y'))}",
        "WIDTH": lambda v: f"Chart width: {v}",
        "HEIGHT_FACTOR": lambda v: f"Height factor: {v}",
        "SHOW_LINE": lambda v: f"Draw line: {on_off(v)}",
        "LINE_WIDTH": lambda v: f"Line width: {v}",
        "SHOW_DOTS": lambda v: f"Show points: {on_off(v)}",
        "DOT_SIZE": lambda v: f"Point radius: {v}",
        "DEFAULT_DOT_COLOR": lambda v: f"Point colour: {v}",
        "SHOW_TITLE": lambda v: f"Column label: {on_off(v)}",
    })


def conv_collapse(d: Dataset) -> None:
    k = d.add("collapse", d.label, "category", policy="outer")
    leaves = []
    for row in d.f.rows:
        rid = row[0].strip()
        if d.tree is not None and not d.is_internal(rid) and d.tree.resolve(rid) is not None:
            leaves.append(rid)
            continue
        d.put(rid, k, f"node {rid}" if is_number(rid) else rid)
    if leaves:
        d.warnings.append(f"{plural(len(leaves), 'leaf id')} skipped (a leaf cannot be collapsed): {short_list(leaves)}")
    d.feature = "Collapse (From a column)"
    d.steps.append("Coloured Ranges → From a column → [[collapse]], min 2 → Collapse.")


def conv_metadata(d: Dataset) -> None:
    keys = d.field_columns(1, "text", policy="keep")
    for row in d.f.rows:
        for i, k in enumerate(keys):
            d.put(row[0], k, row_get(row, 1 + i))
    for k in keys:
        vals = [r[k] for r in d.rows.values() if k in r]
        if vals and all(is_number(v) for v in vals):
            d.col(k).kind = "numeric"
    d.feature = "plain columns (node metadata)"
    d.steps.append(f"Columns {ticks(keys)} load as plain rings; numeric ones also work in Tree decorations → "
                   "Branch width by (clade rows apply to that branch).")


CONVERTERS: Dict[str, Callable[[Dataset], None]] = {
    "DATASET_COLORSTRIP": conv_colorstrip,
    "DATASET_SIMPLEBAR": conv_simplebar,
    "DATASET_GRADIENT": conv_gradient,
    "DATASET_MULTIBAR": conv_multibar,
    "DATASET_HEATMAP": conv_heatmap,
    "DATASET_EXTERNALSHAPE": conv_externalshape,
    "DATASET_PIECHART": conv_piechart,
    "DATASET_BINARY": conv_binary,
    "DATASET_SYMBOL": conv_symbol,
    "DATASET_DOMAINS": conv_domains,
    "DATASET_TEXT": conv_text,
    "DATASET_CONNECTION": conv_connection,
    "DATASET_STYLE": conv_style,
    "DATASET_ALIGNMENT": conv_alignment,
    "DATASET_BOXPLOT": conv_boxplot,
    "DATASET_LINECHART": conv_linechart,
    "DATASET_RANGE": conv_range,
    "TREE_COLORS": conv_tree_colors,
    "LABELS": conv_labels,
    "COLLAPSE": conv_collapse,
    "METADATA": conv_metadata,
}


def convert(path: str, kind: str, tree: Optional[Tree], display: str = "") -> Dataset:
    d = Dataset(read_itol(path, kind, tree.by_name if tree is not None else None), tree)
    d.display = display or d.f.name
    CONVERTERS[kind](d)
    d.finish()
    return d


def unify_clade_ids(datasets: List[Dataset], tree: Tree) -> None:
    """One spelling per internal node across the run: mitol keeps a single row per node (the file loaded last
    wins), so "A|B" and "C|D" naming the same clade in two files would hide each other's values."""
    for d in datasets:
        if d.connections is not None:
            continue
        new: Dict[str, Dict[str, str]] = {}
        renamed = clash = 0
        for rid, row in d.rows.items():
            cid = rid
            node = None if rid.startswith(CONTAINS) else tree.resolve(rid)
            if node is not None and not tree.is_leaf(node):
                cid = tree.ref(node) or rid
            renamed += cid != rid
            dest = new.setdefault(cid, {})
            for k, v in row.items():
                clash += k in dest and dest[k] != v
                dest[k] = v
        d.rows = new
        if renamed:
            d.notes.append(f"{plural(renamed, 'clade id')} written as the node's name or 'first leaf|last leaf' "
                           "(one spelling per clade in every file, so mitol keeps all their values).")
        if clash:
            d.warnings.append(f"{plural(clash, 'cell')} given twice for the same clade (different spellings); the "
                              "last one is used")


def resolve_ambiguous_symbols(datasets: List[Dataset]) -> None:
    """
    A symbol value that names several legend entries ('A / B': same shape and
    colour, e.g. a file that draws every symbol as a circle) is settled from
    another dataset in the run that gives the same id exactly one of them.
    """
    for d in datasets:
        if d.kind != "DATASET_SYMBOL":
            continue
        fixed, left = 0, 0
        for rid, row in d.rows.items():
            for k, v in list(row.items()):
                if " / " not in v:
                    continue
                cands = set(v.split(" / "))
                found = {ov for o in datasets if o is not d for ov in o.rows.get(rid, {}).values()} & cands
                if len(found) != 1:
                    left += 1
                    continue
                new = found.pop()
                row[k] = new
                fixed += 1
                colour = next((c for kk, vv, c in d.colors if kk == k and vv == v), None)
                if colour and not any(kk == k and vv == new for kk, vv, _ in d.colors):
                    d.colors.append((k, new, colour))
                if (k, v) in d.shapes:
                    d.shapes.setdefault((k, new), d.shapes[(k, v)])
        if not fixed:
            continue
        used = {(k, v) for r in d.rows.values() for k, v in r.items()}
        d.colors = [(k, v, c) for k, v, c in d.colors if v.startswith("(") or (k, v) in used]
        if not left:
            d.warnings = [w for w in d.warnings if "match several legend entries" not in w]
        d.notes.append(f"{plural(fixed, 'symbol')} matched several legend entries (same shape and colour); each took "
                       "the value another file in this run gives the same leaf"
                       + (f" ({plural(left, 'symbol')} could not be settled and still name all of them)" if left else "") + ".")


def clade_rows_without_tree(datasets: List[Dataset]) -> bool:
    """Decoration columns with "A|B" rows (no --tree): differently spelled ones would hide each other in mitol."""
    for d in datasets:
        if d.kind in ("DATASET_RANGE", "LABELS"):  # 'start|end' spans / leaf renames: not clade rows
            continue
        keep = {c.key for c in d.columns if c.policy == "keep"}
        if any(("|" in rid or "---" in rid) and keep & set(r) for rid, r in d.rows.items()):
            return True
    return False


# ============================================================
# Naming (unique across the run) and writing
# ============================================================

def assign_names(datasets: List[Dataset], outside: Optional[Dict[str, str]] = None) -> None:
    """Column names: DATASET_LABEL / field labels, unique across the run and the names in `outside`
    (column → where it is already used: another table in OUTDIR, or a table kept from an earlier run)."""
    outside = outside or {}
    taken: set = set(outside)

    def free(name: str) -> bool:
        return name not in taken and name.strip().lower() not in RESERVED_COLUMNS

    def unique(name: str, d: Dataset) -> str:
        name = re.sub(r"\s+", " ", clean_text(name)).strip() or "value"
        first = name
        if not free(name):
            name = f"{name} ({d.short})"
            if not free(name):
                k = 2
                while not free(f"{name} {k}"):
                    k += 1
                name = f"{name} {k}"
        if first in outside:
            d.renamed.append(f"'{first}' is already a column of {outside[first]}, so this one is named '{name}'")
        taken.add(name)
        return name

    counts = Counter(c.want for d in datasets for c in d.columns)
    for d in datasets:
        paired = {k for kd, kl, _ in d.pairs for k in (kd, kl)}
        for kd, kl, stem in d.pairs:  # "<x> domains" + "<x> length": mitol pairs them by name
            stem = re.sub(r"\s+", " ", clean_text(stem)).strip() or "protein"
            cand, k = stem, 2
            while not (free(f"{cand} domains") and free(f"{cand} length")):
                cand, k = f"{stem} {k}", k + 1
            for c in d.columns:
                if c.key in (kd, kl):
                    c.name = f"{cand} {'domains' if c.key == kd else 'length'}"
                    taken.add(c.name)
        # Field columns keep their bare label when every field label of the dataset is unique in the run;
        # otherwise all of them get the dataset label in front (consistent names within one ring).
        prefix = any(counts[c.want] > 1 or c.want in outside for c in d.columns if c.field_of is not None)
        for c in d.columns:
            if c.key in paired:
                continue
            base = f"{c.field_of} {c.want}" if c.field_of is not None and prefix else c.want
            c.name = unique(base, d)


def assign_files(datasets: List[Dataset], foreign: Iterable[str] = (), reuse: Optional[Dict[str, str]] = None,
                 keep: Iterable[str] = ()) -> None:
    """Output file names: <stem>.tsv, never one of RESERVED_FILES, another tool's file (`foreign`) or a file kept
    from an earlier run (`keep`); a source converted before gets its earlier file name back (`reuse`)."""
    used = set(RESERVED_FILES) | {n.casefold() for n in foreign} | {n.casefold() for n in keep}
    reuse = reuse or {}
    for d in datasets:  # earlier names first, so a new file cannot take them
        suffix = ".connections.tsv" if d.connections is not None else ".tsv"
        prev = reuse.get(os.path.realpath(d.f.path), "")
        if prev.endswith(suffix) and prev.casefold() not in used:
            d.out_file = prev
            used.add(prev.casefold())
    for d in datasets:
        if d.out_file:
            continue
        suffix = ".connections.tsv" if d.connections is not None else ".tsv"
        stem, k = d.f.stem, 2
        name = stem + suffix
        while name.casefold() in used:  # case-insensitive: macOS file systems
            name, k = f"{stem}_{k}{suffix}", k + 1
        used.add(name.casefold())
        d.out_file = name


def clean_text(v: str) -> str:
    """No tabs / line breaks (→ space) and no other control characters (NUL …)."""
    v = re.sub(r"[\t\r\n\x0b\x0c\x1c-\x1e\x85\u2028\u2029]+", " ", v)
    return re.sub(r"[\x00-\x08\x0e-\x1b\x1f\x7f]", "", v).strip()


def tsv_cell(v: str) -> str:
    """One cell, cleaned; a leading quote is quoted (d3's TSV reader would unquote it)."""
    v = clean_text(v)
    return '"' + v.replace('"', '""') + '"' if v.startswith('"') else v


def write_atomic(path: str, text: str) -> None:
    """Write via a temporary file in the same folder + rename, so a reader never sees half a file."""
    folder = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".itol2tsv-", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        umask = os.umask(0)
        os.umask(umask)
        os.chmod(tmp, 0o666 & ~umask)  # mkstemp creates 0600; use the usual permissions
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def table_text(header: List[str], rows: Iterable[List[str]]) -> str:
    """TSV text; trailing empty cells are left out (no trailing whitespace; mitol reads missing cells as blank)."""
    lines = ["\t".join(tsv_cell(h) for h in header)]
    for r in rows:
        cells = [tsv_cell(v) for v in r]
        while len(cells) > 1 and cells[-1] == "":
            cells.pop()
        lines.append("\t".join(cells))
    return "\n".join(lines) + "\n"


def dataset_text(d: Dataset) -> str:
    if d.connections is not None:
        cols = ["source", "target", "width", "color", "style", "label"]
        return table_text(cols, ([c[k] for k in cols] for c in d.connections))
    return table_text(["id"] + [c.name for c in d.columns],
                      ([rid] + [r.get(c.key, "") for c in d.columns] for rid, r in d.rows.items()))


def colour_rows(d: Dataset) -> List[List[str]]:
    names = {c.key: c.name for c in d.columns}
    return [[names[k], v, c, d.shapes.get((k, v), "")] for k, v, c in d.colors if k in names]


def render(d: Dataset, text: str, quote: str = "`") -> str:
    """Text with [[key]] replaced by the column's name (its preferred name for a column dropped as empty)."""
    names = {**d.wants, **{c.key: c.name for c in d.columns if c.name}}
    return re.sub(r"\[\[(\w+)\]\]", lambda m: f"{quote}{names.get(m.group(1), m.group(1))}{quote}", text)


def n_rows(d: Dataset) -> int:
    return len(d.connections) if d.connections is not None else len(d.rows)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_sha256(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


# ============================================================
# Guide (README.md)
# ============================================================

README_TITLE = "# iTOL annotations converted for mitol"


def md(s: str) -> str:
    return s.replace("|", "\\|")


def anchor(name: str) -> str:
    return re.sub(r"[^a-z0-9 _-]", "", name.lower()).replace(" ", "-")


def describe(d: Dataset, c: Column) -> str:
    vals = [r[c.key] for r in d.rows.values() if c.key in r]
    if c.kind in ("category", "colour"):
        n = len(set(vals))
        keyed = any(k == c.key for k, _, _ in d.colors)
        return f"categories: {n}" + (", colours in colors.tsv" if keyed else "")
    return {"numeric": "numbers", "text": "text", "binary": "1 / 0 / -1", "list": "number lists",
            "domains": "domain list", "sequence": "aligned sequences"}.get(c.kind, c.kind)


def files_row(d: Dataset) -> str:
    return (f"| {md(d.display)} | [`{md(d.out_file)}`](#{anchor(d.out_file)}) | {d.kind} → {d.feature} | "
            f"{n_rows(d):,} | {len(d.warnings) or '–'} |")


def readme_section(d: Dataset) -> str:
    out = [f"### {d.out_file}", "", f"From `{d.display}` ({d.kind}, \"{d.label}\") → {d.feature}.", ""]
    if d.connections is not None:
        out.append("- Columns: `source`, `target`, `width`, `color`, `style`, `label`")
    else:
        cols = d.columns
        out.append("- Columns: " + ", ".join(f"`{c.name}` ({describe(d, c)})" for c in cols[:12])
                   + (f", … (+{len(cols) - 12} more)" if len(cols) > 12 else ""))
    out += [f"- In mitol: {render(d, s)}" for s in d.steps]
    if d.by_hand:
        out.append(f"- Set by hand ({d.by_hand_where}): " + "; ".join(render(d, h) for h in d.by_hand))
    out += [f"- Note: {render(d, n)}" for n in d.notes]
    out += [f"- Note: {n}." for n in d.renamed]
    if d.not_carried:
        out.append("- Not carried over: " + ", ".join(f"`{s}`" for s in d.not_carried))
    out += [f"- Warning: {render(d, w)}" for w in d.warnings]
    return "\n".join(out) + "\n"


def sources_text(paths: List[str]) -> str:
    paths = [os.path.abspath(p) for p in paths]
    if len(paths) <= 3:
        return ", ".join(f"`{p}`" for p in paths)
    return f"{len(paths)} inputs in `{os.path.commonpath(paths)}`"


def readme_text(entries: List[dict], carried: List[dict], skipped: List[Tuple[str, str]],
                failed: List[Tuple[str, str]], sources: List[str], tree_path: Optional[str],
                general: List[str]) -> str:
    out = [README_TITLE, ""]
    out.append(f"Made by `scripts/itol2tsv.py` from {sources_text(sources)}"
               + (f", ids checked against `{tree_path}`." if tree_path else " (no tree given: ids not checked).")
               + " Re-running a command overwrites the files it made"
               + (f"; {plural(len(carried), 'table')} made earlier from other inputs are kept (last rows of the "
                  "Files table)." if carried else "."))
    out += ["", "## Load into mitol", "",
            "1. Load the tree" + (f" (`{os.path.basename(tree_path)}`)." if tree_path else "."),
            "2. **Annotations (CSV/TSV) → Add files…** (**Choose files…** before the first file) and select every "
            "`.tsv` in this folder, including `colors.tsv` (the colour key: category colours, bar / field colours "
            "and gradient stops taken from the iTOL files).",
            "3. Columns appear as rings under **Annotation Tracks** (numbers as bars, text as colour strips; columns "
            "with over 100 distinct values, such as sequences or domain lists, start hidden). Untick the ones you "
            "don't need, then follow the notes per file below.", ""]
    out += [f"- {g}" for g in general]
    if general:
        out.append("")
    out += ["## Files", "", "| iTOL file | Output | iTOL type → mitol | Rows | Warnings |", "|---|---|---|---:|---:|"]
    out += [e["files_row"] for e in entries]
    out += [e["files_row"].replace(" | [`", " | *(earlier run)* [`", 1) for e in carried]
    for name, why in failed:
        out.append(f"| {md(name)} | – | failed: {md(why)} | | |")
    for name, why in skipped:
        out.append(f"| {md(name)} | – | skipped: {md(why)} | | |")
    out.append("")
    out += [e["section"] for e in entries + carried]
    return "\n".join(out)


# ============================================================
# Output folder: ownership (manifest), shared folders
# ============================================================

def safe_name(n: object) -> bool:
    """A plain file name inside OUTDIR (no folder part): manifest entries are never used as paths otherwise."""
    return (isinstance(n, str) and n not in ("", ".", "..") and os.path.basename(n) == n
            and "/" not in n and "\\" not in n and "\x00" not in n)


def read_manifest(outdir: str) -> Optional[dict]:
    """The manifest of an earlier run ({} when there is none; None when it exists but cannot be read).
    Sources are stored relative to OUTDIR (version 2), so a copied folder maps to its own copies; they are
    returned as absolute paths. Version 1 stored absolute paths ("legacy")."""
    path = os.path.join(outdir, MANIFEST)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            m = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(m, dict) or not isinstance(m.get("files"), list) or not isinstance(m.get("outputs"), list):
        return None
    base = os.path.realpath(outdir)
    m["legacy"] = m.get("version", 1) == 1
    m["files"] = [n for n in m["files"] if safe_name(n)]
    m["outputs"] = [e for e in m["outputs"] if isinstance(e, dict) and safe_name(e.get("file"))
                    and isinstance(e.get("source"), str) and e["source"]]
    for e in m["outputs"]:
        e["source"] = os.path.normpath(os.path.join(base, e["source"]))  # an absolute source stays as it is
    return m


def manifest_text(files: Iterable[str], outputs: List[dict], outdir: str) -> str:
    base = os.path.realpath(outdir)

    def rel(src: str) -> str:
        try:
            return os.path.relpath(src, base)
        except ValueError:  # another drive (Windows)
            return src
    outs = [{**e, "source": rel(e["source"])} for e in outputs]
    return json.dumps({"tool": "itol2tsv", "version": 2, "files": sorted(files), "outputs": outs}, indent=1) + "\n"


def legacy_own_files(outdir: str) -> Set[str]:
    """Files listed by a README.md of an itol2tsv version without a manifest."""
    try:
        with open(os.path.join(outdir, "README.md"), encoding="utf-8") as fh:
            text = fh.read()
    except (OSError, UnicodeDecodeError):
        return set()
    if not text.startswith(README_TITLE):
        return set()
    return {n for n in re.findall(r"\[`([^`]+)`\]\(#", text) if safe_name(n)} | {"README.md", "colors.tsv"}


def foreign_columns(outdir: str, names: Iterable[str]) -> Dict[str, str]:
    """Column names of other tools' .tsv tables in OUTDIR (README step 2 loads every .tsv there)."""
    out: Dict[str, str] = {}
    for n in sorted(names):
        if not n.lower().endswith(".tsv"):
            continue
        try:
            with open(os.path.join(outdir, n), encoding="utf-8-sig", errors="replace") as fh:
                head = fh.readline().rstrip("\r\n")
        except OSError:
            continue
        cells = [c.strip().strip('"') for c in head.split("\t")]
        if [c.lower() for c in cells[:3]] == ["column", "value", "color"]:
            continue  # a colour key, not a table
        for c in cells:
            if c:
                out.setdefault(c, n)
    return out


def check_outdir(outdir: str) -> None:
    """Fail early, with one line, when OUTDIR cannot be a folder we write to."""
    if os.path.lexists(outdir) and not os.path.isdir(outdir):
        sys.exit(f"itol2tsv: {outdir} exists and is not a folder; choose another with -o")
    probe = outdir
    while not os.path.exists(probe):
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        probe = parent
    if not os.path.isdir(probe):
        sys.exit(f"itol2tsv: cannot create {outdir}: {probe} is not a folder")
    if not os.access(probe, os.W_OK | os.X_OK):
        sys.exit(f"itol2tsv: cannot write to {outdir}: permission denied" + ("" if probe == outdir else f" ({probe})"))


def input_coverage(paths: List[str], recursive: bool) -> Callable[[str], bool]:
    """Whether this run's inputs include a source file (a file given, or a file in a folder given)."""
    files = {os.path.realpath(p) for p in paths if os.path.isfile(p)}
    dirs = [os.path.realpath(p) for p in paths if os.path.isdir(p)]

    def covered(src: str) -> bool:
        return src in files or any(os.path.dirname(src) == d or (recursive and src.startswith(d + os.sep)) for d in dirs)
    return covered


# ============================================================
# Main
# ============================================================

def collect_inputs(paths: List[str], recursive: bool, outdir: str, ignored: Optional[List[str]] = None,
                   own: Iterable[str] = (), unreadable: Optional[List[Tuple[str, str]]] = None) -> List[Tuple[str, str]]:
    """(path, display name) of every input file; display names are relative to their input folder.
    In OUTDIR, the files this script wrote (`own`, colors.tsv, README.md, the manifest, temporary files) are left
    out and listed in `ignored`; other files there are read like any input. While walking a folder that contains
    OUTDIR, OUTDIR itself is not entered. Folders that cannot be read go to `unreadable` (name, reason)."""
    found, seen = [], set()
    out_real = os.path.realpath(outdir)
    mine = {n.casefold() for n in own} | RESERVED_FILES

    def add(p: str, base: Optional[str] = None) -> None:
        rp = os.path.realpath(p)
        name = os.path.basename(rp)
        if os.path.dirname(rp) == out_real and (name.casefold() in mine or name.startswith(".itol2tsv-")):
            if ignored is not None and rp not in ignored:
                ignored.append(rp)
            return
        if rp not in seen:
            seen.add(rp)
            found.append((p, os.path.relpath(p, base) if base else os.path.basename(p)))

    for p in paths:
        if os.path.isdir(p):
            def onerror(e: OSError, base: str = p) -> None:
                if unreadable is not None:
                    where = os.path.relpath(e.filename, base) if e.filename else "."
                    unreadable.append((base.rstrip(os.sep) if where == "." else where, e.strerror or str(e)))
            for root, dirs, files in os.walk(p, onerror=onerror):
                dirs[:] = sorted(x for x in dirs if not x.startswith(".")
                                 and os.path.realpath(os.path.join(root, x)) != out_real) if recursive else []
                for name in sorted(files):
                    if not name.startswith("."):
                        add(os.path.join(root, name), p)
        elif os.path.isfile(p):
            add(p)
        else:
            sys.exit(f"itol2tsv: no such file or folder: {p}")
    return found


def default_outdir(first: str) -> str:
    base = first if os.path.isdir(first) else os.path.dirname(os.path.abspath(first))
    return os.path.join(base, "mitol_converted")


def _interrupted(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


def main(argv: Optional[List[str]] = None) -> int:
    try:  # SIGTERM like Ctrl-C: temporary files are removed and the message says what to do
        signal.signal(signal.SIGTERM, _interrupted)
    except ValueError:  # not the main thread
        pass
    try:
        return run(argv)
    except KeyboardInterrupt:
        print("\nitol2tsv: interrupted; run the same command again to finish (it replaces what this run wrote)",
              file=sys.stderr)
        return 130


def run(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="Example: python3 scripts/itol2tsv.py results/ --tree tree.nwk   "
                                        "(writes results/mitol_converted/)")
    ap.add_argument("inputs", nargs="+", metavar="INPUT", help="iTOL files or folders (other files are skipped)")
    ap.add_argument("-o", "--outdir", help="output folder (default: INPUT/mitol_converted, or next to the first file)")
    ap.add_argument("--tree", help="Newick tree: check ids and expand clade rows of per-leaf datasets to leaves")
    ap.add_argument("--recursive", action="store_true", help="also read sub-folders of folder inputs")
    args = ap.parse_args(argv)

    outdir = os.path.abspath(args.outdir or default_outdir(args.inputs[0]))
    check_outdir(outdir)
    # OUTDIR may be shared with other tools: only files its manifest lists are this script's.
    manifest = read_manifest(outdir) if os.path.isdir(outdir) else {}
    if manifest is None:
        sys.exit(f"itol2tsv: {os.path.join(outdir, MANIFEST)} is not a manifest itol2tsv can read; "
                 "choose another folder with -o")
    own = set(manifest.get("files", [])) or legacy_own_files(outdir)
    prev: List[dict] = manifest.get("outputs", [])

    tree = None
    if args.tree:
        try:
            tree = Tree.from_file(args.tree)
        except (OSError, ValueError) as e:
            ap.error(f"cannot read tree {args.tree}: {e}")
        print(f"tree: {args.tree} ({len(tree.leaves):,} leaves)")

    datasets: List[Dataset] = []
    skipped: List[Tuple[str, str]] = []
    failed: List[Tuple[str, str]] = []
    report: List[Tuple[str, object]] = []  # (file name, Dataset or "skip"/"FAIL" text), in input order
    ignored: List[str] = []
    unreadable: List[Tuple[str, str]] = []
    inputs = collect_inputs(args.inputs, args.recursive, outdir, ignored, own, unreadable)
    for name, why in unreadable:
        skipped.append((name + "/", f"cannot read folder: {why}"))
        report.append((name, f"skip  {name}/: cannot read folder: {why}"))
    for path, name in inputs:
        kind, first = itol_header(path)
        if kind is None:
            skipped.append((name, first))
        elif kind not in CONVERTERS:
            skipped.append((name, f"{kind}: {UNSUPPORTED.get(kind, 'iTOL type not supported by mitol')}"))
        else:
            try:
                d = convert(path, kind, tree, name)
            except Exception as e:  # keep going: one bad file should not stop the run
                failed.append((name, f"{type(e).__name__}: {e}"))
                report.append((name, f"FAIL  {name}: {type(e).__name__}: {e}"))
                continue
            why = d.unusable()
            if why is None:
                datasets.append(d)
                report.append((name, d))
                continue
            skipped.append((name, f"{kind}: {why}"))
        report.append((name, f"skip  {name}: {skipped[-1][1]}"))
    if tree is not None:
        unify_clade_ids(datasets, tree)
    resolve_ambiguous_symbols(datasets)

    def print_report() -> None:
        for _, item in report:
            if not isinstance(item, Dataset):
                print(item)
                continue
            cols = "" if item.connections is not None else " [" + ", ".join(
                [c.name for c in item.columns[:6]] + ([f"… (+{len(item.columns) - 6})"] if len(item.columns) > 6 else [])) + "]"
            print(f"ok    {item.display}: {item.kind}, {plural(n_rows(item), 'row')} -> {item.out_file}{cols}")
            for w in item.warnings:
                print(f"        warning: {render(item, w, quote=chr(39))}")
            for n in item.renamed:
                print(f"        note: {n}")
        if ignored:
            print(f"note: {plural(len(ignored), 'file')} that itol2tsv wrote in the output folder ignored as input")

    if not datasets:
        print_report()
        sys.stdout.flush()
        if ignored and not inputs:
            print(f"itol2tsv: the inputs are files itol2tsv wrote in {outdir}; give the iTOL files, or choose another "
                  "folder with -o; nothing written", file=sys.stderr)
        else:
            print(f"itol2tsv: no iTOL dataset converted from {', '.join(args.inputs)}; nothing written", file=sys.stderr)
        return 1

    present = sorted(os.listdir(outdir)) if os.path.isdir(outdir) else []
    own_cf = {x.casefold() for x in own} | {MANIFEST}
    foreign = [n for n in present if n.casefold() not in own_cf and not n.startswith(".itol2tsv-")]
    clash = [n for n in foreign if n.casefold() in RESERVED_FILES]
    if clash:
        sys.exit(f"itol2tsv: {outdir} has {' and '.join(clash)} that itol2tsv did not write (no {MANIFEST} there "
                 "lists it); choose another folder with -o")

    # Earlier outputs: replaced (source converted again), kept (source not among this run's inputs), or stale
    # (source gone, or among the inputs but not converted this time). A version 1 manifest has absolute paths,
    # which still name the original folder after a copy: there, a source with the same file name as one
    # converted now counts as replaced.
    covered = input_coverage(args.inputs, args.recursive)
    converted = {os.path.realpath(d.f.path) for d in datasets}
    reuse = {e["source"]: e["file"] for e in prev}
    if manifest.get("legacy"):
        by_name = {os.path.basename(e["source"]): e for e in prev if e["source"] not in converted}
        for d in datasets:
            e = by_name.get(os.path.basename(d.f.path))
            if e is not None and os.path.realpath(d.f.path) not in reuse:
                reuse[os.path.realpath(d.f.path)] = e["file"]
                e["replaced"] = True
    carried = []
    for e in prev:
        if e.pop("replaced", False) or e["source"] in converted or covered(e["source"]) or not os.path.isfile(e["source"]):
            continue  # replaced, or stale (its file is removed below)
        if os.path.isfile(os.path.join(outdir, e["file"])):
            carried.append(e)
    carried_files = [e["file"] for e in carried]
    outside = foreign_columns(outdir, foreign)
    for e in carried:
        for c in e.get("columns", []):
            outside.setdefault(c, f"{e['file']} (kept from an earlier run)")
    assign_names(datasets, outside)
    assign_files(datasets, foreign=foreign, reuse=reuse, keep=carried_files)

    general = []
    if tree is None and clade_rows_without_tree(datasets):
        general.append("Clade rows ('A|B') in decoration columns: mitol keeps one row per clade, so if two files spell "
                       "the same clade differently ('A|B' and 'C|D'), only the file loaded last counts for it; "
                       "re-run with --tree to write one spelling per clade.")
    symbols = [f"`{d.col('s0').name}`" for d in datasets if d.kind == "DATASET_SYMBOL"]
    if len(symbols) > 1:
        general.append(f"{len(symbols)} files are symbol datasets ({', '.join(symbols)}): add one Leaf markers rule "
                       "per file; rules sit side by side at the leaf tips in list order (reorder with ▲ ▼).")

    produced = [d.out_file for d in datasets]
    produced_cf = {n.casefold() for n in produced}
    specials = ["colors.tsv", "README.md"]
    removed: List[str] = []
    edited: List[str] = []
    try:
        os.makedirs(outdir, exist_ok=True)
        for n in os.listdir(outdir):  # temporary files of an interrupted run
            if n.startswith(".itol2tsv-") and n.endswith(".tmp") and os.path.isfile(os.path.join(outdir, n)):
                os.remove(os.path.join(outdir, n))
        # Claim the files before writing them, so an interrupted run leaves a folder the next run accepts.
        write_atomic(os.path.join(outdir, MANIFEST), manifest_text(own | set(produced) | set(specials), prev, outdir))
        entries = []
        for d in datasets:
            text = dataset_text(d)
            write_atomic(os.path.join(outdir, d.out_file), text)
            entries.append({"file": d.out_file, "source": os.path.realpath(d.f.path), "sha256": sha256(text),
                            "columns": [c.name for c in d.columns] if d.connections is None else [],
                            "colors": colour_rows(d), "files_row": files_row(d), "section": readme_section(d)})
        # Own files that this run no longer makes: removed unless edited since (then left, no longer ours).
        keep_cf = produced_cf | {n.casefold() for n in carried_files + specials} | {MANIFEST}
        sha_of = {e["file"]: e.get("sha256") for e in prev}
        for n in sorted(own):
            p = os.path.join(outdir, n)
            if n.casefold() in keep_cf or not os.path.isfile(p):
                continue
            if sha_of.get(n) and file_sha256(p) != sha_of[n]:
                edited.append(n)
                continue
            os.remove(p)
            removed.append(n)
        rows = [(list(r) + [""])[:4] for e in entries + carried for r in e.get("colors", [])]
        write_atomic(os.path.join(outdir, "colors.tsv"), table_text(["column", "value", "color", "shape"], rows))
        write_atomic(os.path.join(outdir, "README.md"),
                     readme_text(entries, carried, skipped, failed, args.inputs, args.tree, general))
        files = set(produced) | set(carried_files) | set(specials)
        write_atomic(os.path.join(outdir, MANIFEST), manifest_text(files, entries + carried, outdir))
    except OSError as e:
        sys.exit(f"itol2tsv: cannot write to {outdir}: {e.strerror or e}")

    print_report()
    if carried:
        print(f"kept  {plural(len(carried), 'table')} made earlier from other inputs: {short_list(carried_files, 4)}")
    for n in removed:
        print(f"removed {n} (made earlier; its source is gone or did not convert this time)")
    for n in edited:
        print(f"note: {n} was edited after itol2tsv wrote it: left in place, no longer managed by itol2tsv")
    if tree is None and any(d.unexpanded for d in datasets):
        print("note: some files have clade rows ('A|B') or CONTAINS== patterns; pass --tree to expand them to leaves")
    for g in general:
        print(f"note: {g}")
    print(f"wrote {plural(len(datasets), 'table')}, colors.tsv ({plural(len(rows), 'row')}) and README.md to {outdir}"
          + (f" ({plural(len(carried), 'earlier table')} kept)" if carried else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
