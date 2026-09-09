import { EditorToolbarControls, type EditorToolbarMenuSide } from '../editor/EditorToolbarControls';
import { useCanvasEditor } from './canvas-editor-context';

export function EditorToolbar({ menuSide }: { menuSide: EditorToolbarMenuSide }) {
  const { editor } = useCanvasEditor();
  if (editor === null) return null;
  return <EditorToolbarControls editor={editor} menuSide={menuSide} />;
}
