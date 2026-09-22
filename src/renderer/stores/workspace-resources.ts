import { reconcileCanvasPresentation } from '../../shared/canvas-presentation';
import type { StoreApi } from 'zustand/vanilla';
import { getSchema } from '@tiptap/core';
import { OperationError, unwrapOperation } from '../../shared/operation-result';
import type { CanvasDeletionResult, YantraVaultApi } from '../../shared/vault-api';
import { documentFileSchema, type DocumentFile, type VaultSnapshot, type VaultEntry } from '../../shared/vault-format';
import { canvasFileSchema, canvasPresentationSchema, canvasViewportSchema, type CanvasFile, type CanvasPresentation } from '../../shared/vault-canvas';
import { insertEntry, relocatedPath, relocateEntries, type VaultEntryChange } from '../../shared/vault-organization';
import { documentSchemaExtensions } from '../editor/tiptap-schema';
import { SaveCoordinator, type SaveStatus } from '../persistence/save-coordinator';
import type { LoadedDocument, LoadedCanvas, VaultWorkspaceState } from './workspace-types';
import type { WorkspaceRequests } from './workspace-requests';
import { assertPresentationOnlySave, findVaultEntry, flattenVaultEntries } from '../../shared/vault-packages';
import { parentFolderOf } from '../../shared/vault-paths';

