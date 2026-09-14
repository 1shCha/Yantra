import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Folder, X, type LucideIcon } from 'lucide-react';
import { operationFailure, type OperationResult } from '../../shared/operation-result';
import { titleNameError } from '../../shared/document-title';
import {
  canDropInto,
  nameValidationError,
  friendlyOperationError,
  parentFolderOf,
  type FolderOption,
  type VaultEntryKind,
} from './vault-organize-helpers';

function VaultModal({ title, pending, onDismiss, children, className = '' }: {
  title: string;
  pending: boolean;
  onDismiss: () => void;
  children: ReactNode;
  className?: string;
}) {
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
  return <dialog ref={ref} className={`vault-dialog ${className}`} aria-labelledby="vault-dialog-title" aria-busy={pending}
    onCancel={(event) => { event.preventDefault(); if (!pending) onDismiss(); }}>
    <div className="vault-dialog__heading">
      <h2 id="vault-dialog-title">{title}</h2>
      <button type="button" aria-label="Close dialog" title="Close" disabled={pending} onClick={onDismiss}><X size={17} /></button>
    </div>
    {children}
  </dialog>;
}

/** Names or renames an item. The extension is display-only and never part of the editable text. */
export function VaultNameDialog({ title, submitLabel, initialName, extension, location, busy, onSubmit, onDismiss }: {
  title: string;
  submitLabel: string;
  initialName: string;
  extension: string;
  location: string;
  busy: boolean;
  onSubmit: (name: string) => Promise<OperationResult>;
  onDismiss: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.select(); }, []);
  const isDocumentTitle = extension === '.yantraD';
  const validationError = isDocumentTitle ? titleNameError(name) : nameValidationError(name);
  const error = (name === '' ? null : validationError) ?? operationError;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (validationError !== null || pending || busy) return;
    setPending(true);
    setOperationError(null);
    try {
      const result = await onSubmit(name);
      if (result.status === 'failure' || result.status === 'recovery-required') setOperationError(friendlyOperationError(result.error));
      if (result.status !== 'success') setPending(false);
    } catch (failure) {
      setOperationError(friendlyOperationError(operationFailure(failure)));
      setPending(false);
    }
  }

  return <VaultModal title={title} pending={pending} onDismiss={onDismiss}>
    <form onSubmit={(event) => { void submit(event); }}>
      <label className="vault-dialog__label" htmlFor="vault-item-name">{isDocumentTitle ? 'Title' : 'Name'}</label>
      <input id="vault-item-name" ref={inputRef} value={name} autoFocus disabled={pending}
        onChange={(event) => { setName(event.target.value); setOperationError(null); }}
        aria-invalid={error !== null} aria-describedby={error !== null ? 'vault-name-error' : 'vault-name-hint'} />
      {error !== null
        ? <p id="vault-name-error" className="vault-dialog__error" role="alert">{error}</p>
        : <p id="vault-name-hint" className="vault-dialog__hint">{location} / {(isDocumentTitle ? name.replaceAll(' ', '_') : name) || '…'}{extension}</p>}
      <div className="vault-dialog__footer">
        <button type="button" className="vault-dialog__button" disabled={pending} onClick={onDismiss}>Cancel</button>
        <button type="submit" className="vault-dialog__button vault-dialog__button--primary"
          disabled={validationError !== null || pending || busy}>{pending ? 'Working…' : submitLabel}</button>
      </div>
    </form>
  </VaultModal>;
}

