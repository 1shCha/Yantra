# Yantra Vault: Document and Canvas Workspace

The live vault sidebar supports standalone documents and canvases. The
application opens the remembered vault with no file selected. Create/Open Vault
use native directory pickers. The legacy `default.canvas` is left untouched;
its unused storage service, IPC handlers, and status UI have been removed.

## Files

A vault is an ordinary folder containing `.yantra/vault.json`, ordinary folders,
and document files. The metadata contains `formatVersion: 1`, a stable UUID `id`,
and an ISO UTC `createdAt` timestamp. Internal metadata is excluded from scanning.

File titles and created/renamed folders use only ASCII letters, numbers, `_`, and `-`
(1-180 characters). Spaces and other punctuation are rejected, not silently trimmed.
The vault root folder is not renamed.

On opening an existing vault, legacy extensions are migrated to `.yantraD` and
`.yantraC`. Disallowed characters in file/folder names become underscores; collisions
receive numeric suffixes. IDs, content, and canvas references are preserved.
Before migration, `.yantra/name-migration-backup-<uuid>.json` stores original file
text and the path-change plan. A separate progress journal allows interrupted
migration to resume; unexpected file changes stop migration rather than overwrite
data. Unknown/corrupt document content is preserved and reported by the normal
file-loading UI. Hidden entries, symbolic links, and unrelated file names are left untouched.

A `.yantraD` file contains:

```json
{
  "formatVersion": 1,
  "id": "a6a9d010-36f1-4bf6-8d33-5c6278473ae9",
  "title": "Untitled",
  "doc": { "type": "doc", "content": [{ "type": "heading", "attrs": { "level": 1 } }] },
  "createdAt": "2026-09-08T00:00:00.000Z",
  "updatedAt": "2026-09-08T00:00:00.000Z"
}
```

The filename stem matches the title. Document content uses the existing editor's
supported nodes and marks. Unknown versions, fields, content types, and attributes
are rejected rather than silently stripped. Malformed files and duplicate document
IDs are reported without modifying them. Symbolic links are not followed.

Creation uses unique `Untitled`, `Untitled_2`, etc. names and exclusive file creation
to prevent overwrites. A sidebar-created document belongs in the selected folder,
or the root when no folder is selected. It does not need a canvas appearance.
`.yantraC` files can be created and opened from the sidebar or empty workspace.

## Equations

Document bodies support `inlineMath` and `blockMath` nodes with the original LaTeX
in `attrs.latex`. The same document data is used by standalone editors and canvas
appearances; rendered KaTeX HTML is not persisted. Existing documents need no
migration. Older Yantra builds that do not recognize math nodes reject documents
containing them under the existing strict content validation.

Use the ∑ toolbar action to insert an inline or block equation. Click an equation
while editing to change its source with a live preview. Save commits one undoable
edit; Cancel or Escape discards the draft. Invalid LaTeX remains visible and editable.
Equations are not allowed in the protected title. KaTeX fonts are bundled locally,
and wide block equations scroll inside canvas nodes.

Pasting plain Markdown recognizes inline `$…$` and `\(…\)`, standalone display
`$$…$$` and `\[…\]`, and fenced `math` blocks. Dollar notation conservatively
leaves currency and bare numeric amounts literal; use `\(5\)` for numeric math.
Backticked text stays inline code. Select it (or place the caret in it) and use
**Convert to equation** to explicitly convert it. Code blocks and paste-as-plain-text
remain literal, and the protected title retains its existing paste rules.

Rich HTML pastes preserve their normal formatting. KaTeX/MathML TeX annotations,
`data-math-source`, and Yantra math nodes are normalized to LaTeX-backed nodes;
visual HTML and MathML copies of the same equation are not imported twice. HTML
without math uses the normal editor paste path. Plain-text equation copying and
Markdown serialization use `\(…\)` / `\[…\]` to retain unambiguous source.
Inline code and blockquotes are supported in storage and both rendering modes.

