# myTOL: my Tree Of Life

**myTOL** is a fast, browser-based phylogenetic tree viewer. Load a Newick tree, optionally overlay a CSV annotation file, and explore your data interactively, with pan, zoom, colouring, and export built in. All data stays local.

**myTOL** is inspired by iTOL, but is performant with very large trees. I've tested it with 500k leaves, but it should work with more. This is achieved with "Level of Detail" (LOD) thinning - leaves are hidden when they become smaller than a pixel when you zoom out.

Find it here! **https://mytol.wilkinsonlab.bio/**

Or, install it locally, see below for instructions.

I obviously could not have coded this by myself. This was created by passing the code between Gemini and chatGPT until it finally worked (with a LOT of prompting and manual intervention, it must be said). The code was then finalised using Claude Code. Claude then wrote most of this README. I tried to get rid of the AI-ese, but some residue may remain.

![myTOL screenshot](treepic.png)

---

## Features

- **Three layout modes**: rectangular (phylogram/cladogram), circular, and unrooted equal-angle
- **Annotation tracks**: load a CSV file to display categorical or continuous data bars alongside leaves
- **Coloured ranges**: select any clade and assign it a colour, display as background shading or branch/leaf colouring
- **Support value display**: colour branches by bootstrap/posterior support, optionally show numeric labels
- **Search**: find and jump to any leaf by name
- **Export**: PNG and SVG, the SVG files should hopefully be handled nicely by Illustrator.

Added in this fork (`updates` branch):

- **Load several CSV/TSV files at once**, drag rings into any order, hide rings without leaving a gap
- **Continuous colouring**: gradient presets or custom stops, eyedropper, bar colour, min/max, log scale (any base)
- **Per-category shading**: shade each category of a ring by a numeric column (e.g. type A white→blue, type B white→red)
- **Find by annotation**: select leaves by value; on-canvas legend with drag-to-reorder sections and items
- **Ring borders and gaps**, copy/paste ring styles, delete/restore columns, export the annotations on the tree
- **Sessions**: save/load everything (data, view, filters, selection, legend, styles) as one JSON file
- **Several support values per node** (IQ-TREE `SH-aLRT/aBayes/UFBoot`): pick which one colours and labels branches
- **Resizable side panel**: drag its right edge
- **Coloured ranges**: opacity, extend past the edge and rounded corners; colour or collapse every clade of a column at once (split groups give one clade per piece); one clean shape per range in the SVG
- **Branch colour** option

---

## Try it with the example data

The `example/` folder contains a ready-to-use tree and annotation file, adapted from [this preprint](https://www.biorxiv.org/content/10.1101/2025.10.16.682844v1) from the Sternberg lab. It's of reverse transcriptases and includes protein length* (continuous data) and RT class (categorical data) 

**Correction, it's just a random integer for demonstration purposes*

| File | Description |
|------|-------------|
| `example/RTtree.nwk` | Example phylogenetic tree in Newick format |
| `example/RTtreelabels.csv` | Annotation table (leaf names in the `id` column) |
| `example/annotations_example.tsv` | Richer table showing gradients, log scale and per-category shading |

Drag and drop `RTtree.nwk` onto the canvas, then drag `RTtreelabels.csv` onto the canvas to add annotations (or click **Load example data**). [`example/README.md`](example/README.md) walks through every column of `annotations_example.tsv` and how to set it up.

---

## Installation

myTOL runs locally in your browser. You only need to do this setup once.

### Step 1: Install Node.js

Node.js is free software that lets you run web apps locally.

- Go to **https://nodejs.org** and download the **LTS** version (the big green button)
- Run the installer and follow the prompts, the defaults are fine
- When it's done, restart your computer if prompted

### Step 2: Download myTOL

**Option A: Download as a ZIP (simplest):**

1. On the GitHub page, click the green **Code** button → **Download ZIP**
2. Unzip the downloaded file somewhere you can find it (e.g. your Desktop or Documents)

**Option B: Clone with Git (if you have Git installed):**

```
git clone https://github.com/YOUR_USERNAME/mytol.git
```

### Step 3: Open a Terminal

- **Mac:** Press `Command + Space`, type `Terminal`, press Enter
- **Windows:** Press the Windows key, type `cmd` or `PowerShell`, press Enter

### Step 4: Navigate to the myTOL folder

In the terminal, type `cd ` (with a space after it), then drag the myTOL folder into the terminal window, it will fill in the path automatically. Press Enter.

Or type the path manually, e.g.:
```
cd Desktop/mytol
```

### Step 5: Install dependencies

Type this and press Enter (only needed once):
```
npm install
```
This downloads the libraries myTOL needs. It may take a minute.

### Step 6: Start the app

```
npm run dev
```

You should see a message like:
```
 VITE v5.x ready in 300ms
 ➜ Local:  http://localhost:5173/
```

Open your browser and go to **http://localhost:5173**: myTOL will be running.

To stop it, go back to the terminal and press `Ctrl + C`.

### Step 7 (optional): start it with one word

On macOS (zsh), add an alias to `~/.zshrc` so you can start myTOL from any folder by typing `mytol`. Adjust the path to wherever you cloned it:

```zsh
alias mytol='(cd ~/Packages/mytol && npm run dev)'
```

Reload your shell with `source ~/.zshrc` (or open a new terminal), then type `mytol` and open **http://localhost:5173**.

To also run the `reboot_itol` branch (iTOL-style rings: heatmaps, domains, alignments…) side by side, clone it into its own folder and give it its own command on a neighbouring port:

```zsh
git clone -b reboot_itol https://github.com/gdlampe/mytol.git ~/Packages/mitol
(cd ~/Packages/mitol && npm ci)
# in ~/.zshrc:
alias mitol='(cd ~/Packages/mitol && npm run dev -- --port 5174 --strictPort)'
```

`mitol` then serves **http://localhost:5174**. The two run at the same time, and since they are different addresses, the browser keeps their saved settings separate.

---

## Usage

### Loading data

- **Drag and drop** a `.nwk` / `.newick` file onto the canvas to load a tree
- **Drag and drop** a `.csv` or `.tsv` file onto the canvas to load annotations
- Or use the **Load** panel on the left

### Annotation CSV format

One column named `id` or `name` holds the leaf names (matching the tree exactly). Each other column becomes an annotation track. Use `.csv` (comma) or `.tsv` (tab); blank cells are missing values. You can load several files at once.

```
name,habitat,score
Species_A,forest,0.92
Species_B,grassland,0.45
...
```

See [`example/README.md`](example/README.md) for a worked example of every ring style.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `+` / `-` | Zoom in / out |
| `F` | Fit tree to window |
| `R` | Reroot at selected node |
| `C` | Add selected clade as a coloured range |
| `Enter` | Confirm colour range |
| `Esc` | Deselect |

### Newick support values

Bootstrap or posterior support values are displayed if internal nodes have numeric names, e.g.:

```
((A:0.1,B:0.2)0.95:0.3,(C:0.1,D:0.2)0.72:0.1)0.88;
```

Enable **Show support values on branches** in the Options panel to display numeric labels.

Labels with several values separated by `/` are read too. IQ-TREE writes one per test, e.g. `92.7/0.995/93` = SH-aLRT / aBayes / UFBoot. Under **Support colouring**, **Colour by** picks the value that colours and labels the branches (default: the last, UFBoot); the names are guessed and can be edited, and **Branch labels show all values** prints the whole label.

---

## Browser compatibility

Any modern browser works: Chrome, Firefox, Safari, Edge. A recent version (2022 or newer) is recommended for best canvas performance.

---

## Licence

MIT: free to use, modify, and share.
