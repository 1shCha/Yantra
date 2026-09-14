import { getSchema } from '@tiptap/core';
import { baseKeymap, deleteSelection, setBlockType, toggleMark, wrapIn } from '@tiptap/pm/commands';
import { history, redo, undo } from '@tiptap/pm/history';
import { AllSelection, EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { createEmptyTiptapDoc } from '../../shared/tiptap-document';
import { documentEditorExtensions } from './tiptap-schema';
import { enterTitleBody, protectTitleBackspace, protectTitleDelete, selectionTouchesTitle, titleProtectionPlugin } from './protected-title';

const schema = getSchema(documentEditorExtensions);

function session(title = 'My Project', body?: string) {
  let rejected = 0;
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 1 }, title ? schema.text(title) : undefined),
    ...(body === undefined ? [] : [schema.node('paragraph', null, body ? schema.text(body) : undefined)]),
  ]);
  let state = EditorState.create({ schema, doc, plugins: [titleProtectionPlugin(() => { rejected += 1; }), history()] });
  const dispatch = (tr: Transaction) => { state = state.applyTransaction(tr).state; };
  return {
    get state() { return state; },
    get rejected() { return rejected; },
    dispatch,
    run: (command: Command) => command(state, dispatch),
    select(from: number, to = from) { dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to))); },
  };
}

describe('protected document title', () => {
  it('starts with an empty H1 and requires a heading as the first block', () => {
    const doc = schema.nodeFromJSON(createEmptyTiptapDoc());
    doc.check();
    expect(doc.firstChild?.attrs.level).toBe(1);
    expect(schema.topNodeType.validContent(schema.node('paragraph').content)).toBe(false);
    expect(() => schema.node('doc', null, [schema.node('paragraph')])).toThrow();
  });

  it('accepts English letters/numbers/spaces and rejects punctuation, tabs and non-English text', () => {
    const s = session('');
    s.dispatch(s.state.tr.insertText('My Project 2', 1));
    expect(s.state.doc.textContent).toBe('My Project 2');
    for (const text of ['_', '-', '.', '\t', '\n', '\u00e9', '\ud83d\ude00']) s.dispatch(s.state.tr.insertText(text, 1));
    expect(s.rejected).toBe(7);
    expect(s.state.doc.textContent).toBe('My Project 2');
  });

  it('Enter in the middle or over selected text leaves the entire title intact', () => {
    const s = session();
    s.select(4, 8);
    expect(s.run(enterTitleBody)).toBe(true);
    expect(s.state.doc.firstChild?.textContent).toBe('My Project');
    expect(s.state.doc.child(1).type.name).toBe('paragraph');
    expect(s.state.selection.from).toBe(s.state.doc.firstChild!.nodeSize + 1);
    expect(selectionTouchesTitle(s.state)).toBe(false);
    s.select(1);
    s.run(enterTitleBody);
    expect(s.state.doc.childCount).toBe(2);
  });

  it('allows Enter and all formatting in the body, including another H1', () => {
    const s = session('Title', 'Body 123!');
    const start = s.state.doc.firstChild!.nodeSize + 1;
    s.select(start, start + 4);
    expect(s.run(enterTitleBody)).toBe(false);
    s.run(toggleMark(schema.marks.bold!));
    expect(s.state.doc.child(1).firstChild?.marks[0]?.type.name).toBe('bold');
    s.run(setBlockType(schema.nodes.heading!, { level: 1 }));
    expect(s.state.doc.child(1).attrs.level).toBe(1);
    expect(s.state.doc.firstChild?.textContent).toBe('Title');
  });

  it('rejects formatting and links in the title, including selections spanning the body', () => {
    const s = session('Title', 'Body');
    s.select(1, s.state.doc.content.size - 1);
    s.run(toggleMark(schema.marks.bold!));
    s.run(toggleMark(schema.marks.link!, { href: 'https://example.com' }));
    s.run(setBlockType(schema.nodes.heading!, { level: 2 }));
    s.run(setBlockType(schema.nodes.paragraph!));
    s.run(wrapIn(schema.nodes.bulletList!));
    expect(s.state.doc.firstChild?.attrs.level).toBe(1);
    expect(s.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    expect(s.state.doc.child(1).type.name).toBe('paragraph');
    expect(s.state.doc.child(1).firstChild?.marks).toEqual([]);
    s.dispatch(s.state.tr.setNodeMarkup(0, undefined, { level: 1, textAlign: 'right' }));
    expect(s.state.doc.firstChild?.attrs.textAlign).toBeNull();
  });

  it('clears stored formatting at a title caret but keeps undo and redo available', () => {
    const s = session('');
    s.run(toggleMark(schema.marks.bold!));
    expect(s.state.storedMarks).toEqual([]);
    s.dispatch(s.state.tr.insertText('Draft'));
    expect(s.state.doc.firstChild?.firstChild?.marks).toEqual([]);
    expect(s.run(undo)).toBe(true);
    expect(s.state.doc.firstChild?.textContent).toBe('');
    expect(s.run(redo)).toBe(true);
    expect(s.state.doc.firstChild?.textContent).toBe('Draft');
  });

  it('deleting everything leaves the required empty title and can be undone', () => {
    const s = session('Title', 'Body 123!');
    s.dispatch(s.state.tr.setSelection(new AllSelection(s.state.doc)));
    s.run(deleteSelection);
    expect(s.state.doc.childCount).toBe(1);
    expect(s.state.doc.firstChild?.type.name).toBe('heading');
    expect(s.state.doc.firstChild?.attrs.level).toBe(1);
    expect(s.state.doc.textContent).toBe('');
    s.run(undo);
    expect(s.state.doc.textContent).toBe('TitleBody 123!');
  });

  it('blocks accidental merges at either side of the title/body boundary', () => {
    const s = session('Title', 'Body');
    s.select(s.state.doc.firstChild!.nodeSize - 1);
    expect(s.run(protectTitleDelete)).toBe(true);
    s.select(s.state.doc.firstChild!.nodeSize + 1);
    expect(s.run(protectTitleBackspace)).toBe(true);
    s.select(1);
    expect(s.run(protectTitleBackspace)).toBe(true);
    s.select(2);
    expect(s.run(protectTitleBackspace)).toBe(false);
  });

  it('uses normal body Enter after leaving the title', () => {
    const s = session('Title');
    s.run(enterTitleBody);
    s.dispatch(s.state.tr.insertText('Body'));
    s.run(baseKeymap.Enter!);
    expect(s.state.doc.childCount).toBe(3);
    expect(s.state.doc.child(2).type.name).toBe('paragraph');
  });
});
