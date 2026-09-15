import type { VaultOperations, YantraVaultApi } from '../shared/vault-api';
import type { VaultSnapshot } from '../shared/vault-format';
import { cancelled, captureOperation, success, type OperationResult } from '../shared/operation-result';

function snapshotResult<T extends VaultSnapshot | null>(value: T): OperationResult<T> {
  return value?.recovery ? { status: 'recovery-required', value, error: { code: 'recovery-required', ...value.recovery } } : success(value);
}

// Controlled test backends use the same plain result boundary as Electron.
export function testVaultApi(api: VaultOperations): YantraVaultApi {
  return {
    restore: () => captureOperation(() => api.restore(), snapshotResult),
    choose: (create) => captureOperation(() => api.choose(create), (value) => value === null ? cancelled('user') : snapshotResult(value)),
    refresh: (session) => captureOperation(() => api.refresh(session), snapshotResult),
    deleteCanvasNodes: (session, canvasId, nodeIds) => captureOperation(() => api.deleteCanvasNodes(session, canvasId, nodeIds)),
    deleteEntry: (session, path) => captureOperation(() => api.deleteEntry(session, path), snapshotResult),
    retryRecovery: (session) => captureOperation(() => api.retryRecovery(session), snapshotResult),
    readDocument: (session, path, mode) => captureOperation(() => api.readDocument(session, path, mode)),
    createDocument: (session, folder) => captureOperation(() => api.createDocument(session, folder)),
    saveDocument: (session, file, overwrite) => captureOperation(() => api.saveDocument(session, file, overwrite)),
    readCanvas: (session, path, mode) => captureOperation(() => api.readCanvas(session, path, mode)),
    createCanvas: (session, folder) => captureOperation(() => api.createCanvas(session, folder)),
    saveCanvas: (session, file, overwrite) => captureOperation(() => api.saveCanvas(session, file, overwrite)),
    createNodeDocument: (session) => captureOperation(() => api.createNodeDocument(session)),
    createFolder: (session, folder, name) => captureOperation(() => api.createFolder(session, folder, name)),
    renameEntry: (session, path, name, title) => captureOperation(() => api.renameEntry(session, path, name, title)),
    moveEntry: (session, path, folder, placement) => captureOperation(() => api.moveEntry(session, path, folder, placement)),
  };
}