Canvas previews render only while mounted and reuse HTML cached by immutable
document identity. Idle canvases cull offscreen nodes. Culling pauses during editing
to keep the editor and undo history alive when panning away. Only the active node's
toolbar subscribes to viewport position; editing does not generate hidden previews.

`pnpm test:math-ui` exercises insertion, editing, cancellation, undo/redo, saving,
reopening, canvas previews, Markdown/HTML paste, native math copy/paste, and
code/currency/title preservation in an isolated temporary vault.

## Protected Titles and Filenames

New documents start with an empty Heading 1. In both the standalone editor and
document-backed canvas nodes, the first block is a plain title containing only
ASCII English letters, numbers, and spaces. It remains a title when wrapping visually.
Formatting controls and shortcuts are unavailable for selections touching it;
normal body formatting and text undo/redo remain available. Enter or Shift+Enter
leaves the whole title intact and enters the body. Invalid input is rejected with
an inline notice. Pasting into the title strips formatting, uses the first pasted
line for the title, and places subsequent lines in body paragraphs.

The first block is still ordinary heading JSON, not a new persisted node type.
Title text autosaves through the normal document save queue. Typing while remaining
in the title does not rename files. Leaving an edited title (including clicking into
the body, onto the canvas, or switching files) commits its filename if valid. Enter
or Shift+Enter also explicitly commits it. Each space becomes one
underscore; case and digits are preserved. No trimming, punctuation replacement,
or automatic collision suffix is applied. Blank/space-only titles and titles over
180 characters cannot be committed, but their drafts are retained.

The top-level `title` metadata remains the filename stem, while the first content
block retains the human-readable title (and may hold an uncommitted draft). For
example, the heading `Project 2026` commits to metadata `Project_2026` and a file
named `Project_2026.yantraD`. The existing document ID, folder, body content, node
IDs, and canvas references stay unchanged. Sidebar document renaming accepts the
same title text, previews the resulting filename, and updates the heading too.
Folder and canvas name rules are unchanged.

Title commits use the existing save-before-rename barrier: finish pending saves, pause
editing during the rename, update the clean metadata snapshot, and restore the
body caret without remounting the editor. Failed commits retain the old filename
and show a persistent per-document error; editing the title and leaving it or
pressing Enter retries. Automatic commits skip blank or overlong titles, leaving
their drafts and prior filenames intact. A click-away commit waits until the click
has been handled, survives canvas editor unmounting, and does not invalidate a file
read started by that click. Outside clicks do not restore focus to the old editor.
Sidebar title changes remount affected editors with the new content,
resetting that editor session's undo history. Same-path title changes are saved
atomically rather than being discarded as a no-op. Exclusive destination creation
prevents overwrites, including case-insensitive filesystem collisions. No content
migration is introduced here.

## Scope 4 Canvas Integration

Canvas persistence, workspace operations, and the approved UI are connected.
The existing canvas surface renders inside the shared workspace frame. Each canvas
view has its own interaction store, containing references and geometry, not content.
Nodes resolve their content through the document registry. The legacy canvas store
and save path are not used by the vault. Preview fixtures remain isolated.

Double-clicking empty canvas space creates a node and its document in `Unfiled/`.
The new node is selected without entering editor mode. Double-clicking a node opens
its inline editor. Dragging, resizing, alignment, grouping, and viewport changes use
the existing canvas machinery. Open Document on a node opens the full editor;
clicking the canvas in the sidebar returns to its saved viewport. The canvas header
reports pending saves for both its layout and its referenced documents.

Missing-document nodes retain geometry and connections and show an unavailable
message with Open Document disabled. Later scopes add organization and lifecycle
operations as described below; missing references are never silently discarded.

A `.yantraC` file contains `formatVersion: 1`, UUID `id`, `title`,
`createdAt`, `updatedAt`, `nodes`, `edges`, `groups`, `layerOrder`, and
`viewport` (`x`, `y`, `zoom`). Each node contains:

