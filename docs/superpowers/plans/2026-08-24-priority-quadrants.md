# Priority Quadrants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the numeric Impact × Urgency priority model with an Eisenhower quadrant (`base` / `important` / `urgent` / `urg&import`) picked from a 2×2 matrix popup, stored as two booleans and backward-compatible with old files.

**Architecture:** Enceladus is a single `app.js` with no build step and no bundler — everything is plain `<script src="app.js">` (classic, non-module) global scope, organized as IIFE "modules" (`TaskStore`, `SortController`, `FilterController`, `UI`, …) plus a `COLUMNS` config array that drives header/filter/row rendering. This plan follows that pattern exactly: no new files, no framework, no test runner introduced. Verification is manual, in a real browser (`python3 -m http.server`, per README), since that's how this project already verifies changes.

**Tech Stack:** Vanilla JS (ES2020+, no modules/bundler), vanilla CSS, File System Access API. No test framework exists in this repo (see ARCHITECTURE.md "Outstanding / Future Work") — introducing one is out of scope for this feature.

**Spec:** `docs/superpowers/specs/2026-08-24-priority-quadrants-design.md`

## Global Constraints

- No build step: don't add a bundler, transpiler, or npm dependency.
- No test framework introduced in this plan — verify manually in a browser after each task.
- Must stay backward compatible with older `tasks.json` files (`impact`/`urgency`/numeric `priority`) — see Task 1's migration.
- Keep the existing module structure (`TaskStore`, `SortController`, `FilterController`, `UI`) and the `COLUMNS`-driven rendering pattern — no architecture rewrite.
- Zero external requests / dependencies (CSP in `index.html` stays untouched).

---

## Task 1: Data model & migration

