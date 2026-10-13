# iTOL-style example tables

One table per ring type and tree decoration for the example tree `example/RTtree.nwk` (6,734 reverse
transcriptases); values are synthetic, simulated along the tree from the RT classes in `RTtreelabels.csv`. Most
files have an `id` column of leaf names, then one column per annotation (no iTOL header lines); `colors.tsv`,
`connections.tsv` and `domains_long.tsv` differ (see their sections). Excerpts use spaces; the files use tabs.

## Quick start
1. **Load → Load example data** first (tree + `RTtreelabels.csv`): it clears any loaded annotation files.
2. **Load → Annotations (CSV/TSV) → Add files…**: select every `.tsv` here, `colors.tsv` included. Each shows
   as a chip (`⇄ connections.tsv`; a colour-key chip for `colors.tsv`). Dropping them on the tree works too.
3. **Layout & View → Circ**, then zoom out (**–**) until the rings fit. About 45 columns also get a plain ring (bars,
   gradients or colour strips; long text starts hidden): untick unneeded ones in **Annotation Tracks** (click its header).
4. Per ring file below: **Annotation Tracks → + Add ring…** (under the list) → **Type** → tick the column(s) →
   **Add ring**: its options open under the new ring's row (**Style ▾ / ▴** shows or hides them).
5. Before **Rect**, untick the rings you don't need (or **Show** on the **Annotation Tracks** header): in Rect they squeeze the tree.

## Cell formats
| What | How to write it |
|---|---|
| File | `.tsv` (tab) or `.csv` (comma); **Add files…** accepts only these (a dropped `.txt` loads as a tree). Ids go in a column named `id` or `name`. Files that share a column name merge it (the later file wins). |
| Clade id | `A\|B` (or iTOL's `A---B`) = the smallest clade holding leaves A and B. Used by tree decorations and connections; rings ignore these rows. |
| Number | `2.8`, `-1.4`, `326`. Leave missing values blank: `NA`, `-` or `52%` turn the column's plain ring into a colour strip. A cell of only spaces is not blank: it counts as 0. |
| Number list | `27.9,25.4,27.0`, separated by `,` `;` `\|` or spaces. A blank or `NA` entry leaves a gap in a line chart and is skipped in box-plot samples. |
| Box-plot summary | iTOL's `min,Q1,median,Q3,max[,extremes…]`. No blank or `NA` entries here: they are dropped and the later values shift. |
| x:y pairs | `20:0 30:10 37:38` (or `x\|y`), separated by spaces, `,` or `;`. |
| Presence | `1` `yes` `true` `present` `+` = filled; `0` `no` `false` `absent` = outline; `-1` `NA` `-` or blank = nothing. |
| Domains | `name:start-end[:SHAPE][:colour]` items joined by `;`, or iTOL's `SHAPE\|start\|end\|colour\|label` joined by `,`. Length: a length column, else `len=NNN`, else the last domain end. Shapes: `RE` `HH` `HV` `EL` `DI` `TR` `TL` `PL` `PR` `PU` `PD` `OC` `GP`. |
| Aligned sequence | One string per leaf, all the same length; gaps `-`, `.` or `~`. |
| Colour | `#rgb` / `#rrggbb` work everywhere. A category value that is itself a colour (`#e15759`) is drawn in that colour. Domain cells also take `rgb()`, `hsl()` and basic names (`darkgreen`); connections any CSS colour. |
| Label style | A cell containing `bold` and / or `italic`. |

## Colour keys (colors.tsv)
A colour key has `column`, `value` and `color` (or `colour`) columns and no `id` or `name` column. Load it with
**Add files…**; it shows as a chip under **Annotations (CSV/TSV)**. Three kinds of rows:
```
column             value      color
subfamily          nonLTR-02  #1f77b4
homologs_bacteria  (color)    #1b9e77
mn_vs_mg_log2      (low)      #5e3c99
```
- **A value of the column**: its category colour (colour strip, text rings, tree decorations, ranges **From a
  column**; the domain names of a **Protein domains** ring on that column).
- **`(color)`**: a numeric column's bar colour, and its colour in multi-value bars, pies, binary and shapes.
- **`(low)` `(mid)` `(high)`**: a gradient for the column's own ring; a **Heatmap** takes its first column's.

Loading a key recolours matching columns at once, and columns loaded or rings added later while its chip is open;
rings from **+ Add ring…** made before it keep their own colours (use **Load colours…** below); later edits by hand
win. In `colors.tsv` each RT class has one colour (`clade`, `label`, `branch_color`, `label_color`) and each
`subfamily` a shade of it (neighbours differ in every **Ladderize** order; unclassified `RT-*` in greys).

**One ring only:** **Style ▾ → Load colours…** loads colours into that ring's column only (colour strips, heatmaps, bars,
pies, binary, shapes, domains; a numeric ring needs `(color)` or `(low)` / `(high)` rows): value and colour split by
a tab or comma (`UG2,#f04f27` on `label`; for bars, pies, binary and shapes the value is the column name, e.g. `pref_datp,#4e79a7`), a `value`/`color` header, or a key.