```json
{
  "id": "af96de6a-1904-4a69-a838-c1e45247b9b6",
  "kind": "document",
  "documentId": "a6a9d010-36f1-4bf6-8d33-5c6278473ae9",
  "x": 100,
  "y": 100,
  "width": 320,
  "height": 220
}
```

Nodes may also have `color`. Content is never embedded in a canvas. Groups retain
explicit node membership; layer order lists ungrouped nodes and groups from back
to front. Invalid relationships, duplicate identities, and unknown fields or
versions are rejected without rewriting the file. Scanning detects documents
appearing in multiple canvases; cross-canvas reference saves are serialized to
prevent competing writes from claiming the same document.

`createCanvasNode` writes a document into `Unfiled/` before adding its reference
and flushing the canvas. Failure to create the document leaves no node. Failure
to save the canvas retains the document on disk and the retryable canvas draft.
After an interrupted operation, the durable document may simply be standalone.

The workspace registry keeps document content and canvas presentation separately.
`openCanvas` loads referenced documents into the same registry used by the full
editor; `openNodeDocument` selects that document. Missing or unreadable documents
are reported in each loaded canvas's `documentErrors` map, without removing nodes
or inserting empty replacement documents. Layout saves preserve existing broken
references. `updateCanvas` changes presentation only; content edits continue to use
`updateDocument`. `flush` covers both save queues and outstanding node creation.

Scope 4 tests use temporary vaults to cover content ownership, creation ordering,
failed saves, missing references, stale loads, grouping, viewport persistence, and
edits arriving during saving. The Electron smoke test also covers creating nodes,
editing through both views, resizing an unselected node, persistence after closing,
and rendering missing references, groups, and edges. Desktop and narrow screenshots
are emitted alongside its temporary vault.

## Ownership

Scope 5 organization and placement APIs are implemented. Folder creation,
rename/move menus, and sidebar drag-and-drop are connected. Placement and reveal
have separate workspace actions.

Names are validated before file operations. File rename inputs are titles without
the Yantra extension; the filename and stored title change together. File and folder
IDs are not replaced (folders have paths, not IDs). Nested paths in the working
registry are updated when their containing folder moves. Existing files and folders
are never merged or overwritten on a collision. Case-only renames on case-insensitive
filesystems are treated as collisions; use an intermediate name.

The renderer pauses edits and flushes drafts before organization. Electron serializes
mutations, including saves, so queued work cannot write to an old location during a
move. File moves use exclusive links; file renames write the new metadata exclusively
before removing the source. Folder moves reserve an empty destination before rename.
If interrupted during a file rename/move, both copies can remain; duplicate-ID scanning
reports them without guessing which to delete. These ambiguous duplicate copies
require manual resolution; automatic replay applies to recorded deletions.

Vault snapshots include a rebuildable `appearances` lookup. Loaded canvas drafts take
precedence over this lookup. `placeDocument` reuses the existing document ID; it creates
only a node, or reveals the existing appearance. `revealDocument` opens the correct
canvas and sets a one-shot `revealTarget` request for the future UI to select and focus
that node. Ordinary navigation clears that request. Viewport state is retained.

There is no live external-file watcher.

## Lifecycle and Deletion

Workspace actions and Electron IPC provide:

- `removeFromCanvas(canvasId, nodeIds)` saves pending work, removes nodes and
  connected edges, repairs groups/layer order, and preserves every document.
- `deleteEntry(path)` flushes pending work and uses Electron `shell.trashItem`,
  never permanent unlink as a substitute for Trash. Deleting a canvas preserves
  its documents. Deleting a document removes its appearance before trashing it.
  Folders move to Trash with all their contents, including nested folders and extra
  files. References to contained documents are removed from canvases outside the
  folder. Symbolic links are moved without following their targets. Standalone
  unknown files and unavailable vault entries cannot be deleted. An unreadable
  outside canvas blocks document deletion because its references cannot be checked safely.
