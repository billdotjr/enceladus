# Topic Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-value `labels` field with a single-select `topic` field (search-as-you-type combobox, create-on-the-fly, frequency-ranked suggestions, dynamic colour coding), positioned between Due and Name, backward-compatible with old `labels` data.

**Architecture:** Same single-file, no-build vanilla JS/CSS app as the rest of Enceladus. `app.js` is a plain `<script>` (not a module), organised as IIFE "modules" (`TaskStore`, `SortController`, `FilterController`, `UI`) plus a `COLUMNS` config array that drives rendering. This plan follows the exact pattern the Priority Quadrants feature (already shipped) established: a shared, closure-private popup component inside the `UI` IIFE (`openQuadrantPicker` for Priority; `openTopicCombobox` here), wired into both the draft row and existing rows.

**Tech Stack:** Vanilla JS (ES2020+, no modules/bundler), vanilla CSS, File System Access API. No test framework — verify manually in a browser after each task, per this project's established (and deliberate) convention.

**Spec:** `docs/superpowers/specs/2026-08-24-topic-field-design.md`

## Global Constraints

- No build step: don't add a bundler, transpiler, or npm dependency.
- No test framework introduced in this plan — verify manually in a browser after each task.
- Must stay backward compatible with older `tasks.json` files (`labels` array, or even older `tag` string) — see Task 1's migration.
- Keep the existing module structure (`TaskStore`, `SortController`, `FilterController`, `UI`) and the `COLUMNS`-driven rendering pattern — no architecture rewrite.
- Zero external requests / dependencies (CSP in `index.html` stays untouched).
- Migration rule (user-specified): if the old `labels` array contained `'private'` (case-insensitive) anywhere in it, migrated `topic` = `'Private'` regardless of position; otherwise `topic` = the first label in the array, or `''` if there were none.
- Reuse the existing `labelColor(text)` DJB2→HSL hash function for topic colouring — no new colour system.
- Tab from the draft row's Topic field must NOT commit the draft (unlike the old Label field) — Topic now sits before Name/Description, so Tab is just normal navigation to the next field.

---

## Task 1: Data model & migration

**Files:**
- Modify: `app.js` (`TaskStore.newTask` ~line 72-88, `TaskStore.load` ~line 90-118, `TaskStore`'s return object ~line 143, `UI`'s `DRAFT_DEFAULTS` ~line 432)

**Interfaces:**
- Produces: `TaskStore.topicCounts()` — returns `[{ topic, count }, ...]`, every distinct non-empty `topic` value across all tasks with its usage count, sorted by count descending (ties broken alphabetically). `task.topic` (string, `''` when unset) present on every task after `load()`/`newTask()`.
- Consumes: nothing new. Does NOT yet remove `task.labels`/`draft.labels` — that happens in Task 2, once nothing reads them for rendering anymore. This task is purely additive so the app keeps working unchanged in between.

- [ ] **Step 1: Add `topic: ''` to `TaskStore.newTask()`**

In the object literal inside `newTask()`, add a `topic: ''` field. It doesn't matter exactly where in the object, but keep it next to the existing `labels: []` line for readability:

```js
      labels: [],
      topic: '',
      status: 'New',
```

(`labels: []` stays for now — Task 2 removes it once nothing reads it.)

- [ ] **Step 2: Add topic migration to `TaskStore.load()`**

Insert this block right after the existing tag→labels migration (`if (!Array.isArray(task.labels)) { ... }`) and before the `status: "Done"` migration line, so it runs on an already-normalized `task.labels` array:

```js
      // Migrate old multi-value labels array to a single topic string.
      // 'private' anywhere in the old labels wins (keeps private-section
      // membership); otherwise take the first label; no labels -> ''.
      if (typeof task.topic !== 'string') {
        const privateLabel = task.labels.find(l => l.toLowerCase() === 'private');
        task.topic = privateLabel ? 'Private' : (task.labels[0] || '');
      }
```

