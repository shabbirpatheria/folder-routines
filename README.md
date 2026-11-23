# Habit Checklist

Turn a folder of notes into a compact, minimal habit checklist for [Obsidian](https://obsidian.md).

Habit Checklist is a companion to the [Habit Tracker 21](https://github.com/zoreet/habit-tracker) plugin. Both read and write the same `entries` list of `YYYY-MM-DD` dates in your habit notes: tick habits off in your daily note with Habit Checklist, and view the streak history with Habit Tracker 21. Point both plugins at the same folder and no extra setup is needed.

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

Point the plugin at a root folder (default: `Routines`). Each subfolder becomes a collapsible section, collapsed until you click its heading, and each note inside becomes a checklist item:

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

This renders a collapsible **Habits** checklist with **Fitness** and **Work** sections. On a wide pane (600px or more) the sections are laid out in two columns, read top to bottom and then left to right; narrower panes and phones show a single column. When you check **Gym** in a daily note dated `2026-06-25`, that date is appended to the `entries` frontmatter property of `Fitness/Gym.md`:

```yaml
---
entries:
  - 2026-06-25
---
```

Unchecking removes the date. Checked items are shown with a strikethrough.

A habit can show its current streak next to its name, such as 🔥 12: the number of consecutive days in `entries` up to the daily note's date. Streaks are opt-in per habit; add `showStreak: true` to the habit note's frontmatter to turn one on. Until the habit is ticked that day, the streak is shown very faded with the streak so far, ending the day before: 0 if the habit was missed yesterday, 1 if it was done yesterday but not the day before. Ticking the habit adds the day and shows the streak at full strength. Nothing is shown when `showStreak` is false or missing. Subtasks don't show a streak; a habit with subtasks counts the days its parent was complete.

The checklist stays in step with your habit notes: if a note changes after the daily note is open — for example when Obsidian Sync brings in habits you ticked on your phone — the checkboxes, progress and streaks update in place, without reopening the note.

This is the same format that Habit Tracker 21 reads, so a `habittracker` code block pointed at your routines folder will chart the dates written here.

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

### Day navigation

Above the checklist, arrow buttons link to the previous and next day's notes; clicking one opens it in the same tab (Cmd/Ctrl-click opens a new tab). A button only appears when that day's note exists: on `2026-10-16` with no note for the 17th yet, you get just a button to `2026-10-15`; on `2026-10-15` you get buttons to both `2026-10-14` and `2026-10-16`. Daily notes are recognised by their filename, using the date format from the Daily notes or Periodic Notes plugin.

## Settings

- **Routines folder** — the folder holding your routine notes (default: `Routines`)
- **Hide routine numbering** — hides checklist indices and leading file or folder numbering such as `1. Meditation` without renaming anything on disk (default: off)
- **Entries property** — frontmatter property updated when an item is checked (default: `entries`)
- **Stored date format** — Moment format used for the date written into `entries` (default: `YYYY-MM-DD`)
- **Subtasks property** — frontmatter property that lists a note's subtasks (default: `subtasks`)
- **Subtask entries property** — frontmatter property where per-subtask completion dates are stored (default: `subtaskEntries`)
- **Reset habit data** — removes the entries and subtask entries properties from every habit note in the routines folder, after a confirmation. Subtask lists and other properties are kept. This cannot be undone.

## Installation

### From the Community Plugins browser

Once accepted: Settings → Community plugins → Browse → search for "Habit Checklist".

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](https://github.com/shabbirpatheria/folder-routines/releases).
2. Copy them into `<vault>/.obsidian/plugins/folder-routines/`.
3. Reload Obsidian and enable the plugin under Settings → Community plugins.

## License

[MIT](LICENSE)
