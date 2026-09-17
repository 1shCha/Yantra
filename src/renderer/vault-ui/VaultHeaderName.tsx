import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { operationFailure, type OperationResult } from '../../shared/operation-result';
import { friendlyOperationError } from '../vault/vault-organize-helpers';

export function VaultHeaderName({ title, editName, kind, busy, onRename, validateName }: {
  title: string; editName: string; kind: 'document' | 'canvas'; busy: boolean;
  onRename: (name: string) => Promise<OperationResult>;
  validateName: (name: string) => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(editName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const original = useRef(editName);
  const submitting = useRef(false);
  const errorId = useId();
  useLayoutEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);

  function cancel(restoreFocus = false) {
    if (submitting.current) return;
    setEditing(false); setError(null); setDraft(original.current);
    if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
  }
  useEffect(() => {
    if (!editing) return;
    const outside = (event: PointerEvent) => {
      if (input.current && !event.composedPath().includes(input.current)) cancel();
    };
    const leaveWindow = () => cancel();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', leaveWindow);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', leaveWindow);
    };
  }, [editing]);
  async function save() {
    if (submitting.current || busy) return;
    const invalid = validateName(draft);
    if (invalid) {
      setError(invalid); setDraft(original.current); input.current?.select();
      return;
    }
    submitting.current = true; setPending(true);
    try {
      const result = await onRename(draft);
      if (result.status === 'success') {
        setEditing(false); setError(null);
      } else {
        setDraft(original.current);
        setError(result.status === 'failure' || result.status === 'recovery-required'
          ? friendlyOperationError(result.error) : 'The name could not be changed. Try again.');
      }
    } catch (failure) {
      setDraft(original.current); setError(friendlyOperationError(operationFailure(failure)));
    } finally { submitting.current = false; setPending(false); }
  }
  return <div className={`vault-header-name${editing ? ' vault-header-name--editing' : ''}`}>
    <h1 title={title}>{editing ? <><span className="vault-file-header__name-measure" aria-hidden="true">{draft || "\u00a0"}</span><input ref={input} className="vault-file-header__name-input" aria-label={`${kind === 'document' ? 'Document' : 'Canvas'} name`}
      value={draft} readOnly={pending} aria-busy={pending} aria-invalid={!!error} aria-describedby={error ? errorId : undefined}
      onChange={(event) => { setDraft(event.target.value); setError(validateName(event.target.value)); }}
      onBlur={() => cancel()} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void save(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(true); }
      }} /></> : <button ref={button} type="button" className="vault-file-header__rename" disabled={busy}
      aria-label={`Rename ${kind}`} title="Rename" onClick={() => {
        original.current = editName; setDraft(editName); setError(null); setEditing(true);
      }}>{title}</button>}</h1>
    {editing && error && <div id={errorId} className="vault-file-header__name-error" role="alert">{error}</div>}
  </div>;
}