**Files:**
- Modify: `app.js` (constants block ~line 8-17, `TaskStore.newTask` ~line 52-69, `TaskStore.load` ~line 71-91, `UI` module's `DRAFT_DEFAULTS` ~line 430)

**Interfaces:**
- Produces: `QUADRANT_STYLE` (object, keys `'base'|'important'|'urgent'|'urg&import'` → `{bg, text}`), `QUADRANT_ORDER` (array of those 4 keys, grid order: important, urg&import, base, urgent), `quadrantLabel(task)` (returns one of the 4 keys), `quadrantRank(task)` (returns 0-3, used by Task 4). All defined as top-level globals (this file has no modules/imports — same pattern as existing `STATUS_STYLE`/`statusOptionsHTML`).
- Consumes: nothing new.

- [ ] **Step 1: Add quadrant constants and helper functions**

Insert right after the `STATUS_STYLE` block (after the closing `};` that currently ends around line 17, before `const COLUMNS = [...]`):

```js
const QUADRANT_STYLE = {
  'base':        { bg: '#16a34a', text: '#fff' }, // green
  'important':   { bg: '#2563eb', text: '#fff' }, // blue
  'urgent':      { bg: '#ea580c', text: '#fff' }, // orange
  'urg&import':  { bg: '#dc2626', text: '#fff' }, // red
};

// Grid order for the 2x2 picker: [top-left, top-right, bottom-left, bottom-right]
// Important axis vertical (top=yes), Urgent axis horizontal (right=yes) —
// urg&import is top-right, base is bottom-left.
const QUADRANT_ORDER = ['important', 'urg&import', 'base', 'urgent'];

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

- [ ] **Step 2: Update `TaskStore.newTask()`**

In the object literal inside `newTask()`, replace:

```js
      impact: 1,
      urgency: 5,
      priority: 5,
```

with:

```js
      important: false,
      urgent: false,
```

- [ ] **Step 3: Update `TaskStore.load()` migration**

Replace the whole `load(data)` function body with:

```js
  function load(data) {
    tasks = data.map(t => {
      const task = { ...t };
      // Migrate old single-string tag field to labels array
      if (!Array.isArray(task.labels)) {
        task.labels = task.tag ? [task.tag] : [];
        delete task.tag;
      }
      // Migrate old "Done" status to "Closed"
      if (task.status === 'Done') task.status = 'Closed';
      // Migrate missing createdAt; truncate old ISO datetime to date
      if (!task.createdAt) task.createdAt = '';
      else if (task.createdAt.length > 10) task.createdAt = task.createdAt.slice(0, 10);
      // Migrate impact/urgency numeric model to important/urgent booleans.
      // Defaults for the old model were impact=1, urgency=5 — anything
      // moved away from the default is treated as "on" for that axis.
      if (task.important === undefined || task.urgent === undefined) {
        const oldImpact  = task.impact  !== undefined ? task.impact  : 1;
        const oldUrgency = task.urgency !== undefined ? task.urgency : 5;
        task.important = oldImpact  !== 1;
        task.urgent    = oldUrgency !== 5;
      }
      delete task.impact;
      delete task.urgency;
      delete task.priority;
      return task;
    });
    nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  }
```

- [ ] **Step 4: Update `UI`'s `DRAFT_DEFAULTS()`**

Replace:

```js
  const DRAFT_DEFAULTS = () => ({ impact: 1, urgency: 5, priority: 5, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', labels: [], status: 'New' });
```

with:

```js
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', labels: [], status: 'New' });
```

- [ ] **Step 5: Manual verification — data layer**

The Priority column will visually show `undefined` after this step (COLUMNS/rendering isn't updated until Task 2) — that's expected, ignore it for this task's verification.

1. Serve the app: `python3 -m http.server` in the repo root, open `http://localhost:8000`.
2. Open DevTools console. Confirm no JS errors on load.
3. Sanity-check the pure functions directly in the console:
   ```js
   quadrantLabel({important:false, urgent:false}) // 'base'
   quadrantLabel({important:true,  urgent:false}) // 'important'
   quadrantLabel({important:false, urgent:true})  // 'urgent'
   quadrantLabel({important:true,  urgent:true})  // 'urg&import'
   quadrantRank({important:true, urgent:true})    // 3
   ```
4. Create a new file, add a task (fill Name, press Enter). Use the Save button (or wait for autosave), then open the saved `tasks.json` in a text editor: confirm the task has `"important": false, "urgent": false` and no `impact`/`urgency`/`priority` keys.
5. Migration check: create a text file `/tmp/old-tasks.json` with this content:
   ```json
   [
     {"uuid":"a","id":1,"impact":1,"urgency":5,"priority":5,"name":"base task","status":"New","labels":[],"createdAt":"2026-01-01"},
     {"uuid":"b","id":2,"impact":8,"urgency":5,"priority":40,"name":"important task","status":"New","labels":[],"createdAt":"2026-01-01"},
     {"uuid":"c","id":3,"impact":1,"urgency":9,"priority":9,"name":"urgent task","status":"New","labels":[],"createdAt":"2026-01-01"},
     {"uuid":"d","id":4,"impact":128,"urgency":10,"priority":1280,"name":"urg&import task","status":"New","labels":[],"createdAt":"2026-01-01"}
   ]
   ```
   Open it via "Open existing file" (or "Switch file"). In the console run `TaskStore.getAll().map(t => ({name: t.name, important: t.important, urgent: t.urgent, label: quadrantLabel(t)}))` — expect base/important/urgent/urg&import respectively, matching each task's name. Save, re-open the file in a text editor, confirm no `impact`/`urgency`/`priority` keys remain.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "Replace impact/urgency/priority with important/urgent booleans"
```

---

## Task 2: Quadrant badge rendering (read-only)

**Files:**
- Modify: `app.js` (`COLUMNS` ~line 19-33, `buildDraftRow` cases ~line 472-529, `renderRows` cases ~line 773-834, remove `IMPACT_VALUES`/`MAX_PRIORITY` ~line 35-36, remove `impactColor`/`urgencyColor`/`priorityColor` ~line 400-402)
- Modify: `style.css` (column widths ~line 152-154, "Impact / Urgency / Priority heatmap cells" block ~line 258-273)

**Interfaces:**
- Consumes: `QUADRANT_STYLE`, `quadrantLabel(task)` from Task 1.
- Produces: `td.cell-quadrant` CSS class and DOM structure that Task 3 will attach a click handler to (same `td` element, `case 'quadrant':` blocks in both `buildDraftRow` and `renderRows`).

- [ ] **Step 1: Update `COLUMNS`**

Replace the three lines:

```js
  { key: 'impact',         label: 'Impact',         type: 'impact',    sortable: true  },
  { key: 'urgency',        label: 'Urgency',        type: 'urgency',   sortable: true  },
  { key: 'priority',       label: 'Priority',       type: 'priority',  sortable: true  },
```

with:

```js
  { key: 'priority',       label: 'Priority',       type: 'quadrant',  sortable: true  },
```

- [ ] **Step 2: Remove now-dead constants and color functions**

Delete these two lines (right after `STATUSES`/before `statusOptionsHTML`, or wherever they now sit after Task 1's insertions):

```js
const IMPACT_VALUES = [1, 2, 4, 8, 16, 32, 64, 128];
const MAX_PRIORITY  = 128 * 10; // 1280
```

Delete these two lines from the heatmap section:

```js
function impactColor(val)   { return heatPale(Math.log2(Math.max(1, val)) / 7); }
function urgencyColor(val)  { return heatPale((Math.max(1, Math.min(10, val)) - 1) / 9); }
function priorityColor(val) { return heatRgb((val - 1) / (MAX_PRIORITY - 1)); }
```

(`heatColor`, `heatRgb`, `heatPale`, `dateUrgencyColor` stay — still used for date highlighting.)

- [ ] **Step 3: Replace the `case 'impact':`/`case 'urgency':`/`case 'priority':` blocks in `buildDraftRow`**

Remove everything from `case 'impact': {` up to (but not including) `case 'date': {` — that's the three contiguous blocks (impact, urgency, priority), including the `<select>`-building code in each. Also remove the `let draftPriorityTd = null;` declaration and the `refreshDraftPriority` function defined just above the `for (const col of COLUMNS)` loop (the block starting `let draftPriorityTd = null;` and ending with the closing `};` of `refreshDraftPriority`) — nothing needs them anymore.

Add a single new case, in the same position (right before `case 'date':`):

```js
        case 'quadrant': {
          td.className = 'cell-quadrant';
          const renderBadge = () => {
            const q = quadrantLabel(draft);
            const st = QUADRANT_STYLE[q];
            td.textContent = q;
            td.style.background = st.bg;
            td.style.color = st.text;
          };
          renderBadge();
          break;
        }
```

(No click handler yet — that's Task 3.)

- [ ] **Step 4: Replace the `case 'impact':`/`case 'urgency':`/`case 'priority':` blocks in `renderRows`**

Remove everything from `case 'impact': {` up to (but not including) `case 'date': {` — the three contiguous blocks (impact with `selI`, urgency with `selU`, priority with the `prioT`-based cell). Also remove the now-unused block above the `for (const task of tasks)` loop that starts with the comment `// Relative priority heatmap — scale to visible set` and defines `priorities`/`minP`/`maxP`/`prioSpan`/`prioT` — it was only feeding the priority heatmap.

Add, in the same position (right before `case 'date':`):

```js
          case 'quadrant': {
            td.className = 'cell-quadrant';
            const q = quadrantLabel(task);
            const st = QUADRANT_STYLE[q];
            td.textContent = q;
            td.style.background = st.bg;
            td.style.color = st.text;
            break;
          }
```

- [ ] **Step 5: Update `style.css` column widths**

Replace:

```css
col.col-impact         { width: 44px; }
col.col-urgency        { width: 44px; }
col.col-priority       { width: 48px; }
```

with:

```css
col.col-priority       { width: 90px; }
```

(`urg&import` needs more horizontal room than the old 3-digit number did.)

- [ ] **Step 6: Update `style.css` cell styling**

Replace:

```css
/* ── Impact / Urgency / Priority heatmap cells ────────────── */
td.cell-impact,
td.cell-urgency,
td.cell-priority {
  font-weight: 700;
  text-align: center;
  font-size: 12px;
  padding: 2px 4px;
}
td.cell-impact select.cell-select,
td.cell-urgency select.cell-select {
  text-align: center;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
}
```

with:

```css
/* ── Quadrant badge ───────────────────────────────────────── */
td.cell-quadrant {
  font-weight: 700;
  text-align: center;
  font-size: 11px;
  padding: 2px 4px;
  cursor: pointer;
  border-radius: var(--radius);
}
```

- [ ] **Step 7: Manual verification — badge rendering**

1. Refresh the app in the browser (with a file open that has a mix of quadrant values, e.g. from Task 1's migration test).
2. Confirm the Priority column shows a colored badge with the correct text (`base`/`important`/`urgent`/`urg&import`) and correct color (green/blue/orange/red) for each row.
3. Confirm the draft row's Priority cell shows a green `base` badge.
4. Confirm no console errors, and that adding/editing/saving/deleting tasks still works for every other column (this task shouldn't have touched anything else).

- [ ] **Step 8: Commit**

```bash
git add app.js style.css
git commit -m "Render priority as a colored quadrant badge"
```

---

## Task 3: Interactive 2×2 quadrant picker

**Files:**
- Modify: `app.js` (inside the `UI` IIFE: add a private `openQuadrantPicker`/`closeQuadrantPicker` pair; wire click handlers into the `case 'quadrant':` blocks added in Task 2, in both `buildDraftRow` and `renderRows`)
- Modify: `style.css` (add `.quadrant-picker` popup styles)

**Interfaces:**
- Produces: `openQuadrantPicker(anchorTd, onSelect)` — a function private to the `UI` IIFE (not exposed on the module's public `return {...}`), where `onSelect` is called with one of `QUADRANT_ORDER`'s values when the user picks a quadrant; the picker closes itself after calling `onSelect`, or on outside-click/Escape without calling it.
- Consumes: `QUADRANT_STYLE`, `QUADRANT_ORDER`, `quadrantLabel` from Task 1; the `td.cell-quadrant` cells from Task 2.

- [ ] **Step 1: Add the picker component**

Inside the `UI` IIFE (`const UI = (() => { ... })()`), add near the top (alongside `DRAFT_DEFAULTS`/before `commitDraft`, since both draft and row rendering will use it):

```js
  // ── Quadrant picker (shared by draft row + existing rows) ────────────────
  let openPicker = null;

  function closeQuadrantPicker() {
    if (openPicker) {
      openPicker.panel.remove();
      document.removeEventListener('mousedown', openPicker.onOutsideClick, true);
      document.removeEventListener('keydown', openPicker.onKeydown, true);
      openPicker = null;
    }
  }

  function openQuadrantPicker(anchorTd, onSelect) {
    closeQuadrantPicker();

    const panel = document.createElement('div');
    panel.className = 'quadrant-picker';
    QUADRANT_ORDER.forEach(q => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'qp-cell';
      btn.textContent = q;
      const st = QUADRANT_STYLE[q];
      btn.style.background = st.bg;
      btn.style.color = st.text;
      btn.addEventListener('click', () => {
        onSelect(q);
        closeQuadrantPicker();
      });
      panel.appendChild(btn);
    });
    document.body.appendChild(panel);

    const rect = anchorTd.getBoundingClientRect();
    panel.style.left = `${rect.left + window.scrollX}px`;
    panel.style.top  = `${rect.bottom + window.scrollY + 2}px`;

    const onOutsideClick = e => { if (!panel.contains(e.target)) closeQuadrantPicker(); };
    const onKeydown = e => { if (e.key === 'Escape') closeQuadrantPicker(); };
    // Defer listener registration so the click that opened the picker
    // (which is still bubbling) doesn't immediately close it.
    setTimeout(() => {
      document.addEventListener('mousedown', onOutsideClick, true);
      document.addEventListener('keydown', onKeydown, true);
    }, 0);

    openPicker = { panel, onOutsideClick, onKeydown };
  }
```

- [ ] **Step 2: Wire it into `buildDraftRow`'s `case 'quadrant':`**

Replace the block added in Task 2 with:

```js
        case 'quadrant': {
          td.className = 'cell-quadrant';
          const renderBadge = () => {
            const q = quadrantLabel(draft);
            const st = QUADRANT_STYLE[q];
            td.textContent = q;
            td.style.background = st.bg;
            td.style.color = st.text;
          };
          renderBadge();
          td.addEventListener('click', () => {
            openQuadrantPicker(td, q => {
              draft.important = (q === 'important' || q === 'urg&import');
              draft.urgent    = (q === 'urgent'    || q === 'urg&import');
              renderBadge();
            });
          });
          break;
        }
```

- [ ] **Step 3: Wire it into `renderRows`'s `case 'quadrant':`**

Replace the block added in Task 2 with:

```js
          case 'quadrant': {
            td.className = 'cell-quadrant';
            const applyBadge = t => {
              const q = quadrantLabel(t);
              const st = QUADRANT_STYLE[q];
              td.textContent = q;
              td.style.background = st.bg;
              td.style.color = st.text;
            };
            applyBadge(task);
            td.addEventListener('click', () => {
              openQuadrantPicker(td, q => {
                const important = (q === 'important' || q === 'urg&import');
                const urgent    = (q === 'urgent'    || q === 'urg&import');
                TaskStore.update(task.uuid, 'important', important);
                TaskStore.update(task.uuid, 'urgent', urgent);
                FileManager.scheduleSave();
                const cur = TaskStore.getAll().find(x => x.uuid === task.uuid);
                applyBadge(cur);
              });
            });
            break;
          }
```

- [ ] **Step 4: Add picker CSS**

Append to `style.css`:

```css
/* ── Quadrant picker ──────────────────────────────────────── */
.quadrant-picker {
  position: absolute;
  z-index: 1000;
  display: grid;
  grid-template-columns: repeat(2, 72px);
  grid-template-rows: repeat(2, 40px);
  gap: 2px;
  padding: 2px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.quadrant-picker .qp-cell {
  border: none;
  border-radius: calc(var(--radius) - 2px);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2px;
  font-family: var(--font);
}
.quadrant-picker .qp-cell:hover { filter: brightness(1.1); }
```

- [ ] **Step 5: Manual verification — picker interaction**

1. Refresh the app. Click an existing row's Priority badge.
2. Confirm a 2×2 popup appears directly below the cell, with 4 colored buttons in this layout: top-left `important` (blue), top-right `urg&import` (red), bottom-left `base` (green), bottom-right `urgent` (orange).
3. Click `urg&import`. Confirm: popup closes, badge updates to red `urg&import`, and (after the 500ms autosave debounce, or via Save) the saved file shows `"important": true, "urgent": true` for that task.
4. Reopen the file (or refresh + reopen) — confirm the value persisted.
5. Click the badge again, then click outside the popup (anywhere else on the page) — confirm it closes without changing the value.
6. Click the badge again, press `Escape` — confirm it closes without changing the value.
7. Repeat steps 2-3 on the **draft row**: pick a quadrant, then fill in Name and press Enter to commit the task — confirm the new task is created with the chosen `important`/`urgent` values, and the draft row resets to `base` afterward.
8. Open two different rows' pickers in a row (click row A's badge, then without closing, click row B's badge) — confirm only one popup is ever open at a time.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "Add interactive 2x2 quadrant picker for the Priority cell"
```

---

## Task 4: Sort integration

**Files:**
- Modify: `app.js` (`SortController.apply` ~line 316-340)

**Interfaces:**
- Consumes: `quadrantRank(task)` from Task 1.

- [ ] **Step 1: Update the numeric-sort branch**

Replace:

```js
      // numeric
      if (sortKey === 'id' || sortKey === 'priority') {
        av = Number(av) || 0; bv = Number(bv) || 0;
      }
```

with:

```js
      // numeric
      if (sortKey === 'id') {
        av = Number(av) || 0; bv = Number(bv) || 0;
      }
      // priority: rank by quadrant (base=0 ... urg&import=3), not the old numeric field
      if (sortKey === 'priority') {
        av = quadrantRank(a); bv = quadrantRank(b);
      }
```

- [ ] **Step 2: Manual verification — sort**

1. Refresh the app with a file containing tasks in all 4 quadrants.
2. Click the Priority column header once (ascending): confirm order is `base, important, urgent, urg&import` (ties keep their relative order — that's fine, `Array.prototype.sort` stability isn't a requirement here).
3. Click again (descending): confirm order is `urg&import, urgent, important, base`.
4. Click a third time: confirm sort turns off and reverts to the default (Next Action ascending, per `SortController.reset`/default state) — unrelated to this change, just confirming the header's asc→desc→off cycle still works.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "Sort Priority column by quadrant rank"
```

---

## Task 5: Filter integration

**Files:**
- Modify: `app.js` (`FilterController.apply` ~line 356-365, `buildFilterRow` ~line 665-712)

**Interfaces:**
- Consumes: `quadrantLabel(task)`, `QUADRANT_ORDER` from Task 1.

- [ ] **Step 1: Update `FilterController.apply`**

Replace:

```js
  function apply(tasks) {
    return tasks.filter(task =>
      Object.entries(filters).every(([k, v]) => {
        if (!v) return true;
        const cell = String(task[k] ?? '').toLowerCase();
        if (v.startsWith('!')) return cell !== v.slice(1);
        return cell.includes(v);
      })
    );
  }
```

with:

```js
  function apply(tasks) {
    return tasks.filter(task =>
      Object.entries(filters).every(([k, v]) => {
        if (!v) return true;
        if (k === 'priority') return quadrantLabel(task) === v;
        const cell = String(task[k] ?? '').toLowerCase();
        if (v.startsWith('!')) return cell !== v.slice(1);
        return cell.includes(v);
      })
    );
  }
```

- [ ] **Step 2: Update `buildFilterRow` to render a select for the priority column**

Currently:

```js
      if (col.type === 'status') {
        const sel = document.createElement('select');
        sel.innerHTML = `<option value="">All</option>` +
          `<option value="!closed">Active (hide Closed)</option>` +
          STATUSES.map(s => `<option value="${s.toLowerCase()}">${s}</option>`).join('');
        sel.value = FilterController.get(col.key);
        sel.addEventListener('change', e => {
          FilterController.set(col.key, e.target.value);
          renderBody();
        });
        th.appendChild(sel);
      } else {
```

Change the condition and add a branch, so it reads:

```js
      if (col.type === 'status') {
        const sel = document.createElement('select');
        sel.innerHTML = `<option value="">All</option>` +
          `<option value="!closed">Active (hide Closed)</option>` +
          STATUSES.map(s => `<option value="${s.toLowerCase()}">${s}</option>`).join('');
        sel.value = FilterController.get(col.key);
        sel.addEventListener('change', e => {
          FilterController.set(col.key, e.target.value);
          renderBody();
        });
        th.appendChild(sel);
      } else if (col.type === 'quadrant') {
        const sel = document.createElement('select');
        sel.innerHTML = `<option value="">All</option>` +
          QUADRANT_ORDER.map(q => `<option value="${q}">${q}</option>`).join('');
        sel.value = FilterController.get(col.key);
        sel.addEventListener('change', e => {
          FilterController.set(col.key, e.target.value);
          renderBody();
        });
        th.appendChild(sel);
      } else {
```

- [ ] **Step 3: Manual verification — filter**

1. Refresh the app with a file containing tasks in all 4 quadrants.
2. Confirm the Priority filter cell is now a dropdown with `All`, `base`, `important`, `urgent`, `urg&import`.
3. Pick `urg&import`: confirm only urg&import tasks show.
4. Pick `All`: confirm all tasks show again (respecting the Status column's own filter, unrelated).
5. Click the ✕ "clear all filters" button in the filter row: confirm the Priority filter resets to `All` along with the rest.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "Filter Priority column by quadrant"
```

---

## Task 6: Documentation

**Files:**
- Modify: `README.md` (Features list, "Data format" example JSON)
- Modify: `ARCHITECTURE.md` (Columns table, Heatmap Colours section, Data Format example JSON, Migration table)

**Interfaces:** none (docs only).

- [ ] **Step 1: Update `README.md`'s Features list**

Replace:

```markdown
- **Eisenhower-style prioritisation** — Impact (powers of 2) × Urgency (1–10) = Priority, visualised with a full heatmap
```

with:

```markdown
- **Eisenhower-quadrant prioritisation** — pick `base` / `important` / `urgent` / `urg&import` from a colour-coded 2×2 matrix popup
```

- [ ] **Step 2: Update `README.md`'s "Data format" example**

In the JSON code block, replace:

```json
    "impact": 8,
    "urgency": 7,
    "priority": 56,
```

with:

```json
    "important": true,
    "urgent": true,
```

Also add a line after the existing migration sentence ("The loader migrates older formats transparently (single `tag` string → `labels` array, `"Done"` → `"Closed"`, etc.)."):

```markdown
`impact`/`urgency`/numeric `priority` from older files are migrated to
`important`/`urgent` booleans on first load.
```

- [ ] **Step 3: Update `ARCHITECTURE.md`'s Columns table**

Replace these three rows:

```markdown
| `impact` | Impact | select | Powers of 2: 1, 2, 4, 8, 16, 32, 64, 128. Pale heatmap. |
| `urgency` | Urgency | select | 1–10. Pale heatmap. |
| `priority` | Priority | computed | `impact × urgency` (5–1280). Full-saturation heatmap, relative to visible rows. Read-only. |
```

with:

```markdown
| `priority` | Priority | quadrant | One of `base`/`important`/`urgent`/`urg&import`, picked via a 2×2 matrix popup (click the cell). Colour-coded badge. |
```

- [ ] **Step 4: Update `ARCHITECTURE.md`'s Heatmap Colours section**

Replace:

```markdown
## Heatmap Colours

`heatColor(t)` maps `t ∈ [0, 1]` → `[r, g, b]` along green → amber → red.

- **Impact / Urgency**: `heatPale` — 40% colour + 60% white (pastel). Dark text.
- **Priority**: `heatRgb` — full saturation. White text. Range is relative to the
  currently visible task set (min–max), so contrast is always maximised.
```

with:

```markdown
## Heatmap Colours

`heatColor(t)` maps `t ∈ [0, 1]` → `[r, g, b]` along green → amber → red. Used
for Due / Next Action date highlighting (`dateUrgencyColor`).

## Priority Quadrants

Priority is stored as two booleans, `important` and `urgent`, and displayed as
one of four colour-coded badges:

| Quadrant     | Colour |
|--------------|--------|
| `base`       | Green  |
| `important`  | Blue   |
| `urgent`     | Orange |
| `urg&import` | Red    |

Clicking the Priority cell opens a 2×2 matrix picker — Important axis
vertical (top = yes), Urgent axis horizontal (right = yes); Important+Urgent
(`urg&import`) is the top-right cell — to set both booleans at once.
```

- [ ] **Step 5: Update `ARCHITECTURE.md`'s Data Format example JSON**

Same replacement as README's Step 2: `"impact": 8, "urgency": 7, "priority": 56,` → `"important": true, "urgent": true,`.

- [ ] **Step 6: Update `ARCHITECTURE.md`'s Migration table**

Add a row to the existing Migration table:

```markdown
| `impact`/`urgency`/`priority` (numeric) | converted to `important`/`urgent` booleans: `important = impact !== 1`, `urgent = urgency !== 5` (old defaults); old fields deleted |
```

- [ ] **Step 7: Manual verification**

Read through both files once, confirm no remaining references to `impact`, `urgency`, or the old numeric `priority` model anywhere in either doc.

- [ ] **Step 8: Commit**

```bash
git add README.md ARCHITECTURE.md
git commit -m "Update docs for priority quadrants"
```
