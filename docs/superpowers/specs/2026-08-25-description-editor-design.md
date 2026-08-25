# Description Editor — Design

## Context

Third and final feature of a larger set of changes to Enceladus. Features 1 (Priority
Quadrants) and 2 (Topic field) already shipped, each on this same branch, each
through its own design → plan → implementation cycle.

Working rules for this whole effort (see `CLAUDE.md`):
- No code changes until the user has explicitly agreed to the plan.
- No architecture teardown without agreement — local, incremental changes only.
- Any data format change must stay backward compatible with older `tasks.json`
  files and convert them to the new format on first open.

## Problem

The user barely uses the `Description` column and finds it visually noisy as a
full table column. They want it replaced by a small icon inside the `Name`
cell that opens a dedicated editor supporting bold text, links, and line
breaks — edited WYSIWYG-style (like WordPad), not as raw markup next to a
separate preview pane. Crucially, they want editing sessions to be
crash-safe (continuously autosaved while open, the same way the rest of the
app already autosaves) and to keep a short version history (current + 2
previous) as protection against accidentally overwriting or losing text —
this is **not** meant to be a full revision-browsing feature, just a safety
net.

## Data Model

`description` (string, unchanged field name) now holds lightweight markdown:
`**bold**`, `[text](url)`, and `\n` for line breaks — nothing else. Two new
fields are added, both purely additive:

```json
{
  "description": "current/finalized value",
  "descriptionHistory": ["one version back", "two versions back"],
  "descriptionDraft": null
}
```

- `descriptionHistory`: array of up to 2 strings, most-recent-previous first.
  Never contains the current `description` itself.
- `descriptionDraft`: `null` when no editing session is in progress;
  otherwise a string holding the in-progress content of an open session,
  continuously autosaved (same 500ms-debounce convention the rest of the app
  already uses for every other field).

**No migration logic is needed for the `description` field's content** — it
stays a plain string, and existing free text that happens not to contain
`**`/`[...]( ...)` sequences renders identically to before. The only
migration is defaulting the two new fields when absent:

```js
if (task.descriptionHistory === undefined) task.descriptionHistory = [];
if (task.descriptionDraft === undefined) task.descriptionDraft = null;
```

**Accepted trade-off:** if an existing plain-text description happens to
already contain `**` or `[...](...)`-shaped substrings, it will now render
with that formatting applied, since there is no way to distinguish
"pre-existing literal asterisks" from "intentional markdown" without an
explicit migration flag. Given how rarely this field has been used, this
edge case is accepted rather than engineered around.

## Column removal

`COLUMNS` drops the `description` entry entirely — no `Description` column
in the table anymore. `col.col-description` CSS width rule is removed.

## Name cell restructuring

The `name` column stops using the generic default/`contentEditable` text
case and gets its own dedicated case in both `buildDraftRow` and
`renderRows`, producing:

```html
<td class="cell-name">
  <span class="name-text" contenteditable="true">Task name</span>
  <button type="button" class="name-desc-icon">📝</button>
</td>
```

- `.name-text` behaves exactly like today's Name cell did (typing updates
  `draft.name`/commits `task.name` on blur, Enter commits the draft or
  blurs the row), just scoped to the inner span instead of the whole `td`.
