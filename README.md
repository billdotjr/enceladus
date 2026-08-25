# Enceladus

A private, client-side-only todo list app. No server, no accounts, no data ever leaves your machine.

## Features

- **Eisenhower-quadrant prioritisation** — pick `base` / `important` / `urgent` / `both` from a colour-coded 2×2 matrix popup
- **Inline editing** — click any cell to edit; changes auto-save after 500 ms
- **Description editor** — click the 📝 icon next to a task's Name to open a WYSIWYG editor (bold, links, line breaks); autosaves continuously as a draft while open, keeps the last 2 versions as a safety net
- **Status workflow** — Today · Workable · In Progress · New · Pending feedback · Meeting scheduled · On-Hold · Closed, each colour-coded by urgency
- **Date urgency highlighting** — Due and Next Action dates turn blue (today), pale blue (tomorrow), or red (overdue)
- **Topic** — single-select field with search-as-you-type, create-on-the-fly, and dynamic DJB2 hash colours
- **Private section** — tasks with Topic `Private` appear in a separate table below the main list
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
3. Fill in the draft row at the top of the table and press **Enter** (or click ＋) to add a task
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

The loader migrates older formats transparently (single `tag` string → `labels` array, `"Done"` → `"Closed"`, etc.).
`impact`/`urgency`/numeric `priority` from older files are migrated to
`important`/`urgent` booleans on first load.
Older `labels` arrays are migrated to a single `topic` string on first load
(a `'private'` label anywhere in the array wins; otherwise the first label is
used).

## Running locally

No build step required. Open `index.html` directly in your browser, or serve the folder with any static file server:

```sh
npx serve .
# or
python3 -m http.server
```

## Licence

MIT
