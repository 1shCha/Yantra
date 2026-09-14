# Vault Consolidation Refactor

The live app uses one Zustand vault workspace. Document content has one
authoritative home, and canvas files store presentation and relationships.
Document and canvas format versions remain unchanged; legacy names and extensions
are migrated on vault open as described in VAULT_FORMAT.md.

## Code Map

| Responsibility | Location |
| --- | --- |
| Repository entry point, mutation ordering, conflict baselines | `src/main/vault-repository.ts` |
| Replacement scan/index construction | `src/main/vault-scan.ts` |
| Electron path and symlink safety | `src/main/vault-file-access.ts` |
| Extensions, filename limits and path helpers | `src/shared/vault-paths.ts` |
| Visible title validation and filename conversion | `src/shared/document-title.ts` |
| Workspace actions and loading | `src/renderer/stores/vaultWorkspace.ts` |
| Resource registration, save queues, canvas references | `src/renderer/stores/workspace-resources.ts` |
| Busy state and operation ordering | `src/renderer/stores/workspace-operations.ts` |
| Navigation generations and pending reads | `src/renderer/stores/workspace-requests.ts` |
| Title commits, folders, renaming and moving | `src/renderer/stores/workspace-organization.ts` |
| Editor construction and content updates | `src/renderer/editor/useDocumentEditor.ts` |
| Title-exit scheduling and focus | `src/renderer/editor/useTitleCommit.ts` |
| Shared live/preview sidebar, header and CSS | `src/renderer/vault-ui/` |
| Live shell, navigation, viewport, document editor | `src/renderer/vault/` |

Inspection reads no longer implicitly accept external edits. Callers must request
`'accept-disk'` when loading a version they intend to adopt. Ordinary scans and
failed refreshes preserve existing conflict baselines.

The title draft can differ from the last committed filename. Title commits flush
pending content before renaming and do not invalidate an unrelated pending read.
Do not insert an unconditional async yield between checking operation availability
and reserving it: repeated title-exit callbacks must not race one another.

## Automated Evaluation

Run from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:vault-ui
pnpm test:vault-refactor
```

The first Electron suite uses an isolated temporary vault and production build.
It checks actual editing, title commits, file navigation, canvas interactions,
save failures/retry, close/reopen, sidebar organization, and lifecycle IPC. It also
asserts that production does not expose diagnostic globals. Generated documents, canvases, and populated folders
are moved to system Trash; real user vaults are not touched.

The second Electron suite starts and stops a temporary local development server.
It verifies cross-process save tracing, trace privacy, all preview selector states,
preview filesystem isolation, and layout at 1100px and 640px. Both suites print
their temporary artifact directories. Unit tests cover delayed operations,
failed scans, conflicts, recovery, naming, and editor invariants.

## Manual Check: About 15 Minutes

Use a disposable vault folder. Start the desktop app with `pnpm start`, then use
Create Vault to select that folder. Do not use a valuable vault for failure tests.

1. Create a document. The caret should start at its first heading. Type
   `Project 2026`, then press Enter. Expect `Project_2026.yantraD` in the sidebar
   and on disk, with a normal body paragraph ready for typing.
2. Click the title. Formatting controls should be disabled there. Resize a node
   later so a long title wraps: every wrapped title line stays protected. In the
   body, check headings, bold, lists, tasks, links, and undo/redo.
3. Change the title and click into its body without pressing Enter. The filename
   should update, and typing should continue in the body without an extra click.
4. Create another document. Change the first title, then immediately click the
   other sidebar file. The old document should rename while the clicked document
   remains open. Repeat rapidly. No stuck editor, stale view, or stolen focus.
5. Give two documents in the same folder the same title. Expect a persistent
   collision error, the previous filename retained, and both documents untouched.
   Change the failing title to a unique one and leave it to retry. Punctuation
   should be rejected; a blank title should not rename the file.
6. Create a canvas and double-click its background to create a node. Edit its
   title/body, leave it by clicking the background, drag it, and resize it both
   selected and unselected. Try a wide node with enough content to wrap. It should
   never get stuck between dragging and editing.
7. Use the node's Open Document action. Confirm the same content opens standalone.
   Edit it there and return to the canvas. The node should show the same changes.
8. Create nested folders. Drag documents/canvases between them and back to the
   vault root. Also test Move To and Rename from the context menu, including a
   collision. Check Finder: the moved file should keep its contents and canvas
   connection. A sidebar title rename intentionally starts a new undo history;
   ordinary typing and title commits should not.
9. Toggle both sidebars, resize the window, and enter/leave fullscreen. Check long
   titles, horizontal toolbar scrolling, menus, dialogs, and document scrolling for overlap.
10. Type body content and close the window promptly. Reopen Yantra and the same
    vault; check text, filenames, canvas layout, groups, and connections persisted.

Sidebar Move to Trash supports files and populated folders, with confirmation
and retry for interrupted deletion. General refresh, conflict-resolution, and
recovery UI remains pending; see Remaining UI Work in VAULT_FORMAT.md.

## Development Diagnostics

`pnpm start` enables a bounded in-memory trace (up to 500 events per process).
Open Electron DevTools and run:

```js
await window.yantraDebug.clear()
// Reproduce the operation, then:
console.table(await window.yantraDebug.snapshot())
```

Look for title-exit reasons, coalesced callbacks, workspace waits, save revisions,
IPC start/finish, filesystem operations, and deletion recovery phases. Matching
resource tokens connect document saves in the renderer to Electron writes.
Operation numbers are local to their source process, not globally unique IDs.
No titles, filenames, paths, content, error messages, or external telemetry are
recorded. Restarting clears the trace. Production builds collect no trace and
expose neither `window.yantraDebug` nor `window.yantraVaultTrace`.

The development-only UI preview remains available at `?preview=vault-ui` on the
local Vite URL. Its actions remain inert and do not mount a live vault workspace.
