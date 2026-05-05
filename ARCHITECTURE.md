# Enceladus Todo App — Architecture

## Overview

Single-page, client-side-only todo list app. No server, no external libraries,
no network requests. All data stays on the user's machine via the
**File System Access API**.

## Privacy Guarantee

- Zero external dependencies (no CDN, no fonts API, no analytics)
- All JS/CSS inlined or served from same origin
- File System Access API writes only to the file the user explicitly selects
- No `fetch` / `XMLHttpRequest` to any remote host

## File Tree

```
enceladus/
├── index.html          # Entry point — shell, imports styles + script
├── style.css           # All styling: layout, table, heatmap, dark/light mode
├── app.js              # All application logic (ES modules, no bundler needed)
└── ARCHITECTURE.md     # This file
```

## Data Format (`tasks.json`)

```json
[
  {
    "uuid": "xxxxxxxx-xxxx-...",
    "id": 1,
    "priority": 75,
    "dueDate": "2026-06-01",
    "nextActionDate": "2026-05-10",
    "name": "Example task",
    "description": "Longer description",
    "nextAction": "Send email",
    "contact": "Jane Doe",
    "tag": "work",
    "status": "New"
  }
]
```

## UI Modules (all in `app.js`)

| Module | Responsibility |
|--------|---------------|
| `FileManager` | Open / auto-save JSON via File System Access API |
| `TaskStore` | In-memory task array, CRUD, sequential ID assignment |
| `TableRenderer` | Render `<table>`, bind inline editing, heatmap colouring |
| `SortController` | Click-to-sort on any column header (asc/desc toggle) |
| `FilterController` | Per-column filter inputs in header row, tag autocomplete |
| `ThemeController` | Dark/light toggle, persists to `localStorage` |

## Columns

| Key | Display | Notes |
|-----|---------|-------|
| `uuid` | — | Hidden, generated on creation |
| `id` | # | Auto-increment, read-only |
| `priority` | Priority | 0–100, shown as % with green→orange→red heatmap |
| `dueDate` | Due | Date picker inline |
| `nextActionDate` | Next action | Date picker inline |
| `name` | Name | Free text |
| `description` | Description | Free text |
| `nextAction` | Next action | Free text |
| `contact` | Contact | Free text (Firstname Lastname) |
| `tag` | Tag | Free text + autocomplete from existing tags |
| `status` | Status | Dropdown: New / In Progress / Pending feedback / Done |

## Interaction Model

- **Edit**: click any editable cell → contenteditable or `<input>`/`<select>`
- **New row**: "+ Add" button appends blank task, auto-saves
- **Delete row**: trash icon per row
- **Sort**: click column header label → asc → desc → unsorted cycle
- **Filter**: second header row with `<input>` per column; tag column shows datalist
- **File open**: "Open file" button → `showOpenFilePicker`
- **Auto-save**: debounced 500 ms after any change; falls back to "Download JSON"
  if File System Access API unavailable (e.g. Firefox)

## Status

- [x] `index.html` — shell
- [x] `style.css` — styles
- [x] `app.js` — application logic

## Outstanding / Future Work

- Unit tests (e.g. Vitest) for TaskStore / FilterController
- Import/export from CSV
- Undo / redo stack
- Keyboard navigation between cells (Tab/Shift-Tab)
- Multi-select and bulk delete / bulk status change
- Column resize by dragging
