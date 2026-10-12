# Example data

| File | What it is |
|------|------------|
| `RTtree.nwk` | Reverse-transcriptase tree, 6,734 leaves named by UniProt accession (e.g. `A0A6U3JU95`), support values on internal nodes. |
| `RTtreelabels.csv` | Original table: `id`, `label` (RT class), `randomnumber`, `organism`, `UGness`; 6,723 rows (11 leaves missing). Loaded by **Load example data**. |
| `annotations_example.tsv` | One row per leaf (6,734 rows) with nine columns that cover every ring style. See [Columns](#columns). |

`organism` in `RTtreelabels.csv` is a coarse flag (`eukaryote` only for `LTR/Retroviral/YR`, `bacterial` for every other class, non-LTR and TERT included), so it disagrees with `host_group` below.

In `annotations_example.tsv`, only `id` and `rt_class` (a copy of `label` from `RTtreelabels.csv`) are real data. All other values are synthetic. They were simulated along the tree's branches and tied to the RT class, so the rings show clade-level blocks. Don't use them for biology.

The file starts like this (tab-separated):

```text
id	rt_class	clade_id	host_group	protein_length	copies_per_genome	gc_content	expression_log2fc	domain_type	domain_count
A0A6U3JU95	non-LTR	1	Plants	1201	30	0.39	-0.75	RT-EN	26
A0A6A5BYM3	non-LTR	1	Plants	1265	90	0.39	-0.08	RT-EN	40
```

## File format

- **Leaf names:** the first column named `id` or `name` (any case, no extra spaces) holds the leaf names, spelled exactly as in the tree. Use only one such column. If no file chip appears after loading, the header has no `id`/`name` column (the error shows only in the browser console).
- **Rings:** every other column becomes a ring named after its header. You can rename a ring later in **Annotation Tracks**; the legend, **Find by annotation** and the export use the new name, but the hover tooltip keeps the original header.
- **Separator:** the file extension decides it. `.tsv` is split on tabs and `.csv` on commas. A tab-separated file named `.csv` won't split.
- **Missing values:** leave the cell completely empty (no spaces). An empty cell draws nothing in that ring and shows `N/A` in the hover tooltip. For categorical rings, **Find by annotation** lists it as *(no value)*.
- **Numbers vs categories:** a column is **Continuous** when every non-empty cell is a number (`12`, `0.5`, `-3.2`, `1e4`). A single text cell (`NA`, `n/a`, `>5`, or `0,5` with a decimal comma) makes the whole column **Categorical**, so leave missing numbers blank rather than writing `NA`. You can override the type at any time with the ring's **Categorical / Continuous** dropdown.
- **Ids that aren't leaves:** those rows are not drawn, but they still count when the app decides number vs category, sets the automatic Min/Max and fills the category list under **Style ▾**. The legend and **Find by annotation** count only leaves on the tree.
- **Several files:** rows are merged by id. If two files share a column, the later file's cell wins for every id it lists, even when that cell is blank.
- **Colours:** a new category gets a default colour from a 20-colour set, chosen by hashing its name, so two categories can share a colour. Palettes have 8–12 colours and repeat when a ring has more categories. Recolour the categories you care about by hand.

## Load it

1. Open **Load** and click **Load example data** to get `RTtree.nwk` and `RTtreelabels.csv`. This replaces any annotation files already loaded and clears coloured ranges, collapsed nodes and deleted columns. It does not unhide leaves; use **Layout & View → Unhide all (N)** for that (**Reset tree** also unhides them, but resets collapsed nodes, ranges and the view too).
2. Under **Annotations (CSV/TSV)**, click **Add files…** and pick `annotations_example.tsv`. Dropping the file onto the canvas also works.
   - To see only the new columns, click **×** on the `RTtreelabels.csv` chip. To get it back, click **Add files…** and pick `example/RTtreelabels.csv`.
3. Under **Layout & View**, click **Circ** to wrap the rings around the tree, then click **–** under **Zoom** two or three times (or scroll out) until the outer rings are on screen.
4. Open **Annotation Tracks**, near the bottom of the panel between **Support colouring** and **Legend**. Each ring row has:
   - on the left, the **⠿** drag handle
   - in the middle, the editable name, with the **Categorical / Continuous** dropdown, height (px) and **Style ▾** (the ring's style box) below it (they wrap onto two lines at the default panel width; drag the panel's right edge to widen it)
   - on the right, the visibility checkbox

## Columns

| Column | Detected as | Values | Shows |
|--------|-------------|--------|-------|
| `rt_class` | Categorical | 22 RT classes, 396 blank | categories, legend, search, copy/paste style |
| `clade_id` | Continuous | 1–10, 132 blank | integers that are really categories |
| `host_group` | Categorical | 9 groups (5 bacterial, 4 eukaryotic) | palettes, editing colours, eyedropper |
| `protein_length` | Continuous | 242–1844 (aa) | bars, bar colour, min/max |
| `copies_per_genome` | Continuous | 1–56,700 | log scale, log base |
| `gc_content` | Continuous | 0.29–0.77 | colour gradient, presets, custom stops |
| `expression_log2fc` | Continuous | −5.07 to 3.76 | diverging gradient centred on 0 |
| `domain_type` | Categorical | 5 domain architectures | per-category shading (with `domain_count`) |
| `domain_count` | Continuous | 1–50 | the number that shades `domain_type` |

The columns are listed in file order. Rings are drawn from the tree outward in the order of the ring list, and new columns join the end of that list in file order. With both files loaded, the four `RTtreelabels.csv` rings therefore come first, closest to the tree. Most columns have a few blank cells, so you can see what missing values look like; `domain_type` and `domain_count` have none.

### `rt_class`: categories, legend and search

1. Click **Style ▾** on `rt_class`. Choose a **Palette** (Tableau 10, Set1, Set2, Dark2, Paired or Pastel) and click **Apply**. Palettes have 8–12 colours for 22 classes, so colours repeat; **Paired** (12) repeats least.
2. To recolour a class, click its swatch in the category list. Do this for the classes you care about: even the default colours repeat (`retron` and `DGRs` are both orange).
3. Open **Legend**. **Show** is ticked by default, so the legend is already on the canvas, with one section per visible ring.
   - With both files loaded the legend has 13 sections and runs off the bottom of the canvas. Under **Sections & items**, untick `label`, `randomnumber`, `organism` and `UGness` (or remove the `RTtreelabels.csv` chip, Load step 2), then set **Columns** to `3`. The legend is then under 700 px tall. If it is still cut off, untick more sections or lower **Font size**.
   - On the canvas: drag the legend to move it, double-click any text to rename it (the box also has **Hide**), and click a swatch to recolour it.
   - In the panel: drag **⠿** to reorder sections, untick a section to leave it out, and click **▸** to reorder or hide single items. **Restore hidden entries (N)** brings hidden items back.
   - **Only categories present in the tree** (ticked by default) leaves out classes that have no leaves left after you hide some.
4. Open **Find by annotation**, choose `rt_class` and tick `retron`. 226 leaves match.
   - The **Filter … values…** box shortens the list. **Tick all** (**Tick listed** while the filter has text) and **Untick all** tick every listed value or none. Tick *(no value)* to find the 396 leaves that have no class.
   - **Invert (match everything else)** matches every leaf except these.
   - Matches are marked with dots (**Highlight on tree**, dot colour, **Dot size**). Step through them with **◀ ▶**.
   - Then use **Select clade**, **Copy**, **Save**, **Hide matches**, **Show only** or **Clear**. **Hide matches** and **Show only** remove leaves from the tree; undo with **Layout & View → Unhide all (N)**.
5. Hover over an internal node. The **Clade statistics** box lists the top values of each visible categorical ring. Percentages count only leaves with a value; tick **Options → Clade % includes unlabelled leaves** to count every leaf.

### `clade_id`: numbers that are categories

1. All values are integers, so the column loads as **Continuous** (bars).
2. Set its dropdown to **Categorical**. You get 10 categories and 10 legend entries, and the app keeps your choice when files change.
3. Click **Style ▾** on `clade_id`, choose Palette **Tableau 10** and click **Apply**. It has 10 colours for the 10 clades, so each gets its own clear colour. (By default clades 4 and 10 get near-identical pinks and clade 8 a pale yellow.)
   - Categories and legend entries follow the order in which values first appear in the merged rows: 1–10 with the TSV alone, but 7, 9, 8, 6, 4, 5, 3, 10, 2, 1 with both files (the merged rows follow `RTtreelabels.csv`). To sort the legend, open **Legend**, click **▸** on `clade_id` and drag the items.
4. Under **Annotation Tracks**, set **Default range colour source:** to `clade_id` (it lists only categorical rings). Click a node and press **C**. The **Add New Range** box opens in the side panel (below **Find by annotation**; scroll down if you don't see it), filled in with the colour and name of the most common `clade_id` in that clade. Press Enter or click **Confirm**.
5. The 132 blank leaves fall outside the 10 clades, which have 87–1,299 leaves each.

### `host_group`: palettes and editing colours

1. Click **Style ▾**, choose Palette **Tableau 10** and click **Apply**. It has 10 colours for the 9 groups, so each group gets its own colour. (Set1, Set2 and Dark2 have only 8, so the 9th group would repeat the first. Before you apply a palette, the default colours of Actinobacteria and Fungi match, and so do those of Bacteroidetes and Protists.)
2. Click a group's swatch to open the colour box. You can enter a colour in three ways:
   - type a hex code
   - drag in the picker
   - use **⌖ Pick from screen**. In Chrome and Edge this samples any pixel on screen. Other browsers open the system colour picker; on macOS it has its own eyedropper.
3. Try colouring the bacterial groups in blues and the eukaryotic groups in reds. The clade blocks stand out.

### `protein_length`: bars

1. Continuous columns are drawn as bars by default (**Display: Bar**, 20 px high).
2. Under **Style ▾**, click the **Bar colour** swatch to change the colour.
3. **Min / Max:** a blank field means automatic and shows its value, e.g. `auto (0)` / `auto (1844)`. Type `200` and `1800`, then press Enter. Values outside the range are clamped.

### `copies_per_genome`: log scale

1. On a **Linear** scale almost every bar is invisible: 90% of the values are below 600, but the maximum is 56,700.
2. Set **Scale** to **Log**. The automatic range snaps to whole powers of the base: 1 – 100000. The legend adds a "log₁₀ scale" note and labels both ends plus the powers that fit between them (for example 1, 10, 100 and 100000); labels that would overlap are left out, so which ones show depends on the font. Leaves with no bar are mostly single-copy RTs, not blanks (step 4).
3. **Log base** (shown once **Scale** is **Log**): click **2**, **e** or **10**, or type any number above 1. With base 2 the range becomes 1 – 2¹⁶ (65536). The **Max** field and the legend round numbers to 4 significant digits, so they show `65540`. The legend then labels the ends and whichever powers of 2 fit between them.
4. 1,806 leaves (27%) have the value 1: nearly all retrons, DGRs and TERTs, and most UG RTs. Value 1 is the bottom of the automatic log range, so these leaves get no bar. Type `0.1` in **Min** to give them a short bar; clear the field to go back to automatic.
5. The log scale also works with **Colour gradient**. There, value 1 gets the gradient's low colour, while blank cells stay empty.
6. In **Find by annotation**, choose `copies_per_genome` and set **≥** `1000`. 434 high-copy leaves match. The operator list also has **between**, which takes two values.

### `gc_content`: colour gradient

1. Under **Style ▾**, set **Display** to **Colour gradient**. The default gradient is Viridis.
2. **Preset:** pick from **Choose a gradient…**, e.g. **Yellow–Orange–Red**. **⇄** reverses the gradient.
3. **Stops:**
   - Click a stop swatch to edit it; the colour box includes the eyedropper.
   - **+** adds a stop by copying the last one.
   - **−** removes the last stop.
4. A linear scale starts at 0 for positive data, so the automatic range is 0 – 0.77. Set **Min** `0.3` and **Max** `0.75` to use the whole gradient.

### `expression_log2fc`: diverging gradient

1. Set **Display** to **Colour gradient**, then choose Preset **Red–Blue (diverging)**.
2. Click **⇄** so negative values are blue and positive values are red.
3. Set **Min** `-5` and **Max** `5` so that 0 sits in the middle. The automatic range, −5.07 to 3.76, would not be centred.

### `domain_type` + `domain_count`: per-category shading

This setup draws one category from white to blue and another from white to red, each shaded by a number. The five domain types start in five different colours: `RT-solo` (RT domain alone) grey, `RT-RNaseH` orange, `RT-EN` green, `RT-maturase` lavender and `RT-Cas1` coral.

1. Click **Style ▾** on `domain_type`, then set **Shade by number** to `domain_count`.
2. Each category now shows a low swatch (white by default), a gradient chip and a high swatch (the category colour).
   - Click the high swatch of `RT-RNaseH` and set it to blue (`#08519c`).
   - Click the high swatch of `RT-EN` and set it to red (`#a50f15`).
   - The other three keep their colours. Give `RT-Cas1` another hue if its coral looks too close to the red.
3. Optional settings:
   - Change a low swatch per category, or use **Low colour for all**.
   - **Scale** (Linear / Log), **Min / Max** and, with Log, **Log base** apply to `domain_count`. The automatic range is 0 – 50.
4. The legend draws each category as a small gradient, with the note "shaded by domain_count: 0 – 50".
5. Untick the `domain_count` ring to hide its own bars; the shading keeps working. If you **Delete column** `domain_count`, the shading switches off; **Restore** brings it back.

Within each domain type, `domain_count` spans roughly 1–50, so every type shows its full gradient. A leaf with no `domain_count` would be drawn in the low colour.

## Any ring

| Task | Where | How |
|------|-------|-----|
| Space after a ring | **Style ▾** | **Gap after** (px, default 2) |
| Outline | **Style ▾** | Tick **Border**, then set the colour swatch and width (px) |
| Copy a style | **Style ▾** | **Copy style** on one ring, then **Paste style (name)** on another ring of the same type |
| Delete / restore | **Style ▾** | **Delete column**. The list below the rings then shows **Deleted: …** and **Restore**, which brings back every deleted column with its style, at the end of the ring list. |
| Reorder | ring row | Drag **⠿**, or focus it and press ↑ / ↓ |
| Hide without a gap | ring row | Untick the ring's checkbox |
| Hide all rings | **Annotation Tracks** header | Untick **Show** |
| Ring position | **Annotation Tracks** | **Offset (px)** moves the rings out. Untick **Rings zoom with tree** to keep a fixed on-screen width and use **Auto / Manual**. |

**Copy style example:** with both files loaded, recolour `rt_class` and click **Copy style**. Then open **Style ▾** on `label` (from `RTtreelabels.csv`) and click **Paste style (rt_class)**. The two rings now match.

- Categorical rings: categories with the same name take the source colour, the others take the remaining source colours, and shading comes along.
- Continuous rings: display mode, colours and scale are copied; the target keeps its own Min/Max.
- Gap and border are copied for both types.

## Also available

- **Options → LOD threshold (px)** (default 1.5) thins rings and skips small clades at full view of this 6,734-leaf tree. Set it to 0 to draw every leaf (slower).
- **Options → Annotation bar fill** above 1 overlaps bars slightly to close gaps.
- **Legend:** **Title**, **Font size**, **Columns**, **Background box**. **Reset position** works once you have dragged the legend; **Reset order** and **Reset renamed text** appear once you have reordered or renamed something.
- **Support colouring → On** (the default) colours branches by support value. Tick **Branch support** in **Legend** to add its key.
- **Coloured Ranges:** **Background** or **Colour branches**. A selected node's panel has **Colour Range (C)**.
- Drag the side panel's right edge to widen it; double-click the edge to reset.

## Save your work

- **Export → Export PNG** saves the canvas as shown on screen (the 1×–16× buttons scale the bitmap up; they don't add detail, so use SVG for print). **Export SVG** writes a vector file with the tree, rings, ring borders and legend, which suits a figure.
- **Export → Annotations:** choose **TSV** or **CSV**, tick **Visible rings only** if you want, then click **Export annotations**. The file `annotations.tsv` (or `.csv`) has one row per leaf on the tree that has annotations; hidden leaves are left out. Columns follow ring order, deleted columns are left out, and headers use the ring names. The result can be loaded straight back in.
- **Load → Save session:** writes `tree-session.json`, which holds:
  - the tree and annotation data (deleted columns are not saved, so **Restore** has nothing to bring back after **Load session**)
  - every ring, colour and legend setting
  - the view, hidden and collapsed nodes, ranges and search

  **Load session** restores all of it.
