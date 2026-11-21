# One ring, one colour per category, shaded by a number

Use this when each leaf has **a category** (which protein family it scores best for) **and a number** (how strongly: here the % of its RTs that carry it), and you want both in **one ring**: the colour says which family, the shade says how much. iTOL has no dataset for this (its gradient and heatmap datasets share a single colour pair), so in myTOL it is a categorical ring with **Shade by number**.

The data are synthetic (invented on the example tree `example/RTtree.nwk`, tied loosely to the RT classes), but the layout is the one a real analysis produces: 941 leaves, the others blank.

| File | What it is |
|---|---|
| `family_shading.tsv` | `id`, `ligase_family` (category), `ligase_pct` (number, 0–100), `ligase_tied_families` (category, see Ties). One row per coloured leaf; leaves with no hit are simply absent (blank = nothing drawn). |
| `family_shading_colors.tsv` | Colour key (`column`, `value`, `color`): the **full-strength** colour of each family. |

## Load it
1. **Load → Load example data** (tree + `RTtreelabels.csv`), then **Layout & View → Circ** and zoom out.
2. **Annotations → Add files…**: select `family_shading.tsv` **and** `family_shading_colors.tsv` (the key is applied when it is loaded with the data). You get three new rings: `ligase_family`, `ligase_pct` (bars) and `ligase_tied_families`.
3. **Annotation Tracks → `ligase_family` → Style ▾ → Shade by number** = `ligase_pct`. Each family now shows `low swatch → gradient → family colour`.
4. Optional: pin the scale with **Min** `0` and **Max** `100`. Here the automatic range is already 0–100 (a linear scale starts at 0 and some leaves reach 100), but pinning keeps "light" and "dark" meaning the same % if you later load a file whose maximum is lower.
5. Optional: **Low colour for all** from white to a pale grey (white fades into the page at low values), or change one family's low swatch.
6. Untick the `ligase_pct` ring: its own bars disappear, the shading stays. `ligase_tied_families` can stay on as a thin ring.

The legend draws each family as a small gradient with the note "shaded by ligase_pct: 0 – 100".

## Ties
When two or more families reach the same maximum (domains of one protein architecture always do), one ring can only show one of them. The ring shows a single winner and `ligase_tied_families` lists the full tied set (`A+B+C`). In this example the rarer family wins (a tie of `DNA_ligase_aden` and `OB_DNA_ligase` shows as `OB_DNA_ligase`), which separates architectures that share a common domain; the tied set tells you what the colour stands for. Use **Find by annotation** on `ligase_tied_families` to select one architecture.

## Making your own
Write a TSV with an `id` column, a category column and a numeric column (blank, not `NA`, for missing values), plus a colour key whose `column` equals the category column's header. For the RT atlas this table is produced by `scripts/114_itol_family_gradient_ring.py` (ring = max over the families of the % of a leaf's viable RTs carrying it; ties resolved by `--tie rare|first`).
