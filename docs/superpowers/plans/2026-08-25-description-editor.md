# Description Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `Description` table column with an icon inside the `Name` cell that opens a WYSIWYG modal editor (bold, links, line breaks only), backed by lightweight markdown storage with a continuously-autosaved draft and a 2-entry version history — all without ever using `innerHTML` on user data.

**Architecture:** Same single-file, no-build vanilla JS/CSS app as the rest of Enceladus. This plan follows the shared-popup pattern the two already-shipped features on this branch established (`openQuadrantPicker`, `openTopicCombobox`): a closure-private helper inside the `UI` IIFE, wired into both the draft row and existing rows, with a `closeXxx()` backstop called from `render()`. The markdown⇄DOM conversion functions are pure, top-level helpers (like the existing `labelColor`/`quadrantLabel`), independent of the `UI` module.

**Tech Stack:** Vanilla JS (ES2020+, no modules/bundler), vanilla CSS, `document.execCommand` for WYSIWYG bold/link (the app already targets Chromium exclusively via the File System Access API, so this isn't a new browser-support commitment). No test framework.

**Spec:** `docs/superpowers/specs/2026-08-25-description-editor-design.md`

## Global Constraints

- No build step: don't add a bundler, transpiler, or npm dependency.
- No test framework introduced in this plan — verify manually in a browser (Playwright, installed as a throwaway dev dependency for verification only, never committed) after each task.
- Keep the existing module structure (`TaskStore`, `SortController`, `FilterController`, `UI`) and the `COLUMNS`-driven rendering pattern — no architecture rewrite.
- **User data is never rendered via `innerHTML`.** This is an existing, deliberately documented security principle of this app (see `ARCHITECTURE.md`'s Privacy Guarantee section) — the markdown⇄DOM conversion functions must build/read DOM exclusively via `createElement`/`textContent`/`childNodes`, never by assigning a string to `.innerHTML`.
- Link URLs are only ever turned into clickable `<a href>` elements if they start with `http://`, `https://`, or `mailto:` — anything else renders as literal text.
- No migration logic is needed for `description`'s content (it stays a plain string); only the two new fields (`descriptionHistory`, `descriptionDraft`) need defaulting when absent from an older file.
- History keeps at most 2 previous versions, most-recent-previous first; closing the editor always finalizes the current draft as the new `description` — there is no "cancel without saving."

---

## Task 1: Data model

**Files:**
- Modify: `app.js` (`TaskStore.newTask` ~line 72-88, `TaskStore.load` ~line 90-126, `UI`'s `DRAFT_DEFAULTS` ~line 441)

**Interfaces:**
- Produces: every task object (from `newTask()`, `load()`, and `DRAFT_DEFAULTS()`) has `description: string`, `descriptionHistory: string[]` (0-2 entries), `descriptionDraft: string | null`.

- [ ] **Step 1: Add the two new fields to `TaskStore.newTask()`**

Replace:
```js
      name: '',
      description: '',
      nextAction: '',
```
with:
```js
      name: '',
      description: '',
      descriptionHistory: [],
      descriptionDraft: null,
      nextAction: '',
```

- [ ] **Step 2: Default the two new fields in `TaskStore.load()`'s migration**

Insert this block right after `delete task.labels;` (the line that finishes the topic migration) and before the `// Migrate old "Done" status to "Closed"` comment:

```js
      // Migrate: default the description-versioning fields if absent (purely additive).
      if (task.descriptionHistory === undefined) task.descriptionHistory = [];
      if (task.descriptionDraft === undefined) task.descriptionDraft = null;
```

- [ ] **Step 3: Add the two new fields to `UI`'s `DRAFT_DEFAULTS()`**

Replace:
```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', topic: '', status: 'New' });
```
with:
```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', descriptionHistory: [], descriptionDraft: null, nextAction: '', contact: '', topic: '', status: 'New' });
```

- [ ] **Step 4: Manual verification — data layer**

Nothing in the UI shows these fields yet — this task is purely additive/data-layer.

1. Serve the app: `python3 -m http.server` in the repo root, open `http://localhost:8000`.
2. Confirm no JS errors on load, and the app works exactly as before.
3. Create a new file, add a task. In the console: `TaskStore.getAll()[0].descriptionHistory` should be `[]`, `TaskStore.getAll()[0].descriptionDraft` should be `null`.
4. Migration check: create `/tmp/old-desc.json`:
   ```json
   [
     {"uuid":"a","id":1,"name":"no desc fields","description":"plain text, no markdown","status":"New","createdAt":"2026-01-01","important":false,"urgent":false,"topic":""}
   ]
   ```
   Open it via "Open existing file". In the console: `TaskStore.getAll()[0].description` should still be `"plain text, no markdown"`, `.descriptionHistory` should be `[]`, `.descriptionDraft` should be `null`.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Add descriptionHistory/descriptionDraft fields and migration defaults"
```

---

## Task 2: Name cell restructuring (icon, read-only)

**Files:**
- Modify: `app.js` (`COLUMNS` ~line 44-56, `buildDraftRow`'s text case ~line 775-784, `renderRows`'s text case ~line 1047-1058, `focusDraftName` ~line 804-807)
- Modify: `style.css` (`col.col-description` ~line 157, `td[data-key="name"]` ~line 280, the empty-placeholder selector ~line 343)

**Interfaces:**
- Consumes: `task.description`/`draft.description`, `task.descriptionDraft`/`draft.descriptionDraft` (from Task 1).
- Produces: `td.className = 'cell-name'` cells containing a `span.name-text` (contentEditable, same behavior the old `name` cell had) and a `button.name-desc-icon` (📝) with `has-content`/`has-draft` CSS classes reflecting state — in both `buildDraftRow` and `renderRows`. The icon has NO click handler yet (Task 4 adds it) — clicking does nothing, which is expected and correct for this task.

- [ ] **Step 1: Remove the `description` entry from `COLUMNS`; change `name`'s type**

Replace the whole `COLUMNS` array:

```js
const COLUMNS = [
  { key: 'id',             label: '#',              type: 'readonly',  sortable: true  },
  { key: 'priority',       label: 'Priority',       type: 'quadrant',  sortable: true  },
  { key: 'createdAt',      label: 'Created',        type: 'date',      sortable: true  },
  { key: 'dueDate',        label: 'Due',            type: 'date',      sortable: true  },
  { key: 'topic',          label: 'Topic',          type: 'topic',     sortable: true  },
  { key: 'name',           label: 'Name',           type: 'name',      sortable: true  },
  { key: 'nextActionDate', label: 'Next action',    type: 'date',      sortable: true  },
  { key: 'nextAction',     label: 'Next action',    type: 'text',      sortable: false },
  { key: 'contact',        label: 'Contact',        type: 'text',      sortable: true  },
  { key: 'status',         label: 'Status',         type: 'status',    sortable: true  },
];
```

(`name`'s `type` changes from `'text'` to `'name'` so it gets its own switch case, distinct from `nextAction`/`contact` which stay on the generic `default:` text case. `description` is gone entirely.)

- [ ] **Step 2: Add `case 'name':` to `buildDraftRow`**

Insert this case into the `switch (col.type)` block (position doesn't matter functionally; place it right before `case 'status':`):

```js
        case 'name': {
          td.className = 'cell-name';
          const span = document.createElement('span');
          span.className = 'name-text';
          span.contentEditable = 'true';
          span.textContent = draft.name || '';
          span.dataset.placeholder = 'Name…';
          span.addEventListener('input', e => { draft.name = e.target.textContent; });
          span.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
          });
          td.appendChild(span);

          const icon = document.createElement('button');
          icon.type = 'button';
          icon.className = 'name-desc-icon';
          icon.textContent = '📝';
          const applyIconState = () => {
            icon.classList.remove('has-draft', 'has-content');
            if (draft.descriptionDraft !== null) {
              icon.classList.add('has-draft');
              icon.title = 'Draft in progress — click to continue editing';
            } else if (draft.description) {
              icon.classList.add('has-content');
              icon.title = 'Description';
            } else {
              icon.title = 'No description';
            }
          };
          applyIconState();
          // Prevent blur so a later click (Task 4 wires this up) won't
          // commit the draft row prematurely (same idiom as the quadrant
          // picker and topic combobox above).
          icon.addEventListener('mousedown', e => e.preventDefault());
          td.appendChild(icon);
          break;
        }
```

The old `name` handling is gone because it used to fall through to the generic `default:` text case (matched by `col.type === 'text'`), and `name`'s type is no longer `'text'` — no separate removal step needed, the `default:` case is untouched and now simply never sees `name`.

- [ ] **Step 3: Add `case 'name':` to `renderRows`**

Insert into that switch block too, right before `case 'status':`:

```js
          case 'name': {
            td.className = 'cell-name';
            const span = document.createElement('span');
            span.className = 'name-text';
            span.contentEditable = 'true';
            span.textContent = task.name || '';
            span.addEventListener('blur', e => {
              TaskStore.update(task.uuid, 'name', e.target.textContent.trim());
              FileManager.scheduleSave();
            });
            span.addEventListener('keydown', e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); span.blur(); }
            });
            td.appendChild(span);

            const icon = document.createElement('button');
            icon.type = 'button';
            icon.className = 'name-desc-icon';
            icon.textContent = '📝';
            const applyIconState = t => {
              icon.classList.remove('has-draft', 'has-content');
              if (t.descriptionDraft !== null) {
                icon.classList.add('has-draft');
                icon.title = 'Draft in progress — click to continue editing';
              } else if (t.description) {
                icon.classList.add('has-content');
                icon.title = 'Description';
              } else {
                icon.title = 'No description';
              }
            };
            applyIconState(task);
            td.appendChild(icon);
            break;
          }
