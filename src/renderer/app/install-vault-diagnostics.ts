import { vaultTrace } from '../persistence/vault-diagnostics';

if (vaultTrace.enabled) window.yantraDebug = {
  async snapshot() {
    const main = await window.yantraVaultTrace?.snapshot() ?? [];
    return [...main, ...vaultTrace.snapshot()].sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  },
  async clear() { vaultTrace.clear(); await window.yantraVaultTrace?.clear(); },
};
