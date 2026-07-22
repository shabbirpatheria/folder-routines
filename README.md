# Habit Checklist

An [Obsidian](https://obsidian.md) plugin that turns a folder of routine notes into an interactive, retro **16-bit RPG-style** habit checklist and stats screen. Checking an item off logs the daily note's date into that routine note — and a companion stats board visualizes your consistency like a JRPG character screen.

## How it works

Point the plugin at a root folder (default: `Routines`). Each subfolder becomes a collapsible section, and each note inside becomes a checklist item:

```
Routines/
├── Fitness/
│   ├── Gym.md
│   └── Protein goal.md
└── Work/
    └── Inbox zero.md
```

Add a code block to your daily note (or use the **Insert routines checklist block** command):

````markdown
```routines
```
````

This renders a collapsible **Habits** checklist with **Fitness** and **Work** sections. When you check **Gym** in a daily note dated `2026-06-25`, that date is appended to the `entries` frontmatter property of `Fitness/Gym.md`:

```yaml
---
entries:
  - 2026-06-25
---
```

Unchecking removes the date. Checked items are shown with a strikethrough.

### Subtasks

A routine note can break a habit into subtasks by adding a `subtasks` list to its frontmatter:

```yaml
---
subtasks:
  - Warm up
  - Main set
  - Cool down
---
```

Each subtask renders as a nested checkbox under the habit, connected with pixel tree connectors (`├──` / `└──`). The parent and its subtasks stay in sync both ways:

- Checking **every** subtask automatically checks the parent and logs the daily note's date into `entries`.
- Unchecking any subtask automatically unchecks the parent and removes that date.
- Checking or unchecking the parent toggles **all** subtasks at once.
- If a note already has `entries` dates from before it had subtasks, those dates are automatically backfilled into every subtask on render, so the parent stays consistent.

Per-subtask completion is stored in a plugin-managed `subtaskEntries` property so it survives reloads:

```yaml
---
subtasks:
  - Warm up
  - Main set
subtaskEntries:
  Warm up:
    - 2026-06-25
  Main set:
    - 2026-06-25
entries:
  - 2026-06-25
---
```

Notes without a `subtasks` property behave exactly as before — a single checkbox.

## Stats board

Add a stats screen to **any** note with the `routine-stats` code block (or use the **Insert routine stats board** command):

````markdown
```routine-stats
```
````

This renders a retro RPG **character-stats screen** with one board per folder/section, showing the last **21 days**:

- **Header** — category banner, section title, level (`LV.n`), current streak, and a rank badge (S/A/B/C/D/E).
- **Quick stats** — best streak, current streak, completion %, and earned XP.
- **Completion HUD** — a block-based HP/XP-style progress bar.
- **Heatmap** — routines × days grid; completed days are filled in the section's color, grouped by week with per-row totals.
- **Weekly milestones** — star ratings and rank per week, with a special *Perfect Week* state.
- **Trend** — a pixel sparkline of daily completions.
- **Lifetime stats** — best streak, success rate, missed days, and XP gained.
- **Achievements** — collectible pixel badges (First Clear, 7-Day Streak, Perfect Day, Perfect Week, 100% Complete).

**Click any cell** in the heatmap to add or remove a completion for that routine on that day — it writes to the same `entries` (and fans out to subtasks) exactly like the checklist, and the board updates live.

## Features

- Checklist generated automatically from a folder structure
- Section headers derived from subfolder names
- Collapsible sections, plus a top-level **Habits** toggle to collapse the whole block
- Retro 16-bit RPG-style UI with pixel windows, bevels, and light/dark theming
- Section colors assigned by order (Blue, Amber, Green, Red, Purple), cycling and restarting per parent section
- Live per-section progress bars and completion counts
- Checking an item writes the daily note's date into that note's `entries` property; unchecking removes it
- Optional nested subtasks with pixel tree connectors: completing all subtasks completes the parent, and toggling the parent toggles all subtasks
- `routine-stats` board: per-folder heatmap, streaks, levels, ranks, XP, weekly milestones, trend, and achievements
- Clickable heatmap cells to log/remove completions directly from the stats board
- The daily note's date is parsed from its filename using your Daily Notes / Periodic Notes format

## Settings

- **Routines folder** — vault-relative path to the root folder (default: `Routines`)
- **Entries property** — frontmatter property updated when an item is checked (default: `entries`)
- **Stored date format** — Moment format used for the date written into `entries` (default: `YYYY-MM-DD`)
- **Subtasks property** — frontmatter property that lists a note's subtasks (default: `subtasks`)
- **Subtask entries property** — frontmatter property where per-subtask completion dates are stored (default: `subtaskEntries`)

## Installation

### From the Community Plugins browser

Once accepted: Settings → Community plugins → Browse → search for "Habit Checklist".

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/shabbirpatheria/folder-routines/releases).
2. Copy them into `<vault>/.obsidian/plugins/folder-routines/`.
3. Reload Obsidian and enable the plugin under Settings → Community plugins.

## License

[MIT](LICENSE)
