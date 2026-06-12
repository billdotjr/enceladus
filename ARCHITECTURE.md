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
    "impact": 8,
    "urgency": 7,
    "priority": 56,
    "createdAt": "2026-05-20",
    "dueDate": "2026-06-01",
    "nextActionDate": "2026-05-25",
    "name": "Example task",
    "description": "Longer description",
    "nextAction": "Send email",
    "contact": "Jane Doe",
    "labels": ["work", "urgent"],
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
| missing `impact` / `urgency` | defaulted to `1` / `5` |
| stored `priority` | always recomputed as `impact × urgency` on load |

## UI Modules (all in `app.js`)

| Module | Responsibility |
|--------|----------------|
| `TaskStore` | In-memory task array, CRUD, sequential ID, JSON serialisation |
| `HandleStore` | Persists `FileSystemFileHandle` in IndexedDB for "Reopen" |
| `FileManager` | Open / create / reopen / auto-save JSON via File System Access API |
| `SortController` | Click-to-sort on any column header (asc → desc → off cycle) |
| `FilterController` | Per-column filter inputs; default hides Closed tasks (`!closed`) |
| `UI` | Renders `<table>`, draft row, inline editing, heatmap colouring |
| `ThemeController` | Dark/light toggle, persists to `localStorage` |

## Columns

| Key | Display | Type | Notes |
|-----|---------|------|-------|
| `id` | # | readonly | Auto-increment |
| `impact` | Impact | select | Powers of 2: 1, 2, 4, 8, 16, 32, 64, 128. Pale heatmap. |
| `urgency` | Urgency | select | 1–10. Pale heatmap. |
| `priority` | Priority | computed | `impact × urgency` (5–1280). Full-saturation heatmap, relative to visible rows. Read-only. |
| `createdAt` | Created | date | Set to today on task creation |
| `dueDate` | Due | date | Optional; faint placeholder when empty |
| `name` | Name | text | Bold; required to commit draft |
| `description` | Description | text | Free text |
| `nextActionDate` | Next action | date | Optional; faint placeholder when empty |
| `nextAction` | Next action | text | Free text |
| `contact` | Contact | text | Free text |
| `labels` | Label | chips | Array; DJB2 hash colour per label; drag-to-reorder; datalist autocomplete |
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

## Heatmap Colours

`heatColor(t)` maps `t ∈ [0, 1]` → `[r, g, b]` along green → amber → red.

- **Impact / Urgency**: `heatPale` — 40% colour + 60% white (pastel). Dark text.
- **Priority**: `heatRgb` — full saturation. White text. Range is relative to the
  currently visible task set (min–max), so contrast is always maximised.

## Interaction Model

- **Edit**: click any editable cell → `contenteditable` or `<input>`/`<select>`
- **New task**: draft row is always visible at the top of the table; fill in Name
  and press Enter, Tab (from the label field), or click ＋ to commit
- **Labels**: type in the `+` input and press Enter / `,` / `;` to add a chip;
  drag chips to reorder; click × to remove; Tab from the draft label field commits the task
- **Delete**: trash icon per row (confirm dialog)
- **Sort**: click column header → asc → desc → off; labels sort by first chip (user-defined order).
  Default sort on load: Next Action date ascending; tasks with no date sort last in either direction
- **Filter**: second header row with `<input>` per column; label column shows datalist;
  ✕ button at the end of the filter row resets all filters to the default (`status: !closed`)
- **Refresh**: ↻ button in topbar resets sort and filters to defaults
  (Next Action ascending, `status: !closed`) and re-renders — no page reload or file reopen needed
- **File open**: "Open existing file" on startup or "Switch file" in topbar
- **Auto-save**: debounced 500 ms after any change; Save button for immediate write;
  status bar shows last-save timestamp with live "ago" suffix.
  On browsers without the File System Access API the Save button downloads `tasks.json`
  via a `blob:` URL instead (auto-save stays disabled)
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
- Column resize by dragging
