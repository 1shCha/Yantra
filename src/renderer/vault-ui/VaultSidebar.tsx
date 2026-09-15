import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes, type MouseEvent } from 'react';
import { SidebarIcon } from './SidebarIcon';
import type { EntryPlacement } from '../../shared/vault-organization';
import { parentFolderOf, canDropInto, type VaultEntryKind } from '../vault/vault-organize-helpers';

export interface VaultTreeEntry {
  id: string;
  name: string;
  kind: VaultEntryKind;
  children?: readonly VaultTreeEntry[];
  error?: string;
  unavailable?: boolean;
}

interface VaultSidebarProps {
  name: string;
  entries: readonly VaultTreeEntry[];
  expandedIds: ReadonlySet<string>;
  selectedId?: string;
  onOpen: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onCreateDocument: () => void;
  onCreateCanvas?: () => void;
  onCreateFolder?: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
  onSelectRoot?: () => void;
  /** Enables drag-and-drop moves; called with the dragged path and destination folder ('' = root). */
  onMoveEntry?: (path: string, folder: string, placement?: EntryPlacement) => void;
  /** Expands a folder without changing the selected destination (used while dragging over it). */
  onExpandFolder?: (id: string) => void;
  /** Opens a context menu for an entry at a viewport position. */
  onEntryMenu?: (entry: VaultTreeEntry, position: { x: number; y: number }) => void;
}

const DRAG_EXPAND_DELAY_MS = 650;
const DRAG_SCROLL_ZONE_PX = 28;
const DRAG_SCROLL_STEP_PX = 9;

type DropHandlers = Pick<HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;

interface RowActions {
  beginDrag: (entry: VaultTreeEntry) => (event: DragEvent<HTMLButtonElement>) => void;
  endDrag: () => void;
  dropHandlers: (entry: VaultTreeEntry) => DropHandlers;
  menu: (entry: VaultTreeEntry) => ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  open: (entry: VaultTreeEntry) => void;
}

const VaultTreeRow = memo(function VaultTreeRow({ entry, expanded, selected, dragging, dropping, insertion, disabled, draggable, actions }: {
  entry: VaultTreeEntry; expanded: boolean; selected: boolean; dragging: boolean; dropping: boolean;
  insertion?: 'before' | 'after'; disabled: boolean; draggable: boolean; actions: RowActions;
}) {
  const isFolder = entry.kind === 'folder';
  const icon = isFolder ? (expanded ? 'openFolder' : 'folder') : entry.kind === 'canvas' ? 'canvas' : 'document';
  return <button
    className={`vault-tree__row${selected ? ' vault-tree__row--selected' : ''}${dragging ? ' vault-tree__row--dragging' : ''}${dropping ? ' vault-tree__row--drop' : ''}${insertion ? ` vault-tree__row--insert-${insertion}` : ''}`}
    title={entry.error ?? entry.name} disabled={disabled} aria-current={selected ? 'page' : undefined}
    aria-expanded={isFolder ? expanded : undefined} data-path={entry.id} draggable={draggable}
    onDragStart={(event) => actions.beginDrag(entry)(event)} onDragEnd={() => actions.endDrag()}
    onClick={() => actions.open(entry)} onContextMenu={(event) => actions.menu(entry)?.(event)}
    onDragEnter={(event) => actions.dropHandlers(entry).onDragEnter?.(event)}
    onDragOver={(event) => actions.dropHandlers(entry).onDragOver?.(event)}
    onDragLeave={(event) => actions.dropHandlers(entry).onDragLeave?.(event)}
    onDrop={(event) => actions.dropHandlers(entry).onDrop?.(event)}>
    {isFolder ? (expanded ? <SidebarIcon kind="chevronDown" size={12} /> : <SidebarIcon kind="chevronRight" size={12} />) : <span className="vault-tree__spacer" />}
    <SidebarIcon kind={icon} />
    <span className="vault-tree__name">{entry.name}</span>
  </button>;
});

const VaultSidebarActions = memo(function VaultSidebarActions(props: Pick<VaultSidebarProps, 'disabled' | 'onCreateDocument' | 'onCreateCanvas' | 'onCreateFolder' | 'onRefresh'>) {
  return <div className="vault-sidebar__actions" role="toolbar" aria-label="Vault actions">
    <button disabled={props.disabled} title="New Document" aria-label="New Document" onClick={props.onCreateDocument}><SidebarIcon kind="newDocument" /><span>New document</span></button>
    {props.onCreateCanvas && <button disabled={props.disabled} title="New Canvas" aria-label="New Canvas" onClick={props.onCreateCanvas}><SidebarIcon kind="canvas" /><span>New canvas</span></button>}
    {props.onCreateFolder && <button disabled={props.disabled} title="New Folder" aria-label="New Folder" onClick={props.onCreateFolder}><SidebarIcon kind="newFolder" /><span>New folder</span></button>}
    {props.onRefresh && <button disabled={props.disabled} title="Refresh Vault" aria-label="Refresh Vault" onClick={props.onRefresh}><SidebarIcon kind="refresh" /><span>Refresh vault</span></button>}
  </div>;
});

