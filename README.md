# Habit Checklist

An [Obsidian](https://obsidian.md) plugin that renders an interactive checklist in your daily note from a folder structure, and logs the daily note's date into each routine note when you check it off.

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

## Features

- Checklist generated automatically from a folder structure
- Section headers derived from subfolder names
- Collapsible sections, plus a top-level **Habits** toggle to collapse the whole block
- Checking an item writes the daily note's date into that note's `entries` property; unchecking removes it
- Optional nested subtasks: completing all subtasks completes the parent, and toggling the parent toggles all subtasks
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
