# Habit Checklist

Turn a folder of notes into a compact, minimal habit checklist for [Obsidian](https://obsidian.md).

## Habits

Every note in your routines folder becomes a checkbox, grouped into colour-coded sections. Ticking one writes today's date into that note, so your history lives in your vault as plain frontmatter.

## Quick start

1. Install the plugin (see [Installation](#installation)) and put your habit notes in a `Routines` folder.
2. Add the `routines` code block to your daily note, or use the **Insert routines checklist block** command:

````markdown
```routines
```
````

Completion history is stored in your notes' frontmatter.

---

# Reference

Everything below is optional detail — the plugin works out of the box.

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

Each subtask renders as a nested checkbox under the habit. The parent and its subtasks stay in sync both ways:

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

## Settings

- **Routines folder** — the folder holding your routine notes, picked from a dropdown of every folder in the vault (default: `Routines`)
- **Hide routine numbering** — hides checklist indices and leading file or folder numbering such as `1. Meditation` without renaming anything on disk (default: off)
- **Entries property** — frontmatter property updated when an item is checked (default: `entries`)
- **Stored date format** — Moment format used for the date written into `entries` (default: `YYYY-MM-DD`)
- **Subtasks property** — frontmatter property that lists a note's subtasks (default: `subtasks`)
- **Subtask entries property** — frontmatter property where per-subtask completion dates are stored (default: `subtaskEntries`)
- **Reset all tracking data** — after confirmation, permanently removes completion and subtask history from every Markdown file; habit definitions, note content, and plugin settings are preserved

## Installation

### From the Community Plugins browser

Once accepted: Settings → Community plugins → Browse → search for "Habit Checklist".

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/shabbirpatheria/folder-routines/releases).
2. Copy them into `<vault>/.obsidian/plugins/folder-routines/`.
3. Reload Obsidian and enable the plugin under Settings → Community plugins.

## License

[MIT](LICENSE)
