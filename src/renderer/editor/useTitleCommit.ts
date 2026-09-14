import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { TiptapDoc } from '../../shared/tiptap-document';
import { operationFailure, type OperationResult } from '../../shared/operation-result';
import { documentTitle, titleNameError } from '../../shared/document-title';
import { selectionTouchesTitle } from './protected-title';
import { vaultTrace } from '../persistence/vault-diagnostics';

// Owns title-exit timing and focus only. The workspace owns validation and renaming.
export function useTitleCommit(initialContent: TiptapDoc, onTitleCommit: (() => Promise<OperationResult>) | undefined, onError: (message: string) => void) {
  const [committing, setCommitting] = useState(false);
  const commitCallback = useRef(onTitleCommit);
  commitCallback.current = onTitleCommit;
  const commitPending = useRef(false);
  const restoreFocus = useRef(false);
  const editorInstance = useRef<Editor | null>(null);
  const committedTitle = useRef(documentTitle(initialContent));
  const wasInTitle = useRef(true);
  const pointerDown = useRef(false);
  const cancelScheduledCommit = useRef<(() => void) | null>(null);

  function commitTitle(current: Editor, focusAfter: boolean, title: string) {
    cancelScheduledCommit.current?.();
    const commit = commitCallback.current;
    if (!commit || commitPending.current) return;
    commitPending.current = true;
    vaultTrace.record('title.commit.start');
    if (!current.isDestroyed) {
      current.setEditable(false, false);
      setCommitting(true);
    }
    let focusMoved = false;
    const noticePointer = () => { focusMoved = true; };
    document.addEventListener('pointerdown', noticePointer, { once: true });
    void Promise.resolve().then(commit).then((result) => {
      if (result.status === 'success') committedTitle.current = title;
      vaultTrace.record('title.commit.finish', { outcome: result.status,
        code: result.status === 'failure' || result.status === 'recovery-required' ? result.error.code : undefined });
    }).catch((error) => {
      if (!current.isDestroyed) onError(operationFailure(error).message);
    }).finally(() => {
      document.removeEventListener('pointerdown', noticePointer);
      commitPending.current = false;
      if (current.isDestroyed) return;
      restoreFocus.current = focusAfter && !focusMoved;
      setCommitting(false);
    });
  }

  function scheduleTitleExit(current: Editor, focusAfter = false) {
    const title = current.state.doc.firstChild?.textContent ?? '';
    if (commitPending.current || cancelScheduledCommit.current) { vaultTrace.record('title.exit.coalesced'); return; }
    if (!commitCallback.current || title === committedTitle.current || titleNameError(title)) return;
    vaultTrace.record('title.exit.scheduled');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      document.removeEventListener('pointerup', afterPointer);
      document.removeEventListener('pointercancel', afterPointer);
      window.removeEventListener('blur', afterPointer);
      cancelScheduledCommit.current = null;
    };
    // Defer until after click handlers run. Canvas deselection can destroy this
    // editor on pointerdown, so this pending commit must survive its unmount.
    const afterPointer = () => {
      cancel();
      timer = setTimeout(() => {
        cancelScheduledCommit.current = null;
        if (!current.isDestroyed && current.isFocused && selectionTouchesTitle(current.state)) return;
        const latestTitle = current.isDestroyed ? title : current.state.doc.firstChild?.textContent ?? '';
        if (latestTitle !== committedTitle.current && !titleNameError(latestTitle)) commitTitle(current, focusAfter, latestTitle);
      }, 0);
      cancelScheduledCommit.current = cancel;
    };
    cancelScheduledCommit.current = cancel;
    if (pointerDown.current) {
      document.addEventListener('pointerup', afterPointer, { once: true });
      document.addEventListener('pointercancel', afterPointer, { once: true });
      window.addEventListener('blur', afterPointer, { once: true });
    } else afterPointer();
  }

  useLayoutEffect(() => {
    const down = () => { pointerDown.current = true; };
    const up = () => { pointerDown.current = false; };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
    };
  }, []);

  function syncEditable(editor: Editor | null, editable: boolean) {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(editable && !committing, false);
    if (restoreFocus.current && editable && !committing) {
      restoreFocus.current = false;
      if (document.activeElement === document.body || editor.view.dom.contains(document.activeElement)) editor.commands.focus();
    }
  }
  return {
    committing, syncEditable,
    created(editor: Editor) { editorInstance.current = editor; },
    enter(editor: Editor) {
      if (!commitCallback.current) return;
      vaultTrace.record('title.exit.enter');
      commitTitle(editor, true, editor.state.doc.firstChild?.textContent ?? '');
    },
    selectionChanged(editor: Editor) {
      if (!commitCallback.current) return;
      const inTitle = selectionTouchesTitle(editor.state);
      if (wasInTitle.current && !inTitle) {
        vaultTrace.record('title.exit.body');
        scheduleTitleExit(editor, true);
      }
      wasInTitle.current = inTitle;
    },
    blurred(editor: Editor) {
      if (!commitCallback.current) return;
      vaultTrace.record('title.exit.blur'); scheduleTitleExit(editor);
    },
    destroyed() {
      if (!commitCallback.current) return;
      vaultTrace.record('title.exit.destroy');
      if (editorInstance.current) scheduleTitleExit(editorInstance.current);
    },
  };
}