```

- [ ] **Step 4: Fix `focusDraftName()`**

The "New task" topbar button focuses the draft row's Name field via this function. Its selector targets the old structure (the `td` itself had `data-placeholder`) — now that lives on the inner `span`:

Replace:
```js
  function focusDraftName() {
    const cell = document.querySelector('.draft-row td[data-placeholder="Name…"]');
    if (cell) cell.focus();
  }
```
with:
```js
  function focusDraftName() {
    const cell = document.querySelector('.draft-row .name-text[data-placeholder="Name…"]');
    if (cell) cell.focus();
  }
```

- [ ] **Step 5: Update `style.css`**

Remove:
```css
col.col-description    { width: 320px; }
```

Replace:
```css
td[data-key="name"] { font-weight: 700; }
```
with:
```css
td[data-key="name"] .name-text { font-weight: 700; }
```

Replace:
```css
.draft-row td[contenteditable][data-placeholder]:empty::before {
```
with:
```css
.draft-row [contenteditable][data-placeholder]:empty::before {
```
(this rule is otherwise unchanged — only the selector's leading part changes from `td[contenteditable]...` to the more general `[contenteditable]...`, so it still matches the still-`td`-level `nextAction`/`contact` draft cells AND the now-nested `.name-text` span)

The existing `/* ── Bold name ──... */` comment and the (now-updated) selector above stay as-is — don't remove that section. Add a new, separate block anywhere reasonable (e.g. right after the "Topic badge" section):

```css
/* ── Name cell + description icon ────────────────────────── */
td.cell-name {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
td.cell-name .name-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name-desc-icon {
  flex-shrink: 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 2px;
  opacity: 0.35;
  border-radius: var(--radius);
}
.name-desc-icon.has-content { opacity: 1; }
.name-desc-icon.has-draft {
  opacity: 1;
  background: var(--accent);
  border-radius: 50%;
}
.name-desc-icon:hover { opacity: 1; }
```

- [ ] **Step 6: Manual verification — Playwright**

**Use Playwright** (install as a throwaway dev dependency via `npm install playwright --no-save` in a scratch directory, never commit it) to verify against a real headless Chromium DOM:

1. Load a fixture with 3 tasks: one with `description: ''`, `descriptionDraft: null` (expect dimmed icon, title "No description"); one with `description: 'some text'`, `descriptionDraft: null` (expect normal-opacity icon, title "Description"); one with `descriptionDraft: 'in progress text'` regardless of its `description` value (expect accent-coloured circular-background icon, title "Draft in progress — click to continue editing").
2. Confirm there is no `Description` column header anywhere in the table.
3. Confirm the `Name` cell still lets you type/edit the name (existing behavior unaffected) and still bolds the name text visually.
4. Confirm clicking the 📝 icon does nothing yet (no popup, no error) — expected for this task.
5. Click the topbar "New task" button; confirm focus lands in the draft row's Name field (regression check on the `focusDraftName` fix).
6. Confirm the draft row also shows a (dimmed, since `draft.description` starts empty) 📝 icon next to its Name field.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "Replace Description column with a status icon in the Name cell"
```

---

## Task 3: Markdown ⇄ DOM conversion

**Files:**
- Modify: `app.js` (add two new top-level pure functions, near `labelColor`/`quadrantLabel` — not inside the `UI` IIFE, since they don't need `draft`/`TaskStore` access)

**Interfaces:**
- Produces: `parseDescriptionToDOM(markdown: string, container: HTMLElement): void` — clears `container` and populates it with one `<div>` per line, each containing a mix of text nodes, `<strong>` (bold), and `<a>` (link, only for `http(s)://`/`mailto:` URLs) elements. `serializeDOMToDescription(container: HTMLElement): string` — the inverse: walks `container`'s child `<div>`s and produces the equivalent markdown string, joined with `\n`.
- Consumes: nothing new (pure functions, no dependency on `TaskStore`/`UI` state).

- [ ] **Step 1: Add `parseDescriptionToDOM`**

Add this function near the other top-level pure helpers (e.g. right after `labelColor`):

```js
// ── Description markdown ⇄ DOM (bold, links, line breaks only) ─────────────
// Never uses innerHTML — all DOM built via createElement/textContent, so
// user-authored description text can never be interpreted as markup.

function parseDescriptionToDOM(markdown, container) {
  container.textContent = '';
  const lines = markdown.length ? markdown.split('\n') : [''];
  const tokenRe = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;
  for (const line of lines) {
    const div = document.createElement('div');
    let lastIndex = 0;
    let match;
    tokenRe.lastIndex = 0;
    while ((match = tokenRe.exec(line)) !== null) {
      if (match.index > lastIndex) {
        div.appendChild(document.createTextNode(line.slice(lastIndex, match.index)));
      }
      if (match[1] !== undefined) {
        // bold: **text**
        const strong = document.createElement('strong');
        strong.textContent = match[1];
        div.appendChild(strong);
      } else {
        // link: [text](url)
        const text = match[2];
        const url = match[3];
        if (/^(https?:\/\/|mailto:)/i.test(url)) {
          const a = document.createElement('a');
          a.textContent = text;
          a.href = url;
          a.target = '_blank';
          a.rel = 'noreferrer';
          div.appendChild(a);
        } else {
          // Unsafe/unrecognized scheme: render the literal source text,
          // never turn it into a clickable/executable link.
          div.appendChild(document.createTextNode(match[0]));
        }
      }
      lastIndex = tokenRe.lastIndex;
    }
    if (lastIndex < line.length) {
      div.appendChild(document.createTextNode(line.slice(lastIndex)));
    }
    container.appendChild(div);
  }
}
```

- [ ] **Step 2: Add `serializeDOMToDescription`**

Add right after `parseDescriptionToDOM`:

```js
function serializeDOMToDescription(container) {
  function serializeNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const inner = [...node.childNodes].map(serializeNode).join('');
    const tag = node.tagName.toLowerCase();
    if (tag === 'b' || tag === 'strong') return `**${inner}**`;
    if (tag === 'a') return `[${inner}](${node.getAttribute('href') || ''})`;
    if (tag === 'br') return '';
    return inner; // unexpected wrapper (e.g. execCommand quirks) — just recurse
  }
  return [...container.children].map(div =>
    [...div.childNodes].map(serializeNode).join('')
  ).join('\n');
}
```

- [ ] **Step 3: Manual verification — Playwright round-trip tests**

**Use Playwright** to load the app (these functions are globals on the page the moment `app.js` loads — no need for any UI interaction) and, via `page.evaluate()`, exercise:

1. `parseDescriptionToDOM('**bold** and a [link](https://example.com) and\nsecond line', someDiv)` — confirm `someDiv.children.length === 2`; confirm the first line's children are a `<strong>` with text "bold", then a text node " and a ", then an `<a href="https://example.com" target="_blank" rel="noreferrer">` with text "link", then a text node " and"; confirm the second line is a plain text node "second line".
2. `serializeDOMToDescription(someDiv)` on the DOM built in step 1 — confirm it returns exactly `'**bold** and a [link](https://example.com) and\nsecond line'` (full round-trip).
3. Empty string round-trip: `parseDescriptionToDOM('', div)` then `serializeDOMToDescription(div)` returns `''`.
4. Plain text with no markdown syntax round-trips unchanged: `'just plain text, nothing special'`.
5. Unsafe URL scheme: `parseDescriptionToDOM('[bad](javascript:alert(1))', div)` — confirm NO `<a>` element exists anywhere in `div` (query `div.querySelectorAll('a').length === 0`), and confirm the literal text `[bad](javascript:alert(1))` is present as plain text content.
6. Confirm no `innerHTML` assignment happens anywhere in either function (read the source you just wrote — this is a self-review check, not a runtime assertion).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Add markdown<->DOM conversion for description (no innerHTML)"
```

---

## Task 4: Editor modal shell (open/autosave/close/finalize, fullscreen toggle)

**Files:**
- Modify: `app.js` (inside the `UI` IIFE: add `openDescriptionEditor`/`closeDescriptionEditor`; replace Task 2's icon blocks in `buildDraftRow`/`renderRows` to wire in click handlers; add the `closeDescriptionEditor()` backstop call in `render()`)
- Modify: `style.css` (add `.desc-editor-backdrop`/`.desc-editor`/header/toolbar/body/`.fullscreen` styles)

**Interfaces:**
- Consumes: `parseDescriptionToDOM`, `serializeDOMToDescription` (Task 3); the `td.cell-name` cells and their icons (Task 2).
- Produces: `openDescriptionEditor({ taskName, getState, setDraft, finalize })` — private to the `UI` IIFE. `getState()` returns `{ description, history, draft }` for the task/draft this editor session is for. `setDraft(value)` is called (debounced 500ms while typing) to persist the in-progress draft. `finalize(value)` is called exactly once, when the editor closes, with the final serialized content. `closeDescriptionEditor()` — private, tears down any open editor WITHOUT calling `finalize` (same backstop role `closeQuadrantPicker`/`closeTopicCombobox` play — safe here specifically because an unfinalized draft simply stays resumable via `descriptionDraft`, by design).

- [ ] **Step 1: Add the editor component**

Inside the `UI` IIFE, add near `openQuadrantPicker`/`openTopicCombobox` (same section of the file, after `closeTopicCombobox`/`openTopicCombobox`):

```js
  // ── Description editor (shared by draft row + existing rows) ─────────────
  let openDescEditor = null;

  function closeDescriptionEditor() {
    if (openDescEditor) {
      openDescEditor.cleanup();
      openDescEditor = null;
    }
  }

  function openDescriptionEditor({ taskName, getState, setDraft, finalize }) {
    closeDescriptionEditor();

    const state = getState();
    const startingContent = state.draft !== null ? state.draft : state.description;
    if (state.draft === null) {
      // Starting a fresh session: mark a draft as "in progress" immediately,
      // even before any keystroke — crash-safety from the first moment, and
      // the icon reflects "draft in progress" right away.
      setDraft(startingContent);
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'desc-editor-backdrop';

    const modal = document.createElement('div');
    modal.className = 'desc-editor';

    const header = document.createElement('div');
    header.className = 'desc-editor-header';
    const titleEl = document.createElement('span');
    titleEl.className = 'desc-editor-title';
    titleEl.textContent = taskName || '(untitled task)';
    header.appendChild(titleEl);

    const toolbar = document.createElement('div');
    toolbar.className = 'desc-editor-toolbar';
    header.appendChild(toolbar);

    const btnFullscreen = document.createElement('button');
    btnFullscreen.type = 'button';
    btnFullscreen.textContent = '⛶';
    btnFullscreen.title = 'Toggle fullscreen';
    btnFullscreen.addEventListener('mousedown', e => e.preventDefault());
    btnFullscreen.addEventListener('click', () => modal.classList.toggle('fullscreen'));
    toolbar.appendChild(btnFullscreen);

    const btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'desc-editor-close';
    btnClose.textContent = '✕';
    btnClose.title = 'Close (saves automatically)';
    header.appendChild(btnClose);

    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'desc-editor-body';
    body.contentEditable = 'true';
    parseDescriptionToDOM(startingContent, body);
    modal.appendChild(body);

    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    let saveTimer = null;
    function scheduleAutosave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        setDraft(serializeDOMToDescription(body));
      }, 500);
    }
    body.addEventListener('input', scheduleAutosave);

    function close() {
      clearTimeout(saveTimer);
      const finalValue = serializeDOMToDescription(body);
      document.removeEventListener('keydown', onKeydown);
      backdrop.remove();
      openDescEditor = null;
      finalize(finalValue);
    }

    btnClose.addEventListener('click', close);
    backdrop.addEventListener('mousedown', e => {
      if (e.target === backdrop) close();
    });
    function onKeydown(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKeydown);

    body.focus();

    openDescEditor = {
      cleanup: () => {
        clearTimeout(saveTimer);
        document.removeEventListener('keydown', onKeydown);
        backdrop.remove();
      },
    };
  }
```

- [ ] **Step 2: Wire it into `buildDraftRow`'s `case 'name':`**

Replace the block Task 2 added with (only the icon's event listeners change — the `span`/name-editing part is identical to Task 2):

```js
        case 'name': {
          td.className = 'cell-name';
          const span = document.createElement('span');
          span.className = 'name-text';
          span.contentEditable = 'true';
          span.textContent = draft.name || '';
          span.dataset.placeholder = 'Name…';
          span.addEventListener('input', e => { draft.name = e.target.textContent; });
          span.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
          });
          td.appendChild(span);

          const icon = document.createElement('button');
          icon.type = 'button';
          icon.className = 'name-desc-icon';
          icon.textContent = '📝';
          const applyIconState = () => {
            icon.classList.remove('has-draft', 'has-content');
            if (draft.descriptionDraft !== null) {
              icon.classList.add('has-draft');
              icon.title = 'Draft in progress — click to continue editing';
            } else if (draft.description) {
              icon.classList.add('has-content');
              icon.title = 'Description';
            } else {
              icon.title = 'No description';
            }
          };
          applyIconState();
          icon.addEventListener('mousedown', e => e.preventDefault());
          icon.addEventListener('click', () => {
            openDescriptionEditor({
              taskName: draft.name,
              getState: () => ({ description: draft.description, history: draft.descriptionHistory, draft: draft.descriptionDraft }),
              setDraft: value => { draft.descriptionDraft = value; applyIconState(); },
              finalize: value => {
                if (value !== draft.description) {
                  draft.descriptionHistory = [draft.description, ...draft.descriptionHistory].slice(0, 2);
                  draft.description = value;
                }
                draft.descriptionDraft = null;
                applyIconState();
              },
            });
          });
          td.appendChild(icon);
          break;
        }
