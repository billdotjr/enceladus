// ── Enceladus Todo App ─────────────────────────────────────────────────────
// Client-side only. No external requests. File System Access API for storage.

// ── Constants ──────────────────────────────────────────────────────────────

const STATUSES = ['New', 'In Progress', 'Pending feedback', 'Done'];

const COLUMNS = [
  { key: 'id',             label: '#',            type: 'readonly',     sortable: true  },
  { key: 'priority',       label: 'Priority',     type: 'priority',     sortable: true  },
  { key: 'dueDate',        label: 'Due',          type: 'date',         sortable: true  },
  { key: 'nextActionDate', label: 'Next action',  type: 'date',         sortable: true  },
  { key: 'name',           label: 'Name',         type: 'text',         sortable: true  },
  { key: 'description',    label: 'Description',  type: 'text',         sortable: false },
  { key: 'nextAction',     label: 'Next action',  type: 'text',         sortable: false },
  { key: 'contact',        label: 'Contact',      type: 'text',         sortable: true  },
  { key: 'tag',            label: 'Tag',          type: 'tag',          sortable: true  },
  { key: 'status',         label: 'Status',       type: 'status',       sortable: true  },
];

// ── TaskStore ───────────────────────────────────────────────────────────────

const TaskStore = (() => {
  let tasks = [];
  let nextId = 1;

  function newTask() {
    return {
      uuid: crypto.randomUUID(),
      id: nextId++,
      priority: 50,
      dueDate: '',
      nextActionDate: '',
      name: '',
      description: '',
      nextAction: '',
      contact: '',
      tag: '',
      status: 'New',
    };
  }

  function load(data) {
    tasks = data.map(t => ({ ...t }));
    nextId = tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
  }

  function add() {
    const t = newTask();
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

  function allTags() {
    return [...new Set(tasks.map(t => t.tag).filter(Boolean))].sort();
  }

  function toJSON() { return JSON.stringify(tasks, null, 2); }

  return { load, add, remove, update, getAll, allTags, toJSON };
})();

// ── FileManager ─────────────────────────────────────────────────────────────

const FileManager = (() => {
  let fileHandle = null;
  let saveTimer  = null;
  const supported = 'showOpenFilePicker' in window;

  async function open() {
    if (!supported) { importFallback(); return; }
    try {
      [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false,
      });
      const file = await fileHandle.getFile();
      const text = await file.text();
      TaskStore.load(JSON.parse(text));
      UI.setBanner(file.name);
      UI.render();
      UI.setSaveStatus('Loaded');
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 500);
    UI.setSaveStatus('Unsaved…');
    document.getElementById('btn-save').disabled = false;
  }

  async function save() {
    if (!supported || !fileHandle) {
      // fallback: download
      const blob = new Blob([TaskStore.toJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'tasks.json';
      a.click();
      URL.revokeObjectURL(a.href);
      UI.setSaveStatus('Downloaded');
      return;
    }
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(TaskStore.toJSON());
      await writable.close();
      UI.setSaveStatus('Saved ✓');
      document.getElementById('btn-save').disabled = true;
    } catch (e) {
      console.error(e);
      UI.setSaveStatus('Save failed');
    }
  }

  function importFallback() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      TaskStore.load(JSON.parse(text));
      UI.setBanner(file.name + ' (download-only mode)');
      UI.render();
      UI.setSaveStatus('Loaded');
    };
    input.click();
  }

  return { open, save, scheduleSave, supported };
})();

// ── SortController ──────────────────────────────────────────────────────────

const SortController = (() => {
  let sortKey = null;
  let sortDir = 1; // 1 asc, -1 desc

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
  let filters = {};

  function set(key, value) { filters[key] = value.toLowerCase(); }

  function apply(tasks) {
    return tasks.filter(task =>
      Object.entries(filters).every(([k, v]) => {
        if (!v) return true;
        return String(task[k] ?? '').toLowerCase().includes(v);
      })
    );
  }

  function get(key) { return filters[key] ?? ''; }

  return { set, apply, get };
})();

// ── Priority heatmap colour ─────────────────────────────────────────────────

function priorityColor(pct) {
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  // 0 → green (#4caf50), 50 → orange (#ff9800), 100 → red (#f44336)
  let r, g, b;
  if (p <= 50) {
    const t = p / 50;
    r = Math.round(76  + t * (255 - 76));
    g = Math.round(175 + t * (152 - 175));
    b = Math.round(80  + t * (0   - 80));
  } else {
    const t = (p - 50) / 50;
    r = Math.round(255 + t * (244 - 255));
    g = Math.round(152 + t * (67  - 152));
    b = Math.round(0   + t * (54  - 0));
  }
  return `rgb(${r},${g},${b})`;
}