- `refresh()` flushes first, rescans, clears clean caches, and reopens the active
  file by stable ID at its new location. A failed save stops refresh and retains
  the local draft. Scans build replacement lookups separately and install them
  only after the full scan succeeds. A failed scan preserves the previous lookup
  and conflict baselines, so saving can resume when the vault is available again.
  Missing references stay visible as unavailable nodes.
- Repository and IPC `readDocument` / `readCanvas` default to `mode: 'inspect'`:
  they validate and return contents without accepting a new conflict baseline.
  Workspace loading and explicit conflict reload pass `'accept-disk'`. Content
  saves, reference validation, and rename inspection do not accept disk versions.
  Scan construction lives in `vault-scan.ts`; only a completed scan replaces the
  repository index. Path resolution and symlink checks live in `vault-file-access.ts`.
- `conflicts` maps `document:<id>` / `canvas:<id>` to file kind, ID, path, and
  message. Save failures with the structured `conflict` category retain local snapshots. Ordinary
  retry cannot bypass the comparison against the last accepted disk contents.
- `resolveConflict(kind, id, 'reload' | 'overwrite')` requires an explicit user
  choice. Reload discards only the chosen draft after disk/schema validation.
  Overwrite still requires the same identity and a supported, valid file; it
  cannot recreate a missing file or replace an unknown format. Missing/moved
  dirty files retain their drafts; restore a valid file at the expected path
  before resolving. Clean external moves are picked up by refresh.

Each loaded file exposes `reloadRevision` for the UI to remount an editor or
canvas after explicit reload. Ordinary edits do not increment this revision.
The UI must use it to prevent stale editor contents or undo history from writing
the discarded draft back. Reload revisions are wired into editor and canvas session identity; explicit
conflict-resolution controls are still pending.

Before replacement, saving checks the current bytes against the accepted disk
snapshot. Checks also protect file renaming/moving and deletion. These are local
conflict checks, not an OS-level atomic compare-and-swap with arbitrary external
editors; there is no cross-process locking protocol yet.

Document deletion records the original file and before/after canvas contents in
`.yantra/deletion.json` before changing either file. Replay on open or
`retryRecovery()` accepts only those exact before/after snapshots. Folder deletion
also records a SHA-256 fingerprint of the full tree (paths, file contents, and link
targets); recovery stops if anything changes. Legacy empty-folder records remain
supported. Successful
completion removes the record. Failed Trash or conflicting disk changes retain
the record and expose `vault.recovery` with a path and message. Writes are blocked
until recovery succeeds; reading and opening another vault remain available.
If the source is missing after interruption, recovery reports the ambiguity
instead of assuming it reached Trash. Restore/check it through the OS before
retrying. No in-app restore, force-recovery, or discard-record action exists.

- Document: owns its stable ID, title, rich content, and timestamps.
- Registry: holds loaded working documents by ID, including unsaved drafts.
- Scan: rebuilds the document ID-to-path lookup; it does not own document content.
- Session ID: an ephemeral capability identifying the currently open vault.
- Format version: the public file contract, unrelated to save revision counters.
- Save revision: an internal counter used to distinguish pending and saved edits.

Electron owns filesystem access and remembers the last chosen root in the app's
`vault-preferences.json`. Opening another vault flushes pending documents first.
Failed saves retain drafts and block switching. Late reads cannot change the active
document or populate a different vault's registry.

## UI Connection Requirements

### Operation Outcomes

Refactor Scope 2 introduces `OperationResult<T>` for the vault bridge and async
workspace commands: `success` (with a value), `cancelled` (user, superseded request,
or no applicable action), `failure` (with a structured error), or `recovery-required`
(with the resulting value and error). Restore with no remembered vault succeeds
with a null bridge value; cancelling the folder picker is a separate outcome.