```

- [ ] **Step 3: Wire it into `renderRows`'s `case 'name':`**

Replace the block Task 2 added with:

```js
          case 'name': {
            td.className = 'cell-name';
            const span = document.createElement('span');
            span.className = 'name-text';
            span.contentEditable = 'true';
            span.textContent = task.name || '';
            span.addEventListener('blur', e => {
              TaskStore.update(task.uuid, 'name', e.target.textContent.trim());
              FileManager.scheduleSave();
            });
            span.addEventListener('keydown', e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); span.blur(); }
            });
            td.appendChild(span);

            const icon = document.createElement('button');
            icon.type = 'button';
            icon.className = 'name-desc-icon';
            icon.textContent = '📝';
            const applyIconState = t => {
              icon.classList.remove('has-draft', 'has-content');
              if (t.descriptionDraft !== null) {
                icon.classList.add('has-draft');
                icon.title = 'Draft in progress — click to continue editing';
              } else if (t.description) {
                icon.classList.add('has-content');
                icon.title = 'Description';
              } else {
                icon.title = 'No description';
              }
            };
            applyIconState(task);
            icon.addEventListener('click', () => {
              openDescriptionEditor({
                taskName: task.name,
                getState: () => {
                  const cur = TaskStore.getAll().find(x => x.uuid === task.uuid);
                  return { description: cur.description, history: cur.descriptionHistory, draft: cur.descriptionDraft };
                },
                setDraft: value => {
                  TaskStore.update(task.uuid, 'descriptionDraft', value);
                  FileManager.scheduleSave();
                  applyIconState(TaskStore.getAll().find(x => x.uuid === task.uuid));
                },
                finalize: value => {
                  const cur = TaskStore.getAll().find(x => x.uuid === task.uuid);
                  if (value !== cur.description) {
                    const newHistory = [cur.description, ...cur.descriptionHistory].slice(0, 2);
                    TaskStore.update(task.uuid, 'descriptionHistory', newHistory);
                    TaskStore.update(task.uuid, 'description', value);
                  }
                  TaskStore.update(task.uuid, 'descriptionDraft', null);
                  FileManager.scheduleSave();
                  applyIconState(TaskStore.getAll().find(x => x.uuid === task.uuid));
                },
              });
            });
            td.appendChild(icon);
            break;
          }
