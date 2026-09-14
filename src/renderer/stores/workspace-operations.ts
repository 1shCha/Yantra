import type { StoreApi } from 'zustand/vanilla';
import type { VaultSnapshot } from '../../shared/vault-format';
import { failure, OperationError, success, type OperationResult } from '../../shared/operation-result';
import type { VaultWorkspaceState } from './workspace-types';
import type { WorkspaceRequests } from './workspace-requests';
import { vaultTrace } from '../persistence/vault-diagnostics';

export function createWorkspaceOperations(set: StoreApi<VaultWorkspaceState>['setState'], get: StoreApi<VaultWorkspaceState>['getState'], requests: WorkspaceRequests, flushResources: () => Promise<void>) {
  let operation: Promise<OperationResult> | null = null;
  function blocked(): OperationResult<never> {
    return failure(new OperationError(get().busy
      ? { code: 'busy', message: 'A vault operation is already in progress.' }
      : { code: 'no-vault', message: 'Open a vault first.' }));
  }

  function runOperation(work: () => Promise<void | OperationResult>, reportError = true): Promise<OperationResult> {
    if (get().busy) return Promise.resolve(blocked());
    const traceOperation = vaultTrace.next();
    vaultTrace.record('workspace.start', { operation: traceOperation });
    set({ busy: true, error: null });
    operation = Promise.resolve().then(work).then((outcome) => outcome ?? success(undefined)).catch(failure).then((outcome) => {
      if (reportError && (outcome.status === 'failure' || outcome.status === 'recovery-required')) set({ error: outcome.error.message });
      vaultTrace.record('workspace.finish', { operation: traceOperation, outcome: outcome.status,
        code: outcome.status === 'failure' || outcome.status === 'recovery-required' ? outcome.error.code : undefined });
      return outcome;
    }).finally(() => {
      operation = null;
      set({ busy: false });
    });
    return operation;
  }

  function organize(work: (vault: VaultSnapshot) => Promise<void | OperationResult>, reportError = true): Promise<OperationResult> {
    const vault = get().vault;
    if (!vault || get().busy) return Promise.resolve(blocked());
    // A pending read from an old path must not re-register the file after a move.
    requests.invalidate();
    if (get().loadState === 'loading') set({ activePath: null, loadState: 'idle' });
    return runOperation(async () => { await flushResources(); return work(vault); }, reportError);
  }

  async function waitForIdle() {
    if (operation) vaultTrace.record('workspace.wait');
    while (operation) await operation;
  }
  return { blocked, runOperation, organize, waitForIdle, get pending() { return operation; } };
}
