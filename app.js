// ── Enceladus Todo App ─────────────────────────────────────────────────────
// Client-side only. No external requests. File System Access API for storage.

// ── Constants ──────────────────────────────────────────────────────────────

const STATUSES = ['New', 'In Progress', 'Today', 'Pending feedback', 'On-Hold', 'Closed'];

const STATUS_STYLE = {
  'New':              { bg: '#d97706', text: '#fff' },  // amber
  'In Progress':      { bg: '#15803d', text: '#fff' },  // dark green
  'Today':            { bg: '#2563eb', text: '#fff' },  // bright blue
  'Pending feedback': { bg: '#7c3aed', text: '#fff' },  // dim purple
  'On-Hold':          { bg: '#9ca3af', text: '#1a1a1a' }, // mid grey
  'Closed':           { bg: '#4b5563', text: '#d1d5db' }, // dark grey
};

const COLUMNS = [
  { key: 'id',             label: '#',              type: 'readonly',  sortable: true  },
  { key: 'impact',         label: 'Impact',         type: 'impact',    sortable: true  },
  { key: 'urgency',        label: 'Urgency',        type: 'urgency',   sortable: true  },
  { key: 'priority',       label: 'Priority',       type: 'priority',  sortable: true  },
  { key: 'createdAt',      label: 'Created',        type: 'date',      sortable: true  },
  { key: 'dueDate',        label: 'Due',            type: 'date',      sortable: true  },
  { key: 'name',           label: 'Name',           type: 'text',      sortable: true  },
  { key: 'description',    label: 'Description',    type: 'text',      sortable: false },
  { key: 'nextActionDate', label: 'Next action',    type: 'date',      sortable: true  },
  { key: 'nextAction',     label: 'Next action',    type: 'text',      sortable: false },
  { key: 'contact',        label: 'Contact',        type: 'text',      sortable: true  },
  { key: 'labels',         label: 'Label',          type: 'labels',    sortable: true  },
  { key: 'status',         label: 'Status',         type: 'status',    sortable: true  },
];

const IMPACT_VALUES = [1, 2, 4, 8, 16, 32, 64, 128];
const MAX_PRIORITY  = 128 * 10; // 1280

// Pre-built option HTML with per-status colors (used in every status select)
function statusOptionsHTML(selected) {
  return STATUSES.map(s => {
    const st = STATUS_STYLE[s];
    return `<option value="${s}" style="background:${st.bg};color:${st.text}"${s === selected ? ' selected' : ''}>${s}</option>`;
  }).join('');
}

// ── TaskStore ───────────────────────────────────────────────────────────────

const TaskStore = (() => {
  let tasks = [];
  let nextId = 1;

  function newTask() {
    return {
      uuid: crypto.randomUUID(),
      id: nextId++,
      impact: 1,
      urgency: 5,
      priority: 5,
      createdAt: new Date().toISOString().slice(0, 10),
      dueDate: '',
      nextActionDate: '',
      name: '',
      description: '',
      nextAction: '',
      contact: '',
      labels: [],
      status: 'New',
    };
  }

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
      // Migrate to impact/urgency model
      if (task.impact === undefined) task.impact = 1;
      if (task.urgency === undefined) task.urgency = 5;
      task.priority = task.impact * task.urgency;
      return task;
    });
    nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  }

  function add(overrides = {}) {
    const t = { ...newTask(), ...overrides };
    tasks.push(t);
    return t;
  }

  function remove(uuid) {
    tasks = tasks.filter(t => t.uuid !== uuid);
  }

  function update(uuid, key, value) {
    const t = tasks.find(t => t.uuid === uuid);
    if (t) t[key] = value;
  }

  function getAll()  { return tasks; }

  function allLabels() {
    return [...new Set(tasks.flatMap(t => t.labels || []).filter(Boolean))].sort();
  }

  function toJSON() { return JSON.stringify(tasks, null, 2); }

  return { load, add, remove, update, getAll, allLabels, toJSON };
})();

// ── IDB handle store ────────────────────────────────────────────────────────
// FileSystemFileHandle objects can be persisted in IndexedDB (not JSON).

const HandleStore = (() => {
  const DB = 'enceladus-db', STORE = 'handles', KEY = 'last';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror  = e => reject(e.target.error);
    });
  }

  async function save(handle) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = resolve;
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function load() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  return { save, load };
})();

