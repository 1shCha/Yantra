import { Clipboard, Markdown } from './clipboard';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { openEquationEditor } from './equation-events';
import { useEditor, type Editor, type EditorOptions } from '@tiptap/react';
import { useLayoutEffect, useRef, useState } from 'react';

import { tiptapDocSchema, type TiptapDoc } from '../../shared/tiptap-document';
import { documentEditorExtensions } from './tiptap-schema';
import { ProtectedTitle, TITLE_INPUT_ERROR } from './protected-title';
import type { OperationResult } from '../../shared/operation-result';
import { useTitleCommit } from './useTitleCommit';

interface DocumentEditorOptions {
  initialContent: TiptapDoc;
  editable?: boolean;
  editorProps?: EditorOptions['editorProps'];
  onCreate?: (editor: Editor) => void;
  onChange?: (doc: TiptapDoc) => void;
  onTitleCommit?: () => Promise<OperationResult>;
}

// Content seeds this editor session once. Mount a new session when switching
// documents; reflecting local edits back into props must not reset history.
export function useDocumentEditor({
  initialContent,
  editable = true,
  editorProps,
  onCreate,
  onChange,
  onTitleCommit,
}: DocumentEditorOptions) {
  const editorRef = useRef<Editor | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleCommit = useTitleCommit(initialContent, onTitleCommit, setTitleError);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [Markdown, Clipboard, ...documentEditorExtensions.map((extension) => extension.name === 'inlineMath' || extension.name === 'blockMath'
      ? extension.configure({ onClick: (_node: ProseMirrorNode, pos: number) => { if (editorRef.current) openEquationEditor(editorRef.current, pos); } })
      : extension.name === ProtectedTitle.name
      ? ProtectedTitle.configure({
        onInvalidInput: () => setTitleError(TITLE_INPUT_ERROR),
        onCommit: (current) => titleCommit.enter(current),
      }) : extension)],
    content: initialContent,
    editable,
    editorProps,
    onCreate: ({ editor }) => { editorRef.current = editor; titleCommit.created(editor); onCreate?.(editor); },
    onSelectionUpdate: ({ editor }) => titleCommit.selectionChanged(editor),
    onBlur: ({ editor }) => titleCommit.blurred(editor),
    onDestroy: () => { editorRef.current = null; titleCommit.destroyed(); },
    onUpdate: ({ editor }) => {
      if (!editor.isEditable) return;
      setTitleError(null);
      const parsed = tiptapDocSchema.safeParse(editor.getJSON());
      if (parsed.success) onChange?.(parsed.data);
    },
  });
  useLayoutEffect(() => {
    titleCommit.syncEditable(editor, editable);
  }, [editor, editable, titleCommit.committing]);
  return { editor, titleError };
}