export function createWorkspaceResources(api: YantraVaultApi, set: StoreApi<VaultWorkspaceState>['setState'], get: StoreApi<VaultWorkspaceState>['getState'], requests: WorkspaceRequests, overwrites: Set<string>, syncTabsAfterVaultUpdate: () => void) {
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
    const packageEntry = findVaultEntry(get().vault?.entries ?? [], loaded.path);
    const packageDocumentIds = new Set((packageEntry?.children ?? [])
      .flatMap((entry) => entry.documentId ? [entry.documentId] : []));
    for (const [documentId, document] of documents) {
      if (parentFolderOf(document.path) === loaded.path) packageDocumentIds.add(documentId);
    }
    assertPresentationOnlySave(loaded.file, { ...loaded.file, ...presentation }, packageDocumentIds);
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

  function commitCanvasViewport(id: string, input: CanvasPresentation['viewport']) {
    const loaded = get().canvases.get(id);
    if (!loaded || !canvasCoordinator) throw new OperationError({ code: 'unavailable', message: 'Canvas is not loaded.' });
    const viewport = canvasViewportSchema.parse(input);
    const previous = loaded.file.viewport;
    if (viewport.x === previous.x && viewport.y === previous.y && viewport.zoom === previous.zoom) return;
    const file = { ...loaded.file, viewport, updatedAt: new Date().toISOString() };
    set({ canvases: new Map(get().canvases).set(id, { ...loaded, file }) });
    canvasCoordinator.update(id, file);
  }

  function installCreatedDocument(destination: string, created: { path: string; document: DocumentFile; canvas?: CanvasFile; nodeId?: string }, options?: { blankNode?: boolean }) {
    const document = prepareDocument(created.path, created.document);
    const state = get();
    const vault = state.vault!;
    const documents = new Map(state.documents).set(document.file.id, document);
    const entry: VaultEntry = { path: created.path, name: `${document.file.title}.yantraD`, kind: 'document', documentId: document.file.id };
    const entries = insertEntry(vault.entries, destination, entry);
    const canvases = new Map(state.canvases);
    let appearances = vault.appearances;
    if (created.canvas) {
      const loaded = canvases.get(created.canvas.id);
      if (loaded && canvasCoordinator) {
        const existing = new Map(loaded.file.nodes.map((node) => [node.id, node]));
        const nodes = created.canvas.nodes.map((node) => existing.get(node.id) ?? node);
        const file = {
          ...created.canvas,
          nodes,
          viewport: loaded.file.viewport,
          edges: loaded.file.edges,
          groups: loaded.file.groups,
        };
        canvases.set(created.canvas.id, { ...loaded, file, path: destination, documentErrors: loaded.documentErrors });
        try {
          canvasCoordinator.replaceCleanSnapshot(created.canvas.id, file);
        } catch {
          canvasCoordinator.update(created.canvas.id, file);
        }
      }
      if (created.nodeId) {
        appearances = [...appearances, { canvasId: created.canvas.id, canvasPath: destination, documentId: document.file.id, nodeId: created.nodeId }];
      }
    }
    set({
      documents,
      canvases,
      vault: { ...vault, entries, appearances },
      blankNodeEditTarget: options?.blankNode && created.canvas && created.nodeId
        ? { canvasId: created.canvas.id, nodeId: created.nodeId, requestId: crypto.randomUUID() }
        : state.blankNodeEditTarget,
    });
    return document;
  }

  function documentEntry(entries: VaultEntry[], id: string): VaultEntry | undefined {
    for (const entry of entries) {
      if (entry.documentId === id) return entry;
      const found = entry.children && documentEntry(entry.children, id);
      if (found) return found;
    }
  }

  async function loadCanvasDocuments(id: string, vault: VaultSnapshot, epoch: number, isCurrent: () => boolean = () => true) {
    const canvas = get().canvases.get(id)!;
    const errors = new Map<string, string>();
    await Promise.all(canvas.file.nodes.map(async (node) => {
      if (get().documents.has(node.documentId)) return;
      const entry = documentEntry(vault.entries, node.documentId);
      let pending: Promise<DocumentFile> | undefined;
      try {
        if (!entry || entry.error) throw new Error(entry?.error ?? 'Referenced document is missing.');
        pending = requests.loading.get(entry.path);
        if (!pending) {
          pending = api.readDocument(vault.sessionId, entry.path, 'accept-disk').then(unwrapOperation);
          requests.loading.set(entry.path, pending);
        }
        const file = await pending;
        if (epoch !== requests.generation || !isCurrent()) return;
        if (!get().canvases.get(id)?.file.nodes.some((current) => current.documentId === node.documentId)) return;
        if (file.id !== node.documentId) throw new OperationError({ code: 'conflict', message: 'The referenced document identity changed on disk.' });
        register(entry.path, file);
      } catch (error) {
        if (isCurrent()) errors.set(node.documentId, error instanceof Error ? error.message : String(error));
      } finally {
        if (epoch === requests.generation && entry && requests.loading.get(entry.path) === pending) requests.loading.delete(entry.path);
      }
    }));
    if (epoch === requests.generation && isCurrent()) {
      const current = get().canvases.get(id)!;
      const previous = current.documentErrors;
      if (previous.size !== errors.size || [...errors].some(([key, value]) => previous.get(key) !== value)) {
        set({ canvases: new Map(get().canvases).set(id, { ...current, documentErrors: errors }) });
      }
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
    const blankNodeEditTarget = current.blankNodeEditTarget;
    const update: Partial<VaultWorkspaceState> = { documents, canvases, titleErrors, conflicts,
      vault: { ...change.snapshot, entries: reconcileEntries(current.vault.entries, change.snapshot.entries),
        metadata: JSON.stringify(current.vault.metadata) === JSON.stringify(change.snapshot.metadata) ? current.vault.metadata : change.snapshot.metadata },
      revealTarget: revealTarget && canvases.get(revealTarget.canvasId)?.file.nodes.some((node) => node.id === revealTarget.nodeId) ? revealTarget : null,
      blankNodeEditTarget: blankNodeEditTarget && canvases.get(blankNodeEditTarget.canvasId)?.file.nodes.some((node) => node.id === blankNodeEditTarget.nodeId)
        ? blankNodeEditTarget : null,
    };
    if (current.activePath && removedPaths.has(current.activePath)) {
      Object.assign(update, { activeDocumentId: null, activePath: null, loadState: 'idle' });
    }
    set(update);
    syncTabsAfterVaultUpdate();
  }

  function applyEntryChange(change: VaultEntryChange) {
    const current = get();
    const vault = current.vault;
    if (!vault) return;
    let documents = current.documents;
    for (const [id, loaded] of documents) {
      let file = change.document?.id === id ? change.document : loaded.file;
      const contentChanged = file.doc !== loaded.file.doc && JSON.stringify(file.doc) !== JSON.stringify(loaded.file.doc);
      const bodyChanged = contentChanged && JSON.stringify(file.doc.content?.slice(1)) !== JSON.stringify(loaded.file.doc.content?.slice(1));
      if (file !== loaded.file) file = { ...file, doc: !contentChanged ? loaded.file.doc : !bodyChanged
        ? { ...file.doc, content: [file.doc.content![0]!, ...(loaded.file.doc.content?.slice(1) ?? [])] } : file.doc };
      const path = relocatedPath(loaded.path, change.from, change.to);
      if (file !== loaded.file) coordinator!.replaceCleanSnapshot(id, file);
      if (file !== loaded.file || path !== loaded.path) {
        if (documents === current.documents) documents = new Map(documents);
        documents.set(id, { ...loaded, path, file, reloadRevision: loaded.reloadRevision + Number(bodyChanged) });
      }
    }
    const canvasChanges = [
      ...(change.canvases ?? []),
      ...(change.canvas && !(change.canvases ?? []).some((file) => file.id === change.canvas!.id) ? [change.canvas] : []),
    ];
    const updatedCanvasIds = new Set(canvasChanges.map((file) => file.id));
    let canvases = current.canvases;
    for (const [id, loaded] of canvases) {
      const incoming = canvasChanges.find((file) => file.id === id) ?? loaded.file;
      const { nodes, edges, groups, layerOrder, viewport } = reconcileCanvasPresentation(incoming, loaded.file);
      const file = incoming === loaded.file ? loaded.file : { ...incoming, nodes, edges, groups, layerOrder, viewport };
      const path = relocatedPath(loaded.path, change.from, change.to);
      if (file !== loaded.file) canvasCoordinator!.replaceCleanSnapshot(id, file);
      if (file !== loaded.file || path !== loaded.path) {
        if (canvases === current.canvases) canvases = new Map(canvases);
        canvases.set(id, { ...loaded, path, file });
      }
    }
    const currentOrder = vault.metadata.sidebarOrder;
    const nextOrder = change.sidebarOrder ?? currentOrder?.map((path) => relocatedPath(path, change.from, change.to));
    const sidebarOrder = nextOrder && currentOrder && nextOrder.length === currentOrder.length
      && nextOrder.every((path, index) => path === currentOrder[index]) ? currentOrder : nextOrder;
    const nextEntries = change.from === change.to ? vault.entries : relocateEntries(vault.entries, change.from, change.to);
    let appearances = vault.appearances
      .filter((appearance) => !updatedCanvasIds.has(appearance.canvasId))
      .map((appearance) => {
        const canvasPath = relocatedPath(appearance.canvasPath, change.from, change.to);
        return canvasPath === appearance.canvasPath ? appearance : { ...appearance, canvasPath };
      });
    for (const canvas of canvasChanges) {
      const canvasPath = flattenVaultEntries(nextEntries).find((entry) => entry.kind === 'canvas' && entry.canvasId === canvas.id)?.path;
      if (!canvasPath) continue;
      for (const node of canvas.nodes) {
        appearances.push({ canvasId: canvas.id, canvasPath, documentId: node.documentId, nodeId: node.id });
      }
    }
    set({ documents, canvases, error: change.warning ?? current.error,
      activePath: current.activePath ? relocatedPath(current.activePath, change.from, change.to) : null,
      vault: { ...vault,
        metadata: sidebarOrder === currentOrder ? vault.metadata : { ...vault.metadata, sidebarOrder },
        entries: nextEntries,
        appearances: appearances.length === vault.appearances.length
          && appearances.every((appearance, index) => appearance === vault.appearances[index])
          ? vault.appearances : appearances },
    });
    syncTabsAfterVaultUpdate();
  }

  function applyEntryChanges(changes: VaultEntryChange[]) {
    for (const change of changes) applyEntryChange(change);
  }

  return { initialize, flushResources, prepareDocument, prepareCanvas, register, registerCanvas, commitCanvas, commitCanvasViewport, installCreatedDocument, documentEntry, loadCanvasDocuments, applyEntryChange, applyEntryChanges, applyCanvasDeletion,
    get documentSaves() { return coordinator; }, get canvasSaves() { return canvasCoordinator; } };
}
