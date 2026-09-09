import { EditorContent } from '@tiptap/react';
import { useDocumentEditor } from '../editor/useDocumentEditor';
import { EditorToolbarControls } from '../editor/EditorToolbarControls';
import { PreviewFileHeader, type PreviewSaveState } from './PreviewFileHeader';
import { readingNotes } from './preview-documents';

export function DocumentPreview({ longTitle = false, unplaced = false, saveState = 'Saved' }: { longTitle?: boolean; unplaced?: boolean; saveState?: PreviewSaveState }) {
  const editor = useDocumentEditor({
    initialContent: readingNotes,
    editable: false,
    editorProps: {
      attributes: { class: 'markdown-node__prose', 'aria-label': 'Reading notes document', 'aria-readonly': 'true' },
      handleClick: () => true,
    },
  });

  return (
    <section className="vault-document-view">
      <PreviewFileHeader
        title={longTitle ? 'Local-first software and durable document identity across changing workspaces' : 'Reading notes'}
        folder={unplaced ? 'My vault / Unfiled' : 'My vault / Research'}
        kind="document" canReveal={!unplaced} saveState={saveState}
      />
      <div className="vault-document-toolbar">
        {editor && <EditorToolbarControls editor={editor} menuSide="below" readOnly />}
      </div>
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
