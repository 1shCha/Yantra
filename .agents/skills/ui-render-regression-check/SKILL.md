---
name: ui-render-regression-check
description: Check and fix unnecessary renders, editor remounts, and lost interaction state after Yantra UI changes, including changes to stores and shared data that drive the UI. Use for every UI-related implementation or fix in this repository.
---

# UI render regression check

Apply this check before completing a UI-related change. Run commands from the Yantra repository root. This skill guides the agent; it is not a background watcher or a guarantee that every performance defect is detectable.

## Review the changed interaction

Identify what should update and what should remain stable. Trace the action through store writes, selectors, props, context, effects, and component keys. Include UI-driving changes outside `src/renderer`, such as file-tree transformations and IPC results.

Check for these demonstrated failure modes:

- Rebuilding unchanged folders, tabs, document maps, or canvas geometry during metadata updates.
- Subscribing an individual pane or row to whole collections when it needs one entry or a stable derived value.
- Changing keys or reload revisions for title-only edits, remounting an editor and losing undo history.
- Publishing unchanged geometry into the canvas interaction store, resetting selection or doing unnecessary React Flow work.
- Recreating callback, node-data, or context objects across memo boundaries.
- Passing global busy state through every expensive child when an ancestor can safely enforce the interaction lock.

Preserve legitimate title, save-status, loading, and error updates. Keep save/deletion locks and cross-view synchronization working. Do not add blanket memoization, suppress dependencies, or weaken correctness to reduce renders.

## Verify the behavior

Run `pnpm check:ui-regressions` after the final relevant changes. This runs typecheck, lint, focused state/identity tests, and the Electron tabs/rename smoke checks against a fresh build and temporary vault. A successful run already covering the final changes need not be repeated.

Existing coverage lives in:

- `src/renderer/stores/vaultWorkspace.test.ts`: node identity, rename isolation, unchanged canvas flow state.
- `src/renderer/stores/workspace-tabs.test.ts` and `src/shared/vault-organization.test.ts`: tab behavior and unchanged folder identity.
- `src/main/vault-organization.test.ts`: rename persistence and save-lock correctness.
- `tools/tabs-ui-smoke.ts`: instrumented component render/mount counts during typing and rename, editor instance and undo retention, sidebar row lifecycle and DOM stability, tab restoration, canvas viewport retention, and inline rename behavior.

The tabs smoke suite uses a dedicated Vite `ui-regressions` build with render/lifecycle probes injected by `tools/ui-render-probe-plugin.ts`. Normal builds do not include the probes. Require an observed positive update (such as header typing and the renamed row) so absent instrumentation cannot silently count as zero renders.

Exercise typing, cancellation, and commit separately with both active and inactive document/canvas tabs and the sidebar/picker mounted. A rename should update the renamed row without remounting it; key files by immutable file identity, not their mutable paths. Global save locks may update active interaction wrappers, but must not cause inactive document editors, canvas document nodes, or unchanged canvas geometry to render.

The baseline does not cover every new interaction. Exercise the changed action plus a nearby unrelated view. Check focus/selection, undo history, scroll position, and canvas viewport where relevant. For layout-only work, verify the changed layout and interaction without inventing state tests. For uncovered state or lifecycle behavior, add a focused regression assertion to the appropriate existing suite, or a small new test and include it in the check command. When the concern is unnecessary rendering, extend the probe plugin and assert render/mount counts; DOM mutation observers detect visible mutations, not all React renders. Avoid brittle absolute render counts affected by development/Strict Mode, and avoid timing thresholds without a reproducible baseline.

## Fix and report

Fix demonstrated regressions within the task, add coverage for the failure, and rerun affected checks. Keep assertions that the intended update still happens as well as assertions that unrelated state remains stable. Do not weaken a failing test to hide a regression; update an expectation only when the requested behavior intentionally changed.

Use temporary vaults, not the user's files, for mutation tests. If a test cannot run because the environment lacks Electron/display support or permissions, finish available checks and report the exact missing verification. Do not report a skipped check as passing. Stop retries when new evidence no longer supports another fix, and report the unresolved issue.

In the final response, briefly state the stability checks performed and any material gap. Do not claim zero renders or complete performance coverage from the baseline alone.
