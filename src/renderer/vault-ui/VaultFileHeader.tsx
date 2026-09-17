import type { OperationResult } from '../../shared/operation-result';
import { VaultHeaderName } from './VaultHeaderName';
import type { ReactNode } from 'react';
import { Check, Circle, LoaderCircle, AlertCircle, RotateCw, LocateFixed, PanelsTopLeft, FileText } from 'lucide-react';

export type VaultSaveState = 'Unsaved' | 'Saving' | 'Saved' | 'Failed';

export function VaultFileHeader({ title, kind, children, canReveal = false, saveState = 'Saved', onRetry, onRename, editName = title, validateName, showReveal = true, busy = false }: {
  title: string;
  folder?: string;
  children?: ReactNode;
  kind: 'document' | 'canvas';
  canReveal?: boolean;
  saveState?: VaultSaveState;
  onRetry?: () => void;
  onRename?: (name: string) => Promise<OperationResult>;
  editName?: string;
  validateName?: (name: string) => string | null;
  showReveal?: boolean;
  busy?: boolean;
}) {
  const Icon = kind === 'canvas' ? PanelsTopLeft : FileText;
  const StatusIcon = { Unsaved: Circle, Saving: LoaderCircle, Saved: Check, Failed: AlertCircle }[saveState];
  return (
    <header className="vault-file-header">
      <Icon size={17} aria-hidden="true" />
      <div className="vault-file-header__identity">
        {onRename && validateName ? <VaultHeaderName title={title} editName={editName} kind={kind} busy={busy} onRename={onRename} validateName={validateName} /> : <h1 title={title}>{title}</h1>}
      </div>
      <span className="vault-file-header__saved" role="status" aria-label={saveState} title={saveState} data-state={saveState}><StatusIcon size={13} /><span>{saveState}</span></span>
      {saveState === 'Failed' && <button disabled={busy} className="vault-file-header__action" aria-label="Retry save" title="Retry save" onClick={onRetry}><RotateCw size={15} /></button>}
      {children}
      {kind === 'document' && showReveal && <button
        className="vault-file-header__action"
        title={canReveal ? 'Reveal on Canvas' : 'Not placed on a canvas'}
        aria-label="Reveal on Canvas"
        disabled={!canReveal}
      ><LocateFixed size={17} /></button>}
    </header>
  );
}
