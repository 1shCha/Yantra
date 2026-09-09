import { ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, PanelsTopLeft, Plus, RefreshCw } from 'lucide-react';

export interface VaultTreeEntry {
  id: string;
  name: string;
  kind: 'folder' | 'document' | 'canvas';
  children?: readonly VaultTreeEntry[];
}

interface VaultSidebarProps {
  name: string;
  entries: readonly VaultTreeEntry[];
  expandedIds: ReadonlySet<string>;
  selectedId?: string;
  onOpen: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onCreateDocument: () => void;
  onCreateCanvas: () => void;
  onCreateFolder: () => void;
  onRefresh: () => void;
}

export function VaultSidebar(props: VaultSidebarProps) {
  function renderEntries(entries: readonly VaultTreeEntry[], depth = 0) {
    return entries.map((entry) => {
      const expanded = props.expandedIds.has(entry.id);
      const isFolder = entry.kind === 'folder';
      const Icon = isFolder ? (expanded ? FolderOpen : Folder) : entry.kind === 'canvas' ? PanelsTopLeft : FileText;
      return (
        <li key={entry.id}>
          <button
            className={`vault-tree__row${props.selectedId === entry.id ? ' vault-tree__row--selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 12 }}
            title={entry.name}
            aria-current={props.selectedId === entry.id ? 'page' : undefined}
            aria-expanded={isFolder ? expanded : undefined}
            onClick={() => isFolder ? props.onToggleFolder(entry.id) : props.onOpen(entry.id)}
          >
            {isFolder ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="vault-tree__spacer" />}
            <Icon size={14} />
            <span className="vault-tree__name">{entry.name}</span>
          </button>
          {isFolder && expanded && entry.children && <ul>{renderEntries(entry.children, depth + 1)}</ul>}
        </li>
      );
    });
  }

  return (
    <section className="vault-sidebar" aria-label="Vault files">
      <div className="vault-sidebar__heading"><span title={props.name}>{props.name}</span></div>
      <div className="vault-sidebar__actions" role="toolbar" aria-label="Vault actions">
        <button title="New Document" aria-label="New Document" onClick={props.onCreateDocument}><FilePlus2 size={15} /></button>
        <button title="New Canvas" aria-label="New Canvas" onClick={props.onCreateCanvas}><PanelsTopLeft size={15} /><Plus className="vault-sidebar__plus" size={8} /></button>
        <button title="New Folder" aria-label="New Folder" onClick={props.onCreateFolder}><FolderPlus size={15} /></button>
        <button title="Refresh Vault" aria-label="Refresh Vault" onClick={props.onRefresh}><RefreshCw size={14} /></button>
      </div>
      <nav className="vault-tree" aria-label="Documents and canvases">
        {props.entries.length ? <ul>{renderEntries(props.entries)}</ul> : <p className="vault-sidebar__empty">No files</p>}
      </nav>
    </section>
  );
}