// ── FileManager ─────────────────────────────────────────────────────────────

const FileManager = (() => {
  let fileHandle   = null;
  let saveTimer    = null;
  let lastSaveTime = null;
  let agoTimer     = null;
  const supported  = 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

  function formatSaveStatus(date) {
    const now    = new Date();
    const today  = date.toDateString() === now.toDateString();
    const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const label  = today ? timePart : `${date.toLocaleDateString()} ${timePart}`;

    const sec  = Math.floor((now - date) / 1000);
    const min  = Math.floor(sec  / 60);
    const hr   = Math.floor(min  / 60);
    const days = Math.floor(hr   / 24);
    const ago  = sec < 10  ? 'just now'
               : sec < 60  ? `${sec}s ago`
               : min < 60  ? `${min}m ago`
               : hr  < 24  ? `${hr}h ago`
               :              `${days}d ago`;

    return `Saved ✓ ${label} (${ago})`;
  }

  async function loadHandle(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    TaskStore.load(JSON.parse(text));
    fileHandle = handle;
    UI.setBanner(handle.name);
    UI.render();
    UI.setSaveStatus('Loaded');
    HandleStore.save(handle);
  }

  // Open an existing JSON file, load its tasks, return true on success.
  async function open() {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      await loadHandle(handle);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return false;
    }
  }

  // Create a new empty file, return true on success.
  async function create() {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'tasks.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      fileHandle = handle;
      TaskStore.load([]);
      await writeToHandle();
      UI.setBanner(handle.name);
      UI.render();
      UI.setSaveStatus('Ready');
      HandleStore.save(handle);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return false;
    }
  }

  // Reopen a persisted handle — requires a user gesture for requestPermission.
  async function reopen(handle) {
    try {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'prompt') {
        const granted = await handle.requestPermission({ mode: 'readwrite' });
        if (granted !== 'granted') return false;
      } else if (perm !== 'granted') {
        return false;
      }
      await loadHandle(handle);
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    UI.setSaveStatus('Unsaved…');
    document.getElementById('btn-save').disabled = false;
    if (fileHandle) {
      saveTimer = setTimeout(writeToHandle, 500);
    }
  }

  async function writeToHandle() {
    if (!fileHandle) return;
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(TaskStore.toJSON());
      await writable.close();
      lastSaveTime = new Date();
      clearInterval(agoTimer);
      UI.setSaveStatus(formatSaveStatus(lastSaveTime));
      agoTimer = setInterval(() => UI.setSaveStatus(formatSaveStatus(lastSaveTime)), 30_000);
      document.getElementById('btn-save').disabled = true;
    } catch (e) {
      console.error(e);
      UI.setSaveStatus('Save failed');
    }
  }

  // Called by Save button — writes immediately (no debounce).
  async function save() {
    await writeToHandle();
  }

  return { open, create, reopen, save, scheduleSave, supported };
})();

// ── SortController ──────────────────────────────────────────────────────────

const SortController = (() => {
  let sortKey = 'id';
  let sortDir = -1; // default: newest first

  function toggle(key) {
    if (sortKey === key) {
      if (sortDir === 1) { sortDir = -1; }
      else { sortKey = null; sortDir = 1; }
    } else {
      sortKey = key; sortDir = 1;
    }
    UI.render();
  }

  function apply(tasks) {
    if (!sortKey) return [...tasks];
    return [...tasks].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      // numeric
      if (sortKey === 'id' || sortKey === 'priority') {
        av = Number(av) || 0; bv = Number(bv) || 0;
      }
      // labels: sort by first label as ordered in the cell; no labels sorts last
      if (sortKey === 'labels') {
        av = Array.isArray(av) && av.length ? av[0].toLowerCase() : '￿';
        bv = Array.isArray(bv) && bv.length ? bv[0].toLowerCase() : '￿';
      }
      // date strings sort lexicographically correctly (ISO format)
      if (av < bv) return -sortDir;
      if (av > bv) return  sortDir;
      return 0;
    });
  }

  function getState() { return { sortKey, sortDir }; }

  return { toggle, apply, getState };
})();

// ── FilterController ────────────────────────────────────────────────────────

const FilterController = (() => {
  let filters = { status: '!closed' }; // default: hide Closed

  function set(key, value) { filters[key] = value.toLowerCase(); }

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

  function get(key) { return filters[key] ?? ''; }

  return { set, apply, get };
})();