function textOnColor(pct) {
  // always white or near-white text looks fine across this palette
  return '#ffffff';
}

// ── UI ──────────────────────────────────────────────────────────────────────

const UI = (() => {
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
          STATUSES.map(s => `<option value="${s.toLowerCase()}">${s}</option>`).join('');
        sel.value = FilterController.get(col.key);
        sel.addEventListener('change', e => {
          FilterController.set(col.key, e.target.value);
          render();
        });
        th.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.type = 'search';
        inp.placeholder = col.label;
        inp.value = FilterController.get(col.key);
        if (col.type === 'tag') {
          inp.setAttribute('list', 'tag-datalist');
        }
        inp.addEventListener('input', e => {
          FilterController.set(col.key, e.target.value);
          render();
        });
        th.appendChild(inp);
      }
      row.appendChild(th);
    }
    // spacer for delete column
    row.appendChild(document.createElement('th'));
    refreshTagDatalist();
  }

  function refreshTagDatalist() {
    let dl = document.getElementById('tag-datalist');
    if (!dl) {
      dl = document.createElement('datalist');
      dl.id = 'tag-datalist';
      document.body.appendChild(dl);
    }
    dl.innerHTML = TaskStore.allTags().map(t => `<option value="${t}">`).join('');
  }

  function renderRows(tasks) {
    const tbody = document.getElementById('task-body');
    tbody.innerHTML = '';

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

          case 'priority': {
            td.className = 'cell-priority';
            const pct = Number(task.priority) || 0;
            const bg  = priorityColor(pct);
            td.style.background = bg;
            td.style.color = textOnColor(pct);

            const inp = document.createElement('input');
            inp.type = 'number';
            inp.className = 'cell-input';
            inp.min = 0; inp.max = 100;
            inp.value = pct;
            inp.style.background  = 'transparent';
            inp.style.color       = 'inherit';
            inp.style.textAlign   = 'center';
            inp.style.fontWeight  = 'inherit';
            inp.style.width       = '100%';
            inp.addEventListener('change', e => {
              const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
              inp.value = v;
              td.style.background = priorityColor(v);
              TaskStore.update(task.uuid, 'priority', v);
              FileManager.scheduleSave();
            });
            td.appendChild(inp);
            break;
          }

          case 'date': {
            const inp = document.createElement('input');
            inp.type = 'date';
            inp.className = 'cell-input';
            inp.value = task[col.key] || '';
            inp.addEventListener('change', e => {
              TaskStore.update(task.uuid, col.key, e.target.value);
              FileManager.scheduleSave();
            });
            td.appendChild(inp);
            break;
          }

          case 'tag': {
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'cell-input';
            inp.value = task[col.key] || '';
            inp.setAttribute('list', 'tag-datalist');
            inp.addEventListener('change', e => {
              TaskStore.update(task.uuid, col.key, e.target.value.trim());
              refreshTagDatalist();
              FileManager.scheduleSave();
            });
            td.appendChild(inp);
            break;
          }

          case 'status': {
            td.className = 'cell-status';
            const sel = document.createElement('select');
            sel.className = 'cell-select';
            sel.innerHTML = STATUSES.map(s =>
              `<option value="${s}"${task.status === s ? ' selected' : ''}>${s}</option>`
            ).join('');
            sel.addEventListener('change', e => {
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

  function render() {
    buildColgroup();
    buildHeaders();
    buildFilterRow();
    const filtered = FilterController.apply(SortController.apply(TaskStore.getAll()));
    renderRows(filtered);
  }

  function setBanner(name) {
    document.getElementById('file-banner').classList.remove('hidden');
    document.getElementById('file-name').textContent = name;
  }

  function setSaveStatus(msg) {
    document.getElementById('save-status').textContent = msg;
  }

  return { render, setBanner, setSaveStatus };
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

function init() {
  ThemeController.init();
  UI.render();

  document.getElementById('btn-open').addEventListener('click', () => FileManager.open());

  document.getElementById('btn-new').addEventListener('click', () => {
    TaskStore.add();
    FileManager.scheduleSave();
    UI.render();
    // scroll to last row
    const rows = document.querySelectorAll('#task-body tr:not(.empty-row)');
    if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btn-save').addEventListener('click', () => FileManager.save());
}

document.addEventListener('DOMContentLoaded', init);
