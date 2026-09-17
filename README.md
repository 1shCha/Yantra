# Yantra

A local Electron workspace for rich-text documents and connected canvases.
Documents live in `.yantraD` files; `.yantraC` files reference documents by ID
and store canvas layout. Open or create a vault folder from the sidebar.

Files open in tabs along the top of the workspace. Single-click a sidebar file
to open a tab; double-click to replace the active tab. Files already open are
focused instead. The plus menu offers the same file tree with independent
folder expansion, plus document and canvas creation at the vault root.
Tab order and the active file are restored per vault from local app preferences.
Click a file name in its header to rename it inline. Enter saves; Escape or
clicking elsewhere cancels. Invalid or duplicate names revert with an inline error.

## Development

```sh
pnpm install
pnpm start
```

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:vault-ui
pnpm test:vault-refactor
pnpm test:tabs-ui
```

The Electron smoke tests use isolated temporary vaults. The UI suite moves
its generated deletion fixtures to system Trash. The refactor suite checks
trace privacy, preview isolation, and responsive layouts.
The tabs suite checks navigation, editor and canvas state, the shared file
picker, session restoration, keyboard controls, and overflow.

See [VAULT_FORMAT.md](VAULT_FORMAT.md) for storage, lifecycle behavior, and
remaining UI work; [VAULT_REFACTOR.md](VAULT_REFACTOR.md) provides a code map,
manual checks, and debugging instructions.
