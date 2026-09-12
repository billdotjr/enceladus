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
- **Content Security Policy** (`<meta http-equiv="Content-Security-Policy">`) enforces
  `connect-src 'none'` — the browser engine itself blocks all outbound network requests
  (fetch, XHR, WebSocket, sendBeacon) regardless of what JS runs. Second layer of defence
  independent of the application code.
- `<meta name="referrer" content="no-referrer">` suppresses `Referer` headers on all
  outbound navigations, including the GitHub link.

**Residual risk (no client-side mitigation exists):** CSP cannot block top-level navigation.
A hypothetical XSS could redirect via `location.href` to an attacker URL carrying data in
the query string. The `navigate-to` CSP directive that would address this never shipped in
browsers. The defence here is keeping XSS surface minimal (all user data rendered via
`textContent` / `.value`, never `innerHTML`).

## File Tree

```
enceladus/
├── index.html          # Entry point — shell, imports styles + script
├── style.css           # All styling: layout, table, heatmap, dark/light mode
├── app.js              # All application logic (ES modules, no bundler needed)
├── favicon.svg         # Pixel-art space invader (flat 2D, dark green)
├── ARCHITECTURE.md     # This file
├── README.md           # User-facing documentation
├── CLAUDE.md           # Instructions for Claude sessions
└── LICENSE             # MIT
```

## Data Format (`tasks.json`)

```json
[
  {
    "uuid": "xxxxxxxx-xxxx-...",
    "id": 1,
    "important": true,
    "urgent": true,
    "createdAt": "2026-05-20",
    "dueDate": "2026-06-01",
    "nextActionDate": "2026-05-25",
    "name": "Example task",
    "description": "Longer description with **bold** and [links](https://example.com)",
    "descriptionHistory": [],
    "descriptionDraft": null,
    "nextAction": "Send email",
    "contact": "Jane Doe",
    "topic": "work",
    "status": "In Progress"
  }
]
```

### Migration

The loader (`TaskStore.load`) handles older formats transparently:

