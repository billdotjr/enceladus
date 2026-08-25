# Priority Quadrants — Design

## Context

Part of a larger set of changes to Enceladus (three independent sub-projects, each
with its own design → plan → implementation cycle):

1. **Priority Quadrants** (this document) — replace the numeric Impact × Urgency
   priority model with an Eisenhower-quadrant label.
2. Topic (single-select, replacing multi-label) — not yet designed.
3. Description rich-text popup editor — not yet designed.

Working rules for this whole effort (see `CLAUDE.md`):
- No code changes until the user has explicitly agreed to the plan.
- No architecture teardown without agreement — local, incremental changes only.
- Any data format change must stay backward compatible with older `tasks.json`
  files and convert them to the new format on first open.

## Problem

The user doesn't use the 2D Eisenhower matrix (Impact 1–128 × Urgency 1–10 →
numeric Priority 1–1280) in practice. They want priority expressed as one of the
four classic Eisenhower quadrants, picked visually from an actual 2×2 matrix.

## Data Model

Remove `impact`, `urgency`, and the numeric `priority` field from the task shape.
Replace with two booleans:

```json
{ "important": false, "urgent": false }
```

The quadrant label and sort rank are **derived, not stored**:

```js
function quadrantLabel(t) {
  if (t.important && t.urgent) return 'urg&import';
  if (t.important) return 'important';
  if (t.urgent)    return 'urgent';
  return 'base';
}

function quadrantRank(t) {
  // chmod-style bit encoding: important = 1, urgent = 2
  return (t.important ? 1 : 0) + (t.urgent ? 2 : 0);
  // base=0, important=1, urgent=2, urg&import=3
}
```

`newTask()` / draft defaults: `important: false, urgent: false` (→ `base`).

## Migration (`TaskStore.load`)

For each loaded task, if it doesn't yet have `important`/`urgent` booleans (i.e.
it's an old-format task with `impact`/`urgency`):

```js
if (task.important === undefined || task.urgent === undefined) {
  const oldImpact  = task.impact  ?? 1;
  const oldUrgency = task.urgency ?? 5;
  task.important = oldImpact  !== 1; // 1 was the default impact
  task.urgent    = oldUrgency !== 5; // 5 was the default urgency
}
delete task.impact;
delete task.urgency;
delete task.priority; // old numeric priority, no longer stored
```

This runs once, at load time, for every task in the file — the in-memory model
(and the next auto-save) is always the new format. Already-migrated tasks
(already having `important`/`urgent`) pass through unchanged. `impact`,
`urgency`, `priority` are deleted unconditionally after migration since nothing
reads them anymore.

## UI

### Column

`COLUMNS` collapses the current `impact`, `urgency`, `priority` entries into one:

```js
{ key: 'priority', label: 'Priority', type: 'quadrant', sortable: true }
```

### Cell rendering

Cell shows a colored badge with the quadrant label (`quadrantLabel(task)`):

| Quadrant     | Color   |
|--------------|---------|
| `base`       | green   |
| `important`  | blue    |
| `urgent`     | orange  |
| `urg&import` | red     |

(Reuse the existing color literals' saturation style, e.g. matching `STATUS_STYLE`'s
approach of `{bg, text}` pairs, rather than the old heatmap gradient — these are
four discrete categories now, not a continuum.)

### 2×2 matrix picker

Click the cell (draft row or existing row) → a floating panel opens anchored to
the cell, showing:

```
              Not urgent      Urgent
 Important    important 🔵    urg&import 🔴
 Not import.  base 🟢         urgent 🟠
```

- Vertical axis = Important (top = yes, bottom = no); horizontal axis = Urgent
  (left = no, right = yes). Urgent+Important is top-right.
- Click a quadrant cell → sets `important`/`urgent` accordingly, closes the
  panel, re-renders the cell (and, for existing rows, calls
  `TaskStore.update` + `FileManager.scheduleSave()`; for the draft row, updates
  `draft.important`/`draft.urgent` in place).
- Click outside the panel or `Escape` closes it without changing the value.
- Follows the existing inline-editing pattern (similar lifecycle to how the
  label input works today) — no new global modal system, just a positioned
  `div` appended to the cell/body and removed on close.

## Sorting

`SortController.apply`: for `sortKey === 'priority'`, compare `quadrantRank(a)` /
`quadrantRank(b)` instead of `Number(a.priority)`. Default sort direction
(`sortDir === 1`) keeps ascending-by-rank semantics consistent with other
columns; clicking the header cycles asc → desc → off as today. Descending
(`sortDir === -1`) yields `urg&import → urgent → important → base`.

## Filtering

Filter row for the `priority` column becomes a `<select>` (like the Status
filter) instead of a free-text input:

```
All
base
important
urgent
urg&import
```

`FilterController.apply`'s generic `task[k]` lookup gets a special case for
`k === 'priority'`: compare against `quadrantLabel(task)` instead of the raw
field.

## Removed code

- `IMPACT_VALUES`, `MAX_PRIORITY`
- `impactColor`, `urgencyColor`, `priorityColor` (the heatmap-based ones) —
  replaced by the flat 4-color badge map above
- `case 'impact':` / `case 'urgency':` branches in both `buildDraftRow` and
  `renderRows`
- Any `impact`/`urgency` references in `newTask()`, `DRAFT_DEFAULTS()`

`heatColor`/`heatRgb`/`heatPale`/`dateUrgencyColor` stay — still used for Due /
Next Action date highlighting, unrelated to this change.

## Testing

No test suite exists yet (per ARCHITECTURE.md's Outstanding list). Verify
manually:

- Fresh file: new task defaults to `base`, badge is green.
- Matrix picker: each of the 4 clicks sets the right combination or `important`/
  `urgent`, badge color/label updates immediately, value persists after reload.
- Migration: hand-craft a `tasks.json` with old `impact`/`urgency`/`priority`
  fields covering all 4 quadrant combinations (including edge cases like
  `impact: 1, urgency: 5` → `base`, and `impact: 128, urgency: 10` →
  `urg&import`), open it, confirm correct quadrant assignment, confirm
  re-saved file no longer contains `impact`/`urgency`/`priority` keys.
- Sort: click Priority header, confirm asc/desc order matches
  `base, important, urgent, urg&import` / reverse.
- Filter: select each quadrant option, confirm only matching rows show; `All`
  shows everything (respecting the separately-filtered Status column as today).

## Files touched

- `app.js` — data model, migration, `COLUMNS`, cell rendering, matrix picker,
  sort, filter (all described above)
- `style.css` — new classes for the 4 quadrant badge colors and the floating
  2×2 picker panel (positioning, hover states); remove now-unused
  impact/urgency heatmap cell styles if any are CSS-only
- `README.md` — the "Data format" example JSON currently shows
  `impact`/`urgency`/`priority`; update to `important`/`urgent`, and mention
  the quadrant model in the Features list (currently says "Eisenhower-style
  prioritisation — Impact (powers of 2) × Urgency (1–10)")
- `ARCHITECTURE.md` — replace the Impact/Urgency/Priority rows in the Columns
  table with a single Priority/quadrant row; replace the Heatmap Colours
  section's Impact/Urgency/Priority subsections with the quadrant color table
  and matrix picker description; update the Data Format example JSON

## Out of scope

Topic field and Description rich-text editor — separate design docs, done
after this one ships and is agreed working.
