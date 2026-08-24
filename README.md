# Enceladus

A private, client-side-only todo list app. No server, no accounts, no data ever leaves your machine.

## Features

- **Eisenhower-quadrant prioritisation** — pick `base` / `important` / `urgent` / `urg&import` from a colour-coded 2×2 matrix popup
- **Inline editing** — click any cell to edit; changes auto-save after 500 ms
- **Status workflow** — Today · Workable · In Progress · New · Pending feedback · Meeting scheduled · On-Hold · Closed, each colour-coded by urgency
- **Date urgency highlighting** — Due and Next Action dates turn blue (today), pale blue (tomorrow), or red (overdue)
- **Labels** — free-form chips with drag-to-reorder, autocomplete, and DJB2 hash colours
- **Private section** — tasks tagged `private` appear in a separate table below the main list
- **Per-column filtering and sorting** — status filter defaults to hiding Closed tasks
- **Dark / light theme** — toggled in the topbar, persisted to `localStorage`
- **Auto-save** — via the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API); falls back to manual Save button on unsupported browsers
- **Reopen** — last-used file handle stored in IndexedDB, offered as one-click reopen on startup

## Privacy

- Zero external dependencies — no CDN, no fonts API, no analytics, no telemetry
- All JS and CSS are served from the same origin
- The File System Access API writes only to the file you explicitly choose
- No `fetch` or `XMLHttpRequest` to any remote host

## Usage

1. Open `index.html` in a Chromium-based browser (Chrome, Edge, Arc — Firefox does not support the File System Access API)
2. Choose **Create new file** to start fresh, or **Open existing file** to load a `tasks.json`
3. Fill in the draft row at the top of the table and press **Enter** (or **Tab** from the Label field) to add a task
4. Click any cell to edit it inline — changes save automatically

## Browser support

| Browser | Auto-save | Manual save |
|---------|-----------|-------------|
| Chrome / Edge / Arc | ✅ | ✅ writes to the chosen file |
| Firefox | ❌ | ✅ downloads `tasks.json` |
| Safari | ❌ | ✅ downloads `tasks.json` |

## Data format

Tasks are stored as a plain JSON array in a file of your choosing:

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
    "description": "Longer description",
    "nextAction": "Send email",
    "contact": "Jane Doe",
    "labels": ["work", "urgent"],
    "status": "In Progress"
  }
]
```

The loader migrates older formats transparently (single `tag` string → `labels` array, `"Done"` → `"Closed"`, etc.).
`impact`/`urgency`/numeric `priority` from older files are migrated to
`important`/`urgent` booleans on first load.

## Running locally

No build step required. Open `index.html` directly in your browser, or serve the folder with any static file server:

```sh
npx serve .
# or
python3 -m http.server
```

## Licence

MIT