// ── Heatmap colours ─────────────────────────────────────────────────────────
// t in [0,1]: 0 = green, 0.5 = amber, 1 = red

function heatColor(t) {
  t = Math.min(1, Math.max(0, t));
  let r, g, b;
  if (t <= 0.5) {
    const s = t / 0.5;
    r = Math.round(76  + s * (255 - 76));
    g = Math.round(175 + s * (152 - 175));
    b = Math.round(80  + s * (0   - 80));
  } else {
    const s = (t - 0.5) / 0.5;
    r = Math.round(255 + s * (244 - 255));
    g = Math.round(152 + s * (67  - 152));
    b = Math.round(0   + s * (54  - 0));
  }
  return [r, g, b];
}

function heatRgb(t)  { const [r,g,b] = heatColor(t); return `rgb(${r},${g},${b})`; }
function heatPale(t) {
  const [r,g,b] = heatColor(t);
  return `rgb(${Math.round(r*0.4+255*0.6)},${Math.round(g*0.4+255*0.6)},${Math.round(b*0.4+255*0.6)})`;
}

function impactColor(val)   { return heatPale(Math.log2(Math.max(1, val)) / 7); }
function urgencyColor(val)  { return heatPale((Math.max(1, Math.min(10, val)) - 1) / 9); }
function priorityColor(val) { return heatRgb((val - 1) / (MAX_PRIORITY - 1)); }

// ── Label colour (DJB2 hash → HSL) ─────────────────────────────────────────

function labelColor(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    h |= 0;
  }
  return `hsl(${Math.abs(h) % 360}, 58%, 38%)`;
}

// ── UI ──────────────────────────────────────────────────────────────────────

