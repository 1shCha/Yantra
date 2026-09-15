import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { renderMath, type MathKind } from './math';
import { MATH_EDITOR_EVENT } from './equation-events';
import { selectionTouchesTitle } from './protected-title';
import './math.css';

interface Draft { latex: string; kind: MathKind; editing: boolean }

export function EquationDialog({ editor }: { editor: Editor }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    const open = () => {
      if (!editor.isEditable || selectionTouchesTitle(editor.state)) return;
      const selection = editor.state.selection;
      const node = selection instanceof NodeSelection ? selection.node : null;
      const editing = node?.type.name === 'inlineMath' || node?.type.name === 'blockMath';
      setDraft({ latex: editing ? node.attrs.latex : editor.state.doc.textBetween(selection.from, selection.to, '\n'), kind: editing ? node.type.name === 'blockMath' ? 'blockMath' : 'inlineMath' : 'inlineMath', editing });
    };
    editor.view.dom.addEventListener(MATH_EDITOR_EVENT, open);
    return () => editor.view.dom.removeEventListener(MATH_EDITOR_EVENT, open);
  }, [editor]);
  return draft ? <EquationForm editor={editor} initial={draft} onClose={() => setDraft(null)} /> : null;
}

function EquationForm({ editor, initial, onClose }: { editor: Editor; initial: Draft; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [latex, setLatex] = useState(initial.latex);
  const [kind, setKind] = useState(initial.kind);
  const [error, setError] = useState('');
  const labelId = useId();
  const sourceId = useId();
  const originalDoc = useRef(editor.state.doc);
  const selection = useRef(editor.state.selection);
  const preview = useMemo(() => ({ __html: renderMath(latex, kind === 'blockMath') }), [latex, kind]);
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);
  const close = () => {
    onClose();
    if (!editor.isDestroyed) editor.commands.focus();
  };
  const save = () => {
    if (!latex.trim() || !editor.isEditable || editor.isDestroyed) return;
    if (editor.state.doc !== originalDoc.current) {
      setError('The document changed. Cancel and reopen the equation to edit it.');
      return;
    }
    editor.view.dispatch(closeHistory(editor.state.tr).setSelection(selection.current));
    const ok = initial.editing
      ? editor.commands.updateAttributes(kind, { latex })
      : editor.commands.insertContent({ type: kind, attrs: { latex } });
    if (!ok) { setError('An equation cannot be inserted at this position.'); return; }
    editor.view.dispatch(closeHistory(editor.state.tr));
    close();
  };
  return createPortal(<dialog ref={dialog} className="equation-dialog nodrag nopan nowheel" aria-labelledby={labelId}
    onCancel={(event) => { event.preventDefault(); close(); }}
    onPointerDown={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(); }
    }}>
    <form onSubmit={(event) => { event.preventDefault(); save(); }}>
      <h2 id={labelId}>{initial.editing ? 'Edit equation' : 'Insert equation'}</h2>
      <label>Placement <select value={kind} disabled={initial.editing} onChange={(event) => setKind(event.target.value === 'blockMath' ? 'blockMath' : 'inlineMath')}>
        <option value="inlineMath">Inline</option><option value="blockMath">Separate block</option>
      </select></label>
      <label htmlFor={sourceId}>LaTeX</label>
      <textarea ref={input} id={sourceId} value={latex} spellCheck={false} rows={4}
        placeholder={'\\frac{a}{b}'} onChange={(event) => setLatex(event.target.value)} />
      <div className="equation-dialog__preview" aria-label="Equation preview" dangerouslySetInnerHTML={preview} />
      <p className="equation-dialog__hint">Invalid expressions remain visible and can be corrected later.</p>
      {error && <p role="alert">{error}</p>}
      <div className="equation-dialog__actions"><button type="button" onClick={close}>Cancel</button>
        <button type="submit" disabled={!latex.trim()}>Save</button></div>
    </form>
  </dialog>, document.body);
}
