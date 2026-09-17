import { browserTabStorage, closeTab, openTab, readTabs, reconcileTabs, reorderTab as moveTab, tabForEntry, writeTabs, type TabStorage, type OpenTabOptions } from './workspace-tabs';
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
import { MARKDOWN_NODE_DEFAULT_HEIGHT, MARKDOWN_NODE_DEFAULT_WIDTH } from '../canvas/react-flow-mapping';

function findEntry(entries: VaultEntry[], path: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findEntry(entry.children, path);
    if (found) return found;
  }
}

export function createVaultWorkspace(api: YantraVaultApi, tabStorage: TabStorage | undefined = browserTabStorage()) {
  const requests = new WorkspaceRequests();
  let restorePromise: Promise<OperationResult> | null = null;
  const overwrites = new Set<string>();
  const editorSchema = getSchema(documentSchemaExtensions);
  const viewportFlushes = new Set<() => void>();

  const store = createStore<VaultWorkspaceState>((set, get) => {
    function syncTabsAfterVaultUpdate() {
      const state = get();
      if (!state.vault) return;
      const previousActiveTabId = state.activeTabId;
      const next = reconcileTabs(state, state.vault);
      const unchanged = next.activeTabId === state.activeTabId
        && next.tabs.length === state.tabs.length
        && next.tabs.every((tab, index) => tab === state.tabs[index]);
      if (unchanged) return;
      set(next);
      if (next.activeTabId === previousActiveTabId || get().busy) return;
      if (next.activeTabId) void get().activateTab(next.activeTabId);
      else {
        requests.begin();
        set({ activePath: null, activeDocumentId: null, activeCanvasId: null, loadState: 'idle' });
      }
    }

    const resources = createWorkspaceResources(api, set, get, requests, overwrites, syncTabsAfterVaultUpdate);
    const { flushResources, register, registerCanvas, commitCanvas, documentEntry, loadCanvasDocuments } = resources;

    async function flushWorkspaceResources() {
      for (const flush of viewportFlushes) flush();
      await flushResources();
    }
    const operations = createWorkspaceOperations(set, get, requests, flushWorkspaceResources);
    const { blocked, runOperation, runBackgroundOperation, organize } = operations;

    function install(vault: VaultSnapshot, preserveTabs = false) {
      const session = preserveTabs ? reconcileTabs(get(), vault) : readTabs(tabStorage, vault);
      requests.invalidate();
      resources.initialize(vault);
      set({ ...session, vault, conflicts: new Map(), titleErrors: new Map(), documents: new Map(), canvases: new Map(), activePath: null, activeDocumentId: null, activeCanvasId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'idle', error: vault.recovery?.message ?? null });
    }

    async function replaceFromDisk(work: (vault: VaultSnapshot) => Promise<OperationResult<VaultSnapshot>>): Promise<OperationResult> {
      const result = await organize(async (vault) => {
        const outcome = await work(vault);
        if (outcome.status === 'failure' || outcome.status === 'cancelled') return outcome;
        install(outcome.value, true);
        return outcome.status === 'recovery-required' ? { ...outcome, value: undefined } : success(undefined);
      });
      if (result.status === 'failure' || result.status === 'cancelled') return result;
      const activeTabId = get().activeTabId;
      if (activeTabId) await get().activateTab(activeTabId);
      return result;
    }

    async function switchVault(load: () => Promise<OperationResult<VaultSnapshot | null>>) {
      const result = await runOperation(async () => {
        await flushWorkspaceResources();
        const outcome = await load();
        if (outcome.status === 'failure' || outcome.status === 'cancelled') return outcome;
        if (outcome.value) install(outcome.value);
        return outcome.status === 'recovery-required' ? { ...outcome, value: undefined } : success(undefined);
      });
      if (result.status === 'success' || result.status === 'recovery-required') {
        const id = get().activeTabId;
        if (id) await get().activateTab(id);
      }
      return result;
    }

    function selectFileTab(path: string, options?: OpenTabOptions) {
      const entry = findEntry(get().vault?.entries ?? [], path);
      const tab = entry && tabForEntry(entry);
      return tab ? openTab(get(), tab, options) : {};
    }

    return {
      ...createOrganizationActions(api, set, get, resources, operations, syncTabsAfterVaultUpdate),
      tabs: [], activeTabId: null,
      async activateTab(id) {
        const tab = get().tabs.find((tab) => tab.id === id);
        if (!tab) return cancelled('not-applicable');
        const current = get();
        if (current.activeTabId === id && current.activePath === tab.path && current.loadState === 'ready') {
          const focused = tab.kind === 'document' ? current.activeDocumentId === tab.fileId : current.activeCanvasId === tab.fileId;
          if (focused) {
            requests.begin();
            return success(undefined);
          }
        }
        return tab.kind === 'canvas' ? get().openCanvas(tab.path) : get().openDocument(tab.path);
      },
      async closeTab(id) {
        if (get().busy) return blocked();
        const wasActive = get().activeTabId === id;
        const next = closeTab(get(), id);
        if (wasActive) requests.begin();
        set(next);
        if (!wasActive) return success(undefined);
        set({ activePath: null, activeDocumentId: null, activeCanvasId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'idle', error: null });
        return next.activeTabId ? get().activateTab(next.activeTabId) : success(undefined);
      },
      reorderTab(id, toIndex) {
        if (get().busy) return;
        const next = moveTab(get(), id, toIndex);
        if (next.tabs !== get().tabs) set(next);
      },
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
          const { revealTarget, blankNodeEditTarget } = get();
          const clearReveal = revealTarget?.canvasId === canvasId && nodeIds.includes(revealTarget.nodeId);
          const clearBlankEdit = blankNodeEditTarget?.canvasId === canvasId && nodeIds.includes(blankNodeEditTarget.nodeId);
          if (clearReveal || clearBlankEdit) {
            set({
              revealTarget: clearReveal ? null : revealTarget,
              blankNodeEditTarget: clearBlankEdit ? null : blankNodeEditTarget,
            });
          }
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
      revealTarget: null, blankNodeEditTarget: null,
      loadState: 'idle', error: null, busy: false,
      restore() {
        restorePromise ??= switchVault(api.restore);
        return restorePromise;
      },
      choose: (create) => switchVault(() => api.choose(create)),
      async openDocument(path, options) {
        if (get().deletingDocumentIds.has(findEntry(get().vault?.entries ?? [], path)?.documentId ?? '')) return blocked();
        const vault = get().vault;
        if (!vault || get().busy) return blocked();
        const entry = findEntry(vault.entries, path);
        if (!entry || entry.kind !== 'document') return failure(new OperationError({ code: 'invalid-input', message: 'This item is not a supported document.' }));
        if (entry.error) return failure(new OperationError(entry.failure ?? { code: 'unavailable', message: entry.error, path }));
        if (!entry.documentId) return failure(new OperationError({ code: 'invalid-input', message: 'Document has no valid ID.' }));
        const gesture = options?.replaceTabId !== undefined || options?.provisionalTabId !== undefined;
        const cached = get().documents.get(entry.documentId);
        if (!gesture && cached) {
          const request = requests.begin();
          if (request !== requests.navigation) return cancelled('superseded');
          set({
            ...selectFileTab(path, options),
            activePath: path,
            activeDocumentId: entry.documentId,
            activeCanvasId: null,
            revealTarget: null, blankNodeEditTarget: null,
            loadState: 'ready',
            error: null,
          });
          return success(undefined);
        }
        const request = requests.begin();
        const epoch = requests.generation;
        set({ ...selectFileTab(path, options), activePath: path, activeDocumentId: null, activeCanvasId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'loading', error: null });
        try {
          let loaded = cached ?? get().documents.get(entry.documentId);
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
            ...openTab(current, tabForEntry(entry)!), activePath: result.path, activeDocumentId: document.file.id, activeCanvasId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'ready',
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
      async flush() { await operations.waitForIdle(); await flushWorkspaceResources(); },
      retry(id) {
        if (!get().vault || get().busy) return Promise.resolve(blocked());
        return captureOperation(async () => { await resources.documentSaves!.retry(id); });
      },
      retryCanvas(id) {
        if (!get().vault || get().busy) return Promise.resolve(blocked());
        return captureOperation(async () => { await resources.canvasSaves!.retry(id); });
      },
      async openCanvas(path, options) {
        const vault = get().vault;
        if (!vault || get().busy) return blocked();
        const entry = findEntry(vault.entries, path);
        if (!entry || entry.kind !== 'canvas' || !entry.canvasId || entry.error) {
          return failure(new OperationError(entry?.failure ?? { code: 'unavailable', message: entry?.error ?? 'This item is not a supported canvas.', path }));
        }
        const gesture = options?.replaceTabId !== undefined || options?.provisionalTabId !== undefined;
        const cached = get().canvases.has(entry.canvasId);
        if (!gesture && cached) {
          const request = requests.begin();
          const epoch = requests.generation;
          set({
            ...selectFileTab(path, options),
            activePath: path,
            activeDocumentId: null,
            activeCanvasId: entry.canvasId,
            revealTarget: null, blankNodeEditTarget: null,
            loadState: 'ready',
            error: null,
          });
          await loadCanvasDocuments(entry.canvasId, vault, epoch, () => request === requests.navigation
            && get().vault?.sessionId === vault.sessionId && get().activeCanvasId === entry.canvasId && get().activePath === path);
          if (epoch !== requests.generation || request !== requests.navigation || get().vault?.sessionId !== vault.sessionId
            || get().activeCanvasId !== entry.canvasId || get().activePath !== path) return cancelled('superseded');
          return success(undefined);
        }
        const request = requests.begin();
        const epoch = requests.generation;
        set({ ...selectFileTab(path, options), activePath: path, activeDocumentId: null, activeCanvasId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'loading', error: null });
        try {
          if (!get().canvases.has(entry.canvasId)) {
            const file = await api.readCanvas(vault.sessionId, path, 'accept-disk').then(unwrapOperation);
            if (epoch !== requests.generation || request !== requests.navigation || get().vault?.sessionId !== vault.sessionId
              || get().activePath !== path) return cancelled('superseded');
            if (file.id !== entry.canvasId) throw new OperationError({ code: 'conflict', message: 'The canvas identity changed on disk. Reopen the vault.' });
            registerCanvas(path, file);
          }
          await loadCanvasDocuments(entry.canvasId, vault, epoch, () => request === requests.navigation
            && get().vault?.sessionId === vault.sessionId && get().activePath === path);
          if (epoch === requests.generation && request === requests.navigation && get().vault?.sessionId === vault.sessionId
            && get().activePath === path) {
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
            ...openTab(current, tabForEntry(entry)!), activePath: result.path, activeCanvasId: canvas.file.id, activeDocumentId: null, revealTarget: null, blankNodeEditTarget: null, loadState: 'ready',
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
      updateCanvasViewport(id, viewport) {
        if (get().deletingCanvasId === id || get().vault?.recovery) return;
        resources.commitCanvasViewport(id, viewport);
      },
      registerViewportFlush(flush) {
        viewportFlushes.add(flush);
        return () => { viewportFlushes.delete(flush); };
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
          await flushWorkspaceResources();
          if (!get().documents.has(documentId)) {
            const file = await api.readDocument(vault.sessionId, entry.path, 'accept-disk').then(unwrapOperation);
            if (file.id !== documentId) throw new OperationError({ code: 'conflict', message: 'The document identity changed on disk.' });
            register(entry.path, file);
          }
          const canvas = get().canvases.get(canvasId)!.file;
          const node = { id: crypto.randomUUID(), kind: 'document' as const, documentId,
            x: Math.round(position.x - MARKDOWN_NODE_DEFAULT_WIDTH / 2),
            y: Math.round(position.y - MARKDOWN_NODE_DEFAULT_HEIGHT / 2),
            width: MARKDOWN_NODE_DEFAULT_WIDTH,
            height: MARKDOWN_NODE_DEFAULT_HEIGHT,
          };
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
  store.subscribe((state, previous) => {
    if (!state.vault) return;
    if (state.tabs !== previous.tabs || state.activeTabId !== previous.activeTabId) {
      writeTabs(tabStorage, state.vault, { tabs: state.tabs, activeTabId: state.activeTabId });
    }
  });
  return store;
}