## heatmap.tsv
**Heatmap**: log2(activity with the metal / activity with Mg²⁺) for five metals.
```
id          mn_vs_mg_log2  co_vs_mg_log2  ni_vs_mg_log2  ca_vs_mg_log2  zn_vs_mg_log2
A0A6U3JU95  2.8            0.4            -1.4           -3.0           -2.3
A0A812MG09                 0.4            0.4            -2.5           -0.9
```
1. **+ Add ring…** → **Type: Heatmap** → tick the five `*_vs_mg_log2` columns → **Add ring**.
- The values span 0, so **Mid value** starts at 0 (white). Blank cells get the **No-value colour**.
- **Colour range: Each column separately** (+ **Normalisation: z-score**) compares leaves within each metal.

## multibar.tsv
**Multi-value bars**: homologs found in bacteria, archaea, eukaryotes and viruses, stacked.
```
id          homologs_bacteria  homologs_archaea  homologs_eukaryota  homologs_viruses
A0A6U3JU95  0                  0                 244                 2
A0A369T7D5  326                3                 91                  20
```
1. **+ Add ring…** → **Type: Multi-value bars** → tick the four `homologs_*` columns → **Add ring**.
- **Field colours** come from the `(color)` rows of `colors.tsv`.
- **Layout: Aligned columns (one per field)** or **Side by side (thin bar per field)**; **Scale: Logarithmic**.

## binary.tsv
**Binary (presence / absence)**: filled = present, outline = absent, nothing = not determined.
```
id          has_ncrna  has_cas1  has_integrase  has_endonuclease  in_prophage
A0A183J4B7  1          0         0              1                 yes
A0A2E3MUH7  0          0         0              0                 NA
```
1. **+ Add ring…** → **Type: Binary (presence / absence)** → tick all five columns → **Add ring**.
- In **Rect** symbols appear only once leaves are ~1.5 px apart; **Options → LOD threshold (px)** `3` keeps them.
- **Shapes** and **Colours** per field, **Symbol size**, **Absent fill**.

## shapes.tsv
**Shapes sized by value**: RT copies per genome, genes in its operon, CRISPR spacers (0 is not drawn).
```
id          copy_number  operon_genes  crispr_spacers
A0A6U3JU95  2            0             0
T1B4R9      2            3             27
```
1. **+ Add ring…** → **Type: Shapes sized by value** → tick the three columns → **Add ring**.
- All fields share one scale (as in iTOL), so `crispr_spacers` (up to 59) shrinks the others: tick **Scale each
  field separately**.

## pie.tsv
**Pie charts**: preferred dNTP in percent (rows sum to 100), sized by `relative_activity`.
```
id          pref_datp  pref_dctp  pref_dgtp  pref_dttp  relative_activity
A0A6U3JU95  13         17         52         18         84
A0A6A5BYM3  16         13         38         33         83
```
1. **+ Add ring…** → **Type: Pie charts** → tick the four `pref_*` columns → **Add ring**.
2. In its options: **Pie size: From a column** → **Size column:** `relative_activity`.
- Write percentages as plain numbers (`52`, not `52%`).
- Where leaves are too close for pies, each is a small stacked bar (**Stacked bars when dense**).

## text.tsv
**Text labels**: each leaf's subfamily (128 names such as `LTR-03` or `Retron-05`).
```
id          subfamily
A0A6U3JU95  nonLTR-01
A0A523RAG7  Retron-05
```
1. **+ Add ring…** → **Type: Text labels** → choose `subfamily` → **Add ring**.
2. In its options tick **Use the column's category colours** (the shades from `colors.tsv`).
- A label needs about 9 px per leaf, so the ring starts empty. In **Circ** the font grows with the zoom: tick
  **Shrink to the leaf spacing** (or untick **Annotation Tracks → Rings zoom with tree**), then zoom in.