```

(No `mousedown preventDefault` needed here — existing rows have no draft-row blur-commit timer to protect against.)

- [ ] **Step 4: Add the `closeDescriptionEditor()` backstop in `render()`**

```js
  function render() {
    closeQuadrantPicker(); // backstop: never leave a picker orphaned by a full re-render
    closeTopicCombobox();  // same backstop, for the topic combobox
    closeDescriptionEditor(); // same backstop, for the description editor
    buildColgroup();
    ...
```

- [ ] **Step 5: Add editor CSS**

Append to `style.css`:

```css
/* ── Description editor ───────────────────────────────────── */
.desc-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,.55);
}
.desc-editor {
  display: flex;
  flex-direction: column;
  width: 33vw;
  height: 33vh;
  min-width: 320px;
  min-height: 240px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,.25);
  overflow: hidden;
}
.desc-editor.fullscreen {
  width: 92vw;
  height: 92vh;
}
.desc-editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border);
}
.desc-editor-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  font-size: 13px;
}
.desc-editor-toolbar {
  position: relative;
  display: flex;
  gap: 4px;
}
.desc-editor-toolbar button {
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
  padding: 3px 7px;
}
.desc-editor-toolbar button:hover { background: var(--bg-row-hover); }
.desc-editor-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 6px;
  border-radius: var(--radius);
}
.desc-editor-close:hover { color: var(--del); }
.desc-editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  outline: none;
  font-size: 13px;
  line-height: 1.5;
}
.desc-editor-body div { min-height: 1.1em; }
```

- [ ] **Step 6: Manual verification — Playwright**

1. Click a task's 📝 icon (dimmed/empty state). Confirm a centered modal opens, roughly 1/3 of the viewport width/height, with a header showing the task's name, a toolbar (currently just the ⛶ button), and a × close button; confirm the editable body is focused and empty.
2. Confirm the icon immediately switches to the "draft in progress" (accent, circular background) state as soon as the modal opens — before typing anything (check via `TaskStore.getAll()` in the console: `descriptionDraft` should already be `''`, not `null`).
3. Type some plain text (no formatting). Wait >500ms. Confirm (via the console / saved file) `descriptionDraft` now holds that text.
4. Click × to close. Confirm the modal disappears, the icon switches to "has content" state, `description` now holds the typed text, `descriptionDraft` is back to `null`, `descriptionHistory` has one entry (the old, empty `description`).
5. Reopen the same task's icon. Confirm the modal shows the previously-saved text (parsed back correctly, even with no formatting).
6. Test Escape closes and finalizes the same way as ×.
7. Test clicking the backdrop (outside the modal box) closes and finalizes the same way.
8. Click ⛶: confirm the modal expands to near-fullscreen; click again: confirm it shrinks back to the default size.
9. On the **draft row**: click its 📝 icon, type text, close the editor (confirm `draft.description`/`draft.descriptionHistory` update via a console check exposing `draft` — if `draft` isn't console-accessible, verify indirectly by then filling in Name and committing the task, then checking the created task's `description`). Confirm this doesn't trigger a premature draft-row commit (the row should still be uncommitted/editable until Name is filled and Enter/＋ is used).
10. Confirm the Priority quadrant picker and Topic combobox still work correctly and are unaffected (quick regression smoke check).

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "Add description editor modal: open/autosave/close/finalize, fullscreen toggle"
```

