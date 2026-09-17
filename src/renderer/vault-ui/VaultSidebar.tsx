import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type HTMLAttributes, type MouseEvent } from 'react';
import { SidebarIcon } from './SidebarIcon';
import type { EntryPlacement } from '../../shared/vault-organization';
import { isRootUnfiledPath } from '../../shared/vault-batch-move';
import { isModifierSelection } from '../vault/sidebar-selection';
import { canDropGroup, canDropInto, parentFolderOf, type VaultEntryKind } from '../vault/vault-organize-helpers';

export interface VaultTreeEntry {
  id: string;
  resourceId?: string;
  name: string;
  kind: VaultEntryKind;
  children?: readonly VaultTreeEntry[];
  error?: string;
  unavailable?: boolean;
}

interface VaultSidebarProps {
  name: string;
  compact?: boolean;
  entries: readonly VaultTreeEntry[];
  expandedIds: ReadonlySet<string>;
  selectedId?: string;
  multiSelectedIds?: ReadonlySet<string>;
  onOpen: (id: string, clickCount?: number) => void;
  onReplace?: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onCreateDocument: () => void;
  onCreateCanvas?: () => void;
  onCreateFolder?: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
  onSelectRoot?: () => void;
  onSelectEntry?: (entry: VaultTreeEntry, event: MouseEvent<HTMLButtonElement>) => void;
  onClearSelection?: () => void;
  onPrepareDrag?: (entry: VaultTreeEntry) => { sources: readonly DragSource[]; group: boolean };
  onMoveEntry?: (path: string, folder: string, placement?: EntryPlacement) => void;
  onMoveEntries?: (paths: string[], folder: string) => void;
  onExpandFolder?: (id: string) => void;
  onEntryMenu?: (entry: VaultTreeEntry, position: { x: number; y: number }) => void;
}

const DRAG_EXPAND_DELAY_MS = 650;
const DRAG_SCROLL_ZONE_PX = 28;
const DRAG_SCROLL_STEP_PX = 9;

type DropHandlers = Pick<HTMLAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>;

interface DragSource { path: string; kind: VaultEntryKind }

interface ActiveDrag {
  sources: DragSource[];
  primary: DragSource;
  group: boolean;
}

interface RowActions {
  beginDrag: (entry: VaultTreeEntry) => (event: DragEvent<HTMLButtonElement>) => void;
  endDrag: () => void;
  dropHandlers: (entry: VaultTreeEntry) => DropHandlers;
  menu: (entry: VaultTreeEntry) => ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
  open: (entry: VaultTreeEntry, event: MouseEvent<HTMLButtonElement>) => void;
  replace: (entry: VaultTreeEntry) => void;
}

function rowIcon(entry: VaultTreeEntry, expanded: boolean) {
  if (entry.kind === 'folder') return expanded ? 'openFolder' : 'folder';
  return entry.kind === 'canvas' ? 'canvas' : 'document';
}

function createDragImage(entry: VaultTreeEntry, count: number): HTMLElement {
  const root = document.createElement('div');
  root.className = 'vault-drag-preview';
  const layers = Math.min(count, 3);
  for (let index = layers - 1; index >= 0; index -= 1) {
    const card = document.createElement('div');
    card.className = 'vault-drag-preview__card';
    card.style.setProperty('--vault-drag-layer', String(index));
    if (index === 0) {
      card.innerHTML = `<span class="vault-drag-preview__icon"></span><span class="vault-drag-preview__name"></span>`;
      card.querySelector('.vault-drag-preview__name')!.textContent = entry.name;
    }
    root.appendChild(card);
  }
  if (count > 1) {
    const badge = document.createElement('span');
    badge.className = 'vault-drag-preview__badge';
    badge.textContent = String(count);
    root.appendChild(badge);
  }
  document.body.appendChild(root);
  return root;
}

