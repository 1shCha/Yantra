import type { EntryPlacement } from './vault-organization';
import type { DocumentFile, VaultSnapshot } from './vault-format';
import type { CanvasFile } from './vault-canvas';
import type { VaultBatchMoveResult } from './vault-batch-move';
import type { VaultEntryChange } from './vault-organization';
import type { OperationFailure, OperationResult } from './operation-result';

export interface CanvasDeletionResult {
  snapshot: VaultSnapshot;
  canvases: CanvasFile[];
  error?: OperationFailure;
}

export interface VaultOperations {
  deleteCanvasNodes: (sessionId: string, canvasId: string, nodeIds: string[]) => Promise<CanvasDeletionResult>;
  refresh: (sessionId: string) => Promise<VaultSnapshot>;
  deleteEntry: (sessionId: string, path: string) => Promise<VaultSnapshot>;
  retryRecovery: (sessionId: string) => Promise<VaultSnapshot>;
  restore: () => Promise<VaultSnapshot | null>;
  choose: (create: boolean) => Promise<VaultSnapshot | null>;
  readDocument: (sessionId: string, path: string, mode?: 'inspect' | 'accept-disk') => Promise<DocumentFile>;
  createDocument: (sessionId: string, folder: string) => Promise<{ path: string; document: DocumentFile }>;
  saveDocument: (sessionId: string, document: DocumentFile, overwrite?: boolean) => Promise<{ savedAt: string }>;
  readCanvas: (sessionId: string, path: string, mode?: 'inspect' | 'accept-disk') => Promise<CanvasFile>;
  createCanvas: (sessionId: string, folder: string) => Promise<{ path: string; canvas: CanvasFile }>;
  saveCanvas: (sessionId: string, canvas: CanvasFile, overwrite?: boolean) => Promise<{ savedAt: string }>;
  createNodeDocument: (sessionId: string) => Promise<{ path: string; document: DocumentFile }>;
  createFolder: (sessionId: string, folder: string, name: string) => Promise<{ path: string }>;
  renameEntry: (sessionId: string, path: string, name: string, documentTitle?: string) => Promise<VaultEntryChange>;
  moveEntry: (sessionId: string, path: string, folder: string, placement?: EntryPlacement) => Promise<VaultEntryChange>;
  moveEntries: (sessionId: string, paths: string[], folder: string) => Promise<VaultBatchMoveResult>;
}

// Plain results preserve error categories across both Electron IPC and contextBridge.
export type YantraVaultApi = {
  [Key in keyof VaultOperations]: (...args: Parameters<VaultOperations[Key]>) => Promise<OperationResult<Awaited<ReturnType<VaultOperations[Key]>>>>;
};

export const VAULT_CHANNELS = {
  DELETE_CANVAS_NODES: 'vault:delete-canvas-nodes',
  REFRESH: 'vault:refresh', DELETE_ENTRY: 'vault:delete-entry', RETRY_RECOVERY: 'vault:retry-recovery',
  RESTORE: 'vault:restore', CHOOSE: 'vault:choose',
  READ_DOCUMENT: 'vault:read-document', CREATE_DOCUMENT: 'vault:create-document', SAVE_DOCUMENT: 'vault:save-document',
  READ_CANVAS: 'vault:read-canvas', CREATE_CANVAS: 'vault:create-canvas', SAVE_CANVAS: 'vault:save-canvas',
  CREATE_NODE_DOCUMENT: 'vault:create-node-document',
  CREATE_FOLDER: 'vault:create-folder', RENAME_ENTRY: 'vault:rename-entry', MOVE_ENTRY: 'vault:move-entry',
  MOVE_ENTRIES: 'vault:move-entries',
} as const;

declare global {
  interface Window { yantraVault?: YantraVaultApi; }
}