---

## Task 5: Bold/Link toolbar buttons

**Files:**
- Modify: `app.js` (inside `openDescriptionEditor`, insert Bold/Link button creation)

**Interfaces:**
- Consumes: `body` (the contenteditable element), `toolbar`, `scheduleAutosave` — all local variables/functions already defined inside `openDescriptionEditor` by Task 4.

- [ ] **Step 1: Insert the Bold and Link buttons**

Inside `openDescriptionEditor`, insert this code **immediately before** the line `toolbar.appendChild(btnFullscreen);` (so the final toolbar order is Bold, Link, Fullscreen):

```js
    const btnBold = document.createElement('button');
    btnBold.type = 'button';
    btnBold.textContent = 'B';
    btnBold.style.fontWeight = '700';
    btnBold.title = 'Bold (selection)';
    // Prevent blur so clicking Bold doesn't collapse the text selection in
    // `body` before execCommand runs.
    btnBold.addEventListener('mousedown', e => e.preventDefault());
    btnBold.addEventListener('click', () => {
      body.focus();
      document.execCommand('bold', false, null);
      scheduleAutosave();
    });
    toolbar.appendChild(btnBold);

    const btnLink = document.createElement('button');
    btnLink.type = 'button';
    btnLink.textContent = '🔗';
    btnLink.title = 'Link (selection)';
    btnLink.addEventListener('mousedown', e => e.preventDefault());
    btnLink.addEventListener('click', () => {
      const url = window.prompt('Link URL:');
      if (!url) return;
      if (!/^(https?:\/\/|mailto:)/i.test(url)) {
        window.alert('Only http://, https://, or mailto: links are allowed.');
        return;
      }
      body.focus();
      document.execCommand('createLink', false, url);
      scheduleAutosave();
    });
    toolbar.appendChild(btnLink);
```