export const VaultSidebar = memo(function VaultSidebar(props: VaultSidebarProps) {
  const [dragging, setDragging] = useState<{ path: string; kind: VaultEntryKind } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<EntryPlacement | null>(null);
  const treeRef = useRef<HTMLElement>(null);
  const pointerY = useRef(0);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const { onMoveEntry } = props;

  function clearExpandTimer() {
    if (expandTimer.current) {
      window.clearTimeout(expandTimer.current.timer);
      expandTimer.current = null;
    }
  }

  function endDrag() {
    setInsertion(null);
    setDragging(null);
    setDropTarget(null);
    clearExpandTimer();
    if (scrollTimer.current !== null) {
      window.clearInterval(scrollTimer.current);
      scrollTimer.current = null;
    }
  }

  useEffect(() => endDrag, []);

  function beginDrag(entry: VaultTreeEntry) {
    return (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData('text/plain', entry.id);
      event.dataTransfer.effectAllowed = 'move';
      setDragging({ path: entry.id, kind: entry.kind });
      scrollTimer.current ??= window.setInterval(() => {
        const tree = treeRef.current;
        if (!tree) return;
        const rect = tree.getBoundingClientRect();
        if (pointerY.current < rect.top + DRAG_SCROLL_ZONE_PX) tree.scrollTop -= DRAG_SCROLL_STEP_PX;
        else if (pointerY.current > rect.bottom - DRAG_SCROLL_ZONE_PX) tree.scrollTop += DRAG_SCROLL_STEP_PX;
      }, 40);
    };
  }

  /** Drop handling for a destination folder ('' = vault root). Rows stop propagation so the
      tree-background handlers only see drags over empty space. */
  function dropHandlers(folder: string, expandable: boolean): DropHandlers {
    if (!onMoveEntry || props.disabled) return {};
    return {
      onDragEnter: (event) => {
        event.stopPropagation();
        setInsertion(null);
        if (!dragging || !canDropInto(dragging, folder)) return;
        event.preventDefault();
        if (expandable && !props.expandedIds.has(folder) && expandTimer.current?.id !== folder) {
          clearExpandTimer();
          expandTimer.current = {
            id: folder,
            timer: window.setTimeout(() => {
              expandTimer.current = null;
              (props.onExpandFolder ?? props.onToggleFolder)(folder);
            }, DRAG_EXPAND_DELAY_MS),
          };
        }
      },
      onDragOver: (event) => {
        event.stopPropagation();
        setInsertion(null);
        if (!dragging || !canDropInto(dragging, folder)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget(folder);
      },
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (dropTarget === folder) setDropTarget(null);
        if (expandTimer.current?.id === folder) clearExpandTimer();
      },
      onDrop: (event) => {
        event.stopPropagation();
        setInsertion(null);
        if (!dragging || !canDropInto(dragging, folder)) return;
        event.preventDefault();
        const source = dragging.path;
        endDrag();
        onMoveEntry(source, folder);
      },
    };
  }

  function rowDropHandlers(entry: VaultTreeEntry): DropHandlers {
    const folderHandlers = entry.kind === 'folder' ? dropHandlers(entry.id, true) : {};
    function placementAt(event: DragEvent<HTMLElement>): EntryPlacement | null {
      if (!dragging || props.disabled || entry.unavailable || !onMoveEntry || dragging.path === entry.id
        || parentFolderOf(dragging.path) !== parentFolderOf(entry.id)
        || (dragging.kind === 'folder') !== (entry.kind === 'folder')) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const fraction = (event.clientY - rect.top) / rect.height;
      if (entry.kind === 'folder' && fraction > .25 && fraction < .75) return null;
      return { anchor: entry.id, side: fraction < .5 ? 'before' : 'after' };
    }
    const hover = (event: DragEvent<HTMLElement>) => {
      event.stopPropagation();
      const placement = placementAt(event);
      if (placement) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        clearExpandTimer();
        setDropTarget(null);
        setInsertion((current) => current?.anchor === placement.anchor && current.side === placement.side ? current : placement);
      } else {
        if (entry.kind !== 'folder') clearExpandTimer();
        setInsertion(null);
        if (!dragging || entry.kind !== 'folder' || !canDropInto(dragging, entry.id)) setDropTarget(null);
        folderHandlers.onDragEnter?.(event);
        folderHandlers.onDragOver?.(event);
      }
    };
    return {
      onDragEnter: hover,
      onDragOver: hover,
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setInsertion(null);
        folderHandlers.onDragLeave?.(event);
      },
      onDrop: (event) => {
        event.stopPropagation();
        const placement = placementAt(event);
        if (placement && dragging && onMoveEntry) {
          event.preventDefault();
          const source = dragging.path;
          endDrag();
          onMoveEntry(source, parentFolderOf(entry.id), placement);
        } else folderHandlers.onDrop?.(event);
      },
    };
  }

  function entryMenuHandler(entry: VaultTreeEntry) {
    const { onEntryMenu } = props;
    if (!onEntryMenu) return undefined;
    return (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      // Keyboard-invoked context menus report (0, 0); anchor those to the row instead.
      const fromKeyboard = event.clientX === 0 && event.clientY === 0;
      onEntryMenu(entry, fromKeyboard ? { x: rect.left + 16, y: rect.bottom } : { x: event.clientX, y: event.clientY });
    };
  }

  useEffect(() => {
    const tree = treeRef.current;
    if (!props.selectedId || !tree) return;
    for (const row of tree.querySelectorAll<HTMLButtonElement>('button[data-path]')) {
      if (row.dataset.path === props.selectedId) {
        row.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
  }, [props.selectedId, props.expandedIds]);

  // Stable row dispatchers read the latest committed drag state, so memoized
  // rows never retain a handler from a previous drag or destination.
  const latest = useRef<RowActions>(null);
  useLayoutEffect(() => {
    latest.current = { beginDrag, endDrag, dropHandlers: rowDropHandlers, menu: entryMenuHandler,
      open: (entry) => entry.kind === 'folder' ? props.onToggleFolder(entry.id) : props.onOpen(entry.id) };
  });
  const actions = useMemo<RowActions>(() => ({
    beginDrag: (entry) => (event) => latest.current?.beginDrag(entry)(event),
    endDrag: () => latest.current?.endDrag(),
    dropHandlers: (entry) => latest.current?.dropHandlers(entry) ?? {},
    menu: (entry) => latest.current?.menu(entry),
    open: (entry) => latest.current?.open(entry),
  }), []);
  const identity = useMemo(() => <>
    <SidebarIcon kind="folder" />
    <span className="vault-sidebar__title">{props.name}</span>
  </>, [props.name]);

  const rootDroppable = dragging !== null && canDropInto(dragging, '');
  const rootClass = `vault-root${rootDroppable ? ' vault-root--droppable' : ''}${dropTarget === '' ? ' vault-root--drop' : ''}`;

  function renderEntries(entries: readonly VaultTreeEntry[]) {
    return entries.map((entry) => {
      const expanded = props.expandedIds.has(entry.id);
      const isFolder = entry.kind === 'folder';
      const selected = !isFolder && props.selectedId === entry.id;
      const dropping = dropTarget === entry.id;
      return (
        <li key={entry.id}>
          <VaultTreeRow entry={entry} expanded={expanded} selected={selected}
            dragging={dragging?.path === entry.id} dropping={dropping}
            insertion={insertion?.anchor === entry.id ? insertion.side : undefined}
            disabled={!!(props.disabled || entry.unavailable)} draggable={onMoveEntry !== undefined && !props.disabled && !entry.unavailable}
            actions={actions} />
          {isFolder && expanded && entry.children && <ul>{renderEntries(entry.children)}</ul>}
        </li>
      );
    });
  }

  return (
    <section className="vault-sidebar" aria-label="Vault files">
      <div className="vault-sidebar__heading">{props.onSelectRoot
        ? <button className={rootClass} disabled={props.disabled} onClick={props.onSelectRoot} title={`${props.name} /`} {...dropHandlers('', false)}>{identity}</button>
        : <span className={rootClass} title={props.name} {...dropHandlers('', false)}>{identity}</span>}</div>
      <VaultSidebarActions disabled={props.disabled} onCreateDocument={props.onCreateDocument}
        onCreateCanvas={props.onCreateCanvas} onCreateFolder={props.onCreateFolder} onRefresh={props.onRefresh} />
      <div className="vault-sidebar__section" aria-hidden="true">Files</div>
      <nav ref={treeRef} className={`vault-tree${dropTarget === '' ? ' vault-tree--drop-root' : ''}`} aria-label="Documents and canvases"
        onDragOverCapture={(event) => { pointerY.current = event.clientY; }}
        {...dropHandlers('', false)}>
        {props.entries.length ? <ul>{renderEntries(props.entries)}</ul> : <p className="vault-sidebar__empty">No files</p>}
      </nav>
    </section>
  );
});
