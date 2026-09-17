import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { tiptapDocSchema, type TiptapDoc } from '../../shared/tiptap-document';
import { withDocumentTitle } from '../../shared/document-title';
import { documentEditorExtensions } from '../editor/tiptap-schema';
import { createDocumentEditorSyncTransaction } from './document-editor-sync';

const schema = getSchema(documentEditorExtensions);

const diskDoc: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Notes' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'First body paragraph' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Second body paragraph' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Third body paragraph' }] },
  ],
};

function session(doc: TiptapDoc = diskDoc) {
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc) });
  const dispatch = (tr: Transaction) => { state = state.apply(tr); };
  return {
    get state() { return state; },
    dispatch,
    json(): TiptapDoc { return tiptapDocSchema.parse(state.doc.toJSON()); },
    sync(incoming: TiptapDoc) {
      const tr = createDocumentEditorSyncTransaction(state, incoming);
      if (tr) dispatch(tr);
    },
  };
}

describe('document editor title caret', () => {
  it('does not move the caret when a live title keystroke is written back from the store', () => {
    const s = session();
    s.dispatch(s.state.tr.setSelection(TextSelection.create(s.state.doc, 6)).insertText('X'));
    const caret = s.state.selection.from;
    expect(s.state.doc.firstChild?.textContent).toBe('NotesX');
    expect(caret).toBeLessThan(s.state.doc.firstChild!.nodeSize);
    s.sync(s.json());
    expect(s.state.doc.firstChild?.textContent).toBe('NotesX');
    expect(s.state.selection.from).toBe(caret);
    expect(s.state.selection.from).toBeLessThan(s.state.doc.firstChild!.nodeSize);
  });

  it('keeps the caret in the title when an external rename replaces only the heading', () => {
    const s = session();
    s.dispatch(s.state.tr.setSelection(TextSelection.create(s.state.doc, 6)));
    const incoming = withDocumentTitle(s.json(), 'NotesX');
    s.sync(incoming);
    expect(s.state.doc.firstChild?.textContent).toBe('NotesX');
    expect(s.state.selection.from).toBeLessThan(s.state.doc.firstChild!.nodeSize);
    expect(s.state.selection.from).toBeLessThan(s.state.doc.content.size - 5);
  });

  it('still replaces the body when another view changes content after the title', () => {
    const s = session();
    s.dispatch(s.state.tr.setSelection(TextSelection.create(s.state.doc, 6)));
    const incoming: TiptapDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Edited elsewhere' }] },
      ],
    };
    s.sync(incoming);
    expect(s.state.doc.textContent).toBe('NotesEdited elsewhere');
    expect(s.state.doc.childCount).toBe(2);
  });
});