const UI = (() => {
  // ── Draft row (new task input) ────────────────────────────────────────────
  const DRAFT_DEFAULTS = () => ({ impact: 1, urgency: 5, priority: 5, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', labels: [], status: 'New' });
  let draft = DRAFT_DEFAULTS();

  function commitDraft() {
    if (!draft.name.trim()) return;
    TaskStore.add({ ...draft, labels: [...draft.labels] });
    FileManager.scheduleSave();
    draft = DRAFT_DEFAULTS();
    render();
  }

  function buildDraftRow() {
    const tr = document.createElement('tr');
    tr.className = 'draft-row';

    // Commit when focus leaves the entire row (tab-between-cells safe)
    let blurTimer = null;
    tr.addEventListener('focusout', () => {
      blurTimer = setTimeout(() => {
        if (!tr.contains(document.activeElement)) commitDraft();
      }, 150);
    });
    tr.addEventListener('focusin', () => clearTimeout(blurTimer));

    let draftPriorityTd = null;
    const refreshDraftPriority = () => {
      if (draftPriorityTd) {
        draftPriorityTd.textContent = draft.priority;
        draftPriorityTd.style.background = priorityColor(draft.priority);
      }
    };

    for (const col of COLUMNS) {
      const td = document.createElement('td');
      td.dataset.key = col.key;

      switch (col.type) {
        case 'readonly':
          td.className = 'cell-id draft-id';
          td.textContent = '+';
          break;

        case 'impact': {
          td.className = 'cell-impact';
          td.style.background = impactColor(draft.impact);
          td.style.color = '#1a1a1a';
          const sel = document.createElement('select');
          sel.className = 'cell-select';
          sel.style.cssText = 'background:transparent;color:inherit;font-weight:700;width:100%;text-align:center;';
          IMPACT_VALUES.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v;
            opt.style.background = impactColor(v);
            opt.style.color = '#1a1a1a';
            if (v === draft.impact) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener('change', e => {
            draft.impact = Number(e.target.value);
            draft.priority = draft.impact * draft.urgency;
            td.style.background = impactColor(draft.impact);
            refreshDraftPriority();
          });
          td.appendChild(sel);
          break;
        }

        case 'urgency': {
          td.className = 'cell-urgency';
          td.style.background = urgencyColor(draft.urgency);
          td.style.color = '#1a1a1a';
          const sel = document.createElement('select');
          sel.className = 'cell-select';
          sel.style.cssText = 'background:transparent;color:inherit;font-weight:700;width:100%;text-align:center;';
          for (let v = 1; v <= 10; v++) {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v;
            opt.style.background = urgencyColor(v);
            opt.style.color = '#1a1a1a';
            if (v === draft.urgency) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.addEventListener('change', e => {
            draft.urgency = Number(e.target.value);
            draft.priority = draft.impact * draft.urgency;
            td.style.background = urgencyColor(draft.urgency);
            refreshDraftPriority();
          });
          td.appendChild(sel);
          break;
        }

        case 'priority': {
          td.className = 'cell-priority';
          draftPriorityTd = td;
          td.textContent = draft.priority;
          td.style.background = priorityColor(draft.priority);
          td.style.color = '#fff';
          break;
        }

        case 'date': {
          const inp = document.createElement('input');
          inp.type = 'date'; inp.className = 'cell-input';
          inp.value = draft[col.key] || '';
          inp.classList.toggle('date-empty', !inp.value);
          inp.addEventListener('change', e => {
            draft[col.key] = e.target.value;
            inp.classList.toggle('date-empty', !e.target.value);
          });
          td.appendChild(inp);
          break;
        }

        case 'labels': {
          td.className = 'cell-labels';
          const inp = document.createElement('input');
          inp.type = 'text'; inp.className = 'cell-input';
          inp.placeholder = 'Labels…';
          inp.setAttribute('list', 'labels-datalist');
          inp.value = draft.labels.join(', ');
          inp.addEventListener('change', e => {
            draft.labels = e.target.value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
          });
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const raw = inp.value.trim();
              if (raw) draft.labels = [...new Set(raw.split(/[,;]/).map(s => s.trim()).filter(Boolean))];
              commitDraft();
            }
          });
          td.appendChild(inp);
          break;
        }

        case 'status': {
          td.className = 'cell-status';
          const applyDraftStatus = s => {
            const st = STATUS_STYLE[s] || STATUS_STYLE['New'];
            td.style.background = st.bg;
            td.style.color = st.text;
          };
          applyDraftStatus(draft.status);
          const sel = document.createElement('select');
          sel.className = 'cell-select';
          sel.style.cssText = 'background:transparent;color:inherit;font-weight:600;';
          sel.innerHTML = statusOptionsHTML(draft.status);
          sel.addEventListener('change', e => { draft.status = e.target.value; applyDraftStatus(e.target.value); });
          td.appendChild(sel);
          break;
        }

        default: { // text
          td.contentEditable = 'true';
          td.textContent = draft[col.key] || '';
          td.dataset.placeholder = col.label + '…';
          td.addEventListener('input', e => { draft[col.key] = e.target.textContent; });
          td.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDraft(); }
          });
          break;
        }
      }
      tr.appendChild(td);
    }

    // Commit button (prevents blur so typing isn't lost)
    const tdAct = document.createElement('td');
    tdAct.className = 'cell-del';
    const btnAdd = document.createElement('button');
    btnAdd.className = 'btn-del btn-draft-commit';
    btnAdd.title = 'Add task (Enter)';
    btnAdd.textContent = '＋';
    btnAdd.addEventListener('mousedown', e => e.preventDefault());
    btnAdd.addEventListener('click', commitDraft);
    tdAct.appendChild(btnAdd);
    tr.appendChild(tdAct);

    return tr;
  }

  function focusDraftName() {
    const cell = document.querySelector('.draft-row td[data-placeholder="Name…"]');
    if (cell) cell.focus();
  }

  // Build colgroup once
  function buildColgroup() {
    let cg = '<colgroup>';
    for (const col of COLUMNS) cg += `<col class="col-${col.key}">`;
    cg += '<col class="col-del">';
    cg += '</colgroup>';
    // inject only once
    const tbl = document.getElementById('task-table');
    if (!tbl.querySelector('colgroup')) {
      tbl.insertAdjacentHTML('afterbegin', cg);
    }
  }

  function buildHeaders() {
    const { sortKey, sortDir } = SortController.getState();
    const row = document.getElementById('header-row');
    row.innerHTML = '';
    for (const col of COLUMNS) {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.sortable) {
        if (sortKey === col.key) th.classList.add(sortDir === 1 ? 'sorted-asc' : 'sorted-desc');
        th.addEventListener('click', () => SortController.toggle(col.key));
      } else {
        th.style.cursor = 'default';
      }
      row.appendChild(th);
    }
    // delete col header
    const thDel = document.createElement('th');
    thDel.className = 'th-del';
    row.appendChild(thDel);
  }

  function buildFilterRow() {
    const row = document.getElementById('filter-row');
    row.innerHTML = '';
    for (const col of COLUMNS) {
      const th = document.createElement('th');
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
        const inp = document.createElement('input');
        inp.type = 'search';
        inp.placeholder = col.label;
        inp.value = FilterController.get(col.key);
        if (col.type === 'labels') {
          inp.setAttribute('list', 'labels-datalist');
        }
        inp.addEventListener('input', e => {
          FilterController.set(col.key, e.target.value);
          renderBody();
        });
        th.appendChild(inp);
      }
      row.appendChild(th);
    }
    // spacer for delete column
    row.appendChild(document.createElement('th'));
    refreshLabelDatalist();
  }

  function refreshLabelDatalist() {
    let dl = document.getElementById('labels-datalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'labels-datalist';
      document.body.appendChild(dl);
    }
    dl.innerHTML = TaskStore.allLabels().map(l => `<option value="${l}">`).join('');
  }

  function renderRows(tasks, preserveDraft = false) {
    const tbody = document.getElementById('task-body');
    if (preserveDraft) {
      tbody.querySelectorAll('tr:not(.draft-row)').forEach(r => r.remove());
    } else {
      tbody.innerHTML = '';
      tbody.appendChild(buildDraftRow());
    }

    if (tasks.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      const td = document.createElement('td');
      td.colSpan = COLUMNS.length + 1;
      td.textContent = 'No tasks. Open a file or add a new task.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    // Relative priority heatmap — scale to visible set
    const priorities = tasks.map(t => t.priority || 1);
    const minP = Math.min(...priorities);
    const maxP = Math.max(...priorities);
    const prioSpan = maxP > minP ? maxP - minP : 1;
    const prioT = val => (val - minP) / prioSpan;

    for (const task of tasks) {
      const tr = document.createElement('tr');
      tr.dataset.uuid = task.uuid;

      for (const col of COLUMNS) {
        const td = document.createElement('td');
        td.dataset.key = col.key;
        td.dataset.uuid = task.uuid;

        switch (col.type) {
          case 'readonly':
            td.className = `cell-${col.key}`;
            td.textContent = task[col.key];
            break;

          case 'impact': {
            td.className = 'cell-impact';
            td.style.background = impactColor(task.impact || 1);
            td.style.color = '#1a1a1a';
            const selI = document.createElement('select');
            selI.className = 'cell-select';
            selI.style.cssText = 'background:transparent;color:inherit;font-weight:700;width:100%;text-align:center;';
            IMPACT_VALUES.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v; opt.textContent = v;
              opt.style.background = impactColor(v);
              opt.style.color = '#1a1a1a';
              if (v === (task.impact || 1)) opt.selected = true;
              selI.appendChild(opt);
            });
            selI.addEventListener('change', e => {
              const newImpact = Number(e.target.value);
              TaskStore.update(task.uuid, 'impact', newImpact);
              const cur = TaskStore.getAll().find(t => t.uuid === task.uuid);
              TaskStore.update(task.uuid, 'priority', newImpact * (cur?.urgency || 1));
              FileManager.scheduleSave();
              renderBody();
            });
            td.appendChild(selI);
            break;
          }

          case 'urgency': {
            td.className = 'cell-urgency';
            td.style.background = urgencyColor(task.urgency || 5);
            td.style.color = '#1a1a1a';
            const selU = document.createElement('select');
            selU.className = 'cell-select';
            selU.style.cssText = 'background:transparent;color:inherit;font-weight:700;width:100%;text-align:center;';
            for (let v = 1; v <= 10; v++) {
              const opt = document.createElement('option');
              opt.value = v; opt.textContent = v;
              opt.style.background = urgencyColor(v);
              opt.style.color = '#1a1a1a';
              if (v === (task.urgency || 5)) opt.selected = true;
              selU.appendChild(opt);
            }
            selU.addEventListener('change', e => {
              const newUrgency = Number(e.target.value);
              TaskStore.update(task.uuid, 'urgency', newUrgency);
              const cur = TaskStore.getAll().find(t => t.uuid === task.uuid);
              TaskStore.update(task.uuid, 'priority', (cur?.impact || 1) * newUrgency);
              FileManager.scheduleSave();
              renderBody();
            });
            td.appendChild(selU);
            break;
          }

          case 'priority': {
            td.className = 'cell-priority';
            const p = task.priority || 1;
            td.textContent = p;
            td.style.background = heatRgb(prioT(p));
            td.style.color = '#fff';
            break;
          }

          case 'date': {
            const inp = document.createElement('input');
            inp.type = 'date';
            inp.className = 'cell-input';
            inp.value = task[col.key] || '';
            inp.classList.toggle('date-empty', !inp.value);
            inp.addEventListener('change', e => {
              inp.classList.toggle('date-empty', !e.target.value);
              TaskStore.update(task.uuid, col.key, e.target.value);
              FileManager.scheduleSave();
            });
            td.appendChild(inp);
            break;
          }

          case 'labels': {
            td.className = 'cell-labels';
            const wrap = document.createElement('div');
            wrap.className = 'label-cell';

            const getLabels = () => {
              const t = TaskStore.getAll().find(x => x.uuid === task.uuid);
              return t ? (t.labels || []) : [];
            };

            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'label-input';
            inp.placeholder = '+';
            inp.setAttribute('list', 'labels-datalist');

            const renderChips = () => {
              wrap.querySelectorAll('.label-chip').forEach(c => c.remove());
              getLabels().forEach(lbl => {
                const chip = document.createElement('span');
                chip.className = 'label-chip';
                chip.style.background = labelColor(lbl);
                chip.draggable = true;

                chip.addEventListener('dragstart', e => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', lbl);
                  chip.classList.add('dragging');
                });
                chip.addEventListener('dragend', () => {
                  chip.classList.remove('dragging');
                  wrap.querySelectorAll('.label-chip').forEach(c => c.classList.remove('drag-over'));
                });
                chip.addEventListener('dragover', e => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (!chip.classList.contains('dragging')) {
                    wrap.querySelectorAll('.label-chip').forEach(c => c.classList.remove('drag-over'));
                    chip.classList.add('drag-over');
                  }
                });
                chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
                chip.addEventListener('drop', e => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData('text/plain');
                  if (from === lbl) return;
                  const labels = getLabels();
                  const fi = labels.indexOf(from);
                  const ti = labels.indexOf(lbl);
                  if (fi === -1 || ti === -1) return;
                  const reordered = [...labels];
                  reordered.splice(fi, 1);
                  reordered.splice(ti, 0, from);
                  TaskStore.update(task.uuid, 'labels', reordered);
                  FileManager.scheduleSave();
                  renderChips();
                });

                const txt = document.createElement('span');
                txt.textContent = lbl;
                chip.appendChild(txt);
                const x = document.createElement('button');
                x.className = 'label-chip-x';
                x.textContent = '×';
                x.addEventListener('click', () => {
                  TaskStore.update(task.uuid, 'labels', getLabels().filter(l => l !== lbl));
                  FileManager.scheduleSave();
                  renderChips();
                  refreshLabelDatalist();
                });
                chip.appendChild(x);
                wrap.insertBefore(chip, inp);
              });
            };

            const commit = () => {
              const val = inp.value.replace(/[,;]/g, '').trim();
              if (val && !getLabels().includes(val)) {
                TaskStore.update(task.uuid, 'labels', [...getLabels(), val]);
                FileManager.scheduleSave();
                refreshLabelDatalist();
              }
              inp.value = '';
              renderChips();
            };

            inp.addEventListener('keydown', e => {
              if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                e.preventDefault();
                commit();
              }
            });
            inp.addEventListener('input', () => {
              if (inp.value.endsWith(',') || inp.value.endsWith(';')) commit();
            });
            inp.addEventListener('change', () => commit());

            wrap.appendChild(inp);
            renderChips();
            td.appendChild(wrap);
            break;
          }

          case 'status': {
            td.className = 'cell-status';
            const applyStatusStyle = s => {
              const st = STATUS_STYLE[s] || STATUS_STYLE['New'];
              td.style.background = st.bg;
              td.style.color = st.text;
            };
            applyStatusStyle(task.status);
            const sel = document.createElement('select');
            sel.className = 'cell-select';
            sel.style.cssText = 'background:transparent;color:inherit;font-weight:600;';
            sel.innerHTML = statusOptionsHTML(task.status);
            sel.addEventListener('change', e => {
              applyStatusStyle(e.target.value);
              TaskStore.update(task.uuid, 'status', e.target.value);
              FileManager.scheduleSave();
            });
            td.appendChild(sel);
            break;
          }

          default: { // text
            td.contentEditable = 'true';
            td.textContent = task[col.key] || '';
            td.addEventListener('blur', e => {
              TaskStore.update(task.uuid, col.key, e.target.textContent.trim());
              FileManager.scheduleSave();
            });
            td.addEventListener('keydown', e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); td.blur(); }
            });
            break;
          }
        }

        tr.appendChild(td);
      }

      // delete button
      const tdDel = document.createElement('td');
      tdDel.className = 'cell-del';
      const btnDel = document.createElement('button');
      btnDel.className = 'btn-del';
      btnDel.title = 'Delete task';
      btnDel.textContent = '✕';
      btnDel.addEventListener('click', () => {
        if (confirm('Delete this task?')) {
          TaskStore.remove(task.uuid);
          FileManager.scheduleSave();
          render();
        }
      });
      tdDel.appendChild(btnDel);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    }
  }

  function renderBody() {
    const filtered = FilterController.apply(SortController.apply(TaskStore.getAll()));
    renderRows(filtered, true); // preserve draft row so it keeps focus
  }

  function render() {
    buildColgroup();
    buildHeaders();
    buildFilterRow();
    const filtered = FilterController.apply(SortController.apply(TaskStore.getAll()));
    renderRows(filtered);
  }

  function setBanner(name) {
    document.getElementById('file-banner').classList.remove('hidden');
    // Browsers do not expose the full filesystem path via the File System
    // Access API — only the filename is available.
    document.getElementById('file-name').textContent = name;
    document.getElementById('file-name').title = `Full path not available in browser (filename: ${name})`;
  }

  function setSaveStatus(msg) {
    document.getElementById('save-status').textContent = msg;
  }

  return { render, renderBody, setBanner, setSaveStatus, focusDraftName };
})();

