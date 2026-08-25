# Topic Field — Design

## Context

Part of a larger set of changes to Enceladus (three independent sub-projects, each
with its own design → plan → implementation cycle). Feature 1 (Priority Quadrants)
already shipped. This document covers feature 2:

1. ~~Priority Quadrants~~ — done.
2. **Topic field** (this document) — replace the multi-value `labels` field with a
   single-select `topic` field, positioned between Due and Name.
3. Description rich-text popup editor — not yet designed.

Working rules for this whole effort (see `CLAUDE.md`):
- No code changes until the user has explicitly agreed to the plan.
- No architecture teardown without agreement — local, incremental changes only.
- Any data format change must stay backward compatible with older `tasks.json`
  files and convert them to the new format on first open.

## Problem

The user doesn't use multi-label tagging in practice — one label per task is
enough, and the current label-chip UI (small font, double padding from the cell
padding plus the chip's own padding) is hard to read. They want a single-select
"Topic" field instead: a search-as-you-type combobox that can also create new
values on the fly, positioned between the Due and Name columns, with dynamic
per-topic colour coding.

## Data Model

Remove `labels` entirely. Add:

```json
{ "topic": "Private" }
```

`topic` is a plain string, `''` when unset. `newTask()` / draft defaults:
`topic: ''`.

## Migration (`TaskStore.load`)

Runs **after** the existing `tag` → `labels` migration (so it can rely on
`task.labels` already being a normalized array by the time it runs), and only
when `task.topic` isn't already a string:

```js
if (typeof task.topic !== 'string') {
  const labels = Array.isArray(task.labels) ? task.labels : [];
  const privateLabel = labels.find(l => l.toLowerCase() === 'private');
  task.topic = privateLabel ? 'Private' : (labels[0] || '');
}
delete task.labels;
```

Rule (user-specified): if the old `labels` array contained `'private'`
(case-insensitive) anywhere in it, the migrated `topic` is `'Private'`
regardless of position, preserving membership in the private section. Otherwise
`topic` is the first label in the array, or `''` if there were none.

`delete task.labels` runs unconditionally after, so already-migrated (new
format) tasks pass through unchanged and idempotently.

## Column

`COLUMNS` gains a `topic` entry positioned between `dueDate` and `name`:

```js
{ key: 'topic', label: 'Topic', type: 'topic', sortable: true }
```

Removes the `labels` entry entirely.

## Cell display (read state)

The cell itself is the coloured badge — no inner chip/pill wrapper, so there's
no double padding. Same visual approach as the Priority quadrant badge
(`td.cell-topic`, cell's own padding only, normal cell font size):

```js
td.className = 'cell-topic';
td.textContent = task.topic || '';
if (task.topic) {
  td.style.background = labelColor(task.topic);
  td.style.color = '#fff';
} else {
  td.style.background = '';
  td.style.color = '';
}
```

`labelColor(text)` (existing DJB2→HSL hash function) is reused unchanged — no
new colour system.

## Edit interaction

Click the cell → it becomes a text `<input>`:
- Pre-filled with the current `topic` value, **selected** (select-all) so the
  first keystroke replaces it; arrow keys/Home/End still allow in-place editing
  of the existing value instead.
- Simultaneously opens a floating combobox panel below the cell (same
  positioning idiom as `openQuadrantPicker`: `getBoundingClientRect()`-anchored,
  closes on outside click / Escape, only one open at a time), listing
  candidate topics as coloured rows (background = `labelColor(topic)`, matching
  the cell badge style).

**List contents:**
- Empty input → the **8** most-frequent existing topics (via
  `TaskStore.topicCounts()`), most-frequent first.
- Non-empty input → all existing topics whose text includes the typed string
  (case-insensitive substring match), still ordered by frequency descending.
- If the typed text doesn't exactly match any existing topic, append a
  `Create "<text>"` row at the end of the (possibly empty) filtered list.

**Keyboard/mouse commit rules:**
- Arrow Up/Down moves a highlighted-row cursor through the list (wrapping is
  not required); Enter selects the highlighted row if one is highlighted.
- Enter with no row highlighted: if the input is non-empty, commits the typed
  text as the topic (whether it matches an existing one or is new); if the
  input is empty, does nothing (matches the existing label-input convention of
  ignoring an empty Enter).
- Clicking a list row (including a `Create "…"` row) selects/creates that
  topic and commits.
- Blur (click elsewhere, tab away) commits whatever text is currently in the
  input the same way Enter does (trim, empty ⇒ commit `''`, i.e. clears the
  topic — consistent with how other text cells commit on blur today).
- Escape closes the combobox and reverts the input to the value the cell had
  before this edit started, without committing.
- **Tab from the draft row's Topic field is just normal tab navigation to
  Name — it does NOT commit the draft task.** (Unlike the old label field,
  which sat right before Status and used Tab-to-commit as a shortcut; Topic
  now sits early in the row, before Name/Description/etc., so committing on
  Tab would cut off the rest of the draft.)

Commit, for an existing row: `TaskStore.update(task.uuid, 'topic', value)` +
`FileManager.scheduleSave()`, then re-render just that badge (same pattern as
the quadrant picker's `applyBadge`). For the draft row: mutate
`draft.topic = value` in place, re-render just that badge.

## Shared component

A new private helper inside the `UI` IIFE, `openTopicCombobox(td, currentValue,
onCommit)`, used by both `buildDraftRow`'s and `renderRows`' `case 'topic':`
blocks — same "one shared popup helper, closure-private, not exported" pattern
Task 3 of the Priority feature established with `openQuadrantPicker`.

## Private section

Replace the label-based check with:

```js
const isPrivate = task.topic && task.topic.toLowerCase() === 'private';
```

## Sorting

No `SortController` change needed. `topic` is a plain string field; the
existing generic fallthrough (`av = a[sortKey]`, compared with `<`/`>`) already
handles plain-string columns correctly (same as `name`/`contact` today) — no
special case like the old `labels` (which sorted by first-chip-in-array) is
required anymore.

## Filtering

No new filter-row branch type needed. `topic`'s filter cell stays a text
`<input type="search">` with a `list` attribute — reuses the exact pattern the
`labels` filter used today, just renamed:

```js
if (col.type === 'topic') {
  inp.setAttribute('list', 'topic-datalist');
}
```

`FilterController.apply`'s existing generic substring-match logic (`cell.includes(v)`)
already works correctly for a plain string field — no special case needed.

The `refreshLabelDatalist()` helper is renamed `refreshTopicDatalist()` and
rebuilt off `TaskStore.topicCounts()` instead of `TaskStore.allLabels()`
(dropping the count, keeping just the topic strings for the datalist).

## Removed code

- `TaskStore.allLabels()` — replaced by `TaskStore.topicCounts()` (returns
  `[{topic, count}]`, sorted by count descending, excluding `''`).
- The entire label-chip system: drag-to-reorder handlers, `.label-chip`,
  `.label-cell`, `.label-input`, `.label-chip-x` CSS and their JS
  counterparts in both `buildDraftRow` and `renderRows`.
- `col.col-labels` CSS width rule → replaced by `col.col-topic`.
- `labels-datalist` element/id → replaced by `topic-datalist`.

`labelColor()` stays — reused for topic colouring.

## Styling

New `td.cell-topic` rule (badge look, mirroring `td.cell-quadrant`'s approach:
cell-level padding only, `cursor: pointer`, `border-radius: var(--radius)`,
readable font size — not the old 11px chip font). New `.topic-combobox` panel
+ row styles, following the `.quadrant-picker`/`.qp-cell` styling conventions
(existing CSS custom properties: `--bg-surface`, `--border`, `--radius`,
`--shadow`, `--font`), plus a distinct row style for the `Create "…"` entry
(e.g. italic, muted background) and a highlighted/keyboard-focused row style.

## Testing

No test suite exists (per ARCHITECTURE.md's Outstanding list, unchanged by
this feature). Verify manually:

- Fresh file: new task defaults to no topic (empty badge); typing a topic and
  committing works via Enter, blur, and clicking a `Create "…"` row.
- Migration: hand-craft a `tasks.json` with old `labels` arrays covering: no
  labels, one label, multiple labels with `private` first, multiple labels
  with `private` in the middle/end, multiple labels with no `private` at all.
  Open it, confirm each task's migrated `topic` matches the rule, confirm
  private-tagged tasks still land in the private table, confirm the re-saved
  file has no `labels` key anywhere.
- Combobox: with several tasks sharing a handful of topic values at different
  frequencies, click an empty Topic cell — confirm the top 8 most-frequent
  topics appear, most-frequent first. Type a partial match — confirm the list
  filters correctly and stays frequency-ordered. Type something matching
  nothing — confirm a `Create "…"` row appears and selecting it creates that
  topic. Confirm Escape reverts without change, outside-click/blur commits the
  typed text, only one combobox is ever open at a time.
- Draft row: confirm clicking Topic pre-fills+selects the current (empty)
  value, confirm Tab from Topic moves focus to Name without committing the
  draft, confirm the draft's topic is included correctly when the task is
  eventually committed via Enter from Name or the ＋ button.
- Sort: click the Topic header, confirm plain alphabetical ordering
  (case-sensitive, consistent with how Name/Contact already sort).
- Filter: type in the Topic filter cell, confirm substring matching against
  the datalist-suggested values, same behavior as the old label filter.
- Private section: a task with `topic: 'Private'` (any case) still renders in
  the separate private table below the main list.

## Files touched

- `app.js` — data model, migration, `COLUMNS`, `TaskStore.topicCounts()`,
  cell rendering, `openTopicCombobox`, sort (no change needed, confirm),
  filter row datalist rename
- `style.css` — `td.cell-topic`, `.topic-combobox`/row styles, remove
  `.label-chip`/`.label-cell`/`.label-input` rules, rename `col.col-labels` →
  `col.col-topic`
- `README.md` — Features list (multi-label bullet → topic bullet), "Data
  format" example JSON (`labels` → `topic`)
- `ARCHITECTURE.md` — Columns table (`labels` row → `topic` row, repositioned
  between Due and Name), Data Format example JSON, Migration table (new row
  for labels→topic), Interaction Model section (replace the "Labels" bullet
  describing chip drag-reorder with a Topic combobox description)

## Out of scope

Description rich-text popup editor — separate design doc, done after this one
ships and is agreed working.
