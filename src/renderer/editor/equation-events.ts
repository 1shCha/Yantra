import type { Editor } from '@tiptap/core';
import { selectionTouchesTitle } from './protected-title';
export const MATH_EDITOR_EVENT = 'yantra-edit-equation';

export function openEquationEditor(editor: Editor, pos?: number) {
  if (!editor.isEditable) return;
  if (pos !== undefined) editor.commands.setNodeSelection(pos);
  if (selectionTouchesTitle(editor.state)) return;
  if (pos === undefined && editor.isActive('code')) editor.commands.extendMarkRange('code');
  editor.view.dom.dispatchEvent(new Event(MATH_EDITOR_EVENT));
}
