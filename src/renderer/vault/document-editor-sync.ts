import type { Node } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { TiptapDoc } from '../../shared/tiptap-document';
import { selectionTouchesTitle } from '../editor/protected-title';

function bodiesEqual(current: Node, incoming: Node): boolean {
  if (current.childCount !== incoming.childCount) return false;
  for (let index = 1; index < current.childCount; index += 1) {
    if (!current.child(index).eq(incoming.child(index))) return false;
  }
  return true;
}

function restoreTitleSelection(state: EditorState, tr: Transaction): void {
  if (!selectionTouchesTitle(state) || !tr.doc.firstChild) return;
  const titleEnd = Math.max(1, tr.doc.firstChild.nodeSize - 1);
  const from = Math.min(Math.max(1, state.selection.from), titleEnd);
  const to = Math.min(Math.max(1, state.selection.to), titleEnd);
  tr.setSelection(TextSelection.create(tr.doc, from, to));
}

/** Apply a store document to a mounted editor without echoing local title edits or moving the caret. */
export function createDocumentEditorSyncTransaction(state: EditorState, incoming: TiptapDoc): Transaction | null {
  const nextDoc = state.schema.nodeFromJSON(incoming);
  if (state.doc.eq(nextDoc)) return null;
  const titleOnly = bodiesEqual(state.doc, nextDoc);
  const heading = nextDoc.firstChild;
  const tr = titleOnly && state.doc.firstChild && heading
    ? state.tr.replaceWith(0, state.doc.firstChild.nodeSize, heading)
    : state.tr.replaceWith(0, state.doc.content.size, nextDoc.content);
  if (titleOnly) restoreTitleSelection(state, tr);
  return tr.setMeta('addToHistory', false).setMeta('preventUpdate', true);
}