const VaultTreeRow = memo(function VaultTreeRow({ entry, expanded, active, multiSelected, dragging, dropping, insertion, disabled, draggable, actions }: {
  entry: VaultTreeEntry; expanded: boolean; active: boolean; multiSelected: boolean; dragging: boolean; dropping: boolean;
  insertion?: 'before' | 'after'; disabled: boolean; draggable: boolean; actions: RowActions;
}) {
  const isFolder = entry.kind === 'folder';
  const icon = rowIcon(entry, expanded);
  return <button
    className={`vault-tree__row${active ? ' vault-tree__row--active' : ''}${multiSelected ? ' vault-tree__row--multi-selected' : ''}${dragging ? ' vault-tree__row--dragging' : ''}${dropping ? ' vault-tree__row--drop' : ''}${insertion ? ` vault-tree__row--insert-${insertion}` : ''}`}
    title={entry.error ?? entry.name} disabled={disabled} role="treeitem" aria-current={active ? 'page' : undefined}
    aria-expanded={isFolder ? expanded : undefined} data-path={entry.id} data-resource-id={entry.resourceId} draggable={draggable}
    onDragStart={(event) => actions.beginDrag(entry)(event)} onDragEnd={() => actions.endDrag()}
    onClick={(event) => actions.open(entry, event)} onDoubleClick={() => actions.replace(entry)} onContextMenu={(event) => actions.menu(entry)?.(event)}
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
  const [dragging, setDragging] = useState<ActiveDrag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<EntryPlacement | null>(null);
  const treeRef = useRef<HTMLElement>(null);
  const dragPreview = useRef<HTMLElement | null>(null);
  const pointerY = useRef(0);
  const expandTimer = useRef<{ id: string; timer: number } | null>(null);
  const scrollTimer = useRef<number | null>(null);
  const { onMoveEntry, onMoveEntries } = props;

  function clearExpandTimer() {
    if (expandTimer.current) {
      window.clearTimeout(expandTimer.current.timer);
      expandTimer.current = null;
    }
  }

  function clearDragPreview() {
    dragPreview.current?.remove();
    dragPreview.current = null;
  }

  function endDrag() {
    setInsertion(null);
    setDragging(null);
    setDropTarget(null);
    clearExpandTimer();
    clearDragPreview();
    if (scrollTimer.current !== null) {
      window.clearInterval(scrollTimer.current);
      scrollTimer.current = null;
    }
  }

  useEffect(() => () => endDrag(), []);

  function acceptsDrop(folder: string): boolean {
    if (!dragging) return false;
    return dragging.group ? canDropGroup(dragging.sources, folder) : canDropInto(dragging.primary, folder);
  }

  function beginDrag(entry: VaultTreeEntry) {
    return (event: DragEvent<HTMLButtonElement>) => {
      const prepared = props.onPrepareDrag?.(entry) ?? { sources: [{ path: entry.id, kind: entry.kind }], group: false };
      const sources = [...prepared.sources];
      const group = prepared.group;
      const primary = sources.find((source) => source.path === entry.id) ?? sources[0]!;
      event.dataTransfer.setData('text/plain', primary.path);
      event.dataTransfer.effectAllowed = 'move';
      clearDragPreview();
      const preview = createDragImage(entry, sources.length);
      dragPreview.current = preview;
      event.dataTransfer.setDragImage(preview, 16, 16);
      setDragging({ sources, primary, group });
      scrollTimer.current ??= window.setInterval(() => {
        const tree = treeRef.current;
        if (!tree) return;
        const rect = tree.getBoundingClientRect();
        if (pointerY.current < rect.top + DRAG_SCROLL_ZONE_PX) tree.scrollTop -= DRAG_SCROLL_STEP_PX;
        else if (pointerY.current > rect.bottom - DRAG_SCROLL_ZONE_PX) tree.scrollTop += DRAG_SCROLL_STEP_PX;
      }, 40);
    };
  }

  function dropHandlers(folder: string, expandable: boolean): DropHandlers {
    if ((!onMoveEntry && !onMoveEntries) || props.disabled) return {};
    return {
      onDragEnter: (event) => {
        event.stopPropagation();
        setInsertion(null);
        if (!dragging || !acceptsDrop(folder)) return;
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
        if (!dragging || !acceptsDrop(folder)) return;
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
        if (!dragging || !acceptsDrop(folder)) return;
        event.preventDefault();
        const active = dragging;
        endDrag();
        if (active.group) onMoveEntries?.(active.sources.map((source) => source.path), folder);
        else onMoveEntry?.(active.primary.path, folder);
      },
    };
  }

  function rowDropHandlers(entry: VaultTreeEntry): DropHandlers {
    const folderHandlers = entry.kind === 'folder' ? dropHandlers(entry.id, true) : {};
    function placementAt(event: DragEvent<HTMLElement>): EntryPlacement | null {
      if (dragging?.group || !dragging || props.disabled || entry.unavailable || !onMoveEntry || dragging.primary.path === entry.id
        || parentFolderOf(dragging.primary.path) !== parentFolderOf(entry.id)
        || (dragging.primary.kind === 'folder') !== (entry.kind === 'folder')) return null;
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
        if (!dragging || entry.kind !== 'folder' || !acceptsDrop(entry.id)) setDropTarget(null);
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
          const source = dragging.primary.path;
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

  const latest = useRef<RowActions>(null);
  useLayoutEffect(() => {
    latest.current = {
      beginDrag, endDrag, dropHandlers: rowDropHandlers, menu: entryMenuHandler,
      open: (entry, event) => {
        if (props.onSelectEntry) props.onSelectEntry(entry, event);
        if (isModifierSelection(event) || event.detail >= 2) return;
        if (entry.kind === 'folder') props.onToggleFolder(entry.id);
        else props.onOpen(entry.id, event.detail);
      },
      replace: (entry) => { if (entry.kind !== 'folder') props.onReplace?.(entry.id); },
    };
  });
  const actions = useMemo<RowActions>(() => ({
    beginDrag: (entry) => (event) => latest.current?.beginDrag(entry)(event),
    endDrag: () => latest.current?.endDrag(),
    dropHandlers: (entry) => latest.current?.dropHandlers(entry) ?? {},
    menu: (entry) => latest.current?.menu(entry),
    open: (entry, event) => latest.current?.open(entry, event),
    replace: (entry) => latest.current?.replace(entry),
  }), []);
  const identity = useMemo(() => <>
    <SidebarIcon kind="folder" />
    <span className="vault-sidebar__title">{props.name}</span>
  </>, [props.name]);

  const dragPaths = dragging ? new Set(dragging.sources.map((source) => source.path)) : null;
  const rootDroppable = dragging !== null && acceptsDrop('');
  const rootClass = `vault-root${rootDroppable ? ' vault-root--droppable' : ''}${dropTarget === '' ? ' vault-root--drop' : ''}`;
  const multiSelected = props.multiSelectedIds;

  function renderEntries(entries: readonly VaultTreeEntry[]) {
    return entries.map((entry) => {
      const expanded = props.expandedIds.has(entry.id);
      const isFolder = entry.kind === 'folder';
      const active = !isFolder && props.selectedId === entry.id;
      const selected = !!multiSelected?.has(entry.id);
      const dropping = dropTarget === entry.id;
      const draggable = (onMoveEntry !== undefined || onMoveEntries !== undefined) && !entry.unavailable
        && !(isFolder && isRootUnfiledPath(entry.id));
      return (
        <li key={entry.resourceId ? `${entry.kind}:${entry.resourceId}` : entry.id}>
          <VaultTreeRow entry={entry} expanded={expanded} active={active} multiSelected={selected}
            dragging={!!dragPaths?.has(entry.id)} dropping={dropping}
            insertion={!dragging?.group && insertion?.anchor === entry.id ? insertion.side : undefined}
            disabled={!!entry.unavailable} draggable={draggable}
            actions={actions} />
          {isFolder && expanded && entry.children && <ul role="group">{renderEntries(entry.children)}</ul>}
        </li>
      );
    });
  }

  return (
    <section className={`vault-sidebar${props.compact ? ' vault-sidebar--picker' : ''}`} aria-label="Vault files">
      {!props.compact && <div className="vault-sidebar__heading">{props.onSelectRoot
        ? <button className={rootClass} disabled={props.disabled} onClick={() => { props.onClearSelection?.(); props.onSelectRoot?.(); }} title={`${props.name} /`} {...dropHandlers('', false)}>{identity}</button>
        : <span className={rootClass} title={props.name} {...dropHandlers('', false)}>{identity}</span>}</div>}
      <VaultSidebarActions disabled={props.disabled} onCreateDocument={props.onCreateDocument}
        onCreateCanvas={props.onCreateCanvas} onCreateFolder={props.onCreateFolder} onRefresh={props.onRefresh} />
      <div className="vault-sidebar__section" aria-hidden="true">Files</div>
      <nav aria-label="Documents and canvases" inert={props.disabled} aria-busy={props.disabled}
        tabIndex={props.compact ? undefined : -1}
        onClick={(event) => { if (event.target === event.currentTarget) props.onClearSelection?.(); }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onClearSelection?.();
          }
        }}>
        <div ref={treeRef} role="tree" className={`vault-tree${dropTarget === '' ? ' vault-tree--drop-root' : ''}`}
          onDragOverCapture={(event) => { pointerY.current = event.clientY; }}
          {...dropHandlers('', false)}>
          {props.entries.length ? <ul role="group">{renderEntries(props.entries)}</ul> : <p className="vault-sidebar__empty">No files</p>}
        </div>
      </nav>
    </section>
  );
});
