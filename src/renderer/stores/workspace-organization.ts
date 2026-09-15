import type { StoreApi } from 'zustand/vanilla';
import type { YantraVaultApi } from '../../shared/vault-api';
import type { VaultEntry } from '../../shared/vault-format';
import { insertEntry as addEntry, reorderedPaths, vaultNameSchema } from '../../shared/vault-organization';
import { documentTitle, titleFilename } from '../../shared/document-title';
import { cancelled, failure, OperationError, unwrapOperation } from '../../shared/operation-result';
import { vaultTrace } from '../persistence/vault-diagnostics';
import type { VaultWorkspaceState } from './workspace-types';
import type { createWorkspaceResources } from './workspace-resources';
import type { createWorkspaceOperations } from './workspace-operations';

function findEntry(entries: VaultEntry[], path: string): VaultEntry | undefined {
  for (const entry of entries) {
    if (entry.path === path) return entry;
    const found = entry.children && findEntry(entry.children, path);
    if (found) return found;
  }
}


export function createOrganizationActions(api: YantraVaultApi, set: StoreApi<VaultWorkspaceState>['setState'], get: StoreApi<VaultWorkspaceState>['getState'], resources: ReturnType<typeof createWorkspaceResources>, operations: ReturnType<typeof createWorkspaceOperations>): Pick<VaultWorkspaceState, 'commitDocumentTitle' | 'createFolder' | 'renameEntry' | 'moveEntry'> {
  const { flushResources, applyEntryChange } = resources;
  const { runOperation, organize } = operations;
  return {
    async commitDocumentTitle(id) {
      const resource = vaultTrace.resource(id);
      vaultTrace.record('title.workspace.request', { resource });
      const session = get().vault?.sessionId;
      // Do not yield when idle: the next statement must reserve the operation
      // before another title-exit callback can race it.
      if (operations.pending) vaultTrace.record('title.workspace.wait', { resource });
      while (operations.pending) await operations.pending;
      const vault = get().vault;
      if (!vault || vault.sessionId !== session || !get().documents.has(id)) {
        vaultTrace.record('title.workspace.finish', { resource, outcome: 'cancelled' });
        return cancelled('superseded');
      }
      // The document is already loaded. Renaming it must not invalidate an
      // unrelated file read started by the click that left its editor.
      const result = await runOperation(async () => {
        await flushResources();
        const loaded = get().documents.get(id);
        if (!loaded) throw new OperationError({ code: 'unavailable', message: 'The document is not loaded.' });
        const title = documentTitle(loaded.file.doc);
        const name = titleFilename(title);
        if (name !== loaded.file.title) applyEntryChange(await api.renameEntry(vault.sessionId, loaded.path, name, title).then(unwrapOperation));
      }, false);
      const errors = new Map(get().titleErrors);
      if (result.status === 'failure' || result.status === 'recovery-required') {
        const reason = result.error.code === 'collision' ? 'A file with this name already exists in this folder.' : result.error.message;
        errors.set(id, `${reason} Filename unchanged; your draft is retained. Edit the title, then leave it or press Enter to retry.`);
      } else if (result.status === 'success') errors.delete(id);
      set({ titleErrors: errors });
      vaultTrace.record('title.workspace.finish', { resource, outcome: result.status,
        code: result.status === 'failure' || result.status === 'recovery-required' ? result.error.code : undefined });
      return result;
    },
    createFolder(folder, name) {
      return organize(async (vault) => {
        vaultNameSchema.parse(name);
        if (folder && findEntry(vault.entries, folder)?.kind !== 'folder') throw new OperationError({ code: 'invalid-input', message: 'Choose a valid destination folder.' });
        const created = await api.createFolder(vault.sessionId, folder, name).then(unwrapOperation);
        set({ vault: { ...vault, entries: addEntry(vault.entries, folder, { path: created.path, name, kind: 'folder', children: [] }) } });
      });
    },
    renameEntry(path, name, title) {
      return organize(async (vault) => {
        vaultNameSchema.parse(name);
        const entry = findEntry(vault.entries, path);
        if (!entry || entry.error) throw new OperationError({ code: 'invalid-input', message: 'Choose a valid file or folder.' });
        const change = await api.renameEntry(vault.sessionId, path, name, title).then(unwrapOperation);
        applyEntryChange(change);
        if (change.document) {
          const errors = new Map(get().titleErrors);
          errors.delete(change.document.id);
          set({ titleErrors: errors });
        }
      });
    },
    moveEntry(path, folder, placement) {
      if (placement) {
        const session = get().vault?.sessionId;
        return operations.runBackgroundOperation(async () => {
          const vault = get().vault;
          if (!vault || vault.sessionId !== session) return cancelled('superseded');
          const siblings = folder ? findEntry(vault.entries, folder)?.children : vault.entries;
          const source = siblings?.find((entry) => entry.path === path);
          const anchor = siblings?.find((entry) => entry.path === placement.anchor);
          if (!siblings || !source || source.error || !anchor || (source.kind === 'folder') !== (anchor.kind === 'folder')) {
            throw new OperationError({ code: 'invalid-input', message: 'Reorder existing siblings within the same folder/file group.' });
          }
          const before = vault.metadata.sidebarOrder;
          const order = reorderedPaths(siblings, before ?? [], path, placement);
          if (order.length === (before?.length ?? 0) && order.every((item, index) => item === before?.[index])) return;
          set({ vault: { ...vault, metadata: { ...vault.metadata, sidebarOrder: order } } });
          try {
            const change = await api.moveEntry(vault.sessionId, path, folder, placement).then(unwrapOperation);
            const current = get().vault;
            if (current?.sessionId === session && change.sidebarOrder
              && (change.sidebarOrder.length !== order.length || change.sidebarOrder.some((item, index) => item !== order[index]))) {
              set({ vault: { ...current, metadata: { ...current.metadata, sidebarOrder: change.sidebarOrder } } });
            }
          } catch (error) {
            const current = get().vault;
            if (current?.sessionId !== session) return cancelled('superseded');
            set({ vault: { ...current, metadata: { ...current.metadata, sidebarOrder: before } } });
            return failure(error);
          }
        });
      }
      return organize(async (vault) => {
        const entry = findEntry(vault.entries, path);
        if (!entry || entry.error) throw new OperationError({ code: 'invalid-input', message: 'Choose a valid file or folder.' });
        if (folder && findEntry(vault.entries, folder)?.kind !== 'folder') throw new OperationError({ code: 'invalid-input', message: 'Choose a valid destination folder.' });
        applyEntryChange(await api.moveEntry(vault.sessionId, path, folder, placement).then(unwrapOperation));
      });
    },
  };
}
