import { Check, Circle, LoaderCircle, AlertCircle, RotateCw, LocateFixed, PanelsTopLeft, FileText } from 'lucide-react';

export type PreviewSaveState = 'Unsaved' | 'Saving' | 'Saved' | 'Failed';

export function PreviewFileHeader({ title, folder, kind, canReveal = false, saveState = 'Saved', onRetry }: {
  title: string;
  folder: string;
  kind: 'document' | 'canvas';
  canReveal?: boolean;
  saveState?: PreviewSaveState;
  onRetry?: () => void;
}) {
  const Icon = kind === 'canvas' ? PanelsTopLeft : FileText;
  const StatusIcon = { Unsaved: Circle, Saving: LoaderCircle, Saved: Check, Failed: AlertCircle }[saveState];
  return (
    <header className="vault-file-header">
      <Icon size={17} aria-hidden="true" />
      <div className="vault-file-header__identity">
        <span className="vault-file-header__folder" title={folder}>{folder}</span>
        <h1 title={title}>{title}</h1>
      </div>
      <span className="vault-file-header__saved" role="status" aria-label={saveState} data-state={saveState}><StatusIcon size={13} /><span>{saveState}</span></span>
      {saveState === 'Failed' && <button className="vault-file-header__action" aria-label="Retry save" title="Retry save" onClick={onRetry}><RotateCw size={15} /></button>}
      {kind === 'document' && <button
        className="vault-file-header__action"
        title={canReveal ? 'Reveal on Canvas' : 'Not placed on a canvas'}
        aria-label="Reveal on Canvas"
        disabled={!canReveal}
      ><LocateFixed size={17} /></button>}
    </header>
  );
}
