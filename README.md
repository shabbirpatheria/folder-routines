# Folder Routines

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

## Features

- Checklist generated automatically from a folder structure
- Section headers derived from subfolder names
- Collapsible sections, plus a top-level **Habits** toggle to collapse the whole block
- Checking an item writes the daily note's date into that note's `entries` property; unchecking removes it
- The daily note's date is parsed from its filename using your Daily Notes / Periodic Notes format

## Settings

- **Routines folder** — vault-relative path to the root folder (default: `Routines`)
- **Entries property** — frontmatter property updated when an item is checked (default: `entries`)
- **Stored date format** — Moment format used for the date written into `entries` (default: `YYYY-MM-DD`)

## Installation

### From the Community Plugins browser

Once accepted: Settings → Community plugins → Browse → search for "Folder Routines".

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/shabbirpatheria/folder-routines/releases).
2. Copy them into `<vault>/.obsidian/plugins/folder-routines/`.
3. Reload Obsidian and enable the plugin under Settings → Community plugins.

## License

[MIT](LICENSE)
