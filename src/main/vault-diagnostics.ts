import { VaultTrace } from '../shared/vault-trace';
import { AsyncLocalStorage } from 'node:async_hooks';

// Replaced at build time. Production builds do not enable the inspection bridge.
declare const __VAULT_DIAGNOSTICS__: boolean;
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Build constant is absent in repository-only test runners.
export const vaultTrace = new VaultTrace(typeof __VAULT_DIAGNOSTICS__ !== 'undefined' && __VAULT_DIAGNOSTICS__, 'main');
export const vaultTraceOperation = new AsyncLocalStorage<number>();