- [ ] **Step 2: Manual verification — Playwright**

1. Open the editor, type some text, select part of it (via `page.evaluate` using a Selection/Range, or via keyboard shift-selection), click **B**. Confirm the selected text is now wrapped in `<strong>` (or `<b>`) and renders visually bold.
2. Select some other text, click 🔗. Playwright: register a `page.on('dialog', dialog => dialog.accept('https://example.com'))` handler before clicking, so the native `prompt()` is answered programmatically. Confirm the selected text becomes an `<a href="https://example.com">`.
3. Repeat the link flow but accept the prompt with `javascript:alert(1)`. Confirm `window.alert` fires (register a second dialog handler for it) and NO `<a>` is created.
4. Confirm both actions trigger the autosave (check `descriptionDraft` reflects the formatted markdown, e.g. contains `**...**` or `[...](...)`, after waiting past the debounce).
5. Close and reopen the editor; confirm the bold/link formatting round-trips correctly (parsed back into the same visual formatting) via the Task 3 conversion functions.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Add Bold/Link toolbar buttons to the description editor"
```

---

## Task 6: History popover

**Files:**
- Modify: `app.js` (inside `openDescriptionEditor`, insert the History button + popover logic)
- Modify: `style.css` (add `.desc-history-popover` and related styles)

**Interfaces:**
- Consumes: `getState`, `setDraft`, `body`, `toolbar`, `parseDescriptionToDOM` — all already available inside `openDescriptionEditor` by Task 4/5.

- [ ] **Step 1: Insert the History button and popover logic**

Inside `openDescriptionEditor`, insert this code **immediately before** the line `toolbar.appendChild(btnFullscreen);` (so it lands after Task 5's Bold/Link buttons and before Fullscreen — final order: Bold, Link, History, Fullscreen):

```js
    const btnHistory = document.createElement('button');
    btnHistory.type = 'button';
    btnHistory.textContent = '🕐';
    btnHistory.title = 'Version history';
    let historyPopover = null;
    function closeHistoryPopover() {
      if (historyPopover) { historyPopover.remove(); historyPopover = null; }
    }
    btnHistory.addEventListener('mousedown', e => e.preventDefault());
    btnHistory.addEventListener('click', () => {
      if (historyPopover) { closeHistoryPopover(); return; }
      const history = getState().history;
      const pop = document.createElement('div');
      pop.className = 'desc-history-popover';
      if (!history.length) {
        const empty = document.createElement('div');
        empty.className = 'desc-history-empty';
        empty.textContent = 'No previous versions yet';
        pop.appendChild(empty);
      } else {
        history.forEach(value => {
          const row = document.createElement('div');
          row.className = 'desc-history-row';
          const preview = document.createElement('span');
          preview.className = 'desc-history-preview';
          const plain = value.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1');
          preview.textContent = plain.slice(0, 40) || '(empty)';
          row.appendChild(preview);
          const btnRestore = document.createElement('button');
          btnRestore.type = 'button';
          btnRestore.textContent = 'Restore';
          btnRestore.addEventListener('mousedown', e => e.preventDefault());
          btnRestore.addEventListener('click', () => {
            parseDescriptionToDOM(value, body);
            setDraft(value);
            closeHistoryPopover();
          });
          row.appendChild(btnRestore);
          pop.appendChild(row);
        });
      }
      toolbar.appendChild(pop);
      historyPopover = pop;
    });
    toolbar.appendChild(btnHistory);
    // Clicking back into the editing area closes an open history popover.
    body.addEventListener('mousedown', closeHistoryPopover);
