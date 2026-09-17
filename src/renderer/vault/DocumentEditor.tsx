import type { OperationResult } from '../../shared/operation-result';
import { documentTitle } from '../../shared/document-title';
import { EditorContent } from '@tiptap/react';
import { memo, useEffect } from 'react';
import type { DocumentFile } from '../../shared/vault-format';
import { EditorToolbarControls } from '../editor/EditorToolbarControls';
import { VaultFileHeader, type VaultSaveState } from '../vault-ui/VaultFileHeader';
import { useDocumentEditor } from '../editor/useDocumentEditor';
import { createDocumentEditorSyncTransaction } from './document-editor-sync';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';

export const DocumentEditor = memo(function DocumentEditor({ file, busy, store, focusRequested, onFocusHandled, saveState, onRetry, onRename, validateName, commitError }: {
  file: DocumentFile;
  saveState: VaultSaveState;
  onRetry: () => void;
  onRename: (name: string) => Promise<OperationResult>;
  validateName: (name: string) => string | null;
  commitError?: string;
  busy: boolean;
  store: ReturnType<typeof createVaultWorkspace>;
  focusRequested: boolean;
  onFocusHandled: () => void;
}) {
  const { editor, titleError } = useDocumentEditor({
    initialContent: file.doc,
    editable: !busy,
    editorProps: { attributes: { class: 'markdown-node__prose', 'aria-label': 'Document content' } },
    onChange: (doc) => store.getState().updateDocument(file.id, doc),
    onTitleCommit: () => store.getState().commitDocumentTitle(file.id),
  });
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const tr = createDocumentEditorSyncTransaction(editor.state, file.doc);
    if (tr) editor.view.dispatch(tr);
  }, [editor, file.doc]);
  useEffect(() => {
    if (!editor || busy || !focusRequested) return;
    editor.commands.focus('start');
    onFocusHandled();
  }, [editor, busy, focusRequested, onFocusHandled]);
  return <>
    <VaultFileHeader title={file.title} kind="document" showReveal={false} busy={busy} saveState={saveState} onRetry={onRetry} onRename={onRename} editName={documentTitle(file.doc)} validateName={validateName}>
      {editor && <div className="vault-document-toolbar"><EditorToolbarControls editor={editor} menuSide="below" inline readOnly={busy} /></div>}
    </VaultFileHeader>
    {commitError && <div className="document-title-error" role="alert">{commitError}</div>}
    <div className="vault-document-scroll">
      {titleError && <div className="document-title-error" role="status">{titleError}</div>}
      <EditorContent className="vault-document-content vault-document-content--editable" editor={editor} />
    </div>
  </>;
});