/** Moves an item into a chosen folder; the vault root is always listed as a destination. */
export function VaultMoveDialog({ title, vaultName, folders, source, busy, onSubmit, onDismiss }: {
  title: string;
  vaultName: string;
  folders: readonly FolderOption[];
  source: { path: string; kind: VaultEntryKind };
  busy: boolean;
  onSubmit: (folder: string) => Promise<OperationResult>;
  onDismiss: () => void;
}) {
  const parent = parentFolderOf(source.path);
  const options: FolderOption[] = [{ path: '', name: vaultName, depth: 0 }, ...folders.map((folder) => ({ ...folder, depth: folder.depth + 1 }))];
  const [destination, setDestination] = useState<string | null>(
    () => options.find((option) => canDropInto(source, option.path))?.path ?? null,
  );
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const movable = destination !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (destination === null || pending || busy) return;
    setPending(true);
    setOperationError(null);
    try {
      const result = await onSubmit(destination);
      if (result.status === 'failure' || result.status === 'recovery-required') setOperationError(friendlyOperationError(result.error));
      if (result.status !== 'success') setPending(false);
    } catch (failure) {
      setOperationError(friendlyOperationError(operationFailure(failure)));
      setPending(false);
    }
  }

  return <VaultModal title={title} pending={pending} onDismiss={onDismiss}>
    <form onSubmit={(event) => { void submit(event); }}>
      <p>Choose a destination folder.</p>
      <fieldset className="vault-destination-list" disabled={pending}><legend>Destination</legend>
        {options.map((option) => {
          const valid = canDropInto(source, option.path);
          return <label key={option.path || '/'} style={{ paddingLeft: 4 + option.depth * 14 }} title={option.path || `${vaultName} (vault root)`}>
            <input type="radio" name="vault-move-destination" value={option.path} checked={destination === option.path}
              disabled={!valid} autoFocus={destination === option.path} onChange={() => setDestination(option.path)} />
            <Folder size={15} /><span>{option.name}</span>
            {option.path === parent && <small>Current</small>}
            {source.kind === 'folder' && option.path === source.path && <small>This folder</small>}
          </label>;
        })}
      </fieldset>
      {operationError !== null && <p className="vault-dialog__error" role="alert">{operationError}</p>}
      {!movable && <p className="vault-dialog__hint">There is no other folder to move this into.</p>}
      <div className="vault-dialog__footer">
        <button type="button" className="vault-dialog__button" disabled={pending} onClick={onDismiss}>Cancel</button>
        <button type="submit" className="vault-dialog__button vault-dialog__button--primary"
          disabled={!movable || pending || busy}>{pending ? 'Working…' : 'Move'}</button>
      </div>
    </form>
  </VaultModal>;
}

/** Confirms moving an entry to the system Trash and keeps operation failures visible. */
export function VaultDeleteDialog({ name, kind, busy, recovering = false, onSubmit, onRecover, onDismiss }: {
  name: string;
  kind: VaultEntryKind;
  busy: boolean;
  onSubmit: () => Promise<OperationResult>;
  onRecover: () => Promise<OperationResult>;
  recovering?: boolean;
  onDismiss: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [needsRecovery, setNeedsRecovery] = useState(recovering);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || busy) return;
    setPending(true);
    setOperationError(null);
    try {
      const result = await (needsRecovery ? onRecover() : onSubmit());
      if (result.status === 'failure' || result.status === 'recovery-required') {
        setOperationError(friendlyOperationError(result.error));
        if (result.status === 'recovery-required') setNeedsRecovery(true);
      }
      if (result.status !== 'success') setPending(false);
    } catch (failure) {
      setOperationError(friendlyOperationError(operationFailure(failure)));
      setPending(false);
    }
  }

  return <VaultModal title="Move to Trash?" className="vault-dialog--trash" pending={pending} onDismiss={onDismiss}>
    <form onSubmit={(event) => { void submit(event); }}>
      <p className="vault-delete-name">{name}</p>
      <p className="vault-dialog__hint">{kind === 'document'
        ? 'This document will move to Trash, and its appearances will be removed from canvases.'
        : kind === 'canvas' ? 'This canvas will move to Trash. Its documents will stay in the vault.'
          : 'This folder and all its contents will move to Trash. Documents inside it will also be removed from canvases outside the folder.'}</p>
      {operationError !== null && <p className="vault-dialog__error" role="alert">{operationError}</p>}
      <div className="vault-dialog__footer">
        <button type="button" className="vault-dialog__button" autoFocus disabled={pending} onClick={onDismiss}>Cancel</button>
        <button type="submit" className="vault-dialog__button" disabled={pending || busy}>
          {pending ? 'Working…' : needsRecovery ? 'Retry deletion' : 'Move to Trash'}
        </button>
      </div>
    </form>
  </VaultModal>;
}

export interface VaultMenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** In-app context menu anchored at a viewport position, clamped to stay on screen. */
export function VaultContextMenu({ label, items, position, onDismiss }: {
  label: string;
  items: readonly VaultMenuItem[];
  position: { x: number; y: number };
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState(position);
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPlacement({
      x: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)),
    });
  }, [position]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) onDismiss();
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onDismiss]);
  return <div ref={ref} className="vault-action-menu" role="menu" aria-label={label}
    style={{ position: 'fixed', left: placement.x, top: placement.y, zIndex: 30 }}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (event.key === 'Escape' || event.key === 'Tab') { onDismiss(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
      const current = buttons.findIndex((button) => button === document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }}>
    {items.map(({ label: itemLabel, icon: Icon, onSelect, disabled, danger }) => <button key={itemLabel} role="menuitem" tabIndex={-1}
      disabled={disabled} data-danger={danger || undefined} onClick={() => { onDismiss(); onSelect(); }}><Icon size={15} />{itemLabel}</button>)}
  </div>;
}