Electron returns plain result objects through IPC and contextBridge rather than
throwing custom errors across that boundary. Repository internals may still throw;
the IPC boundary captures and classifies them. Errors carry stable categories
such as `conflict`, `collision`, `invalid-input`, `unsupported-format`, `missing`,
`permission`, `invalid-session`, and `recovery-required`. Unknown failures remain
`unknown`; wording is never used to guess their category.

Existing UI callers branch on the returned command result. They must not infer
success from the shared `error` notice or clear/rethrow that notice as a workaround.
An incomplete deletion can update the workspace but still return `recovery-required`.
The save coordinator retains each file's structured `failure` alongside the existing
display `error` string, so failures remain visible after navigation.

`flush()` deliberately retains its rejecting `Promise<void>` contract for the
before-close handshake: failed saving must prevent closing. Synchronous editor
updates remain synchronous. Document and canvas format versions remain unchanged. Folder deletion uses the
existing recovery record with a folder fingerprint in its original-content field.

Instantiate one `createVaultWorkspace` store for the application session, not per
editor. Call `restore()` once; it restores the vault but leaves no document open.
The existing before-close callback connects to `store.getState().flush()`.
The vault workspace is the only active persistence service.

Use `openDocument(path)` for file navigation, `createDocument(folder)` for creation,
and `updateDocument(id, doc)` for content changes. Mount a fresh shared editor
session keyed by vault session ID and document ID. Retain the registry across view
changes. Honor `busy` by pausing editing and navigation during vault operations.

The UI must show loading/read errors without mounting an editor for an invalid
document. Per-document save state lives in each registry entry; retry and flush
remain available independently of editor mounts.

The UI shows document/canvas loading, save states, errors, and retry controls. Failed saves
remain visible even for inactive files. Native close-failure choices are deferred.
Sidebar context menus offer Move to Trash for files and folders, with a confirmation
dialog and deletion-recovery retry. General refresh, recovery, and conflict controls
await UI implementation.

## Remaining UI Work

- Add explicit Refresh, Reload from Disk, and Overwrite Disk controls. Surface
  structured conflicts independently of generic save errors and retain local
  drafts on failure. Overwrite must require a separate confirmation.
- Add a persistent recovery notice and retry outside the deletion dialog. Keep
  mutation controls disabled while recovery is unresolved; preserve read access
  and the ability to open another vault. Never offer force or discard recovery.
- Expose Remove from Canvas through the workspace action. Appearance removal
  preserves documents and differs from moving their files to Trash. The legacy
  canvas selection deletion controls remain disabled in the live vault surface.
- Add native close-failure choices. Failed flushes currently keep the window open.
- Test any new lifecycle UI in both standalone documents and inline canvas
  editors, including focus, reload/undo history, pending writes, and failures.

## Checks

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
Run `pnpm test:vault-ui` for the isolated Electron workflow smoke test. It creates
a temporary vault, tests editing, navigation, save failure/retry, close flushing,
and reopening, and prints the location of its desktop/narrow screenshots. It also
exercises refresh/recovery IPC and the sidebar Trash flow for generated documents,
canvases, and nested folders through the production Electron handler.
Tests use temporary directories and controlled API implementations; they do not
touch the user's vault or legacy canvas. Native picker selection and closing with
pending edits should also be checked manually in Electron.

### Sidebar ordering

Vault metadata may include an optional `sidebarOrder` array of vault-relative paths.
The sidebar ranks siblings by this array while always placing folders above files.
Unlisted entries follow in the default alphabetical order. Drag near the top or
bottom of a sibling row to reorder within its folder/file group; dropping in the
middle of a folder row still moves the item into that folder. Ordering survives
refreshes and reopening the vault, and paths are updated after in-app moves and renames.

Document content validation is defined once in `src/shared/tiptap-document.ts`
and reused by editor updates, Markdown clipboard imports, and vault file parsing.
Unknown nodes, marks, and attributes are rejected rather than silently removed.
Ordered-list `attrs.type` and link `attrs.title` are preserved as optional nullable
strings. Existing version-1 files without these attributes remain valid.
