import type { StoreApi } from 'zustand/vanilla';
import { getSchema } from '@tiptap/core';
import { OperationError, unwrapOperation } from '../../shared/operation-result';
import type { YantraVaultApi } from '../../shared/vault-api';
import { documentFileSchema, type DocumentFile, type VaultSnapshot, type VaultEntry } from '../../shared/vault-format';
import { canvasFileSchema, canvasPresentationSchema, type CanvasFile, type CanvasPresentation } from '../../shared/vault-canvas';
import { relocatedPath, relocateEntries, type VaultEntryChange } from '../../shared/vault-organization';
import { documentSchemaExtensions } from '../editor/tiptap-schema';
import { SaveCoordinator, type SaveStatus } from '../persistence/save-coordinator';
import type { VaultWorkspaceState } from './workspace-types';
import type { WorkspaceRequests } from './workspace-requests';

export function createWorkspaceResources(api: YantraVaultApi, set: StoreApi<VaultWorkspaceState>['setState'], get: StoreApi<VaultWorkspaceState>['getState'], requests: WorkspaceRequests, overwrites: Set<string>) {
  let coordinator: SaveCoordinator<DocumentFile> | null = null;
  let canvasCoordinator: SaveCoordinator<CanvasFile> | null = null;
  const editorSchema = getSchema(documentSchemaExtensions);
  function initialize(vault: VaultSnapshot) {
    const next = new SaveCoordinator<DocumentFile>({
      serialize: JSON.stringify,
      write: async (id, file) => unwrapOperation(await api.saveDocument(vault.sessionId, file, overwrites.has(`document:${id}`))).savedAt,
    });
    next.subscribe((id, save) => {
      const document = get().documents.get(id);
      if (!document) return;
      publishConflict('document', id, document.path, save);
      set({ documents: new Map(get().documents).set(id, { ...document, save }) });
    });
    coordinator = next;
    const nextCanvases = new SaveCoordinator<CanvasFile>({
      serialize: JSON.stringify,
      write: async (id, file) => unwrapOperation(await api.saveCanvas(vault.sessionId, file, overwrites.has(`canvas:${id}`))).savedAt,
    });
    nextCanvases.subscribe((id, save) => {
      const canvas = get().canvases.get(id);
      if (canvas) publishConflict('canvas', id, canvas.path, save);
      if (canvas) set({ canvases: new Map(get().canvases).set(id, { ...canvas, save }) });
    });
    canvasCoordinator = nextCanvases;
  }
  async function flushResources() {
    do {
      await coordinator?.flushAll();
      await canvasCoordinator?.flushAll();
    } while ([...get().documents.values(), ...get().canvases.values()].some((resource) => resource.save.state !== 'clean'));
  }

  function publishConflict(kind: 'document' | 'canvas', id: string, path: string, save: SaveStatus) {
    const key = `${kind}:${id}`;
    const conflicts = new Map(get().conflicts);
    if (save.failure?.code === 'conflict') conflicts.set(key, { kind, id, path, message: save.failure.message });
    else if (save.state === 'clean') conflicts.delete(key);
    set({ conflicts });
  }

  function register(path: string, input: DocumentFile) {
    const file = documentFileSchema.parse(input);
    // Structural validation prevents unsupported documents being normalized by the editor.
    editorSchema.nodeFromJSON(file.doc).check();
    if (!coordinator) throw new OperationError({ code: 'invalid-input', message: 'No vault is open.' });
    if (!get().documents.has(file.id)) {
      coordinator.register(file.id, file);
      set({ documents: new Map(get().documents).set(file.id, { path, file, save: coordinator.status(file.id), reloadRevision: 0 }) });
    }
    return file.id;
  }

  function registerCanvas(path: string, input: CanvasFile) {
    const file = canvasFileSchema.parse(input);
    if (!canvasCoordinator) throw new OperationError({ code: 'invalid-input', message: 'No vault is open.' });
    if (!get().canvases.has(file.id)) {
      canvasCoordinator.register(file.id, file);
      set({ canvases: new Map(get().canvases).set(file.id, { path, file, save: canvasCoordinator.status(file.id), documentErrors: new Map(), reloadRevision: 0 }) });
    }
    return file.id;
  }

  function commitCanvas(id: string, input: CanvasPresentation) {
    const loaded = get().canvases.get(id);
    if (!loaded || !canvasCoordinator) throw new OperationError({ code: 'unavailable', message: 'Canvas is not loaded.' });
    const presentation = canvasPresentationSchema.parse(input);
    for (const node of presentation.nodes) {
      for (const other of get().canvases.values()) {
        if (other.file.id !== id && other.file.nodes.some((candidate) => candidate.documentId === node.documentId)) {
          throw new OperationError({ code: 'invalid-input', message: 'A document can appear on only one canvas.' });
        }
      }
      if (!loaded.file.nodes.some((candidate) => candidate.id === node.id && candidate.documentId === node.documentId)
        && !get().documents.has(node.documentId)) throw new OperationError({ code: 'invalid-input', message: 'Load the document before adding a canvas reference.' });
    }
    const unchanged = { ...loaded.file, ...presentation };
    if (JSON.stringify(unchanged) === JSON.stringify(loaded.file)) return;
    const file = { ...unchanged, updatedAt: new Date().toISOString() };
    set({ canvases: new Map(get().canvases).set(id, { ...loaded, file }) });
    canvasCoordinator.update(id, file);
  }

  function documentEntry(entries: VaultEntry[], id: string): VaultEntry | undefined {
    for (const entry of entries) {
      if (entry.documentId === id) return entry;
      const found = entry.children && documentEntry(entry.children, id);
      if (found) return found;
    }
  }

  async function loadCanvasDocuments(id: string, vault: VaultSnapshot, epoch: number) {
    const canvas = get().canvases.get(id)!;
    const errors = new Map<string, string>();
    await Promise.all(canvas.file.nodes.map(async (node) => {
      if (get().documents.has(node.documentId)) return;
      const entry = documentEntry(vault.entries, node.documentId);
      try {
        if (!entry || entry.error) throw new Error(entry?.error ?? 'Referenced document is missing.');
        let pending = requests.loading.get(entry.path);
        if (!pending) {
          pending = api.readDocument(vault.sessionId, entry.path, 'accept-disk').then(unwrapOperation);
          requests.loading.set(entry.path, pending);
        }
        const file = await pending;
        if (epoch !== requests.generation) return;
        if (file.id !== node.documentId) throw new OperationError({ code: 'conflict', message: 'The referenced document identity changed on disk.' });
        register(entry.path, file);
      } catch (error) {
        errors.set(node.documentId, error instanceof Error ? error.message : String(error));
      } finally {
        if (epoch === requests.generation && entry) requests.loading.delete(entry.path);
      }
    }));
    if (epoch === requests.generation) {
      const current = get().canvases.get(id)!;
      set({ canvases: new Map(get().canvases).set(id, { ...current, documentErrors: errors }) });
    }
  }

  function applyEntryChange(change: VaultEntryChange) {
    const current = get();
    if (!current.vault) return;
    const documents = new Map(current.documents);
    for (const [id, loaded] of documents) {
      const file = change.document?.id === id ? change.document : loaded.file;
      const path = relocatedPath(loaded.path, change.from, change.to);
      if (file !== loaded.file) coordinator!.replaceCleanSnapshot(id, file);
      const contentChanged = JSON.stringify(file.doc) !== JSON.stringify(loaded.file.doc);
      if (file !== loaded.file || path !== loaded.path) documents.set(id, { ...loaded, path, file, reloadRevision: loaded.reloadRevision + Number(contentChanged) });
    }
    const canvases = new Map(current.canvases);
    for (const [id, loaded] of canvases) {
      const file = change.canvas?.id === id ? change.canvas : loaded.file;
      const path = relocatedPath(loaded.path, change.from, change.to);
      if (file !== loaded.file) canvasCoordinator!.replaceCleanSnapshot(id, file);
      if (file !== loaded.file || path !== loaded.path) canvases.set(id, { ...loaded, path, file });
    }
    set({ documents, canvases,
      activePath: current.activePath ? relocatedPath(current.activePath, change.from, change.to) : null,
      vault: { ...current.vault, entries: change.from === change.to ? current.vault.entries : relocateEntries(current.vault.entries, change.from, change.to),
        appearances: current.vault.appearances.map((appearance) => ({ ...appearance, canvasPath: relocatedPath(appearance.canvasPath, change.from, change.to) })) },
    });
  }

  return { initialize, flushResources, register, registerCanvas, commitCanvas, documentEntry, loadCanvasDocuments, applyEntryChange,
    get documentSaves() { return coordinator; }, get canvasSaves() { return canvasCoordinator; } };
}