## domains.tsv
**Protein domains**: a backbone as long as `rt length` with shaped, coloured domains. Most cells use the
compact form; the 14 PLE cells use iTOL's form, to show that both can be mixed.
```
id          rt domains                                          rt length
A0A7X7EKK8  RT:21-408;Maturase:430-522;Cas1:556-764:EL:#6a3d9a  788
A0A6P7VJA7  RE|70|439||RT,HH|501|635|darkgreen|GIYYIG,len=705   705
```
1. **+ Add ring…** → **Type: Protein domains** → choose `rt domains` → **Add ring**. **Protein length
   column** is set to `rt length` automatically (a `<x> domains` column pairs with `<x> length`).
- **Domain colours**: one swatch per name; Cas1 and GIYYIG keep their cell colours until you pick another.
- **Scale lines** `auto` (proportional **Length scale** only), or **Length scale: Each protein fills the width**.

## domains_long.tsv
The same ring from a long table: one row per domain hit, as written by hmmscan or InterProScan.
```
id          domain  start  end  evalue   protein_length
A0A369T7D5  RVT_1   18     317  2.2e-11  581
A0A369T7D5  GIIM    333    434  6.2e-21  581
```
1. Hover its chip: *Read as a domain table: 4366 domains for 2309 leaves*. Its columns are now
   `domains_long domains` and `domains_long length`.
2. **+ Add ring…** → **Type: Protein domains** → choose `domains_long domains` → **Add ring**.
- Read this way when ≥ 10 % of rows repeat an id, ≥ 90 % have numeric start/end, and there is a name column
  (`domain`, `family`, `label` …) or only hit columns (`evalue`, `score` …). Optional `color` (hex) / `shape` columns style each hit.
- `evalue` is accepted but not used for filtering: every row is drawn, so remove weak hits beforehand.

## boxplot.tsv
**Box plot**: `activity_replicates` holds six replicates (quartiles are computed; 551 leaves have one failed
replicate); `expression_summary` uses iTOL's 5-number form, optionally followed by extremes.
```
id          activity_replicates            expression_summary
A0A2Z6RKH2  24.1,27.5,26.2,26.7,48.2,28.4  5,14,19,27,37
A0A6A5BYM3  28.3,25.3,24.1,26.0,26.5,27.2  7,12,18,23,39,59,4
```
1. **+ Add ring…** → **Type: Box plot** → choose `activity_replicates` → **Add ring**; repeat with `expression_summary`.
2. **Cell format** is detected: *Samples (compute quartiles)* or *Summary: min, Q1, median, Q3, max[, extremes…]*.
- **Whiskers: 1.5 × IQR (Tukey) + outliers** marks exactly the 551 failed replicates (like `48.2`) once
  leaves are about 7 px apart.
- In the summary form, never leave an entry blank or `NA`: the values after it would shift.

