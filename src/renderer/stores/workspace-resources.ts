import { reconcileCanvasPresentation } from '../../shared/canvas-presentation';
import type { StoreApi } from 'zustand/vanilla';
import { getSchema } from '@tiptap/core';
import { OperationError, unwrapOperation } from '../../shared/operation-result';
import type { CanvasDeletionResult, YantraVaultApi } from '../../shared/vault-api';
import { documentFileSchema, type DocumentFile, type VaultSnapshot, type VaultEntry } from '../../shared/vault-format';
import { canvasFileSchema, canvasPresentationSchema, type CanvasFile, type CanvasPresentation } from '../../shared/vault-canvas';
import { insertEntry, relocatedPath, relocateEntries, type VaultEntryChange } from '../../shared/vault-organization';
import { documentSchemaExtensions } from '../editor/tiptap-schema';
import { SaveCoordinator, type SaveStatus } from '../persistence/save-coordinator';
import type { LoadedDocument, LoadedCanvas, VaultWorkspaceState } from './workspace-types';
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

  function prepareDocument(path: string, input: DocumentFile): LoadedDocument {
    const file = documentFileSchema.parse(input);
    // Structural validation prevents unsupported documents being normalized by the editor.
    editorSchema.nodeFromJSON(file.doc).check();
    if (!coordinator) throw new OperationError({ code: 'invalid-input', message: 'No vault is open.' });
    if (!get().documents.has(file.id)) {
      coordinator.register(file.id, file);
      return { path, file, save: coordinator.status(file.id), reloadRevision: 0 };
    }
    return get().documents.get(file.id)!;
  }

  function register(path: string, input: DocumentFile) {
    const document = prepareDocument(path, input);
    if (!get().documents.has(document.file.id)) set({ documents: new Map(get().documents).set(document.file.id, document) });
    return document.file.id;
  }

  function prepareCanvas(path: string, input: CanvasFile): LoadedCanvas {
    const file = canvasFileSchema.parse(input);
    if (!canvasCoordinator) throw new OperationError({ code: 'invalid-input', message: 'No vault is open.' });
    if (!get().canvases.has(file.id)) {
      canvasCoordinator.register(file.id, file);
      return { path, file, save: canvasCoordinator.status(file.id), documentErrors: new Map(), reloadRevision: 0 };
    }
    return get().canvases.get(file.id)!;
  }

  function registerCanvas(path: string, input: CanvasFile) {
    const canvas = prepareCanvas(path, input);
    if (!get().canvases.has(canvas.file.id)) set({ canvases: new Map(get().canvases).set(canvas.file.id, canvas) });
    return canvas.file.id;
  }

  function prepareCanvasChange(id: string, input: CanvasPresentation, documents = get().documents): LoadedCanvas {
    const loaded = get().canvases.get(id);
    if (!loaded || !canvasCoordinator) throw new OperationError({ code: 'unavailable', message: 'Canvas is not loaded.' });
    const presentation = canvasPresentationSchema.parse(input);
    const otherDocumentIds = new Set([...get().canvases.values()]
      .filter((canvas) => canvas.file.id !== id)
      .flatMap((canvas) => canvas.file.nodes.map((node) => node.documentId)));
    const existingReferences = new Map(loaded.file.nodes.map((node) => [node.id, node.documentId]));
    for (const node of presentation.nodes) {
      if (otherDocumentIds.has(node.documentId)) {
        throw new OperationError({ code: 'invalid-input', message: 'A document can appear on only one canvas.' });
      }
      if (existingReferences.get(node.id) !== node.documentId && !documents.has(node.documentId)) {
        throw new OperationError({ code: 'invalid-input', message: 'Load the document before adding a canvas reference.' });
      }
    }
    const reconciled = reconcileCanvasPresentation(presentation, loaded.file);
    if (reconciled === loaded.file) return loaded;
    const file = { ...loaded.file, ...reconciled, updatedAt: new Date().toISOString() };
    return { ...loaded, file };
  }

  function commitCanvas(id: string, input: CanvasPresentation) {
    const canvas = prepareCanvasChange(id, input);
    if (canvas === get().canvases.get(id)) return;
    set({ canvases: new Map(get().canvases).set(id, canvas) });
    canvasCoordinator!.update(id, canvas.file);
  }

  function addCanvasDocument(canvasId: string, created: { path: string; document: DocumentFile }, position: { x: number; y: number }) {
    const document = prepareDocument(created.path, created.document);
    const state = get();
    const vault = state.vault!;
    const documents = new Map(state.documents).set(document.file.id, document);
    let entries = vault.entries;
    if (!entries.some((entry) => entry.path === 'Unfiled')) entries = insertEntry(entries, '', { path: 'Unfiled', name: 'Unfiled', kind: 'folder', children: [] });
    entries = insertEntry(entries, 'Unfiled', { path: created.path, name: `${document.file.title}.yantraD`, kind: 'document', documentId: document.file.id });
    const current = state.canvases.get(canvasId)!.file;
    const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId: document.file.id,
      x: Math.round(position.x - 160), y: Math.round(position.y - 110), width: 320, height: 220 };
    const canvas = prepareCanvasChange(canvasId, { nodes: [...current.nodes, node], edges: current.edges,
      groups: current.groups, layerOrder: [...current.layerOrder, node.id], viewport: current.viewport }, documents);
    // Publish a complete addition: subscribers never see a reference without its
    // document or an intermediate canvas with a missing sidebar entry.
    set({ documents, vault: { ...vault, entries }, canvases: new Map(state.canvases).set(canvasId, canvas) });
    canvasCoordinator!.update(canvasId, canvas.file);
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
        if (!get().canvases.get(id)?.file.nodes.some((current) => current.documentId === node.documentId)) return;
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

  function applyCanvasDeletion(change: CanvasDeletionResult) {
    const current = get();
    if (current.vault?.sessionId !== change.snapshot.sessionId) return;
    // Keep untouched tree branches so memoized sidebar rows retain their props.
    function reconcileEntries(before: VaultEntry[], after: VaultEntry[]): VaultEntry[] {
      const byPath = new Map(before.map((entry) => [entry.path, entry]));
      const entries = after.map((entry) => {
        const previous = byPath.get(entry.path);
        if (!previous) return entry;
        const children = entry.children && reconcileEntries(previous.children ?? [], entry.children);
        const next = { ...entry };
        if (children) next.children = children;
        return children === previous.children && JSON.stringify({ ...previous, children: undefined }) === JSON.stringify({ ...next, children: undefined }) ? previous : next;
      });
      return entries.length === before.length && entries.every((entry, index) => entry === before[index]) ? before : entries;
    }
    const documents = new Map(current.documents);
    const removedPaths = new Set<string>();
    const titleErrors = new Map(current.titleErrors);
    const conflicts = new Map(current.conflicts);
    for (const id of current.deletingDocumentIds) {
      if (documentEntry(change.snapshot.entries, id)) continue;
      const removedPath = documentEntry(current.vault.entries, id)?.path;
      if (removedPath) removedPaths.add(removedPath);
      if (documents.has(id)) coordinator!.unregister(id);
      documents.delete(id);
      titleErrors.delete(id);
      conflicts.delete(`document:${id}`);
      const path = current.documents.get(id)?.path;
      if (path) requests.loading.delete(path);
    }
    const canvases = new Map(current.canvases);
    for (const file of change.canvases) {
      const loaded = canvases.get(file.id);
      if (!loaded) continue;
      const stable = { ...file,
        edges: JSON.stringify(file.edges) === JSON.stringify(loaded.file.edges) ? loaded.file.edges : file.edges,
        groups: JSON.stringify(file.groups) === JSON.stringify(loaded.file.groups) ? loaded.file.groups : file.groups,
        layerOrder: JSON.stringify(file.layerOrder) === JSON.stringify(loaded.file.layerOrder) ? loaded.file.layerOrder : file.layerOrder,
      };
      canvasCoordinator!.replaceCleanSnapshot(file.id, stable);
      const ids = new Set(file.nodes.map((node) => node.documentId));
      canvases.set(file.id, { ...loaded, file: stable, documentErrors: new Map([...loaded.documentErrors].filter(([id]) => ids.has(id))) });
    }
    const revealTarget = current.revealTarget;
    const update: Partial<VaultWorkspaceState> = { documents, canvases, titleErrors, conflicts,
      vault: { ...change.snapshot, entries: reconcileEntries(current.vault.entries, change.snapshot.entries),
        metadata: JSON.stringify(current.vault.metadata) === JSON.stringify(change.snapshot.metadata) ? current.vault.metadata : change.snapshot.metadata },
      revealTarget: revealTarget && canvases.get(revealTarget.canvasId)?.file.nodes.some((node) => node.id === revealTarget.nodeId) ? revealTarget : null,
    };
    if (current.activePath && removedPaths.has(current.activePath)) {
      Object.assign(update, { activeDocumentId: null, activePath: null, loadState: 'idle' });
    }
    set(update);
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
    set({ documents, canvases, error: change.warning ?? current.error,
      activePath: current.activePath ? relocatedPath(current.activePath, change.from, change.to) : null,
      vault: { ...current.vault, metadata: { ...current.vault.metadata, sidebarOrder: change.sidebarOrder ?? current.vault.metadata.sidebarOrder?.map((path) => relocatedPath(path, change.from, change.to)) }, entries: change.from === change.to ? current.vault.entries : relocateEntries(current.vault.entries, change.from, change.to),
        appearances: current.vault.appearances.map((appearance) => ({ ...appearance, canvasPath: relocatedPath(appearance.canvasPath, change.from, change.to) })) },
    });
  }

  return { initialize, flushResources, prepareDocument, prepareCanvas, register, registerCanvas, commitCanvas, addCanvasDocument, documentEntry, loadCanvasDocuments, applyEntryChange, applyCanvasDeletion,
    get documentSaves() { return coordinator; }, get canvasSaves() { return canvasCoordinator; } };
}
