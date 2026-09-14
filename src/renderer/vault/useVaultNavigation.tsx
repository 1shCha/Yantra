import { useShallow } from 'zustand/react/shallow';
import { FilePlus2, FolderInput, FolderPlus, PanelsTopLeft, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { VaultEntry } from '../../shared/vault-format';
import { relocatedPath } from '../../shared/vault-organization';
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

const kindLabels = { folder: 'Folder', document: 'Document', canvas: 'Canvas' } satisfies Record<VaultEntryKind, string>;

function treeEntries(entries: VaultEntry[]): VaultTreeEntry[] {
  return entries.map((entry) => ({
    id: entry.path, name: entry.name, kind: entry.kind, error: entry.error,
    children: entry.children && treeEntries(entry.children),
  }));
}

type OrganizeDialog =
  | { kind: 'create-folder'; folder: string }
  | { kind: 'rename'; path: string; entryKind: VaultEntryKind }
  | { kind: 'move'; path: string; entryKind: VaultEntryKind }
  | { kind: 'delete'; path: string; entryKind: VaultEntryKind };

export function useVaultNavigation(store: ReturnType<typeof createVaultWorkspace>) {
  const state = useStore(store, useShallow((current) => ({
    vault: current.vault, busy: current.busy, activePath: current.activePath, activeDocumentId: current.activeDocumentId,
    createDocument: current.createDocument, createCanvas: current.createCanvas, openDocument: current.openDocument, openCanvas: current.openCanvas,
    moveEntry: current.moveEntry, renameEntry: current.renameEntry, createFolder: current.createFolder, choose: current.choose, deleteEntry: current.deleteEntry, retryRecovery: current.retryRecovery,
  })));
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const [destination, setDestination] = useState({ session: '', folder: '', expanded: new Set<string>() });
  const [dialog, setDialog] = useState<OrganizeDialog | null>(null);
  const [menu, setMenu] = useState<{ path: string; entryKind: VaultEntryKind; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<{ session: string; path: string } | null>(null);
  const session = state.vault?.sessionId ?? '';
  const folder = destination.session === session ? destination.folder : '';
  const expanded = destination.session === session ? destination.expanded : new Set<string>();
  const highlightPath = highlight?.session === session ? highlight.path : undefined;
  const highlightedFile = highlightPath && state.vault && findVaultEntry(state.vault.entries, highlightPath)?.kind !== 'folder'
    ? highlightPath : undefined;
  function createDocument(target: string) {
    setHighlight(null);
    setDestination({ session, folder: target, expanded: expandedWithAncestors(expanded, target) });
    void state.createDocument(target).then((result) => {
      const current = store.getState();
      if (result.status === 'success' && current.vault?.sessionId === session && current.activeDocumentId !== state.activeDocumentId) {
        setFocusDocumentId(current.activeDocumentId);
      }
    });
  }

  function createCanvas(target: string) {
    setHighlight(null);
    setDestination({ session, folder: target, expanded: expandedWithAncestors(expanded, target) });
    void state.createCanvas(target);
  }

  function openFile(path: string) {
    if (path.endsWith('.yantraC')) void state.openCanvas(path);
    else void state.openDocument(path);
  }

  /** After a rename or move, remaps local sidebar paths, expands the destination chain,
      and marks the organized item selected. */
  function revealOrganized(from: string, to: string, destinationFolder: string) {
    const remapped = new Set([...expanded].map((path) => relocatedPath(path, from, to)));
    setDestination({ session, folder: relocatedPath(folder, from, to), expanded: expandedWithAncestors(remapped, destinationFolder) });
    setHighlight({ session, path: to });
  }

  /** Dialog submissions surface failures inline and keep the dialog open. */
  async function submitOrganize(action: () => Promise<OperationResult>, onSuccess: () => void): Promise<OperationResult> {
    const result = await action();
    if (result.status === 'success') {
      onSuccess();
      setDialog(null);
    }
    return result;
  }

  function moveByDrag(path: string, target: string) {
    setHighlight(null);
    void state.moveEntry(path, target).then((result) => {
      if (result.status === 'success') revealOrganized(path, movedPath(path, target), target);
    });
  }

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

  const dialogEntry = dialog && dialog.kind !== 'create-folder' && state.vault ? findVaultEntry(state.vault.entries, dialog.path) : undefined;

  const vaultActions = <div className="vault-session-actions" role="toolbar" aria-label="Open or create vault">
    <button title="Create Vault" aria-label="Create Vault" disabled={state.busy} onClick={() => void state.choose(true)}><SidebarIcon kind="newFolder" size={15} /><span>Create vault</span></button>
    <button title="Open Vault" aria-label="Open Vault" disabled={state.busy} onClick={() => void state.choose(false)}><SidebarIcon kind="openFolder" size={15} /><span>Open vault</span></button>
  </div>;

  const sidebar = <div className="vault-navigation">
    {state.vault ? <VaultSidebar
      name={state.vault.name} entries={treeEntries(state.vault.entries)} expandedIds={expanded}
      selectedId={highlightedFile || state.activePath || undefined} disabled={state.busy}
      onSelectRoot={() => { setHighlight(null); setDestination({ session, folder: '', expanded }); }}
      onOpen={(path) => {
        setHighlight(null);
        setDestination({ session, folder: '', expanded });
        openFile(path);
      }}
      onToggleFolder={(path) => {
        const next = new Set(expanded);
        if (next.has(path)) next.delete(path); else next.add(path);
        setHighlight(null);
        setDestination({ session, folder: path, expanded: next });
      }}
      onExpandFolder={(path) => setDestination({ session, folder, expanded: new Set([...expanded, path]) })}
      onCreateDocument={() => createDocument(folder)}
      onCreateCanvas={() => createCanvas(folder)}
      onCreateFolder={() => setDialog({ kind: 'create-folder', folder })}
      onMoveEntry={moveByDrag}
      onEntryMenu={(entry, position) => setMenu({ path: entry.id, entryKind: entry.kind, x: position.x, y: position.y })}
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


  return { sidebar, dialogOpen: dialog !== null, folder, createDocument, createCanvas, openFile, focusDocumentId, setFocusDocumentId };
}