```

- [ ] **Step 2: Add popover CSS**

Append to `style.css`:

```css
/* ── Description history popover ─────────────────────────── */
.desc-history-popover {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  min-width: 200px;
  max-width: 320px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.desc-history-empty {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
  padding: 4px;
}
.desc-history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
.desc-history-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.desc-history-row button {
  flex-shrink: 0;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--accent);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
}
```

- [ ] **Step 3: Manual verification — Playwright**

1. Create a task, open its editor, type "version one", close (finalizes as `description`, history still empty since there was no prior description to shift).
2. Reopen, replace text with "version two", close (`description` = "version two", `descriptionHistory` = ["version one"]).
3. Reopen, replace text with "version three", close (`description` = "version three", `descriptionHistory` = ["version two", "version one"]).
4. Reopen, click 🕐. Confirm the popover shows 2 entries with previews "version two" and "version one" (in that order), each with a Restore button.
5. Click Restore on "version one". Confirm the editor body content updates to "version one" and the popover closes.
6. Close the editor. Confirm `description` = "version one", `descriptionHistory` = ["version three", "version two"] (the value that was current when Restore was clicked — "version three" — shifted into history; "version one" is promoted; "version two", the older history entry, drops off since history caps at 2).
7. With a task that has an empty `descriptionHistory`, open its editor and click 🕐 — confirm the popover shows "No previous versions yet".
8. Click 🕐 to open the popover, then click into the editing body — confirm the popover closes.
9. Click 🕐 twice in a row (open, then click the button again) — confirm it toggles closed without reopening a duplicate.

- [ ] **Step 4: Commit**

```bash
git add app.js style.css
git commit -m "Add version history popover to the description editor"
```

---

## Task 7: Documentation

**Files:**
- Modify: `README.md` (Features list, Data-format example JSON)
- Modify: `ARCHITECTURE.md` (Columns table, Data Format example JSON, Migration table, Interaction Model section)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`'s Features list**

