import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nameValidationError } from '../vault/vault-organize-helpers';
import { AlertCircle, FileQuestion, Folder, FolderOpen, LoaderCircle, X, FilePlus2, PanelsTopLeft, FolderPlus, Pencil, FolderInput, Trash2, LocateFixed, ExternalLink, Unlink } from 'lucide-react';

export const overlayStates = [
  'Menu - vault', 'Menu - document', 'Menu - canvas', 'Menu - folder', 'Menu - node',
  'Create Document', 'Create Canvas', 'Create Folder', 'Rename', 'Rename - invalid name', 'Rename - name collision',
  'Move', 'Delete Document', 'Delete Canvas', 'Delete Folder - not empty',
] as const;

export const fileStates = ['Loading', 'File unavailable', 'Unsupported format'] as const;

export function FileStatePreview({ state, onRetry }: { state: string; onRetry?: () => void }) {
  const loading = state === 'Loading';
  const Icon = loading ? LoaderCircle : state === 'File unavailable' ? FileQuestion : AlertCircle;
  return <section className="vault-file-state" role={loading ? 'status' : undefined}>
    <Icon size={28} className={loading ? 'vault-spin' : undefined} />
    <h1>{loading ? 'Opening Reading_notes' : state}</h1>
    {!loading && <p>{state === 'File unavailable' ? 'Reading_notes.yantraD could not be opened. The file may have been moved or removed.' : 'This document uses a newer format. Update Yantra to open it. Your file has not been changed.'}</p>}
    {state === 'File unavailable' && <button className="vault-dialog__button" onClick={onRetry}>Try Again</button>}
  </section>;
}

