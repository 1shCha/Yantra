# Yantra

A local Electron workspace for rich-text documents and connected canvases.
Documents live in `.yantraD` files; `.yantraC` files reference documents by ID
and store canvas layout. Open or create a vault folder from the sidebar.

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
```

The Electron smoke tests use isolated temporary vaults. The UI suite moves
its generated deletion fixtures to system Trash. The refactor suite checks
trace privacy, preview isolation, and responsive layouts.

See [VAULT_FORMAT.md](VAULT_FORMAT.md) for storage, lifecycle behavior, and
remaining UI work; [VAULT_REFACTOR.md](VAULT_REFACTOR.md) provides a code map,
manual checks, and debugging instructions.