Replace:
```markdown
- **Inline editing** — click any cell to edit; changes auto-save after 500 ms
```
with (adds a new bullet right after it; keep the Inline editing bullet as-is):
```markdown
- **Inline editing** — click any cell to edit; changes auto-save after 500 ms
- **Description editor** — click the 📝 icon next to a task's Name to open a WYSIWYG editor (bold, links, line breaks); autosaves continuously as a draft while open, keeps the last 2 versions as a safety net
```

- [ ] **Step 2: Update `README.md`'s Data-format example**

In the JSON code block, replace:
```json
    "description": "Longer description",
```
with:
```json
    "description": "Longer description with **bold** and [links](https://example.com)",
    "descriptionHistory": [],
    "descriptionDraft": null,
```

- [ ] **Step 3: Update `ARCHITECTURE.md`'s Columns table**

Find the `name` row:
```markdown
| `name` | Name | text | Bold; required to commit draft |
```
Replace it with:
```markdown
| `name` | Name | name | Bold; required to commit draft. Includes a 📝 icon opening the description editor (see below). |
```

Remove the `description` row entirely:
```markdown
| `description` | Description | text | Free text |
```

- [ ] **Step 4: Update `ARCHITECTURE.md`'s Data Format example JSON**

Same replacement as README's Step 2.

- [ ] **Step 5: Update `ARCHITECTURE.md`'s Migration table**

Add a row:
```markdown
| missing `descriptionHistory`/`descriptionDraft` | defaulted to `[]` / `null` (purely additive — `description`'s own content needs no migration) |
```

- [ ] **Step 6: Add a "Description Editor" section to `ARCHITECTURE.md`**

Insert a new section, after the existing "Priority Quadrants" section and before "Interaction Model":

```markdown
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
```

- [ ] **Step 7: Update `ARCHITECTURE.md`'s Interaction Model section**

Replace:
```markdown
- **Edit**: click any editable cell → `contenteditable` or `<input>`/`<select>`
```
with:
```markdown
- **Edit**: click any editable cell → `contenteditable` or `<input>`/`<select>`; Name also has a 📝 icon opening the description editor (see above)
```

- [ ] **Step 8: Manual verification**

Read through both files once, confirm no remaining references to "Description" as a table column (a mention of the description *editor*/*field* is fine and expected) — `grep -n -i description README.md ARCHITECTURE.md` and manually check each hit makes sense in context.

- [ ] **Step 9: Commit**

```bash
git add README.md ARCHITECTURE.md
git commit -m "Update docs for the description editor"
```