Do NOT add `delete task.labels;` yet — Task 2 does that, once the old label-rendering code (which still reads `task.labels`/`draft.labels`) is gone. Leaving `labels` in place for now keeps the app fully functional between this task and Task 2.

- [ ] **Step 3: Add `TaskStore.topicCounts()`**

Add this function inside the `TaskStore` IIFE, near `allLabels()`:

```js
  function topicCounts() {
    const counts = new Map();
    for (const t of tasks) {
      if (t.topic) counts.set(t.topic, (counts.get(t.topic) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  }
```

Add `topicCounts` to the module's return statement (keep `allLabels` for now — Task 4 removes it once its last caller is gone):

```js
  return { load, add, remove, update, getAll, allLabels, topicCounts, toJSON };
```

- [ ] **Step 4: Add `topic: ''` to `UI`'s `DRAFT_DEFAULTS()`**

Current line:
```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', labels: [], status: 'New' });
```

New (add `topic: ''` next to `labels: []`, which stays for now):
```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', labels: [], topic: '', status: 'New' });
```

- [ ] **Step 5: Manual verification — data layer**

Nothing in the UI shows `topic` yet — this task is purely data-layer. Verify via the browser console.

1. Serve the app: `python3 -m http.server` in the repo root, open `http://localhost:8000`.
2. Confirm no JS errors on load, and that the app works exactly as before (Label column still there with chips — untouched).
3. Create a new file, add a task with a label (e.g. type "work" in the Label field, press Enter). In the console: `TaskStore.getAll()[0].topic` should be `''` (new tasks default to no topic; `newTask()`/`DRAFT_DEFAULTS()` topic is independent of the label you just typed — that's expected, migration only applies to *loaded* files, not manually-added tasks).
4. Migration check: create a text file `/tmp/old-topics.json` with this content (covering: no labels, one label, private first, private in the middle, private absent):
   ```json
   [
     {"uuid":"a","id":1,"labels":[],"name":"no labels","status":"New","createdAt":"2026-01-01","important":false,"urgent":false},
     {"uuid":"b","id":2,"labels":["work"],"name":"one label","status":"New","createdAt":"2026-01-01","important":false,"urgent":false},
     {"uuid":"c","id":3,"labels":["private","work"],"name":"private first","status":"New","createdAt":"2026-01-01","important":false,"urgent":false},
     {"uuid":"d","id":4,"labels":["work","home","Private"],"name":"private middle, mixed case","status":"New","createdAt":"2026-01-01","important":false,"urgent":false},
     {"uuid":"e","id":5,"labels":["home","errands"],"name":"no private","status":"New","createdAt":"2026-01-01","important":false,"urgent":false}
   ]
   ```
   Open it via "Open existing file" (or "Switch file"). In the console run `TaskStore.getAll().map(t => ({name: t.name, topic: t.topic}))` — expect: `''`, `'work'`, `'Private'`, `'Private'`, `'home'` respectively.
5. `TaskStore.topicCounts()` check: with the file from step 4 still loaded, run `TaskStore.topicCounts()` in the console — expect `[{topic:'Private', count:2}, {topic:'home', count:1}, {topic:'work', count:1}]` (2 Private tasks; `home` and `work` tied at 1, alphabetically ordered `home` before `work`).

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Add topic field and migration from old labels array"
```

---

## Task 2: Topic badge (read-only) + remove old label-chip UI

**Files:**
- Modify: `app.js` (`COLUMNS` ~line 44-56, `commitDraft` ~line 487-493, `buildDraftRow`'s `case 'labels':` block ~line 561-589, `renderRows`'s `case 'labels':` block ~line 832-951, the `isPrivate` check ~line 1008, `TaskStore.load`'s topic-migration block from Task 1, `TaskStore.newTask`/`UI`'s `DRAFT_DEFAULTS` from Task 1)
- Modify: `style.css` (`col.col-labels` ~line 160, the "Label chips" block ~line 355-408)

**Interfaces:**
- Consumes: `task.topic`/`draft.topic`, `labelColor(text)` (existing, unchanged).
- Produces: `td.className = 'cell-topic'` badge cells (read-only for now — Task 3 adds the click-to-edit combobox) in both `buildDraftRow` and `renderRows`, matching the `td.cell-quadrant` badge pattern Priority already established.

- [ ] **Step 1: Update `COLUMNS`** — move Topic between Due and Name, remove the old Label entry

Replace the whole `COLUMNS` array:

```js
const COLUMNS = [
  { key: 'id',             label: '#',              type: 'readonly',  sortable: true  },
  { key: 'priority',       label: 'Priority',       type: 'quadrant',  sortable: true  },
  { key: 'createdAt',      label: 'Created',        type: 'date',      sortable: true  },
  { key: 'dueDate',        label: 'Due',            type: 'date',      sortable: true  },
  { key: 'topic',          label: 'Topic',          type: 'topic',     sortable: true  },
  { key: 'name',           label: 'Name',           type: 'text',      sortable: true  },
  { key: 'description',    label: 'Description',    type: 'text',      sortable: false },
  { key: 'nextActionDate', label: 'Next action',    type: 'date',      sortable: true  },
  { key: 'nextAction',     label: 'Next action',    type: 'text',      sortable: false },
  { key: 'contact',        label: 'Contact',        type: 'text',      sortable: true  },
  { key: 'status',         label: 'Status',         type: 'status',    sortable: true  },
];
```

- [ ] **Step 2: Finish the migration — delete `task.labels`**

In `TaskStore.load()`, right after the topic-derivation block Task 1 added, add:

```js
      delete task.labels;
```

So the full block now reads:

```js
      if (typeof task.topic !== 'string') {
        const privateLabel = task.labels.find(l => l.toLowerCase() === 'private');
        task.topic = privateLabel ? 'Private' : (task.labels[0] || '');
      }
      delete task.labels;
```

- [ ] **Step 3: Remove `labels: []` from `TaskStore.newTask()` and `UI`'s `DRAFT_DEFAULTS()`**

In `newTask()`, remove the `labels: [],` line (keep `topic: '',`):
```js
      topic: '',
      status: 'New',
```

In `DRAFT_DEFAULTS()`, remove `labels: [], ` (keep `topic: ''`):
```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', topic: '', status: 'New' });
```

- [ ] **Step 4: Update `commitDraft()`**

Replace:
```js
    TaskStore.add({ ...draft, labels: [...draft.labels] });
```
with:
```js
    TaskStore.add({ ...draft });
```

- [ ] **Step 5: Replace `buildDraftRow`'s `case 'labels':` block with `case 'topic':`**

Remove the entire `case 'labels': { ... break; }` block (the one building a text `<input>` with the `labels-datalist` list attribute and comma/semicolon parsing). Replace it, in the same position (right before `case 'status':`), with:

```js
        case 'topic': {
          td.className = 'cell-topic';
          td.textContent = draft.topic || '';
          if (draft.topic) {
            td.style.background = labelColor(draft.topic);
            td.style.color = '#fff';
          } else {
            td.style.background = '';
            td.style.color = '';
          }
          break;
        }
```

(No click handler yet — Task 3 adds the combobox.)

- [ ] **Step 6: Replace `renderRows`'s `case 'labels':` block with `case 'topic':`**

Remove the entire `case 'labels': { ... break; }` block (the large one with `getLabels`, `renderChips`, drag-and-drop handlers, and the `+` input). Replace it, in the same position (right before `case 'status':`), with:

```js
          case 'topic': {
            td.className = 'cell-topic';
            td.textContent = task.topic || '';
            if (task.topic) {
              td.style.background = labelColor(task.topic);
              td.style.color = '#fff';
            } else {
              td.style.background = '';
              td.style.color = '';
            }
            break;
          }
```

- [ ] **Step 7: Update the `isPrivate` check**

Replace:
```js
      const isPrivate = task.labels.some(l => l.toLowerCase() === 'private');
```
with:
```js
      const isPrivate = !!task.topic && task.topic.toLowerCase() === 'private';
```

- [ ] **Step 8: Update `style.css` column width**

Replace:
```css
col.col-labels         { width: 140px; }
```
with:
```css
col.col-topic           { width: 140px; }
```

- [ ] **Step 9: Replace the "Label chips" CSS block**

Remove the entire block from the `/* ── Label chips ─...` comment through the end of `.label-input:focus { width: 80px; border-bottom: 1px solid var(--accent); }` (this covers `td.cell-labels`, `.label-cell`, `.label-chip`, `.label-chip.dragging`, `.label-chip.drag-over`, `.label-chip[draggable="true"]`, `.label-chip-x`, `.label-chip-x:hover`, `.label-input`, `.label-input:focus`).

Replace it with:

```css
/* ── Topic badge ──────────────────────────────────────────── */
td.cell-topic {
  font-weight: 600;
  cursor: pointer;
  border-radius: var(--radius);
}
```

- [ ] **Step 10: Manual verification — badge rendering**

1. Refresh the app in the browser (with the file from Task 1's migration test still open, or reopen `/tmp/old-topics.json`).
2. Confirm the Topic column now appears between Due and Name, showing a colour-coded badge with the right text for each row (`Private`, `home`, `work`, empty for the no-labels task) — colours should match whatever `labelColor()` produces for each string (don't hardcode expected hex values, just confirm each distinct topic gets a consistent, distinct-looking colour and the same topic string always gets the same colour).
3. Confirm the draft row's Topic cell is present and empty (no badge colour, since `draft.topic` starts `''`).
4. Confirm the private-tagged tasks (`c`, `d`) still render in the separate private table below the main list.
5. Confirm no console errors, and that adding/editing/saving/deleting tasks still works for every other column.
6. Confirm the old Label column, its chips, and its `+` input are completely gone from the table.

- [ ] **Step 11: Commit**

```bash
git add app.js style.css
git commit -m "Render topic as a colored badge; remove old label-chip UI"
```

---

## Task 3: Interactive topic combobox

**Files:**
- Modify: `app.js` (inside the `UI` IIFE: add `openTopicCombobox`/`closeTopicCombobox`; wire click handlers into the `case 'topic':` blocks from Task 2, in both `buildDraftRow` and `renderRows`; add the `closeTopicCombobox()` backstop call in `render()`)
- Modify: `style.css` (add `.topic-combobox`/`.tc-row` styles)

**Interfaces:**
- Produces: `openTopicCombobox(anchorTd, currentValue, onCommit)` — private to the `UI` IIFE. Turns `anchorTd` into a live text input (pre-filled with `currentValue`, selected) and opens a floating suggestion panel below it. Calls `onCommit(value)` with the committed string when the user selects/creates/types-and-confirms a topic, or `onCommit(null)` if the user cancelled (Escape) — callers must treat `null` as "no change, just re-render the existing value." `closeTopicCombobox()` — private, tears down any open combobox WITHOUT calling `onCommit` (used as a safety backstop, same role `closeQuadrantPicker()` plays for the Priority feature).
- Consumes: `TaskStore.topicCounts()`, `labelColor(text)` (both from Task 1 / pre-existing). The `td.cell-topic` cells from Task 2.

- [ ] **Step 1: Add the combobox component**

Inside the `UI` IIFE, add near `openQuadrantPicker`/`closeQuadrantPicker` (same section of the file):

```js
  // ── Topic combobox (shared by draft row + existing rows) ─────────────────
  let openCombobox = null;

  function closeTopicCombobox() {
    if (openCombobox) {
      openCombobox.cleanup();
      openCombobox = null;
    }
  }

  function openTopicCombobox(anchorTd, currentValue, onCommit) {
    closeTopicCombobox();

    let settled = false;

    anchorTd.textContent = '';
    anchorTd.style.background = '';
    anchorTd.style.color = '';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'cell-input';
    inp.value = currentValue || '';
    anchorTd.appendChild(inp);

    const panel = document.createElement('div');
    panel.className = 'topic-combobox';
    document.body.appendChild(panel);

    let items = []; // [{ create: bool, value: string }]
    let highlighted = -1;

    function resolveValue(raw) {
      // Case-insensitive snap to an existing topic's canonical casing, so
      // typing "work" when "Work" already exists doesn't create a duplicate.
      const match = TaskStore.topicCounts().find(c => c.topic.toLowerCase() === raw.toLowerCase());
      return match ? match.topic : raw;
    }

    function positionPanel() {
      const rect = anchorTd.getBoundingClientRect();
      panel.style.left = `${rect.left + window.scrollX}px`;
      panel.style.top = `${rect.bottom + window.scrollY + 2}px`;
      panel.style.minWidth = `${rect.width}px`;
    }

    function renderList() {
      const query = inp.value.trim();
      const lower = query.toLowerCase();
      const counts = TaskStore.topicCounts();
      const matches = lower
        ? counts.filter(c => c.topic.toLowerCase().includes(lower))
        : counts.slice(0, 8);
      items = matches.map(c => ({ create: false, value: c.topic }));
      const exactMatch = counts.some(c => c.topic.toLowerCase() === lower);
      if (query && !exactMatch) items.push({ create: true, value: query });

      highlighted = -1;
      panel.innerHTML = '';
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'tc-row' + (item.create ? ' tc-row-create' : '');
        if (item.create) {
          row.textContent = `Create "${item.value}"`;
        } else {
          row.textContent = item.value;
          row.style.background = labelColor(item.value);
          row.style.color = '#fff';
        }
        row.addEventListener('mousedown', e => {
          e.preventDefault(); // keep the input focused; commit directly here
          finish(item.value);
        });
        panel.appendChild(row);
      });
      positionPanel();
    }

    function updateHighlight() {
      [...panel.children].forEach((row, i) => {
        row.classList.toggle('tc-row-highlighted', i === highlighted);
      });
    }

    function finish(value) {
      settled = true;
      panel.remove();
      openCombobox = null;
      onCommit(value);
    }

    function cancel() {
      settled = true;
      panel.remove();
      openCombobox = null;
      onCommit(null);
    }

    inp.addEventListener('input', renderList);
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) { highlighted = Math.min(highlighted + 1, items.length - 1); updateHighlight(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) { highlighted = Math.max(highlighted - 1, 0); updateHighlight(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlighted >= 0 && items[highlighted]) {
          finish(items[highlighted].value);
        } else {
          const val = inp.value.trim();
          if (val) finish(resolveValue(val));
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    inp.addEventListener('blur', () => {
      if (settled) return; // already handled by a row mousedown or Escape
      const val = inp.value.trim();
      finish(resolveValue(val));
    });

    renderList();
    inp.focus();
    inp.select();

    openCombobox = {
      cleanup: () => { if (!settled) { settled = true; panel.remove(); } }
    };
  }
```

- [ ] **Step 2: Wire it into `buildDraftRow`'s `case 'topic':`**

Replace the block Task 2 added with:

```js
        case 'topic': {
          td.className = 'cell-topic';
          const renderBadge = () => {
            td.textContent = draft.topic || '';
            if (draft.topic) {
              td.style.background = labelColor(draft.topic);
              td.style.color = '#fff';
            } else {
              td.style.background = '';
              td.style.color = '';
            }
          };
          renderBadge();
          // Prevent blur so the draft row isn't committed prematurely while
          // the combobox is open (same idiom as the quadrant picker above).
          td.addEventListener('mousedown', e => e.preventDefault());
          td.addEventListener('click', () => {
            openTopicCombobox(td, draft.topic, value => {
              if (value !== null) draft.topic = value;
              renderBadge();
            });
          });
          break;
        }
```

- [ ] **Step 3: Wire it into `renderRows`'s `case 'topic':`**

Replace the block Task 2 added with:

```js
          case 'topic': {
            td.className = 'cell-topic';
            const applyBadge = t => {
              td.textContent = t.topic || '';
              if (t.topic) {
                td.style.background = labelColor(t.topic);
                td.style.color = '#fff';
              } else {
                td.style.background = '';
                td.style.color = '';
              }
            };
            applyBadge(task);
            td.addEventListener('click', () => {
              openTopicCombobox(td, task.topic, value => {
                if (value !== null) {
                  TaskStore.update(task.uuid, 'topic', value);
                  FileManager.scheduleSave();
                }
                const cur = TaskStore.getAll().find(x => x.uuid === task.uuid);
                applyBadge(cur);
              });
            });
            break;
          }
```

- [ ] **Step 4: Add the `closeTopicCombobox()` backstop in `render()`**

In `UI`'s `render()` function, alongside the existing `closeQuadrantPicker();` backstop call, add:

```js
  function render() {
    closeQuadrantPicker(); // backstop: never leave a picker orphaned by a full re-render
    closeTopicCombobox();  // same backstop, for the topic combobox
    buildColgroup();
    ...
```

- [ ] **Step 5: Add combobox CSS**

Append to `style.css`:

```css
/* ── Topic combobox ───────────────────────────────────────── */
.topic-combobox {
  position: absolute;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px;
  max-height: 240px;
  overflow-y: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  font-family: var(--font);
}
.topic-combobox .tc-row {
  padding: 4px 8px;
  border-radius: calc(var(--radius) - 2px);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.topic-combobox .tc-row:hover,
.topic-combobox .tc-row.tc-row-highlighted {
  filter: brightness(1.1);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.topic-combobox .tc-row-create {
  background: var(--bg-filter);
  color: var(--text-muted);
  font-style: italic;
  font-weight: 500;
}
```

- [ ] **Step 6: Manual verification — combobox interaction**

Use a file with several tasks sharing a handful of topics at different frequencies (e.g. 3× "work", 2× "home", 1× "errands", 1× "Private" — more than 8 distinct topics isn't necessary to test the "top 8" cap, but do use at least 3-4 distinct values).

1. Click an existing row's empty or filled Topic badge. Confirm the cell turns into a text input (pre-filled with the current value, text selected) and a dropdown panel appears below it listing topics most-frequent-first (e.g. "work" before "home" before "errands"/"Private").
2. Type a partial string matching one topic (e.g. "wo"). Confirm the list filters to matching topics only, still frequency-ordered.
3. Type something matching nothing (e.g. "zzz"). Confirm a `Create "zzz"` row appears.
4. Click the `Create "zzz"` row. Confirm: input/panel close, badge shows "zzz" with a colour, and (after autosave or Save) the saved file has that task's `topic: "zzz"`.
5. Click the badge again, press Arrow Down twice then Enter. Confirm the second item in the list gets selected/committed (adjust based on actual list order).
6. Click the badge again, type nothing, press Escape. Confirm: input/panel close, badge reverts to showing the value it had before this edit (unchanged).
7. Click the badge again, type nothing, click elsewhere on the page (outside the cell and panel). Confirm the (empty) input commits as an empty topic — badge becomes blank/uncoloured.
8. Click the badge again, type an existing topic's name in different casing (e.g. "WORK" when "work" exists), press Enter without arrowing to a suggestion. Confirm it commits as `"work"` (canonical casing), not `"WORK"` — check `TaskStore.topicCounts()` in the console afterward to confirm no `"WORK"` duplicate was created.
9. Open two different rows' comboboxes in a row (click row A's badge, then without closing, click row B's badge). Confirm only one combobox panel is ever open at a time.
10. Repeat steps 1-4 on the **draft row**: pick/create a topic, then fill in Name and press **Tab** from the Name field (or just click into Name directly) — confirm Tab from the Topic *combobox itself* does NOT commit the draft (it should have already closed after step 1-4's Enter/click/blur; if you tab out of the Topic cell without having opened the combobox, confirm that's just normal tab navigation to Name too). Fill in Name and press Enter — confirm the new task is created with the chosen topic, and the draft row's Topic resets to empty afterward.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "Add interactive search-as-you-type combobox for the Topic cell"
```

---

## Task 4: Filter row + datalist rename

**Files:**
- Modify: `app.js` (`buildFilterRow`'s generic filter-input branch ~line 701-714, `refreshLabelDatalist` ~line 734-746 and its call site ~line 731, `TaskStore`'s `allLabels` and return statement)

**Interfaces:**
- Consumes: `TaskStore.topicCounts()` (from Task 1).
- Produces: nothing new for later tasks (this is the last code task before docs).

- [ ] **Step 1: Update the generic filter-input branch in `buildFilterRow`**

Replace:
```js
        if (col.type === 'labels') {
          inp.setAttribute('list', 'labels-datalist');
        }
```
with:
```js
        if (col.type === 'topic') {
          inp.setAttribute('list', 'topic-datalist');
        }
```

- [ ] **Step 2: Rename `refreshLabelDatalist` to `refreshTopicDatalist`, rebuild off `topicCounts()`**

Replace the whole function:
```js
  function refreshLabelDatalist() {
    let dl = document.getElementById('labels-datalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'labels-datalist';
      document.body.appendChild(dl);
    }
    dl.replaceChildren(...TaskStore.allLabels().map(l => {
      const opt = document.createElement('option');
      opt.value = l;
      return opt;
    }));
  }
```
with:
```js
  function refreshTopicDatalist() {
    let dl = document.getElementById('topic-datalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'topic-datalist';
      document.body.appendChild(dl);
    }
    dl.replaceChildren(...TaskStore.topicCounts().map(c => {
      const opt = document.createElement('option');
      opt.value = c.topic;
      return opt;
    }));
  }
```

Update its call site at the end of `buildFilterRow()`:
```js
    refreshLabelDatalist();
```
becomes:
```js
    refreshTopicDatalist();
```

- [ ] **Step 3: Remove `TaskStore.allLabels()`**

It's now dead (its only caller was `refreshLabelDatalist`, just renamed/rewritten above). Remove the function:
```js
  function allLabels() {
    return [...new Set(tasks.flatMap(t => t.labels || []).filter(Boolean))].sort();
  }
```
and remove `allLabels` from the module's return statement:
```js
  return { load, add, remove, update, getAll, allLabels, topicCounts, toJSON };
```
becomes:
```js
  return { load, add, remove, update, getAll, topicCounts, toJSON };
```

- [ ] **Step 4: Manual verification — filter and sort**

1. Refresh the app with a file containing tasks across several distinct topics.
2. Click into the Topic filter cell (the search input in the filter row). Confirm typing a topic name (or part of one) filters the visible rows to matching topics (substring match, case-insensitive) — same behavior the old Label filter had.
3. Confirm the filter input offers autocomplete suggestions (browser-native datalist dropdown) drawn from existing topics as you type.
4. Click the Topic column header. Confirm rows sort alphabetically by topic (ascending), empty-topic rows sorting per plain string comparison (empty string first) — this requires no code change, just confirm the existing generic sort path handles it correctly.
5. Click the ✕ "clear all filters" button in the filter row. Confirm the Topic filter clears along with the rest.
6. Confirm `TaskStore.allLabels` is `undefined` in the console (removed) and `TaskStore.topicCounts` still works.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Wire Topic filter datalist to topicCounts; remove dead allLabels"
```

---

## Task 5: Documentation

**Files:**
- Modify: `README.md` (Features list, Usage step 3, Data-format example JSON)
- Modify: `ARCHITECTURE.md` (UI Modules table, Columns table, Interaction Model section, Data Format example JSON)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`'s Features list**

Replace:
```markdown
- **Labels** — free-form chips with drag-to-reorder, autocomplete, and DJB2 hash colours
- **Private section** — tasks tagged `private` appear in a separate table below the main list
```
with:
```markdown
- **Topic** — single-select field with search-as-you-type, create-on-the-fly, and dynamic DJB2 hash colours
- **Private section** — tasks with Topic `Private` appear in a separate table below the main list
```

- [ ] **Step 2: Update `README.md`'s Usage step 3**

Replace:
```markdown
3. Fill in the draft row at the top of the table and press **Enter** (or **Tab** from the Label field) to add a task
```
with:
```markdown
3. Fill in the draft row at the top of the table and press **Enter** (or click ＋) to add a task
```

- [ ] **Step 3: Update `README.md`'s Data-format example**

In the JSON code block, replace:
```json
    "labels": ["work", "urgent"],
```
with:
```json
    "topic": "work",
```

Add a sentence after the existing migration paragraph:
```markdown
Older `labels` arrays are migrated to a single `topic` string on first load
(a `'private'` label anywhere in the array wins; otherwise the first label is
used).
```

- [ ] **Step 4: Update `ARCHITECTURE.md`'s UI Modules table**

Replace:
```markdown
| `UI` | Renders `<table>`, draft row, inline editing, heatmap colouring |
```
with:
```markdown
| `UI` | Renders `<table>`, draft row, inline editing, quadrant/topic popups |
```

- [ ] **Step 5: Update `ARCHITECTURE.md`'s Columns table**

Replace:
```markdown
| `labels` | Label | chips | Array; DJB2 hash colour per label; drag-to-reorder; datalist autocomplete |
```
with a row positioned between `dueDate` and `name` (matching the actual `COLUMNS` order):
```markdown
| `topic` | Topic | topic | Single string; search-as-you-type combobox (click cell), create-on-the-fly, top-8-by-frequency suggestions, DJB2 hash colour |
```

(Move it to sit between the `dueDate` and `name` rows in the table, matching the new column order.)

- [ ] **Step 6: Update `ARCHITECTURE.md`'s Data Format example JSON**

Same replacement as README's Step 3: `"labels": ["work", "urgent"],` → `"topic": "work",`.

- [ ] **Step 7: Update `ARCHITECTURE.md`'s Migration table**

Add a row:
```markdown
| `labels` (array) | converted to a single `topic` string: `'private'` anywhere in the array wins (`topic = 'Private'`), otherwise the first label is used, or `''` if none |
```

- [ ] **Step 8: Update `ARCHITECTURE.md`'s Interaction Model section**

Replace:
```markdown
- **New task**: draft row is always visible at the top of the table; fill in Name
  and press Enter, Tab (from the label field), or click ＋ to commit
- **Labels**: type in the `+` input and press Enter / `,` / `;` to add a chip;
  drag chips to reorder; click × to remove; Tab from the draft label field commits the task
```
with:
```markdown
- **New task**: draft row is always visible at the top of the table; fill in Name
  and press Enter, or click ＋ to commit
- **Topic**: click the cell to edit — text input opens with the current value
  selected, plus a dropdown of the 8 most-frequent existing topics (or filtered
  matches as you type); click a suggestion, press Enter, or click elsewhere to
  commit; a `Create "…"` row appears when nothing matches; Escape cancels
  without changing the value
```

Replace:
```markdown
- **Sort**: click column header → asc → desc → off; labels sort by first chip (user-defined order).
```
with:
```markdown
- **Sort**: click column header → asc → desc → off; topic sorts alphabetically (plain string comparison).
```

Replace:
```markdown
- **Filter**: second header row with `<input>` per column; label column shows datalist;
```
with:
```markdown
- **Filter**: second header row with `<input>` per column; topic column shows datalist autocomplete;
```

- [ ] **Step 9: Manual verification**

Read through both files once, confirm no remaining references to `labels`, "label chip(s)", or "drag-to-reorder" anywhere in either doc (a couple of mentions of "Label" as a column *name* are expected to be gone entirely since the column is renamed to Topic — there should be zero hits for a case-insensitive `grep -n -i 'label\|chip'` sweep, aside from unrelated matches you should individually confirm are false positives, if any).

- [ ] **Step 10: Commit**

```bash
git add README.md ARCHITECTURE.md
git commit -m "Update docs for the topic field"
```
