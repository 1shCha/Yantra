import type { EntryPlacement } from '../../shared/vault-organization';
import type { OperationResult } from '../../shared/operation-result';
import type { DocumentFile, VaultSnapshot } from '../../shared/vault-format';
import type { TiptapDoc } from '../../shared/tiptap-document';
import type { CanvasFile, CanvasPresentation } from '../../shared/vault-canvas';
import type { CanvasAppearance } from '../../shared/vault-organization';
import type { SaveStatus } from '../persistence/save-coordinator';

export interface LoadedDocument {
  reloadRevision: number;
  path: string;
  file: DocumentFile;
  save: SaveStatus;
}

export interface LoadedCanvas {
  reloadRevision: number;
  path: string;
  file: CanvasFile;
  save: SaveStatus;
  documentErrors: Map<string, string>;
}

export interface VaultWorkspaceState {
  deletingCanvasId: string | null;
  deletingDocumentIds: ReadonlySet<string>;
  titleErrors: Map<string, string>;
  commitDocumentTitle: (id: string) => Promise<OperationResult>;
  conflicts: Map<string, { kind: 'document' | 'canvas'; id: string; path: string; message: string }>;
  refresh: () => Promise<OperationResult>;
  deleteCanvasNodes: (canvasId: string, nodeIds: string[]) => Promise<OperationResult>;
  deleteEntry: (path: string) => Promise<OperationResult>;
  retryRecovery: () => Promise<OperationResult>;
  removeFromCanvas: (canvasId: string, nodeIds: string[]) => Promise<OperationResult>;
  resolveConflict: (kind: 'document' | 'canvas', id: string, choice: 'reload' | 'overwrite') => Promise<OperationResult>;
  vault: VaultSnapshot | null;
  documents: Map<string, LoadedDocument>;
  canvases: Map<string, LoadedCanvas>;
  activePath: string | null;
  activeDocumentId: string | null;
  activeCanvasId: string | null;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  busy: boolean;
  restore: () => Promise<OperationResult>;
  choose: (create: boolean) => Promise<OperationResult>;
  openDocument: (path: string) => Promise<OperationResult>;
  createDocument: (folder?: string) => Promise<OperationResult>;
  updateDocument: (id: string, doc: TiptapDoc) => void;
  flush: () => Promise<void>;
  retry: (id: string) => Promise<OperationResult>;
  openCanvas: (path: string) => Promise<OperationResult>;
  createCanvas: (folder?: string) => Promise<OperationResult>;
  updateCanvas: (id: string, presentation: CanvasPresentation) => void;
  createCanvasNode: (canvasId: string, position: { x: number; y: number }) => Promise<OperationResult>;
  openNodeDocument: (canvasId: string, nodeId: string) => Promise<OperationResult>;
  retryCanvas: (id: string) => Promise<OperationResult>;
  createFolder: (folder: string, name: string) => Promise<OperationResult>;
  renameEntry: (path: string, name: string, documentTitle?: string) => Promise<OperationResult>;
  moveEntry: (path: string, folder: string, placement?: EntryPlacement) => Promise<OperationResult>;
  getAppearance: (documentId: string) => CanvasAppearance | null;
  placeDocument: (canvasId: string, documentId: string, position: { x: number; y: number }) => Promise<OperationResult>;
  revealDocument: (documentId: string) => Promise<OperationResult>;
  revealTarget: { canvasId: string; nodeId: string; requestId: string } | null;
}