| Old field | Migration |
|-----------|-----------|
| `tag` (string) | converted to `labels: [tag]` |
| `status: "Done"` | renamed to `"Closed"` |
| missing `createdAt` | set to `""` |
| `createdAt` as ISO datetime | truncated to date (`YYYY-MM-DD`) |
| `impact`/`urgency`/`priority` (numeric) | converted to `important`/`urgent` booleans: `important = impact !== 1`, `urgent = urgency !== 5` (old defaults); old fields deleted |
| `labels` (array) | converted to a single `topic` string: `'private'` anywhere in the array wins (`topic = 'Private'`), otherwise the first label is used, or `''` if none |
| missing `descriptionHistory`/`descriptionDraft` | defaulted to `[]` / `null` (purely additive — `description`'s own content needs no migration) |

## UI Modules (all in `app.js`)

| Module | Responsibility |
|--------|----------------|
| `TaskStore` | In-memory task array, CRUD, sequential ID, JSON serialisation |
| `HandleStore` | Persists `FileSystemFileHandle` in IndexedDB for "Reopen" |
| `FileManager` | Open / create / reopen / auto-save JSON via File System Access API |
| `SortController` | Click-to-sort on any column header (asc → desc → off cycle) |
| `FilterController` | Per-column filter inputs; default hides Closed tasks (`!closed`) |
| `UI` | Renders `<table>`, draft row, inline editing, quadrant/topic popups |
| `ThemeController` | Dark/light toggle, persists to `localStorage` |

## Columns

| Key | Display | Type | Notes |
|-----|---------|------|-------|
| `id` | # | readonly | Auto-increment |
| `priority` | Priority | quadrant | One of `base`/`important`/`urgent`/`both`, picked via a 2×2 matrix popup (click the cell). Colour-coded badge. |
| `createdAt` | Created | date | Set to today on task creation |
| `dueDate` | Due | date | Optional; faint placeholder when empty |
| `topic` | Topic | topic | Single string; search-as-you-type combobox (click cell), create-on-the-fly, top-8-by-frequency suggestions, DJB2 hash colour |
| `name` | Name | name | Bold; required to commit draft. Includes a 📝 icon opening the description editor (see below). |
| `nextActionDate` | Next action | date | Optional; faint placeholder when empty |
| `nextAction` | Next action | text | Free text |
| `contact` | Contact | text | Free text |
| `status` | Status | select | See statuses below |
| _(delete)_ | — | button | Per-row trash icon |

## Statuses

| Value | Colour |
|-------|--------|
| Today | Red |
| Workable | Orange |
| In Progress | Amber |
| New | Green |
| Pending feedback | Blue |
| Meeting scheduled | Purple |
| On-Hold | Grey |
| Closed | Dark grey |

The status filter defaults to `!closed` (active tasks only).

## Priority Quadrants

Priority is stored as two booleans, `important` and `urgent`, and displayed as
one of four colour-coded badges:

| Quadrant     | Colour |
|--------------|--------|
| `base`       | Green  |
| `important`  | Blue   |
| `urgent`     | Orange |
| `both`       | Red    |

Clicking the Priority cell opens a 2×2 matrix picker — Important axis
vertical (top = yes), Urgent axis horizontal (right = yes); Important+Urgent
(`both`) is the top-right cell — to set both booleans at once.

## Description Editor

`description` holds lightweight markdown (`**bold**`, `[text](url)`, `\n`
for line breaks) — nothing else. Rendered via `parseDescriptionToDOM`/
`serializeDOMToDescription` (`app.js`), which build/read DOM exclusively via
`createElement`/`textContent`, never `innerHTML` — link URLs are only
turned into clickable `<a>` elements when they start with `http://`,
`https://`, or `mailto:`.

Click the 📝 icon next to a task's Name to open a WYSIWYG modal editor
(`contenteditable`, formatted via `document.execCommand`). While open, the
in-progress content is continuously autosaved (500ms debounce, same
convention as the rest of the app) into `descriptionDraft` — closing the
editor (×, Escape, or clicking the backdrop) promotes that draft to
`description` and shifts the previous `description` into
`descriptionHistory` (capped at 2 entries, most-recent-previous first). The
🕐 toolbar button shows those up to 2 previous versions with a Restore
action — a safety net against accidental overwrites, not a full revision
browser.

The icon itself reflects state: dimmed when there's no description and no
draft, normal when there's a saved description, and accent-highlighted
whenever `descriptionDraft` is non-null — including after reopening a file
where an editing session was interrupted (e.g. the browser closed
mid-edit), since the draft persists in the saved file and is resumed (not
silently discarded or finalized) the next time that task's icon is clicked.

## Interaction Model

- **Edit**: click any editable cell → `contenteditable` or `<input>`/`<select>`; Name also has a 📝 icon opening the description editor (see above)
- **New task**: draft row is always visible at the top of the table; fill in Name
  and press Enter, or click ＋ to commit
- **Topic**: click the cell to edit — text input opens with the current value
  selected, plus a dropdown of the 8 most-frequent existing topics (or filtered
  matches as you type); click a suggestion, press Enter, or click elsewhere to
  commit; a `Create "…"` row appears when nothing matches; Escape cancels
  without changing the value
- **Delete**: trash icon per row (confirm dialog)
- **Sort**: click column header → asc → desc → off; topic sorts alphabetically (plain string comparison).
  Default sort on load: Next Action date ascending; tasks with no date sort last in either direction.
  When sorting by Next Action date, tied dates (including two tasks with no date) break by priority
  quadrant — more important first when ascending, flipping to less important first when descending
- **Filter**: second header row with `<input>` per column; topic column shows datalist autocomplete;
  ✕ button at the end of the filter row resets all filters to the default (`status: !closed`)
- **Refresh**: ↻ button in topbar resets sort and filters to defaults
  (Next Action ascending, `status: !closed`) and re-renders — no page reload or file reopen needed
- **File open**: "Open existing file" on startup or "Switch file" in topbar
- **Auto-save**: debounced 500 ms after any change; Save button for immediate write;
  status bar shows last-save timestamp with live "ago" suffix.
  On browsers without the File System Access API the Save button downloads `tasks.json`
  via a `blob:` URL instead (auto-save stays disabled)
- **Column resize**: drag a header's right edge to resize it (trades width
  with the next column); widths are percentages of the table, persisted to
  `localStorage` (`enceladus-column-widths`) — proportions hold across any
  window size and survive reloads
- **Theme**: ☀ / ☾ button in topbar, persisted to `localStorage`
- **Reopen**: last-used file handle stored in IndexedDB; offered as one-click reopen on startup

## Status

- [x] `index.html` — shell
- [x] `style.css` — styles
- [x] `app.js` — application logic
- [x] `ARCHITECTURE.md` — this file

## Version / Footer

The app title in the topbar includes a small `v<date>` link (`.app-version`) that points to the GitHub repo.
The date (`index.html`, `.app-version` element) must be updated manually after each deploy — there is no build step to inject it automatically.

## Outstanding / Future Work

- Unit tests (e.g. Vitest) for TaskStore / FilterController
- Import / export from CSV
- Undo / redo stack
- Keyboard navigation between cells (Tab/Shift-Tab within a row)
- Multi-select and bulk delete / bulk status change
