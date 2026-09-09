import { useEditor, type Editor, type EditorOptions } from '@tiptap/react';

import { tiptapDocSchema, type TiptapDoc } from '../../shared/tiptap-document';
import { documentEditorExtensions } from './tiptap-schema';

interface DocumentEditorOptions {
  initialContent: TiptapDoc;
  editable?: boolean;
  editorProps?: EditorOptions['editorProps'];
  onCreate?: (editor: Editor) => void;
  onChange?: (doc: TiptapDoc) => void;
}

// Content seeds this editor session once. Mount a new session when switching
// documents; reflecting local edits back into props must not reset history.
export function useDocumentEditor({
  initialContent,
  editable = true,
  editorProps,
  onCreate,
  onChange,
}: DocumentEditorOptions) {
  return useEditor({
    immediatelyRender: false,
    extensions: documentEditorExtensions,
    content: initialContent,
    editable,
    editorProps,
    onCreate: ({ editor }) => onCreate?.(editor),
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return;
      const parsed = tiptapDocSchema.safeParse(editor.getJSON());
      if (parsed.success) onChange?.(parsed.data);
    },
  });
}
