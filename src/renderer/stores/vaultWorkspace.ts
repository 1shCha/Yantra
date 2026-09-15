import { tiptapDocSchema } from '../../shared/tiptap-document';
import { createOrganizationActions } from './workspace-organization';
import { createWorkspaceOperations } from './workspace-operations';
import { createWorkspaceResources } from './workspace-resources';
import { WorkspaceRequests } from './workspace-requests';
import type { VaultWorkspaceState } from './workspace-types';
import { createStore } from 'zustand/vanilla';
import { cancelled, captureOperation, failure, OperationError, operationFailure, success, unwrapOperation, type OperationResult } from '../../shared/operation-result';
import { getSchema } from '@tiptap/core';
import type { YantraVaultApi } from '../../shared/vault-api';
import { documentFileSchema, type DocumentFile, type VaultEntry, type VaultSnapshot } from '../../shared/vault-format';
import { canvasFileSchema, removeCanvasNodes } from '../../shared/vault-canvas';
import { documentSchemaExtensions } from '../editor/tiptap-schema';
import { insertEntry as addEntry } from '../../shared/vault-organization';

function findEntry(entries: VaultEntry[], path: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findEntry(entry.children, path);
    if (found) return found;
  }
}

export function createVaultWorkspace(api: YantraVaultApi) {
  const requests = new WorkspaceRequests();
  let restorePromise: Promise<OperationResult> | null = null;
  const overwrites = new Set<string>();
  const editorSchema = getSchema(documentSchemaExtensions);

  const store = createStore<VaultWorkspaceState>((set, get) => {
    const resources = createWorkspaceResources(api, set, get, requests, overwrites);
    const { flushResources, register, registerCanvas, commitCanvas, documentEntry, loadCanvasDocuments } = resources;

    const operations = createWorkspaceOperations(set, get, requests, flushResources);
    const { blocked, runOperation, runBackgroundOperation, organize } = operations;

    function install(vault: VaultSnapshot) {
      requests.invalidate();
      resources.initialize(vault);
      set({ vault, conflicts: new Map(), titleErrors: new Map(), documents: new Map(), canvases: new Map(), activePath: null, activeDocumentId: null, activeCanvasId: null, revealTarget: null, loadState: 'idle', error: vault.recovery?.message ?? null });
    }

    async function replaceFromDisk(work: (vault: VaultSnapshot) => Promise<OperationResult<VaultSnapshot>>): Promise<OperationResult> {
      const documentId = get().activeDocumentId;
      const canvasId = get().activeCanvasId;
      const result = await organize(async (vault) => {
        const outcome = await work(vault);
        if (outcome.status === 'failure' || outcome.status === 'cancelled') return outcome;
        install(outcome.value);
        return outcome.status === 'recovery-required' ? { ...outcome, value: undefined } : success(undefined);
      });
      if (result.status === 'failure' || result.status === 'cancelled') return result;
      const flatten = (entries: VaultEntry[]): VaultEntry[] => entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
      const entry = flatten(get().vault?.entries ?? []).find((candidate) =>
        documentId ? candidate.documentId === documentId : canvasId ? candidate.canvasId === canvasId : false);
      if (entry) {
        if (entry.kind === 'document') await get().openDocument(entry.path);
        else await get().openCanvas(entry.path);
      }
      return result;
    }

    function switchVault(load: () => Promise<OperationResult<VaultSnapshot | null>>) {
      return runOperation(async () => {
        await flushResources();
        const outcome = await load();
        if (outcome.status === 'failure' || outcome.status === 'cancelled') return outcome;
        if (outcome.value) install(outcome.value);
        return outcome.status === 'recovery-required' ? { ...outcome, value: undefined } : success(undefined);
      });
    }

    return {
      ...createOrganizationActions(api, set, get, resources, operations),
      deletingCanvasId: null, deletingDocumentIds: new Set(),
      titleErrors: new Map(),
      conflicts: new Map(),
      refresh: () => replaceFromDisk((vault) => api.refresh(vault.sessionId)),
      deleteEntry: (path) => replaceFromDisk((vault) => api.deleteEntry(vault.sessionId, path)),
      deleteCanvasNodes(canvasId, nodeIds) {
        const session = get().vault?.sessionId;
        if (!session || get().busy || get().deletingCanvasId) return Promise.resolve(blocked());
        return runBackgroundOperation(async () => {
          if (get().vault?.sessionId !== session) return cancelled('superseded');
          const canvas = get().canvases.get(canvasId);
          const ids = new Set(nodeIds);
          const nodes = canvas?.file.nodes.filter((node) => ids.has(node.id)) ?? [];
          if (!nodes.length) return;
          const deletingDocumentIds = new Set(nodes.map((node) => node.documentId));
          set({ deletingCanvasId: canvasId, deletingDocumentIds });
          try {
            await Promise.all([...deletingDocumentIds].filter((id) => get().documents.has(id)).map((id) => resources.documentSaves!.flush(id)));
            await resources.canvasSaves!.flush(canvasId);
            const outcome = await api.deleteCanvasNodes(session, canvasId, [...ids]);
            if (outcome.status === 'failure' || outcome.status === 'cancelled') return outcome;
            resources.applyCanvasDeletion(outcome.value);
            const error = outcome.status === 'recovery-required' ? outcome.error : outcome.value.error;
            if (error) return error.code === 'recovery-required'
              ? { status: 'recovery-required' as const, value: undefined, error }
              : { status: 'failure' as const, error };
          } finally { set({ deletingCanvasId: null, deletingDocumentIds: new Set() }); }
        });
      },
      retryRecovery: () => replaceFromDisk((vault) => api.retryRecovery(vault.sessionId)),
      removeFromCanvas(canvasId, nodeIds) {
        return organize(async () => {
          const loaded = get().canvases.get(canvasId);
          if (!loaded) throw new OperationError({ code: 'invalid-input', message: 'Open the canvas before removing its nodes.' });
          const file = removeCanvasNodes(loaded.file, new Set(nodeIds));
          const { nodes, edges, groups, layerOrder, viewport } = file;
          commitCanvas(canvasId, { nodes, edges, groups, layerOrder, viewport });
          await resources.canvasSaves!.flush(canvasId);
          if (get().revealTarget?.canvasId === canvasId && nodeIds.includes(get().revealTarget!.nodeId)) set({ revealTarget: null });
        });
      },
      resolveConflict(kind, id, choice) {
        const vault = get().vault;
        const key = `${kind}:${id}`;
        if (!vault || get().busy) return Promise.resolve(blocked());
        if (!get().conflicts.has(key)) return Promise.resolve(cancelled('not-applicable'));
        return runOperation(async () => {
          if (kind === 'document') await resources.documentSaves!.waitForIdle(id);
          else await resources.canvasSaves!.waitForIdle(id);
          if (!get().conflicts.has(key)) return cancelled('not-applicable');
          if (choice === 'overwrite') {
            overwrites.add(key);
            try {
              if (kind === 'document') await resources.documentSaves!.retry(id);
              else await resources.canvasSaves!.retry(id);
            } finally { overwrites.delete(key); }
          } else if (kind === 'document') {
            const loaded = get().documents.get(id)!;
            const file = documentFileSchema.parse(await api.readDocument(vault.sessionId, loaded.path, 'accept-disk').then(unwrapOperation));
            if (file.id !== id) throw new OperationError({ code: 'conflict', message: 'The document identity changed. Your local draft has been retained.' });
            editorSchema.nodeFromJSON(file.doc).check();
            resources.documentSaves!.discardDraft(id, file);
            set({ documents: new Map(get().documents).set(id, { ...loaded, file, save: resources.documentSaves!.status(id), reloadRevision: loaded.reloadRevision + 1 }) });
          } else {
            const loaded = get().canvases.get(id)!;
            const file = canvasFileSchema.parse(await api.readCanvas(vault.sessionId, loaded.path, 'accept-disk').then(unwrapOperation));
            if (file.id !== id) throw new OperationError({ code: 'conflict', message: 'The canvas identity changed. Your local draft has been retained.' });
            resources.canvasSaves!.discardDraft(id, file);
            set({ canvases: new Map(get().canvases).set(id, { ...loaded, file, save: resources.canvasSaves!.status(id), reloadRevision: loaded.reloadRevision + 1 }) });
            await loadCanvasDocuments(id, vault, requests.generation);
          }
        });
      },
      vault: null, documents: new Map(), canvases: new Map(), activePath: null, activeDocumentId: null, activeCanvasId: null,
      revealTarget: null,
      loadState: 'idle', error: null, busy: false,
      restore() {
        restorePromise ??= switchVault(api.restore);
        return restorePromise;
      },
      choose: (create) => switchVault(() => api.choose(create)),
      async openDocument(path) {
        if (get().deletingDocumentIds.has(findEntry(get().vault?.entries ?? [], path)?.documentId ?? '')) return blocked();
        const vault = get().vault;
        if (!vault || get().busy) return blocked();
        const request = requests.begin();
        const epoch = requests.generation;
        set({ activePath: path, activeDocumentId: null, activeCanvasId: null, revealTarget: null, loadState: 'loading', error: null });
        try {
          const entry = findEntry(vault.entries, path);
          if (!entry || entry.kind !== 'document') throw new OperationError({ code: 'invalid-input', message: 'This item is not a supported document.' });
          if (entry.error) throw new OperationError(entry.failure ?? { code: 'unavailable', message: entry.error, path });
          if (!entry.documentId) throw new OperationError({ code: 'invalid-input', message: 'Document has no valid ID.' });
          let loaded = get().documents.get(entry.documentId);
          if (!loaded) {
            let pending = requests.loading.get(path);
            if (!pending) {
              pending = api.readDocument(vault.sessionId, path, 'accept-disk').then(unwrapOperation);
              requests.loading.set(path, pending);
            }
            const file = await pending;
            if (requests.generation !== epoch) return cancelled('superseded');
            if (!documentEntry(get().vault?.entries ?? [], file.id)) return cancelled('superseded');
            if (file.id !== entry.documentId) throw new OperationError({ code: 'conflict', message: 'The document identity changed on disk. Reopen the vault.' });
            register(path, file);
            loaded = get().documents.get(file.id);
          }
          if (request === requests.navigation && loaded) {
            set({ activeDocumentId: loaded.file.id, loadState: 'ready', error: null });
            return success(undefined);
          }
          return cancelled('superseded');
        } catch (error) {
          if (requests.generation === epoch && request === requests.navigation) {
            set({ loadState: 'error', error: operationFailure(error).message });
            return failure(error);
          }
          return cancelled('superseded');
        } finally {
          if (requests.generation === epoch) requests.loading.delete(path);
        }
      },
      async createDocument(folder = '') {
        const session = get().vault?.sessionId;
        if (!session || get().busy) return blocked();
        const navigation = requests.begin();
        return runBackgroundOperation(async () => {
          const vault = get().vault;
          if (!vault || vault.sessionId !== session) return cancelled('superseded');
          if (vault.recovery) throw new OperationError({ code: 'recovery-required', message: vault.recovery.message });
          if (folder && findEntry(vault.entries, folder)?.kind !== 'folder') throw new OperationError({ code: 'invalid-input', message: 'Choose a valid destination folder.' });
          const result = await api.createDocument(session, folder).then(unwrapOperation);
          const document = resources.prepareDocument(result.path, result.document);
          const current = get();
          const entry: VaultEntry = { path: result.path, name: `${document.file.title}.yantraD`, kind: 'document', documentId: document.file.id };
          const update: Partial<VaultWorkspaceState> = {
            documents: new Map(current.documents).set(document.file.id, document),
            vault: { ...current.vault!, entries: addEntry(current.vault!.entries, folder, entry) },
          };
          if (navigation === requests.navigation) Object.assign(update, {
            activePath: result.path, activeDocumentId: document.file.id, activeCanvasId: null, revealTarget: null, loadState: 'ready',
          });
          set(update);
          if (navigation !== requests.navigation) return cancelled('superseded');
        });
      },
      updateDocument(id, input) {
        if (get().deletingDocumentIds.has(id)) return;
        if (get().busy || get().vault?.recovery) throw new OperationError({ code: 'invalid-input', message: 'Document editing is paused during a vault operation or recovery.' });
        const loaded = get().documents.get(id);
        if (!loaded || !resources.documentSaves) throw new OperationError({ code: 'unavailable', message: 'Document is not loaded.' });
        const doc = tiptapDocSchema.parse(input);
        editorSchema.nodeFromJSON(doc).check();
        if (JSON.stringify(doc) === JSON.stringify(loaded.file.doc)) return;
        const file: DocumentFile = { ...loaded.file, doc, updatedAt: new Date().toISOString() };
        set({ documents: new Map(get().documents).set(id, { ...loaded, file }) });
        resources.documentSaves.update(id, file);
      },
      async flush() { await operations.waitForIdle(); await flushResources(); },
      retry(id) {
        if (!get().vault || get().busy) return Promise.resolve(blocked());
        return captureOperation(async () => { await resources.documentSaves!.retry(id); });
      },
      retryCanvas(id) {
        if (!get().vault || get().busy) return Promise.resolve(blocked());
        return captureOperation(async () => { await resources.canvasSaves!.retry(id); });
      },
      async openCanvas(path) {
        const vault = get().vault;
        if (!vault || get().busy) return blocked();
        const request = requests.begin();
        const epoch = requests.generation;
        set({ activePath: path, activeDocumentId: null, activeCanvasId: null, revealTarget: null, loadState: 'loading', error: null });
        try {
          const entry = findEntry(vault.entries, path);
          if (!entry || entry.kind !== 'canvas' || !entry.canvasId || entry.error) throw new OperationError(entry?.failure ?? { code: 'unavailable', message: entry?.error ?? 'This item is not a supported canvas.', path });
          if (!get().canvases.has(entry.canvasId)) {
            const file = await api.readCanvas(vault.sessionId, path, 'accept-disk').then(unwrapOperation);
            if (epoch !== requests.generation) return cancelled('superseded');
            if (file.id !== entry.canvasId) throw new OperationError({ code: 'conflict', message: 'The canvas identity changed on disk. Reopen the vault.' });
            registerCanvas(path, file);
          }
          await loadCanvasDocuments(entry.canvasId, vault, epoch);
          if (epoch === requests.generation && request === requests.navigation) {
            set({ activeCanvasId: entry.canvasId, loadState: 'ready', error: null });
            return success(undefined);
          }
          return cancelled('superseded');
        } catch (error) {
          if (epoch === requests.generation && request === requests.navigation) {
            set({ loadState: 'error', error: operationFailure(error).message });
            return failure(error);
          }
          return cancelled('superseded');
        }
      },
      async createCanvas(folder = '') {
        const session = get().vault?.sessionId;
        if (!session || get().busy) return blocked();
        const navigation = requests.begin();
        return runBackgroundOperation(async () => {
          const vault = get().vault;
          if (!vault || vault.sessionId !== session) return cancelled('superseded');
          if (vault.recovery) throw new OperationError({ code: 'recovery-required', message: vault.recovery.message });
          if (folder && findEntry(vault.entries, folder)?.kind !== 'folder') throw new OperationError({ code: 'invalid-input', message: 'Choose a valid destination folder.' });
          const result = await api.createCanvas(session, folder).then(unwrapOperation);
          const canvas = resources.prepareCanvas(result.path, result.canvas);
          const current = get();
          const entry: VaultEntry = { path: result.path, name: `${canvas.file.title}.yantraC`, kind: 'canvas', canvasId: canvas.file.id };
          const update: Partial<VaultWorkspaceState> = {
            canvases: new Map(current.canvases).set(canvas.file.id, canvas),
            vault: { ...current.vault!, entries: addEntry(current.vault!.entries, folder, entry) },
          };
          if (navigation === requests.navigation) Object.assign(update, {
            activePath: result.path, activeCanvasId: canvas.file.id, activeDocumentId: null, revealTarget: null, loadState: 'ready',
          });
          set(update);
          if (navigation !== requests.navigation) return cancelled('superseded');
        });
      },
      updateCanvas(id, presentation) {
        if (get().deletingCanvasId === id) return;
        if (get().busy || get().vault?.recovery) throw new OperationError({ code: 'invalid-input', message: 'Canvas editing is paused during a vault operation or recovery.' });
        commitCanvas(id, presentation);
      },
      async createCanvasNode(canvasId, position) {
        const session = get().vault?.sessionId;
        if (!session || get().busy) return blocked();
        return runBackgroundOperation(async () => {
          const vault = get().vault;
          if (!vault || vault.sessionId !== session) return cancelled('superseded');
          if (vault.recovery) throw new OperationError({ code: 'recovery-required', message: vault.recovery.message });
          if (!get().canvases.has(canvasId)) throw new OperationError({ code: 'unavailable', message: 'Canvas is not loaded.' });
          if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new OperationError({ code: 'invalid-input', message: 'Invalid node position.' });
          // Creation is serialized, but existing editors and geometry remain live.
          // Read the latest canvas when the durable document returns.
          const result = await api.createNodeDocument(session).then(unwrapOperation);
          resources.addCanvasDocument(canvasId, result, position);
          await resources.canvasSaves!.flush(canvasId);
        });
      },
      async openNodeDocument(canvasId, nodeId) {
        const node = get().canvases.get(canvasId)?.file.nodes.find((candidate) => candidate.id === nodeId);
        const vault = get().vault;
        const entry = node && vault && documentEntry(vault.entries, node.documentId);
        if (!entry) {
          const error = new OperationError({ code: 'missing', message: 'Referenced document is missing.' });
          set({ error: error.message });
          return failure(error);
        }
        return get().openDocument(entry.path);
      },
      getAppearance(documentId) {
        const current = get();
        for (const loaded of current.canvases.values()) {
          const node = loaded.file.nodes.find((candidate) => candidate.documentId === documentId);
          if (node) return { documentId, canvasId: loaded.file.id, canvasPath: loaded.path, nodeId: node.id };
        }
        return current.vault?.appearances.find((appearance) => appearance.documentId === documentId && !current.canvases.has(appearance.canvasId)) ?? null;
      },
      async revealDocument(documentId) {
        if (!get().vault || get().busy) return blocked();
        const appearance = get().getAppearance(documentId);
        if (!appearance) {
          const error = new OperationError({ code: 'unavailable', message: 'This document is not placed on a canvas.' });
          set({ error: error.message });
          return failure(error);
        }
        const epoch = requests.generation;
        const request = requests.navigation + 1;
        const result = await get().openCanvas(appearance.canvasPath);
        if (result.status !== 'success') return result;
        if (epoch === requests.generation && request === requests.navigation && get().activeCanvasId === appearance.canvasId && get().loadState === 'ready') {
          set({ revealTarget: { canvasId: appearance.canvasId, nodeId: appearance.nodeId, requestId: crypto.randomUUID() } });
          return success(undefined);
        }
        return cancelled('superseded');
      },
      async placeDocument(canvasId, documentId, position) {
        const vault = get().vault;
        if (!vault || get().busy) return blocked();
        if (get().getAppearance(documentId)) return get().revealDocument(documentId);
        const request = requests.begin();
        const epoch = requests.generation;
        const result = await runOperation(async () => {
          if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new OperationError({ code: 'invalid-input', message: 'Invalid node position.' });
          if (!get().canvases.has(canvasId)) throw new OperationError({ code: 'invalid-input', message: 'Open the destination canvas first.' });
          const entry = documentEntry(vault.entries, documentId);
          if (!entry || entry.error) throw new OperationError({ code: 'invalid-input', message: 'Document is missing or unavailable.' });
          await flushResources();
          if (!get().documents.has(documentId)) {
            const file = await api.readDocument(vault.sessionId, entry.path, 'accept-disk').then(unwrapOperation);
            if (file.id !== documentId) throw new OperationError({ code: 'conflict', message: 'The document identity changed on disk.' });
            register(entry.path, file);
          }
          const canvas = get().canvases.get(canvasId)!.file;
          const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId,
            x: Math.round(position.x - 160), y: Math.round(position.y - 110), width: 320, height: 220 };
          commitCanvas(canvasId, { nodes: [...canvas.nodes, node], edges: canvas.edges, groups: canvas.groups,
            layerOrder: [...canvas.layerOrder, node.id], viewport: canvas.viewport });
          await resources.canvasSaves!.flush(canvasId);
        });
        if (result.status !== 'success') return result;
        if (epoch === requests.generation && request === requests.navigation) return get().revealDocument(documentId);
        return cancelled('superseded');
      },
    };
  });
  return store;
}