## linechart.tsv
**Line chart**: `temp_profile` is `x:y` pairs (activity % at 20–75 °C); `product_time_course` is a plain y
list (x = 0, 1, 2 …), where 151 leaves miss one point (`NA`, drawn as a gap).
```
id          temp_profile                            product_time_course
A0A6U3JU95  20:0 30:10 37:38 45:95 55:64 65:7 75:0  0,24,43,57,66,75,80
A0A812DKM4  20:2 30:2 37:28 45:86 55:78 65:8 75:4   0,25,43,NA,65,70,76
```
1. **+ Add ring…** → **Type: Line chart** → choose `temp_profile` → **Add ring**; repeat with `product_time_course`.
- Lines need about 2 px per leaf, points and **Lines at X** `37` / **Lines at Y** `50` about 6 px. At some
  in-between zoom levels the ring can be blank, in Rect and Circ (see [Zoom levels](#zoom-levels)).
- **Y range: Per leaf**, **Fill under line**, **Colour by Y** `20|#d62728 60|#f28e2b 1000|#2ca02c`.

## alignment.tsv
**Sequence alignment**: only the 209 DGR reverse transcriptases (189 columns, RT motifs around columns
92–129), so the ring is one short coloured arc.
```
id          rt_alignment
A0A377J340  YNDAIHSVNVTNLRKNRIPKPDGGERPLGIEFPYNPGVHE-----LAQEKKLWDIKGFF…
A0A2L2WMZ8  KQLQLIGVNVDNHLKRRIPKPDGGERPLGILTEGVRWVHE-----LLEVSKIWDIKGFF…
```
1. **+ Add ring…** → **Type: Sequence alignment** → choose `rt_alignment` → **Add ring** (Clustal X colours).
2. To read residues: untick the other rings, **Layout & View → Rect**; **Cell width** `8`, **First column** `80`,
   **Last column** `140`; **Search leaf** `A0A377J340`, Enter; click **+** until letters show.
- **Consensus row**, **Conservation graph**, **Dot highlighting: Against consensus**.

## decorations.tsv
Tree decorations, not a ring. 18 leaf rows (a representative for each of 18 RT classes) style labels and carry a
node symbol; 24 clade rows (`leafA|leafB`) colour clades and carry node symbols and node pies (`pie_*` columns,
not shown); both set branch widths.
```
id             branch_color  branch_width  label_color  label_background  label_style  display_name              node_symbol
A0A5S6Q2M3                   3             non-LTR      highlight         bold         nonLTR-02 representative  characterised
C5K8E4|Q54DH4  non-LTR       2                                                                                   strong_support
```
1. **Tree decorations** (click its header): set **Branch colour**, **Label colour**, **Label background**,
   **Label style (bold/italic)** and **Branch width by** to the matching columns; **Rename labels from**: `display_name`.
2. **Node symbols → Symbol by:** `node_symbol`; under **Node pie charts** tick the five `pie_*` columns.
3. Untick **Show** on the **Annotation Tracks** header, **Layout & View → Rect**, **Search leaf** `A0A5S6Q2M3`,
   Enter, click **+** until leaf labels appear: it reads **nonLTR-02 representative**, bold, in the non-LTR
   colour on a yellow highlight.
- Colours come from `colors.tsv`; a hex colour written in a cell (`#1f77b4`) is drawn as itself.
- Clade rows colour the whole clade; label settings use leaf rows only. **Reset decorations** clears all.

## connections.tsv
Curves between leaves or clades (`A|B`, or iTOL's `A---B`), each with its own colour, width and style.
```
source                   target                 weight  width  color    style   label
A0A4R1D371|A0A1F6W4H6    A0A377J340|A0A1S6HHE2  5              #e15759  dashed  shared_ncrna
A0A377J340---A0A1S6HHE2  A0A0N0UYT8|G0VNL5              1               dashed  default_colour_thin
```
1. Open **Tree decorations → Connections (27 of 27 matched)**: try **Curve** and **Arrowheads at the target**.
- A row's `width` (px) is used as is; otherwise **width** is the base and `weight` scales it 0.5–3× (relative to
  the largest weight). The swatch colours rows without `color`; **opacity** applies to all.
- Needs `source` and `target` columns (or `node1`/`node2`, `leaf1`/`leaf2`); `label` is not drawn; a row whose
  source is its target (`self_loop`) draws a loop.

## clade_ranges.tsv
Names the leaves of 11 RT-class groups (5,893 leaves).
```
id          clade
A0A6U3JU95  non-LTR retrotransposons
A0A377J340  DGRs
```
1. **Coloured Ranges** (click its header) → **From a column**: choose `clade` (keep **min** 2). It finds *15
   clades*: non-LTR retrotransposons and group II introns come in pieces (ignore *Split across the root*).
2. **Add ranges** (one labelled range per clade) or **Collapse**.
- Ranges take the column's category colours at the moment you click: here the class colours of `colors.tsv`.

## Zoom levels
In the full view the 6,734 leaves are under 1 px apart, so rings draw every n-th leaf (**Options → Level of
detail → LOD threshold (px)**, default 1.5); the details below need room. In Rect (other rings hidden): **Search
leaf**, Enter, then click **+** under **Layout & View → Zoom**. Leaf labels appear when leaves are 6 px apart.

| Detail | Shows when leaves are about |
|---|---|
| Binary symbols (Rect) | 1.5 px apart |
| Line-chart lines; points and guide lines | 2 px; 6 px |
| Box-plot whisker caps; outlier marks | 5 px; 7 px |
| Text-ring labels (font size 11); alignment letters (**Cell width** ≥ 7) | 9 px |
| Domain labels (if the name fits its domain) | 15 px |

- Binary and line-chart rings can go blank at some in-between zoom levels; **LOD threshold (px)** `3` keeps
  them drawn at every zoom (the tree gets a little coarser).
- In **Circ** the rings grow with zoom: use the mouse wheel with the pointer on the ring and no node selected
  (a selected node becomes the zoom centre). Leaf labels sit outside all the rings, so read them in Rect.