- `.name-desc-icon` is a plain `<button>`, not text content, so it can never
  be typed into or deleted by editing the name. Clicking it opens the
  description editor for that task (or the draft). On the draft row, its
  `mousedown` calls `e.preventDefault()` (same idiom `openQuadrantPicker`'s
  and `openTopicCombobox`'s draft-cell triggers already use) so opening the
  editor never fires the draft row's blur-commit timer.

**Icon visual states** (via CSS class + a `title` tooltip, checked in this
priority order):
1. `descriptionDraft !== null` → class `has-draft`, coloured with
   `var(--accent)`, `title="Draft in progress — click to continue editing"`.
2. else `description` non-empty → class `has-content`, normal opacity,
   `title="Description"`.
3. else (empty, no draft) → dimmed (`opacity: 0.35`, matching the existing
   empty-date-placeholder convention), `title="No description"`.

This state is recomputed and reapplied every time the icon's underlying data
changes (draft autosave tick, session finalize) — the icon is the *only*
place a user sees "is there an unfinished draft," per the user's explicit
requirement that reopening a file with a pending draft should visibly say so.

## Editor component

A new closure-private helper inside the `UI` IIFE, `openDescriptionEditor`,
following the same "one shared popup helper, closure-private, not exported"
pattern `openQuadrantPicker` and `openTopicCombobox` established — but this
one is a **modal** (full-page backdrop), not an anchored popup, since it's a
substantially bigger, longer-lived editing surface.

```js
function openDescriptionEditor({ getState, setDraft, finalize }) {
  // getState() => { description: string, history: string[], draft: string|null }
  // setDraft(value: string)   — called (debounced) while editing; persists the draft
  // finalize(value: string)   — called exactly once, when the editor closes
}
```

Callers (draft row and existing rows) each build their own `getState`/
`setDraft`/`finalize` closures over `draft`/`TaskStore`, mirroring exactly
how `openQuadrantPicker`'s and `openTopicCombobox`'s callers already build
their own commit closures over `draft` vs. `TaskStore.update`.

**Opening:** if `getState().draft` is `null` (no session in progress), the
editor immediately calls `setDraft(getState().description)` before doing
anything else — this both signals "a session has started" (icon flips to
the draft state right away) and guarantees crash-safety from the very first
moment, even before any keystroke. If `draft` was already non-null (resuming
an interrupted session — e.g. the browser closed mid-edit), the editor loads
that draft content instead of `description`.

**No cancel/discard.** Because the draft is continuously autosaved from the
moment the editor opens, there is nothing to "lose" by closing — closing
always finalizes whatever is currently in the editable area as the new
`description`. This is a deliberate simplification: undo-within-a-session is
handled by the browser's native `contenteditable` undo (Ctrl+Z), and
recovering *previous sessions'* content is handled by the History control
(below), not by a cancel button.

**Closing** (× button, `Escape`, or clicking the backdrop — all equivalent):
serializes the current editable content one final time (not debounced) and
calls `finalize(value)`. The finalize closure (defined by the caller):
- if `value !== current description`: shifts the *old* `description` onto
  the front of `descriptionHistory`, truncated to 2 entries, then sets
  `description = value`
- always sets `descriptionDraft = null`
- triggers `FileManager.scheduleSave()` (existing rows only — the draft row
  has no file to save until it's committed as a real task)

**Layout:**
- Fixed-position modal with a semi-transparent backdrop (`.startup-modal`'s
  existing visual pattern, but built dynamically via
  `document.createElement`/`appendChild`, matching `openQuadrantPicker`'s
  approach, not a static HTML skeleton like the startup modal).
- Default size ≈ 1/9 of the viewport area: `width: 33vw; height: 33vh;` with
  sane minimums (`min-width: 320px; min-height: 240px;`) so it stays usable
  on small windows.
- A ⛶ toolbar button toggles a `.fullscreen` class that expands it to
  `width: 92vw; height: 92vh;` and back.
- Header bar: task name (read-only label, for context — truncated with
  ellipsis if long), then the toolbar (**B**, 🔗, 🕐 History, ⛶ Fullscreen),
  then × close.
- Body: a single `contenteditable="true"` div filling the remaining space —
  WYSIWYG editing, not a split raw-text/preview layout.

**Toolbar buttons:**
- **B** (Bold): `document.execCommand('bold', false, null)` on the current
  selection. (This app already targets Chromium exclusively — it already
  depends on `showOpenFilePicker`/`showSaveFilePicker`, Chromium-only APIs
  — so relying on `execCommand`, while a deprecated API, is a pragmatic,
  low-code-volume choice consistent with the app's existing browser-support
  posture, not a new dependency.)
- 🔗 (Link): prompts for a URL via `window.prompt('Link URL:')`. If the
  entered value doesn't start with `http://`, `https://`, or `mailto:`, the
  prompt is rejected (alert + re-shown, or simply no-op) — malformed/unsafe
  schemes are never turned into a link. On a valid URL,
  `document.execCommand('createLink', false, url)` on the current selection
  (if no text is selected, browsers insert the URL itself as the link text,
  which is acceptable default behavior).
- 🕐 (History): toggles a small popover listing `getState().history`
  (0–2 entries, most-recent-previous first). Each entry shows a short
  preview (first ~40 characters of its plain-text content) and a "Restore"
  button. Clicking Restore: re-parses that historical string into DOM,
  replaces the editable area's content with it, and calls
  `setDraft(thatValue)` immediately — this does **not** shift history by
  itself; the normal `finalize` comparison (against the *current*
  `description`, not against history) handles shifting correctly when the
  editor is next closed, so restoring an old version and then closing
  promotes it to current and pushes the (former) current into history,
  exactly like any other edit. If `history` is empty, the popover shows "No
  previous versions yet" instead of a list.

## Markdown ⇄ DOM conversion (no `innerHTML`, ever)

Two pure functions, used by the editor (not exported, defined alongside
`openDescriptionEditor` or as siblings to it — implementation detail for the
plan to place precisely):

**`parseDescriptionToDOM(markdown, container)`** — populates `container`
(the contenteditable div) by walking the string and building real DOM nodes:
- Split on `\n`; each line becomes its own top-level `<div>` child of
  `container` (this matches what Chrome's `contenteditable` *itself*
  produces when the user presses Enter, which keeps the round-trip
  consistent — after the initial parse, further edits keep the same
  div-per-line shape the serializer expects).
- Within each line, a single left-to-right scan alternates between a
  combined regex matching `\*\*(.+?)\*\*` (bold) or `\[(.+?)\]\((.+?)\)`
  (link) and plain text in between. Matched bold spans become `<strong>`
  elements (`document.createElement('strong')`, `.textContent = ...`);
  matched links become `<a>` elements (`document.createElement('a')`,
  `.textContent = ...`, `.href = url`, plus `target="_blank"
  rel="noreferrer"` matching the app's existing external-link convention
  from `index.html`'s version link) **only if the URL starts with
  `http://`, `https://`, or `mailto:`** — otherwise the bracket/paren text
  is left as literal plain text (defense in depth: even if a bad URL
  somehow ended up stored, it's never turned into a clickable/executable
  link on render). Everything else is a plain text node
  (`document.createTextNode`). No nesting (a link's text can't itself
  contain bold, and vice verser) — kept deliberately simple per "lightweight
  markdown."
- An empty `markdown` string produces one empty `<div>` (so the editor isn't
  literally empty/uneditable).

**`serializeDOMToDescription(container)`** — walks `container`'s child
`<div>`s (one per line) and, for each, recursively serializes its children:
text nodes → literal text; `<b>`/`<strong>` → children wrapped in `**...**`;
`<a>` → children wrapped in `[...]( href )`; any other/unexpected element →
just recurse into its children (defensive fallback, since `execCommand` can
occasionally produce slightly different wrapper elements across edits).
Lines are joined with `\n`.

## Removed/changed code

- `COLUMNS`: `description` entry removed.
- `buildDraftRow`/`renderRows`: the generic `default: // text` case no
  longer handles `name` (it gets its own `case 'name':`); the old
  `description` cell (which used to fall through to that same generic case)
  needs no explicit removal beyond the `COLUMNS` entry disappearing — the
  switch simply never sees a `description`-typed column anymore.
- CSS: `col.col-description` removed; the existing
  `.draft-row td[contenteditable][data-placeholder]:empty::before` selector
  is widened to `.draft-row [contenteditable][data-placeholder]:empty::before`
  (attribute-based descendant selector, not tied to `td` specifically) so it
  keeps matching the now-nested `.name-text` span as well as the still-`td`-level
  `nextAction`/`contact` cells; `td[data-key="name"] { font-weight: 700; }`
  moves to target `.name-text` specifically instead of the whole cell (so
  the emoji icon isn't affected by the bold rule, though this has no visible
  effect either way — done for clarity).

## Testing

No test suite exists (per ARCHITECTURE.md's Outstanding list, unchanged).
Verify manually, with Playwright for the interactive/DOM-heavy parts (per
this project's established convention on this branch):

- Icon states: empty/no-draft (dimmed), has-content/no-draft (normal),
  draft-in-progress (accent colour) — confirm each renders and the tooltip
  text matches.
- Opening a fresh (no prior draft) editor: confirm `descriptionDraft`
  becomes non-null immediately (before any keystroke) and the icon reflects
  that.
- Bold/Link toolbar buttons apply formatting to a selection; the rendered
  result visually matches (bold text is bold, links are clickable/styled).
- Typing, waiting past the debounce, confirm the file on disk gets the
  updated `descriptionDraft` (crash-safety check — simulate by inspecting
  the saved JSON mid-session without closing the editor).
- Closing (×, Escape, backdrop click) all finalize identically: `description`
  updated, old value pushed into `descriptionHistory` (capped at 2, oldest
  dropped), `descriptionDraft` cleared.
- Reopening a task whose `descriptionDraft` was left non-null (simulating an
  interrupted session — hand-edit a fixture file) shows the draft-in-progress
  icon state and resumes editing that draft content, not `description`.
- History popover: shows up to 2 entries with previews; Restore loads that
  content into the editor as the active draft; closing afterward correctly
  promotes it and shifts the *previous* current value into history.
- Round-trip fidelity: type `**bold** and a [link](https://example.com) and
  a second line`, close, reopen — confirm the same formatting is intact
  (parse → DOM → serialize → parse is stable).
- Link URL validation: attempt to create a link with a `javascript:` URL —
  confirm it's rejected (not turned into a clickable link).
- Fullscreen toggle expands/restores correctly.
- Migration: a fixture file with `description` set as a plain string and no
  `descriptionHistory`/`descriptionDraft` fields loads correctly, defaults
  applied, nothing crashes.

## Files touched

- `app.js` — `COLUMNS`, `TaskStore.newTask`/`load`/`DRAFT_DEFAULTS` (new
  fields), the new `case 'name':` blocks in `buildDraftRow`/`renderRows`,
  `openDescriptionEditor` + `parseDescriptionToDOM` +
  `serializeDOMToDescription`
- `style.css` — remove `col.col-description`; add `.cell-name` flex layout,
  `.name-desc-icon` states, `.description-editor` modal + header/toolbar/body
  + `.fullscreen` + history popover styles; widen the empty-placeholder
  selector
- `README.md` — Features list (Description bullet → description-editor
  bullet), Data-format example JSON (add `descriptionHistory`/
  `descriptionDraft`)
- `ARCHITECTURE.md` — Columns table (remove the `description` row, note the
  icon lives in `name`'s Notes), Data Format example JSON, Migration table
  (new row for the two additive fields), Interaction Model section (replace
  any Description-column mention with a description-editor description)

## Out of scope

- Full version history browsing beyond the last 2 versions.
- Any formatting beyond bold, links, and line breaks (no italics, lists,
  headings, etc.) — matches the user's explicit "jen" (just/only these).
- Collaborative/simultaneous editing concerns — this is a single-user,
  single-file app.
