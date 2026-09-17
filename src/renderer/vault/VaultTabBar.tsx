import { FileText, PanelsTopLeft, Plus, X } from 'lucide-react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import type { WorkspaceTab } from '../stores/workspace-tabs';
import { VaultSidebar, type VaultTreeEntry } from '../vault-ui/VaultSidebar';

import { useTabDrag } from './useTabDrag';

type Workspace = ReturnType<typeof createVaultWorkspace>;

const VaultTabItem = memo(function VaultTabItem({ tab, selected, index, onActivate, onClose, onKeyDown, onPointerDown }: {
  tab: WorkspaceTab; selected: boolean; index: number;
  onActivate: (id: string) => void; onClose: (id: string) => void;
  onKeyDown: (event: KeyboardEvent, index: number) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>, id: string) => void;
}) {
  const Icon = tab.kind === 'canvas' ? PanelsTopLeft : FileText;
  return <div className={`vault-tab${selected ? ' vault-tab--active' : ''}`}>
    <button role="tab" id={`tab-${tab.id}`} aria-controls={`pane-${tab.id}`} aria-selected={selected}
      tabIndex={selected ? 0 : -1} title={tab.path} data-file-id={tab.fileId}
      onPointerDown={(event) => onPointerDown(event, tab.id)}
      onDragStart={(event) => event.preventDefault()}
      onKeyDown={(event) => onKeyDown(event, index)}
      onClick={() => onActivate(tab.id)}>
      <Icon size={15} aria-hidden="true" /><span>{tab.title}</span>
    </button>
    <button className="vault-tab__close" aria-label={`Close ${tab.title}`} title={`Close ${tab.title}`}
      onClick={() => onClose(tab.id)}><X size={14} /></button>
  </div>;
});

function VaultTabAdd({ store, isOpen, trigger }: {
  store: Workspace; isOpen: boolean; trigger: RefObject<HTMLButtonElement | null>;
}) {
  const { hasVault, busy } = useStore(store, useShallow((state) => ({ hasVault: !!state.vault, busy: state.busy })));
  return <button ref={trigger} className="vault-tabs__add" aria-label="Open a file or create a tab" title="Open a file or create a tab"
    disabled={!hasVault || busy} popoverTarget="vault-tab-picker" aria-expanded={isOpen} aria-haspopup="dialog"><Plus size={14} /></button>;
}

function VaultTabLock({ store, listRef, children }: { store: Workspace; listRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const busy = useStore(store, (state) => state.busy);
  return <div className="vault-tabs__list" role="tablist" aria-label="Open files" ref={listRef} inert={busy}>{children}</div>;
}

export const VaultTabBar = memo(function VaultTabBar({ store, entries, onOpen, onCreateDocument, onCreateCanvas }: {
  store: Workspace;
  entries: readonly VaultTreeEntry[];
  onOpen: (path: string) => void;
  onCreateDocument: () => void;
  onCreateCanvas: () => void;
}) {
  const { tabs, activeTabId, vaultSession, vaultName } = useStore(store, useShallow((state) => ({
    tabs: state.tabs, activeTabId: state.activeTabId,
    vaultSession: state.vault?.sessionId ?? '', vaultName: state.vault?.name,
  })));
  const onPointerDown = useTabDrag(store);
  const list = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [isOpen, setOpen] = useState(false);
  const [expansion, setExpansion] = useState<{ session: string; ids: ReadonlySet<string> }>({ session: '', ids: new Set() });
  const expanded = expansion.session === vaultSession ? expansion.ids : new Set<string>();

  useLayoutEffect(() => {
    if (list.current?.querySelector('[data-tab-dragging]')) return;
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);
  useEffect(() => { picker.current?.hidePopover(); }, [vaultSession]);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect || !picker.current) return;
      picker.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
      picker.current.style.top = `${rect.bottom + 8}px`;
    };
    position();
    picker.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    window.addEventListener('resize', position);
    return () => window.removeEventListener('resize', position);
  }, [isOpen]);

  const dismiss = useCallback(() => { picker.current?.hidePopover(); trigger.current?.focus(); }, []);
  const onActivate = useCallback((id: string) => { void store.getState().activateTab(id); }, [store]);
  const onClose = useCallback((id: string) => {
    void store.getState().closeTab(id).then(() => {
      list.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      if (!store.getState().tabs.length) trigger.current?.focus();
    });
  }, [store]);
  const onKeyDown = useCallback((event: KeyboardEvent, index: number) => {
    const current = tabsRef.current;
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % current.length;
    else if (event.key === 'ArrowLeft') target = (index + current.length - 1) % current.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = current.length - 1;
    else if (event.key === 'Delete') { event.preventDefault(); onClose(current[index]!.id); return; }
    else return;
    event.preventDefault();
    if (event.altKey && event.shiftKey) {
      store.getState().reorderTab(current[index]!.id, target);
      return;
    }
    void store.getState().activateTab(current[target]!.id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  }, [onClose, store]);
  function pickerKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.findIndex((button) => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next]?.focus();
    event.preventDefault();
  }
  return <div className="vault-tabs">
    <VaultTabLock store={store} listRef={list}>
      {tabs.map((tab, index) => <VaultTabItem key={tab.id} tab={tab} selected={activeTabId === tab.id} index={index}
        onActivate={onActivate} onClose={onClose} onKeyDown={onKeyDown} onPointerDown={onPointerDown} />)}
    </VaultTabLock>
    <VaultTabAdd store={store} isOpen={isOpen} trigger={trigger} />
    <div ref={picker} id="vault-tab-picker" className="vault-tab-picker" popover="auto" role="dialog" aria-label="Open a file"
      onToggle={(event) => setOpen(event.newState === 'open')} onKeyDown={pickerKeys}>
      {vaultName && isOpen && <VaultTabPicker store={store} name={vaultName} entries={entries} expanded={expanded}
        selectedId={tabs.find((tab) => tab.id === activeTabId)?.path}
        onToggleFolder={(path) => { const ids = new Set(expanded); if (ids.has(path)) ids.delete(path); else ids.add(path); setExpansion({ session: vaultSession, ids }); }}
        onOpen={(path) => { onOpen(path); dismiss(); }}
        onCreateDocument={() => { onCreateDocument(); dismiss(); }}
        onCreateCanvas={() => { onCreateCanvas(); dismiss(); }} />}
    </div>
  </div>;
});

function VaultTabPicker({ store, name, entries, expanded, selectedId, onToggleFolder, onOpen, onCreateDocument, onCreateCanvas }: {
  store: Workspace; name: string; entries: readonly VaultTreeEntry[]; expanded: ReadonlySet<string>;
  selectedId?: string; onToggleFolder: (path: string) => void; onOpen: (path: string) => void;
  onCreateDocument: () => void; onCreateCanvas: () => void;
}) {
  const busy = useStore(store, (state) => state.busy);
  return <VaultSidebar compact name={name} entries={entries} expandedIds={expanded}
    selectedId={selectedId} disabled={busy}
    onToggleFolder={onToggleFolder} onOpen={onOpen} onCreateDocument={onCreateDocument} onCreateCanvas={onCreateCanvas} />;
}
