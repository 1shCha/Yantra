import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type MouseEvent } from 'react';
import { SidebarIcon } from './SidebarIcon';
import { canDropInto, type VaultEntryKind } from '../vault/vault-organize-helpers';

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
  onMoveEntry?: (path: string, folder: string) => void;
  /** Expands a folder without changing the selected destination (used while dragging over it). */
  onExpandFolder?: (id: string) => void;
  /** Opens a context menu for an entry at a viewport position. */
  onEntryMenu?: (entry: VaultTreeEntry, position: { x: number; y: number }) => void;
}

const DRAG_EXPAND_DELAY_MS = 650;
const DRAG_SCROLL_ZONE_PX = 28;
const DRAG_SCROLL_STEP_PX = 9;

type DropHandlers = Pick<HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;

export function VaultSidebar(props: VaultSidebarProps) {
  const [dragging, setDragging] = useState<{ path: string; kind: VaultEntryKind } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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
    if (!onMoveEntry) return {};
    return {
      onDragEnter: (event) => {
        event.stopPropagation();
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
        if (!dragging || !canDropInto(dragging, folder)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== folder) setDropTarget(folder);
      },
      onDragLeave: (event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        if (dropTarget === folder) setDropTarget(null);
        if (expandTimer.current?.id === folder) clearExpandTimer();
      },
      onDrop: (event) => {
        event.stopPropagation();
        if (!dragging || !canDropInto(dragging, folder)) return;
        event.preventDefault();
        const source = dragging.path;
        endDrag();
        onMoveEntry(source, folder);
      },
    };
  }

  /** Files are never drop destinations; swallow the events so the root background does not claim them. */
  const inertDropHandlers: DropHandlers = {
    onDragEnter: (event) => event.stopPropagation(),
    onDragOver: (event) => event.stopPropagation(),
    onDrop: (event) => event.stopPropagation(),
  };

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

  const identity = <>
    <SidebarIcon kind="folder" />
    <span className="vault-sidebar__title">{props.name}</span>
  </>;

  const rootDroppable = dragging !== null && canDropInto(dragging, '');
  const rootClass = `vault-root${rootDroppable ? ' vault-root--droppable' : ''}${dropTarget === '' ? ' vault-root--drop' : ''}`;

  function renderEntries(entries: readonly VaultTreeEntry[]) {
    return entries.map((entry) => {
      const expanded = props.expandedIds.has(entry.id);
      const isFolder = entry.kind === 'folder';
      const selected = !isFolder && props.selectedId === entry.id;
      const icon = isFolder ? (expanded ? 'openFolder' : 'folder') : entry.kind === 'canvas' ? 'canvas' : 'document';
      const dropping = dropTarget === entry.id;
      return (
        <li key={entry.id}>
          <button
            className={`vault-tree__row${selected ? ' vault-tree__row--selected' : ''}${
              dragging?.path === entry.id ? ' vault-tree__row--dragging' : ''}${dropping ? ' vault-tree__row--drop' : ''}`}
            title={entry.error ?? entry.name}
            disabled={props.disabled || entry.unavailable}
            aria-current={selected ? 'page' : undefined}
            aria-expanded={isFolder ? expanded : undefined}
            data-path={entry.id}
            draggable={onMoveEntry !== undefined && !props.disabled && !entry.unavailable}
            onDragStart={beginDrag(entry)}
            onDragEnd={endDrag}
            onClick={() => isFolder ? props.onToggleFolder(entry.id) : props.onOpen(entry.id)}
            onContextMenu={entryMenuHandler(entry)}
            {...(isFolder ? dropHandlers(entry.id, true) : inertDropHandlers)}
          >
            {isFolder ? (expanded ? <SidebarIcon kind="chevronDown" size={12} /> : <SidebarIcon kind="chevronRight" size={12} />) : <span className="vault-tree__spacer" />}
            <SidebarIcon kind={icon} />
            <span className="vault-tree__name">{entry.name}</span>
          </button>
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
      <div className="vault-sidebar__actions" role="toolbar" aria-label="Vault actions">
        <button disabled={props.disabled} title="New Document" aria-label="New Document" onClick={props.onCreateDocument}><SidebarIcon kind="newDocument" /><span>New document</span></button>
        {props.onCreateCanvas && <button disabled={props.disabled} title="New Canvas" aria-label="New Canvas" onClick={props.onCreateCanvas}><SidebarIcon kind="canvas" /><span>New canvas</span></button>}
        {props.onCreateFolder && <button disabled={props.disabled} title="New Folder" aria-label="New Folder" onClick={props.onCreateFolder}><SidebarIcon kind="newFolder" /><span>New folder</span></button>}
        {props.onRefresh && <button disabled={props.disabled} title="Refresh Vault" aria-label="Refresh Vault" onClick={props.onRefresh}><SidebarIcon kind="refresh" /><span>Refresh vault</span></button>}
      </div>
      <div className="vault-sidebar__section" aria-hidden="true">Files</div>
      <nav ref={treeRef} className={`vault-tree${dropTarget === '' ? ' vault-tree--drop-root' : ''}`} aria-label="Documents and canvases"
        onDragOverCapture={(event) => { pointerY.current = event.clientY; }}
        {...dropHandlers('', false)}>
        {props.entries.length ? <ul>{renderEntries(props.entries)}</ul> : <p className="vault-sidebar__empty">No files</p>}
      </nav>
    </section>
  );
}