function PreviewDialog({ title, children, onDismiss }: { title: string; children: ReactNode; onDismiss: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  return <dialog ref={ref} className="vault-dialog" aria-labelledby="vault-dialog-title" onCancel={(event) => { event.preventDefault(); onDismiss(); }}>
    <div className="vault-dialog__heading"><h2 id="vault-dialog-title">{title}</h2><button aria-label="Close dialog" title="Close" onClick={onDismiss}><X size={17} /></button></div>
    {children}
  </dialog>;
}

const menuActions = {
  'Menu - vault': [{ label: 'Create Vault', icon: FolderPlus }, { label: 'Open Vault', icon: FolderOpen }],
  'Menu - document': [{ label: 'Rename', icon: Pencil }, { label: 'Move', icon: FolderInput }, { label: 'Reveal on Canvas', icon: LocateFixed }, { label: 'Delete Document', icon: Trash2 }],
  'Menu - canvas': [{ label: 'Rename', icon: Pencil }, { label: 'Move', icon: FolderInput }, { label: 'Delete Canvas', icon: Trash2 }],
  'Menu - folder': [{ label: 'New Document', icon: FilePlus2 }, { label: 'New Canvas', icon: PanelsTopLeft }, { label: 'New Folder', icon: FolderPlus }, { label: 'Rename', icon: Pencil }, { label: 'Move', icon: FolderInput }, { label: 'Delete Folder', icon: Trash2 }],
  'Menu - node': [{ label: 'Open Document', icon: ExternalLink }, { label: 'Remove from Canvas', icon: Unlink }],
};

function ActionMenu({ state, onDismiss }: { state: keyof typeof menuActions; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onDismiss();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onDismiss]);
  return <div ref={ref} className="vault-action-menu" role="menu" aria-label={state.replace('Menu - ', '') + ' actions'} onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { onDismiss(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const current = buttons.findIndex((button) => button === document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  }}>
    {menuActions[state].map(({ label, icon: Icon }) => <button role="menuitem" tabIndex={-1} key={label} onClick={onDismiss} data-danger={label.startsWith('Delete')}><Icon size={15} />{label}</button>)}
  </div>;
}

function NameDialog({ state, onDismiss }: { state: string; onDismiss: () => void }) {
  const create = state.startsWith('Create');
  const title = create ? state : 'Rename Document';
  const [name, setName] = useState(state === 'Rename - invalid name' ? 'Research/notes' : state === 'Rename - name collision' ? 'Overview' : create ? 'Untitled' : 'Reading_notes');
  const extension = state === 'Create Folder' ? '' : state === 'Create Canvas' ? '.yantraC' : '.yantraD';
  const error = nameValidationError(name) ?? (state === 'Rename - name collision' && name === 'Overview' ? 'An item with this name already exists in Research.' : null);
  return <PreviewDialog title={title} onDismiss={onDismiss}>
    <form onSubmit={(event) => { event.preventDefault(); if (!error) onDismiss(); }}>
      <label className="vault-dialog__label" htmlFor="vault-item-name">Name</label>
      <input id="vault-item-name" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={!!error} aria-describedby={error ? 'vault-name-error' : 'vault-name-hint'} />
      {error ? <p id="vault-name-error" className="vault-dialog__error" role="alert">{error}</p> : <p id="vault-name-hint" className="vault-dialog__hint">Research / {name}{extension}</p>}
      <div className="vault-dialog__footer"><button type="button" className="vault-dialog__button" onClick={onDismiss}>Cancel</button><button className="vault-dialog__button vault-dialog__button--primary" disabled={!!error}>{create ? 'Create' : 'Rename'}</button></div>
    </form>
  </PreviewDialog>;
}

function MoveDialog({ onDismiss }: { onDismiss: () => void }) {
  const [destination, setDestination] = useState('My vault');
  return <PreviewDialog title="Move Reading_notes" onDismiss={onDismiss}>
    <p>Choose a destination folder.</p>
    <fieldset className="vault-destination-list"><legend>Destination</legend>
      {['My vault', 'Research', 'Research / Systems', 'Projects', 'Unfiled'].map((folder) => <label key={folder} title={folder === 'Research' ? 'Current folder' : folder}>
        <input type="radio" name="destination" value={folder} checked={destination === folder} disabled={folder === 'Research'} onChange={() => setDestination(folder)} />
        <Folder size={15} /><span>{folder}</span>{folder === 'Research' && <small>Current</small>}
      </label>)}
    </fieldset>
    <div className="vault-dialog__footer"><button className="vault-dialog__button" onClick={onDismiss}>Cancel</button><button className="vault-dialog__button vault-dialog__button--primary" onClick={onDismiss}>Move</button></div>
  </PreviewDialog>;
}

function isMenuState(state: string): state is keyof typeof menuActions {
  return Object.hasOwn(menuActions, state);
}

export function VaultOverlayPreview({ state, onDismiss }: { state: string; onDismiss: () => void }) {
  if (isMenuState(state)) return <ActionMenu state={state} onDismiss={onDismiss} />;
  if (state.startsWith('Create') || state.startsWith('Rename')) return <NameDialog state={state} onDismiss={onDismiss} />;
  if (state === 'Move') return <MoveDialog onDismiss={onDismiss} />;
  const folder = state === 'Delete Folder - not empty';
  const doc = state === 'Delete Document';
  return <PreviewDialog title={folder ? 'Folder is not empty' : doc ? 'Delete Reading_notes?' : 'Delete Overview?'} onDismiss={onDismiss}>
    <p>{folder ? 'Research contains files. Move or delete its contents before deleting this folder.' : doc ? 'Reading_notes.yantraD will move to system Trash. Its node and connected edges will be removed from Overview.' : 'Overview.yantraC will move to system Trash. Its documents will remain in your vault.'}</p>
    {!folder && <p className="vault-dialog__hint">{doc ? 'The file can be recovered from system Trash. Canvas placement is not restored automatically.' : 'The canvas file can be recovered from system Trash.'}</p>}
    <div className="vault-dialog__footer"><button className="vault-dialog__button" onClick={onDismiss}>{folder ? 'Close' : 'Cancel'}</button>{!folder && <button className="vault-dialog__button vault-dialog__button--danger" onClick={onDismiss}>Move to Trash</button>}</div>
  </PreviewDialog>;
}
