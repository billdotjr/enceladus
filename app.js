// ── Enceladus Todo App ─────────────────────────────────────────────────────
// Client-side only. No external requests. File System Access API for storage.

// ── Constants ──────────────────────────────────────────────────────────────

const STATUSES = ['Today', 'Workable', 'In Progress', 'New', 'Pending feedback', 'Meeting scheduled', 'On-Hold', 'Closed'];

const STATUS_STYLE = {
  'New':                { bg: '#16a34a', text: '#fff' },  // green
  'Workable':           { bg: '#ea580c', text: '#fff' },  // orange
  'In Progress':        { bg: '#ca8a04', text: '#fff' },  // amber
  'Today':              { bg: '#a84444', text: '#fff' },  // soft terracotta red
  'Pending feedback':   { bg: '#2563eb', text: '#fff' },  // blue
  'Meeting scheduled':  { bg: '#7c3aed', text: '#fff' },  // purple
  'On-Hold':            { bg: '#9ca3af', text: '#1a1a1a' }, // mid grey
  'Closed':             { bg: '#4b5563', text: '#d1d5db' }, // dark grey
};

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
      important: false,
      urgent: false,
      createdAt: new Date().toISOString().slice(0, 10),
      dueDate: '',
      nextActionDate: '',
      name: '',
      description: '',
      nextAction: '',
      contact: '',
      topic: '',
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
      // Migrate old multi-value labels array to a single topic string.
      // 'private' anywhere in the old labels wins (keeps private-section
      // membership); otherwise take the first label; no labels -> ''.
      if (typeof task.topic !== 'string') {
        const privateLabel = task.labels.find(l => l.toLowerCase() === 'private');
        task.topic = privateLabel ? 'Private' : (task.labels[0] || '');
      }
      delete task.labels;
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

  function topicCounts() {
    const counts = new Map();
    for (const t of tasks) {
      if (t.topic) counts.set(t.topic, (counts.get(t.topic) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  }

  function toJSON() { return JSON.stringify(tasks, null, 2); }

  return { load, add, remove, update, getAll, allLabels, topicCounts, toJSON };
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
    if (!fileHandle) {
      // Fallback for browsers without the File System Access API:
      // trigger a download via a blob: URL — stays entirely in-browser,
      // no network involved. Only reachable from the explicit Save button
      // (the auto-save debounce is gated on fileHandle).
      const blob = new Blob([TaskStore.toJSON()], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'tasks.json';
      a.click();
      URL.revokeObjectURL(url);
      lastSaveTime = new Date();
      UI.setSaveStatus(formatSaveStatus(lastSaveTime));
      document.getElementById('btn-save').disabled = true;
      return;
    }
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
  let sortKey = 'nextActionDate';
  let sortDir = 1; // default: soonest next action first

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
      if (sortKey === 'id') {
        av = Number(av) || 0; bv = Number(bv) || 0;
      }
      // priority: rank by quadrant (base=0 ... urg&import=3), not the old numeric field
      if (sortKey === 'priority') {
        av = quadrantRank(a); bv = quadrantRank(b);
      }
      // labels: sort by first label as ordered in the cell; no labels sorts last
      if (sortKey === 'labels') {
        av = Array.isArray(av) && av.length ? av[0].toLowerCase() : '￿';
        bv = Array.isArray(bv) && bv.length ? bv[0].toLowerCase() : '￿';
      }
      // date strings sort lexicographically correctly (ISO format);
      // empty dates always sort last regardless of direction
      if (sortKey === 'createdAt' || sortKey === 'dueDate' || sortKey === 'nextActionDate') {
        const empty = sortDir === 1 ? '9999-99-99' : '0000-00-00';
        av = av || empty;
        bv = bv || empty;
      }
      if (av < bv) return -sortDir;
      if (av > bv) return  sortDir;
      return 0;
    });
  }

  function getState() { return { sortKey, sortDir }; }

  function reset() { sortKey = 'nextActionDate'; sortDir = 1; }

  return { toggle, apply, getState, reset };
})();

// ── FilterController ────────────────────────────────────────────────────────

const FilterController = (() => {
  let filters = { status: '!closed' }; // default: hide Closed

  function set(key, value) { filters[key] = value.toLowerCase(); }

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

  function get(key) { return filters[key] ?? ''; }

  function clear() { filters = { status: '!closed' }; }

  return { set, apply, get, clear };
})();

