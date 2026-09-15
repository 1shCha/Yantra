import type { StoreApi } from 'zustand/vanilla';
import type { VaultSnapshot } from '../../shared/vault-format';
import { failure, OperationError, success, type OperationResult } from '../../shared/operation-result';
import type { VaultWorkspaceState } from './workspace-types';
import type { WorkspaceRequests } from './workspace-requests';
import { vaultTrace } from '../persistence/vault-diagnostics';

export function createWorkspaceOperations(set: StoreApi<VaultWorkspaceState>['setState'], get: StoreApi<VaultWorkspaceState>['getState'], requests: WorkspaceRequests, flushResources: () => Promise<void>) {
  let operation: Promise<OperationResult> | null = null;
  function blocked(): OperationResult<never> {
    return failure(new OperationError((get().busy || get().deletingCanvasId !== null)
      ? { code: 'busy', message: 'A vault operation is already in progress.' }
      : { code: 'no-vault', message: 'Open a vault first.' }));
  }

  function execute(work: () => Promise<void | OperationResult>, reportError: boolean, globalBusy: boolean): Promise<OperationResult> {
    if (get().busy) return Promise.resolve(blocked());
    const previous = operation;
    const traceOperation = vaultTrace.next();
    // Reserve a place immediately. Every accepted command belongs to this FIFO,
    // including commands queued behind background creation or ordering saves.
    if (!previous && globalBusy) set({ busy: true, error: null });
    const scheduled = (previous ?? Promise.resolve()).then(() => {
      vaultTrace.record('workspace.start', { operation: traceOperation });
      if (previous && globalBusy) set({ busy: true, error: null });
      return work();
    }).then((outcome) => outcome ?? success(undefined)).catch(failure).then((outcome) => {
      if (reportError && (outcome.status === 'failure' || outcome.status === 'recovery-required')) set({ error: outcome.error.message });
      vaultTrace.record('workspace.finish', { operation: traceOperation, outcome: outcome.status,
        code: outcome.status === 'failure' || outcome.status === 'recovery-required' ? outcome.error.code : undefined });
      return outcome;
    }).finally(() => {
      if (operation === scheduled) operation = null;
      if (globalBusy) set({ busy: false });
    });
    operation = scheduled;
    return scheduled;
  }

  function runOperation(work: () => Promise<void | OperationResult>, reportError = true) {
    return execute(work, reportError, true);
  }

  // Creation and ordering share the operation queue without disabling unrelated
  // controls. Path-changing work and close/refresh still wait for them.
  function runBackgroundOperation(work: () => Promise<void | OperationResult>) {
    return execute(work, true, false);
  }

  function organize(work: (vault: VaultSnapshot) => Promise<void | OperationResult>, reportError = true): Promise<OperationResult> {
    const vault = get().vault;
    if (!vault || get().busy) return Promise.resolve(blocked());
    return runOperation(async () => {
      // Invalidate when this operation starts: navigation remains available while
      // an earlier metadata save is pending, but old paths must not survive a move.
      requests.invalidate();
      if (get().loadState === 'loading') set({ activePath: null, loadState: 'idle' });
      await flushResources();
      const current = get().vault;
      if (!current || current.sessionId !== vault.sessionId) return blocked();
      return work(current);
    }, reportError);
  }

  async function waitForIdle() {
    if (operation) vaultTrace.record('workspace.wait');
    while (operation) await operation;
  }
  return { blocked, runOperation, runBackgroundOperation, organize, waitForIdle, get pending() { return operation; } };
}
