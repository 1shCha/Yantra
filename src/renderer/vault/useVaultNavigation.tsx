import { useShallow } from 'zustand/react/shallow';
import { FilePlus2, FolderInput, FolderPlus, PanelsTopLeft, Pencil, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { normalizeBatchMoveSources, pruneSelectedPaths, remapSelectedPaths } from '../../shared/vault-batch-move';
import {
  applySelectionGesture,
  collectVisibleSidebarRows,
  selectableVisiblePaths,
} from './sidebar-selection';
import { useStore } from 'zustand';
import type { VaultEntry } from '../../shared/vault-format';
import { orderEntries, type EntryPlacement, relocatedPath } from '../../shared/vault-organization';
import { cancelled, type OperationResult } from '../../shared/operation-result';
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
    const row = { id: entry.path, resourceId: entry.error ? undefined : entry.documentId ?? entry.canvasId, name: entry.name, kind: entry.kind, error: entry.error,
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
    moveEntry: current.moveEntry, moveEntries: current.moveEntries, renameEntry: current.renameEntry, createFolder: current.createFolder, choose: current.choose, deleteEntry: current.deleteEntry, retryRecovery: current.retryRecovery,
  })));
  const [selection, setSelection] = useState<{ session: string; paths: ReadonlySet<string>; anchor: string | null }>({ session: '', paths: new Set(), anchor: null });
  const navRef = useRef<HTMLDivElement>(null);
  const [focusDocumentId, setFocusDocumentId] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ session: string; folder: string; expanded: ReadonlySet<string> }>({ session: '', folder: '', expanded: emptyExpanded });
  const [dialog, setDialog] = useState<OrganizeDialog | null>(null);
  const renameFile = useCallback((id: string, kind: 'document' | 'canvas', name: string): Promise<OperationResult> => {
    const current = store.getState();
    const file = kind === 'document' ? current.documents.get(id) : current.canvases.get(id);
    if (!file) return Promise.resolve(cancelled('not-applicable'));
    return current.renameEntry(file.path, kind === 'document' ? titleFilename(name) : name, kind === 'document' ? name : undefined);
  }, [store]);
  const [menu, setMenu] = useState<{ path: string; entryKind: VaultEntryKind; x: number; y: number } | null>(null);
  const [highlight, setHighlight] = useState<{ session: string; path: string } | null>(null);
  const session = state.vault?.sessionId ?? '';
  const folder = destination.session === session ? destination.folder : '';
  const expanded = destination.session === session ? destination.expanded : emptyExpanded;
  const entries = useMemo(() => treeEntries(orderEntries(state.vault?.entries ?? [], state.vault?.metadata.sidebarOrder)), [state.vault?.entries, state.vault?.metadata.sidebarOrder]);
  const visibleRows = useMemo(() => collectVisibleSidebarRows(entries, expanded), [entries, expanded]);
  const visibleSelectable = useMemo(() => new Set(selectableVisiblePaths(visibleRows)), [visibleRows]);
  const selectedPaths = useMemo(() => {
    if (selection.session !== session) return new Set<string>();
    return pruneSelectedPaths(selection.paths, visibleSelectable);
  }, [session, selection.session, selection.paths, visibleSelectable]);
  const selectionAnchor = useMemo(() => {
    if (selection.session !== session) return null;
    if (selection.anchor && selectedPaths.has(selection.anchor)) return selection.anchor;
    return selectedPaths.values().next().value ?? null;
  }, [session, selection.session, selection.anchor, selectedPaths]);

  const clearSelection = useCallback(() => {
    setSelection({ session, paths: new Set(), anchor: null });
  }, [session]);

  useEffect(() => {
    const node = navRef.current;
    if (!node) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clearSelection();
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [clearSelection]);
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
  const createDocument = useCallback((target = folder) => {
    const previouslyActive = store.getState().activeDocumentId;
    prepareDestination(target);
    void state.createDocument(target).then((result) => {
      const current = store.getState();
      if (result.status === 'success' && current.vault?.sessionId === session && current.activeDocumentId !== previouslyActive) {
        setFocusDocumentId(current.activeDocumentId);
      }
    });
  }, [session, folder, prepareDestination, state.createDocument, store]);

  const createCanvas = useCallback((target = folder) => {
    prepareDestination(target);
    void state.createCanvas(target);
  }, [folder, prepareDestination, state.createCanvas]);

  const createDocumentAtRoot = useCallback(() => createDocument(''), [createDocument]);
  const createCanvasAtRoot = useCallback(() => createCanvas(''), [createCanvas]);

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

  const remapSelectionAfterChanges = useCallback((changes: readonly { from: string; to: string }[]) => {
    if (!changes.length) return;
    setSelection((current) => {
      if (current.session !== session) return current;
      let anchor = current.anchor;
      for (const change of changes) {
        if (anchor) anchor = relocatedPath(anchor, change.from, change.to);
      }
      return { session, paths: remapSelectedPaths(current.paths, changes), anchor };
    });
  }, [session]);

  const syncSelectionToVault = useCallback((paths: readonly string[], target: string) => {
    const vaultEntries = store.getState().vault?.entries;
    if (!vaultEntries) return;
    setSelection((current) => {
      if (current.session !== session) return current;
      const next = new Set<string>();
      for (const path of current.paths) {
        const candidate = parentFolderOf(path) === target ? path : movedPath(path, target);
        if (findVaultEntry(vaultEntries, candidate)) next.add(candidate);
        else if (findVaultEntry(vaultEntries, path)) next.add(path);
      }
      for (const path of paths) {
        const candidate = parentFolderOf(path) === target ? path : movedPath(path, target);
        if (findVaultEntry(vaultEntries, candidate)) next.add(candidate);
      }
      const anchor = current.anchor && next.has(current.anchor)
        ? current.anchor
        : current.anchor && findVaultEntry(vaultEntries, relocatedPath(current.anchor, paths[0] ?? '', movedPath(paths[0] ?? '', target)))
          ? relocatedPath(current.anchor, paths[0] ?? '', movedPath(paths[0] ?? '', target))
          : next.values().next().value ?? null;
      return { session, paths: next, anchor };
    });
  }, [session, store]);

  const moveByDrag = useCallback((path: string, target: string, placement?: EntryPlacement) => {
    if (placement) {
      void state.moveEntry(path, target, placement);
      return;
    }
    setHighlight(null);
    void state.moveEntry(path, target, placement).then((result) => {
      if (result.status === 'success') {
        revealOrganized(path, movedPath(path, target), target);
        remapSelectionAfterChanges([{ from: path, to: movedPath(path, target) }]);
        setDestination((current) => current.session === session
          ? { ...current, expanded: expandedWithAncestors(current.expanded, target) } : current);
      }
    });
  }, [state.moveEntry, revealOrganized, remapSelectionAfterChanges, session]);

  const moveGroupByDrag = useCallback((paths: string[], target: string) => {
    setHighlight(null);
    const normalized = normalizeBatchMoveSources(paths, store.getState().vault?.metadata.sidebarOrder ?? []);
    void state.moveEntries(normalized, target).then((result) => {
      if (result.status === 'cancelled' || result.status === 'recovery-required') return;
      syncSelectionToVault(normalized, target);
      setDestination({ session, folder: target, expanded: expandedWithAncestors(expanded, target) });
    });
  }, [state.moveEntries, store, session, expanded, syncSelectionToVault]);

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

  const selectSidebarEntry = useCallback((entry: VaultTreeEntry, event: MouseEvent<HTMLButtonElement>) => {
    const next = applySelectionGesture(selectedPaths, selectionAnchor, {
      path: entry.id,
      additive: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
    }, visibleRows);
    setSelection({ session, paths: next.paths, anchor: next.anchor });
  }, [selectedPaths, selectionAnchor, visibleRows, session]);

  const prepareDrag = useCallback((entry: VaultTreeEntry) => {
    const kind = entry.kind;
    if (selectedPaths.has(entry.id) && selectedPaths.size > 1) {
      return {
        group: true,
        sources: [...selectedPaths].map((path) => {
          const found = findVaultEntry(state.vault?.entries ?? [], path);
          // SAFETY: Tree entries always use a known sidebar kind; fall back to the grabbed row when pruning races the vault scan.
          const resolvedKind: VaultEntryKind = found?.kind ?? kind;
          return { path, kind: resolvedKind };
        }),
      };
    }
    if (!selectedPaths.has(entry.id)) {
      setSelection({ session, paths: new Set([entry.id]), anchor: entry.id });
    }
    return { group: false, sources: [{ path: entry.id, kind }] };
  }, [selectedPaths, session, state.vault]);
  const clickGesture = useRef<{ session: string; path: string; target?: string; provisional?: string } | null>(null);
  const openEntry = useCallback((path: string, count = 0) => {
    const before = store.getState();
    const target = before.activeTabId ?? undefined;
    const existing = before.tabs.find((tab) => tab.path === path);
    selectRoot();
    openFile(path);
    clickGesture.current = count === 1 ? { session, path, target,
      provisional: existing ? undefined : store.getState().activeTabId ?? undefined } : null;
  }, [selectRoot, openFile, session, store]);
  const replaceEntry = useCallback((path: string) => {
    const gesture = clickGesture.current;
    clickGesture.current = null;
    if (!gesture || gesture.session !== session || gesture.path !== path || !gesture.provisional) return;
    const options = { replaceTabId: gesture.target, provisionalTabId: gesture.provisional };
    if (path.endsWith('.yantraC')) void store.getState().openCanvas(path, options);
    else void store.getState().openDocument(path, options);
  }, [session, store]);
  const toggleFolder = useCallback((path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    setHighlight(null);
    setDestination({ session, folder: path, expanded: next });
  }, [session, expanded]);
  const expandFolder = useCallback((path: string) => {
    setDestination({ session, folder, expanded: new Set([...expanded, path]) });
  }, [session, folder, expanded]);
  const createFolderInFolder = useCallback(() => setDialog({ kind: 'create-folder', folder }), [folder]);
  const openEntryMenu = useCallback((entry: VaultTreeEntry, position: { x: number; y: number }) => {
    setMenu({ path: entry.id, entryKind: entry.kind, x: position.x, y: position.y });
  }, []);

  const dialogEntry = dialog && dialog.kind !== 'create-folder' && state.vault ? findVaultEntry(state.vault.entries, dialog.path) : undefined;

  const vaultActions = useMemo(() => <div className="vault-session-actions" role="toolbar" aria-label="Open or create vault">
    <button title="Create Vault" aria-label="Create Vault" disabled={state.busy} onClick={() => void state.choose(true)}><SidebarIcon kind="newFolder" size={15} /><span>Create vault</span></button>
    <button title="Open Vault" aria-label="Open Vault" disabled={state.busy} onClick={() => void state.choose(false)}><SidebarIcon kind="openFolder" size={15} /><span>Open vault</span></button>
  </div>, [state.busy, state.choose]);

  const sidebar = <div ref={navRef} className="vault-navigation" inert={state.busy} tabIndex={-1}
    onMouseDown={() => navRef.current?.focus({ preventScroll: true })}>
    {state.vault ? <VaultSidebar
      name={state.vault.name} entries={entries} expandedIds={expanded}
      selectedId={highlightedFile || state.activePath || undefined}
      multiSelectedIds={selectedPaths}
      onSelectRoot={selectRoot}
      onClearSelection={clearSelection}
      onSelectEntry={selectSidebarEntry}
      onPrepareDrag={prepareDrag}
      onOpen={openEntry}
      onReplace={replaceEntry}
      onToggleFolder={toggleFolder}
      onExpandFolder={expandFolder}
      onCreateDocument={() => createDocument()}
      onCreateCanvas={() => createCanvas()}
      onCreateFolder={createFolderInFolder}
      onMoveEntry={moveByDrag}
      onMoveEntries={moveGroupByDrag}
      onEntryMenu={openEntryMenu}
    /> : <section className="vault-sidebar"><div className="vault-sidebar__heading">No vault open</div></section>}
    {vaultActions}
  </div>;
  const dialogs = <>
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
  </>;


  const dialogOpen = dialog !== null;
  const viewport = useMemo(() => ({
    dialogOpen, folder, createDocument, createCanvas, createDocumentAtRoot, createCanvasAtRoot,
    openFile, renameFile, focusDocumentId, setFocusDocumentId,
  }), [dialogOpen, folder, createDocument, createCanvas, createDocumentAtRoot, createCanvasAtRoot, openFile, renameFile, focusDocumentId]);
  return { sidebar, dialogs, entries, ...viewport, viewport };
}
