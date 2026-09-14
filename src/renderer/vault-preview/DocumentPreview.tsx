import { EditorContent } from '@tiptap/react';
import { useDocumentEditor } from '../editor/useDocumentEditor';
import { EditorToolbarControls } from '../editor/EditorToolbarControls';
import { VaultFileHeader, type VaultSaveState } from '../vault-ui/VaultFileHeader';
import { readingNotes } from './preview-documents';

export function DocumentPreview({ longTitle = false, unplaced = false, saveState = 'Saved' }: { longTitle?: boolean; unplaced?: boolean; saveState?: VaultSaveState }) {
  const { editor } = useDocumentEditor({
    initialContent: readingNotes,
    editable: false,
    editorProps: {
      attributes: { class: 'markdown-node__prose', 'aria-label': 'Reading notes document', 'aria-readonly': 'true' },
      handleClick: () => true,
    },
  });

  return (
    <section className="vault-document-view">
      <VaultFileHeader
        title={longTitle ? 'Local-first_software_and_durable_document_identity_across_changing_workspaces' : 'Reading_notes'}
        folder={unplaced ? 'My vault / Unfiled' : 'My vault / Research'}
        kind="document" canReveal={!unplaced} saveState={saveState}
      >
        {editor && <div className="vault-document-toolbar"><EditorToolbarControls editor={editor} menuSide="below" inline readOnly /></div>}
      </VaultFileHeader>
      <div className="vault-document-scroll" onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest('a, input, label')) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}>
        <EditorContent className="vault-document-content" editor={editor} />
      </div>
    </section>
  );
}