// ── ThemeController ─────────────────────────────────────────────────────────

const ThemeController = (() => {
  const KEY = 'enceladus-theme';
  const ICONS = { 'theme-light': '☀', 'theme-dark': '☾' };

  function apply(theme) {
    document.body.className = theme;
    document.getElementById('btn-theme').textContent = ICONS[theme] ?? '☀';
  }

  function init() {
    const saved = localStorage.getItem(KEY) || 'theme-light';
    apply(saved);
    document.getElementById('btn-theme').addEventListener('click', () => {
      const next = document.body.classList.contains('theme-light') ? 'theme-dark' : 'theme-light';
      apply(next);
      localStorage.setItem(KEY, next);
    });
  }

  return { init };
})();

// ── Bootstrap ───────────────────────────────────────────────────────────────

function dismissStartup() {
  document.getElementById('startup-modal').classList.add('hidden');
}

async function init() {
  ThemeController.init();

  if (!FileManager.supported) {
    document.getElementById('startup-api-warn').classList.remove('hidden');
    document.getElementById('api-warn').classList.remove('hidden');
    document.getElementById('btn-startup-open').disabled = true;
    document.getElementById('btn-startup-new').disabled = true;
    dismissStartup();
  } else {
    // Check for a previously used file handle in IDB
    const lastHandle = await HandleStore.load().catch(() => null);
    if (lastHandle) {
      const btn = document.getElementById('btn-startup-reopen');
      btn.textContent = `Reopen "${lastHandle.name}"`;
      btn.classList.remove('hidden');
      document.getElementById('startup-divider').classList.remove('hidden');
      btn.addEventListener('click', async () => {
        const ok = await FileManager.reopen(lastHandle);
        if (ok) dismissStartup();
      });
    }

    document.getElementById('btn-startup-open').addEventListener('click', async () => {
      const ok = await FileManager.open();
      if (ok) dismissStartup();
    });
    document.getElementById('btn-startup-new').addEventListener('click', async () => {
      const ok = await FileManager.create();
      if (ok) dismissStartup();
    });
  }

  UI.render();

  // "Switch file" in topbar — open a different file
  document.getElementById('btn-open').addEventListener('click', async () => {
    await FileManager.open();
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    document.querySelector('.draft-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    UI.focusDraftName();
  });

  document.getElementById('btn-save').addEventListener('click', () => FileManager.save());
}

document.addEventListener('DOMContentLoaded', init);
