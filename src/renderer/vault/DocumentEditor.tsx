import { EditorContent } from '@tiptap/react';
import { useEffect } from 'react';
import type { DocumentFile } from '../../shared/vault-format';
import { EditorToolbarControls } from '../editor/EditorToolbarControls';
import { VaultFileHeader, type VaultSaveState } from '../vault-ui/VaultFileHeader';
import { useDocumentEditor } from '../editor/useDocumentEditor';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';

export function DocumentEditor({ file, busy, store, focusRequested, onFocusHandled, saveState, onRetry, commitError }: {
  file: DocumentFile;
  saveState: VaultSaveState;
  onRetry: () => void;
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
    if (!editor || busy || !focusRequested) return;
    editor.commands.focus('start');
    onFocusHandled();
  }, [editor, busy, focusRequested, onFocusHandled]);
  return <>
    <VaultFileHeader title={file.title} kind="document" showReveal={false} busy={busy} saveState={saveState} onRetry={onRetry}>
      {editor && <div className="vault-document-toolbar"><EditorToolbarControls editor={editor} menuSide="below" inline readOnly={busy} /></div>}
    </VaultFileHeader>
    {commitError && <div className="document-title-error" role="alert">{commitError}</div>}
    <div className="vault-document-scroll">
      {titleError && <div className="document-title-error" role="status">{titleError}</div>}
      <EditorContent className="vault-document-content vault-document-content--editable" editor={editor} />
    </div>
  </>;
}
