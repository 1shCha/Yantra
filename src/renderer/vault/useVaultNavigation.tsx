import { useShallow } from 'zustand/react/shallow';
import { FilePlus2, FolderInput, FolderPlus, PanelsTopLeft, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { VaultEntry } from '../../shared/vault-format';
import { orderEntries, type EntryPlacement, relocatedPath } from '../../shared/vault-organization';
import type { OperationResult } from '../../shared/operation-result';
import { createVaultWorkspace } from '../stores/vaultWorkspace';
import { SidebarIcon } from '../vault-ui/SidebarIcon';
import { VaultSidebar, type VaultTreeEntry } from '../vault-ui/VaultSidebar';
import { VaultContextMenu, VaultDeleteDialog, VaultMoveDialog, VaultNameDialog, type VaultMenuItem } from './VaultOrganize';
import {
  FILE_EXTENSIONS,
  entryTitle,
  expandedWithAncestors,
  findVaultEntry,
  listFolders,
  locationLabel,
  movedPath,
  parentFolderOf,
  renamedPath,
  type VaultEntryKind,
} from './vault-organize-helpers';
import { documentTitle, titleFilename } from '../../shared/document-title';

const emptyExpanded: ReadonlySet<string> = new Set();

const kindLabels = { folder: 'Folder', document: 'Document', canvas: 'Canvas' } satisfies Record<VaultEntryKind, string>;

const treeEntryCache = new WeakMap<VaultEntry, VaultTreeEntry>();
function treeEntries(entries: VaultEntry[]): VaultTreeEntry[] {
  return entries.map((entry) => {
    const cached = treeEntryCache.get(entry);
    if (cached) return cached;
    const row = { id: entry.path, name: entry.name, kind: entry.kind, error: entry.error,
      children: entry.children && treeEntries(entry.children) };
    treeEntryCache.set(entry, row);
    return row;
  });
}

type OrganizeDialog =
  | { kind: 'create-folder'; folder: string }
  | { kind: 'rename'; path: string; entryKind: VaultEntryKind }
  | { kind: 'move'; path: string; entryKind: VaultEntryKind }
  | { kind: 'delete'; path: string; entryKind: VaultEntryKind };

export function useVaultNavigation(store: ReturnType<typeof createVaultWorkspace>) {
  const state = useStore(store, useShallow((current) => ({
    vault: current.vault, busy: current.busy, activePath: current.activePath,
    createDocument: current.createDocument, createCanvas: current.createCanvas, openDocument: current.openDocument, openCanvas: current.openCanvas,
    moveEntry: current.moveEntry, renameEntry: current.renameEntry, createFolder: current.createFolder, choose: current.choose, deleteEntry: current.deleteEntry, retryRecovery: current.retryRecovery,
  })));
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ session: string; folder: string; expanded: ReadonlySet<string> }>({ session: '', folder: '', expanded: emptyExpanded });
  const [dialog, setDialog] = useState<OrganizeDialog | null>(null);
  const [menu, setMenu] = useState<{ path: string; entryKind: VaultEntryKind; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<{ session: string; path: string } | null>(null);
  const session = state.vault?.sessionId ?? '';
  const folder = destination.session === session ? destination.folder : '';
  const expanded = destination.session === session ? destination.expanded : emptyExpanded;
  const entries = useMemo(() => treeEntries(orderEntries(state.vault?.entries ?? [], state.vault?.metadata.sidebarOrder)), [state.vault?.entries, state.vault?.metadata.sidebarOrder]);
  const highlightPath = highlight?.session === session ? highlight.path : undefined;
  const highlightedFile = highlightPath && state.vault && findVaultEntry(state.vault.entries, highlightPath)?.kind !== 'folder'
    ? highlightPath : undefined;
  const prepareDestination = useCallback((target: string) => {
    setHighlight(null);
    setDestination((current) => {
      const previous = current.session === session ? current.expanded : emptyExpanded;
      const next = expandedWithAncestors(previous, target);
      const expanded = next.size === previous.size ? previous : next;
      return current.session === session && current.folder === target && current.expanded === expanded
        ? current : { session, folder: target, expanded };
    });
  }, [session]);
  const createDocument = useCallback((target: string) => {
    const previouslyActive = store.getState().activeDocumentId;
    prepareDestination(target);
    void state.createDocument(target).then((result) => {
      const current = store.getState();
      if (result.status === 'success' && current.vault?.sessionId === session && current.activeDocumentId !== previouslyActive) {
        setFocusDocumentId(current.activeDocumentId);
      }
    });
  }, [session, prepareDestination, state.createDocument, store]);

  const createCanvas = useCallback((target: string) => {
    prepareDestination(target);
    void state.createCanvas(target);
  }, [prepareDestination, state.createCanvas]);

  const openFile = useCallback((path: string) => {
    if (path.endsWith('.yantraC')) void state.openCanvas(path);
    else void state.openDocument(path);
  }, [state.openCanvas, state.openDocument]);

  /** After a rename or move, remaps local sidebar paths, expands the destination chain,
      and marks the organized item selected. */
  const revealOrganized = useCallback((from: string, to: string, destinationFolder: string) => {
    const remapped = new Set([...expanded].map((path) => relocatedPath(path, from, to)));
    setDestination({ session, folder: relocatedPath(folder, from, to), expanded: expandedWithAncestors(remapped, destinationFolder) });
    setHighlight({ session, path: to });
  }, [expanded, session, folder]);

  /** Dialog submissions surface failures inline and keep the dialog open. */
  async function submitOrganize(action: () => Promise<OperationResult>, onSuccess: () => void): Promise<OperationResult> {
    const result = await action();
    if (result.status === 'success') {
      onSuccess();
      setDialog(null);
    }
    return result;
  }

  const moveByDrag = useCallback((path: string, target: string, placement?: EntryPlacement) => {
    if (placement) {
      void state.moveEntry(path, target, placement);
      return;
    }
    setHighlight(null);
    void state.moveEntry(path, target, placement).then((result) => {
      if (result.status === 'success') revealOrganized(path, movedPath(path, target), target);
    });
  }, [state.moveEntry, revealOrganized]);

  function afterDeletion(path: string) {
    const removed = (candidate: string) => candidate === path || candidate.startsWith(`${path}/`);
    setHighlight(null);
    setFocusDocumentId(null);
    setDestination({ session, folder: removed(folder) ? parentFolderOf(path) : folder,
      expanded: new Set([...expanded].filter((candidate) => !removed(candidate))) });
  }

  function menuItems(target: { path: string; entryKind: VaultEntryKind }): VaultMenuItem[] {
    const disabled = state.busy;
    const rename: VaultMenuItem = { label: 'Rename', icon: Pencil, disabled, onSelect: () => setDialog({ kind: 'rename', path: target.path, entryKind: target.entryKind }) };
    const move: VaultMenuItem = { label: 'Move To…', icon: FolderInput, disabled, onSelect: () => setDialog({ kind: 'move', path: target.path, entryKind: target.entryKind }) };
    const trash: VaultMenuItem = { label: 'Move to Trash', icon: Trash2, disabled, danger: true, onSelect: () => setDialog({ kind: 'delete', path: target.path, entryKind: target.entryKind }) };
    if (target.entryKind !== 'folder') return [rename, move, trash];
    return [
      { label: 'New Document', icon: FilePlus2, disabled, onSelect: () => createDocument(target.path) },
      { label: 'New Canvas', icon: PanelsTopLeft, disabled, onSelect: () => createCanvas(target.path) },
      { label: 'New Folder', icon: FolderPlus, disabled, onSelect: () => setDialog({ kind: 'create-folder', folder: target.path }) },
      rename, move, trash,
    ];
  }

  const selectRoot = useCallback(() => {
    setHighlight(null);
    setDestination({ session, folder: '', expanded });
  }, [session, expanded]);
  const openEntry = useCallback((path: string) => {
    selectRoot();
    openFile(path);
  }, [selectRoot, openFile]);
  const toggleFolder = useCallback((path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    setHighlight(null);
    setDestination({ session, folder: path, expanded: next });
  }, [session, expanded]);
  const expandFolder = useCallback((path: string) => {
    setDestination({ session, folder, expanded: new Set([...expanded, path]) });
  }, [session, folder, expanded]);
  const createDocumentInFolder = useCallback(() => createDocument(folder), [createDocument, folder]);
  const createCanvasInFolder = useCallback(() => createCanvas(folder), [createCanvas, folder]);
  const createFolderInFolder = useCallback(() => setDialog({ kind: 'create-folder', folder }), [folder]);
  const openEntryMenu = useCallback((entry: VaultTreeEntry, position: { x: number; y: number }) => {
    setMenu({ path: entry.id, entryKind: entry.kind, x: position.x, y: position.y });
  }, []);

  const dialogEntry = dialog && dialog.kind !== 'create-folder' && state.vault ? findVaultEntry(state.vault.entries, dialog.path) : undefined;

  const vaultActions = useMemo(() => <div className="vault-session-actions" role="toolbar" aria-label="Open or create vault">
    <button title="Create Vault" aria-label="Create Vault" disabled={state.busy} onClick={() => void state.choose(true)}><SidebarIcon kind="newFolder" size={15} /><span>Create vault</span></button>
    <button title="Open Vault" aria-label="Open Vault" disabled={state.busy} onClick={() => void state.choose(false)}><SidebarIcon kind="openFolder" size={15} /><span>Open vault</span></button>
  </div>, [state.busy, state.choose]);

  const sidebar = <div className="vault-navigation">
    {state.vault ? <VaultSidebar
      name={state.vault.name} entries={entries} expandedIds={expanded}
      selectedId={highlightedFile || state.activePath || undefined} disabled={state.busy}
      onSelectRoot={selectRoot}
      onOpen={openEntry}
      onToggleFolder={toggleFolder}
      onExpandFolder={expandFolder}
      onCreateDocument={createDocumentInFolder}
      onCreateCanvas={createCanvasInFolder}
      onCreateFolder={createFolderInFolder}
      onMoveEntry={moveByDrag}
      onEntryMenu={openEntryMenu}
    /> : <section className="vault-sidebar"><div className="vault-sidebar__heading">No vault open</div></section>}
    {state.vault && <div className="vault-destination" title={`${state.vault.name}/${folder}`}>New file in: {folder || '/'}</div>}
    {vaultActions}
    {menu && <VaultContextMenu label={`${kindLabels[menu.entryKind]} actions`} items={menuItems(menu)}
      position={{ x: menu.x, y: menu.y }} onDismiss={() => setMenu(null)} />}
    {dialog?.kind === 'delete' && state.vault && <VaultDeleteDialog
      name={dialog.path} kind={dialog.entryKind} busy={state.busy} recovering={state.vault.recovery?.path === dialog.path}
      onSubmit={() => submitOrganize(() => state.deleteEntry(dialog.path), () => afterDeletion(dialog.path))}
      onRecover={() => submitOrganize(() => state.retryRecovery(), () => afterDeletion(dialog.path))}
      onDismiss={() => setDialog(null)} />}
    {dialog?.kind === 'create-folder' && state.vault && <VaultNameDialog
      title="New Folder" submitLabel="Create" initialName="" extension=""
      location={locationLabel(state.vault.name, dialog.folder)} busy={state.busy}
      onSubmit={(name) => submitOrganize(() => state.createFolder(dialog.folder, name), () => {
        const created = dialog.folder ? `${dialog.folder}/${name}` : name;
        setDestination({ session, folder: created, expanded: expandedWithAncestors(expanded, created) });
        setHighlight(null);
      })}
      onDismiss={() => setDialog(null)} />}
    {dialog?.kind === 'rename' && state.vault && dialogEntry && <VaultNameDialog
      title={`Rename ${kindLabels[dialog.entryKind]}`} submitLabel="Rename"
      initialName={dialog.entryKind === 'document'
        ? (dialogEntry.documentId && store.getState().documents.get(dialogEntry.documentId)
          ? documentTitle(store.getState().documents.get(dialogEntry.documentId)!.file.doc)
          : entryTitle(dialogEntry.name, dialog.entryKind).replaceAll('_', ' ').replaceAll('-', ' '))
        : entryTitle(dialogEntry.name, dialog.entryKind)}
      extension={FILE_EXTENSIONS[dialog.entryKind]}
      location={locationLabel(state.vault.name, parentFolderOf(dialog.path))} busy={state.busy}
      onSubmit={(name) => {
        const filename = dialog.entryKind === 'document' ? titleFilename(name) : name;
        return submitOrganize(() => state.renameEntry(dialog.path, filename, dialog.entryKind === 'document' ? name : undefined),
          () => revealOrganized(dialog.path, renamedPath(dialog.path, dialog.entryKind, filename), parentFolderOf(dialog.path)));
      }}
      onDismiss={() => setDialog(null)} />}
    {dialog?.kind === 'move' && state.vault && dialogEntry && <VaultMoveDialog
      title={`Move ${entryTitle(dialogEntry.name, dialog.entryKind)}`} vaultName={state.vault.name}
      folders={listFolders(state.vault.entries)}
      source={{ path: dialog.path, kind: dialog.entryKind }} busy={state.busy}
      onSubmit={(target) => submitOrganize(() => state.moveEntry(dialog.path, target),
        () => revealOrganized(dialog.path, movedPath(dialog.path, target), target))}
      onDismiss={() => setDialog(null)} />}
  </div>;


  const dialogOpen = dialog !== null;
  const viewport = useMemo(() => ({ dialogOpen, folder, createDocument, createCanvas, openFile, focusDocumentId, setFocusDocumentId }),
    [dialogOpen, folder, createDocument, createCanvas, openFile, focusDocumentId]);
  return { sidebar, ...viewport, viewport };
}