// Returns {bg, text} for date urgency (both due and next-action), else null.
function dateUrgencyColor(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  const days  = Math.round((new Date(dateStr) - new Date(today)) / 86400000);
  if (days < 0)   return { bg: '#dc2626', text: '#fff' };              // overdue: red
  if (days === 0) return { bg: '#2563eb', text: '#fff' };              // today: blue
  if (days === 1) return { bg: 'rgb(168,193,247)', text: '#1a1a1a' };  // tomorrow: pale blue
  return null;
}

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
  const DRAFT_DEFAULTS = () => ({ important: false, urgent: false, createdAt: new Date().toISOString().slice(0, 10), dueDate: '', nextActionDate: '', name: '', description: '', nextAction: '', contact: '', topic: '', status: 'New' });
  let draft = DRAFT_DEFAULTS();

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
      // Prevent blur so clicking a quadrant doesn't shift focus away from
      // the draft row and trigger a premature commit.
      btn.addEventListener('mousedown', e => e.preventDefault());
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

    function renderList(forceTop8) {
      const query = forceTop8 ? '' : inp.value.trim();
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

    inp.addEventListener('input', () => renderList());
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

    renderList(true);
    inp.focus();
    inp.select();

    openCombobox = {
      cleanup: () => { if (!settled) { settled = true; panel.remove(); } }
    };
  }

  function commitDraft() {
    if (!draft.name.trim()) return;
    TaskStore.add({ ...draft });
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

    for (const col of COLUMNS) {
      const td = document.createElement('td');
      td.dataset.key = col.key;

      switch (col.type) {
        case 'readonly':
          td.className = 'cell-id draft-id';
          td.textContent = '+';
          break;

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
          // Prevent blur so the draft row isn't committed prematurely while
          // the quadrant picker is open (same idiom as btnAdd below).
          td.addEventListener('mousedown', e => e.preventDefault());
          td.addEventListener('click', () => {
            openQuadrantPicker(td, q => {
              draft.important = (q === 'important' || q === 'urg&import');
              draft.urgent    = (q === 'urgent'    || q === 'urg&import');
              renderBadge();
            });
          });
          break;
        }

        case 'date': {
          const inp = document.createElement('input');
          inp.type = 'date'; inp.className = 'cell-input';
          inp.value = draft[col.key] || '';
          inp.classList.toggle('date-empty', !inp.value);
          const applyDraftDateColor = val => {
            const c = (col.key === 'dueDate' || col.key === 'nextActionDate') ? dateUrgencyColor(val) : null;
            td.style.background = c ? c.bg : '';
            inp.style.color = c ? c.text : '';
          };
          applyDraftDateColor(inp.value);
          inp.addEventListener('change', e => {
            draft[col.key] = e.target.value;
            inp.classList.toggle('date-empty', !e.target.value);
            applyDraftDateColor(e.target.value);
          });
          td.appendChild(inp);
          break;
        }

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

  // Build colgroup once (shared column widths for both tables)
  function buildColgroup() {
    let cg = '<colgroup>';
    for (const col of COLUMNS) cg += `<col class="col-${col.key}">`;
    cg += '<col class="col-del">';
    cg += '</colgroup>';
    for (const id of ['task-table', 'private-table']) {
      const tbl = document.getElementById(id);
      if (!tbl.querySelector('colgroup')) tbl.insertAdjacentHTML('afterbegin', cg);
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
    // clear-all filters button in delete column
    const thClear = document.createElement('th');
    thClear.className = 'th-del';
    const btnClear = document.createElement('button');
    btnClear.className = 'btn-del';
    btnClear.title = 'Clear all filters';
    btnClear.textContent = '✕';
    btnClear.addEventListener('click', () => {
      FilterController.clear();
      buildFilterRow();
      renderBody();
    });
    thClear.appendChild(btnClear);
    row.appendChild(thClear);
    refreshLabelDatalist();
  }

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

  function renderRows(tasks, preserveDraft = false) {
    const tbody = document.getElementById('task-body');
    const privateBody = document.getElementById('private-body');
    if (preserveDraft) {
      tbody.querySelectorAll('tr:not(.draft-row)').forEach(r => r.remove());
    } else {
      tbody.innerHTML = '';
      tbody.appendChild(buildDraftRow());
    }
    privateBody.innerHTML = '';
    document.getElementById('private-wrapper').classList.add('hidden');

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

          case 'date': {
            const inp = document.createElement('input');
            inp.type = 'date';
            inp.className = 'cell-input';
            inp.value = task[col.key] || '';
            inp.classList.toggle('date-empty', !inp.value);
            const applyDateColor = val => {
              const c = (col.key === 'dueDate' || col.key === 'nextActionDate') ? dateUrgencyColor(val) : null;
              td.style.background = c ? c.bg : '';
              inp.style.color = c ? c.text : '';
            };
            applyDateColor(inp.value);
            inp.addEventListener('change', e => {
              inp.classList.toggle('date-empty', !e.target.value);
              applyDateColor(e.target.value);
              TaskStore.update(task.uuid, col.key, e.target.value);
              FileManager.scheduleSave();
            });
            td.appendChild(inp);
            break;
          }

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

      const isPrivate = !!task.topic && task.topic.toLowerCase() === 'private';
      (isPrivate ? privateBody : tbody).appendChild(tr);
    }
    document.getElementById('private-wrapper').classList.toggle('hidden', privateBody.childElementCount === 0);
  }

  function renderBody() {
    const filtered = FilterController.apply(SortController.apply(TaskStore.getAll()));
    renderRows(filtered, true); // preserve draft row so it keeps focus
  }

  function render() {
    closeQuadrantPicker(); // backstop: never leave a picker orphaned by a full re-render
    closeTopicCombobox();  // same backstop, for the topic combobox
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

  // Refresh — reset sort and filters to defaults and re-render
  document.getElementById('btn-refresh').addEventListener('click', () => {
    SortController.reset();
    FilterController.clear();
    UI.render();
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    document.querySelector('.draft-row')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    UI.focusDraftName();
  });

  document.getElementById('btn-save').addEventListener('click', () => FileManager.save());
}

document.addEventListener('DOMContentLoaded', init);
