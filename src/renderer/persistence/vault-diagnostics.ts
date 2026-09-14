import { VaultTrace } from '../../shared/vault-trace';

declare const __VAULT_DIAGNOSTICS__: boolean;
// oxlint-disable-next-line anti-slop/no-runtime-typeof -- Build constant is absent in repository-only test runners.
export const vaultTrace = new VaultTrace(typeof __VAULT_DIAGNOSTICS__ !== 'undefined' && __VAULT_DIAGNOSTICS__, 'renderer');
