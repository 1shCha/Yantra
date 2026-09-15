import { Extension, Node as TiptapNode } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey, Selection, TextSelection, type Command, type EditorState } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform';
import { validTitleText } from '../../shared/document-title';
import type { Editor } from '@tiptap/core';

export { TITLE_INPUT_ERROR } from '../../shared/document-title';
export const TITLE_FORMAT_HINT = 'The document title is always Heading 1.';

const FORMATTING_SHORTCUTS = [
  'Mod-b', 'Mod-B', 'Mod-i', 'Mod-I', 'Mod-Shift-h',
  'Mod-Alt-0', 'Mod-Alt-1', 'Mod-Alt-2', 'Mod-Alt-3', 'Mod-Alt-4', 'Mod-Alt-5', 'Mod-Alt-6',
  'Mod-Alt-c', 'Mod-Shift-7', 'Mod-Shift-8', 'Mod-Shift-9',
  'Mod-Shift-l', 'Mod-Shift-e', 'Mod-Shift-r', 'Mod-Shift-j',
];

export const ProtectedDocument = TiptapNode.create({
  name: 'doc',
  topNode: true,
  content: 'heading block*',
  renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n'),
});

export function selectionTouchesTitle(state: EditorState): boolean {
  return state.selection.from < (state.doc.firstChild?.nodeSize ?? 0);
}

function hasTitleFormatting(node: Node): boolean {
  if (node.type.name !== 'heading' || node.attrs.level !== 1 || node.attrs.textAlign != null) return false;
  let valid = node.marks.length === 0;
  node.forEach((child) => { if (!child.isText || child.marks.length > 0) valid = false; });
  return valid;
}

// Enter leaves the complete title intact, even with a caret in its middle.
export const enterTitleBody: Command = (state, dispatch) => {
  if (!selectionTouchesTitle(state)) return false;
  const end = state.doc.firstChild!.nodeSize;
  if (dispatch) {
    const tr = state.tr;
    if (state.doc.childCount === 1) tr.insert(end, state.schema.nodes.paragraph!.create());
    tr.setSelection(Selection.near(tr.doc.resolve(end + 1))).setStoredMarks([]);
    dispatch(closeHistory(tr).scrollIntoView());
  }
  return true;
};

export const protectTitleBackspace: Command = (state) => {
  const { selection, doc } = state;
  return selection.empty && (selection.from === 1 || selection.from === doc.firstChild!.nodeSize + 1);
};

export const protectTitleDelete: Command = (state) => state.selection.empty
  && state.selection.from === state.doc.firstChild!.nodeSize - 1;

export function titleProtectionPlugin(onInvalidInput: () => void): Plugin {
  return new Plugin({
    key: new PluginKey('protectedTitle'),
    filterTransaction(tr) {
      if (!tr.docChanged) return true;
      const title = tr.doc.firstChild;
      if (!title || !hasTitleFormatting(title)) return false;
      if (!validTitleText(title.textContent)) {
        onInvalidInput();
        return false;
      }
      // Reject formatting across a title/body selection as a whole, even when
      // removing a mark that the title itself does not carry.
      return !tr.steps.some((step, index) => (step instanceof AddMarkStep || step instanceof RemoveMarkStep)
        && step.from < tr.docs[index]!.firstChild!.nodeSize);
    },
    appendTransaction(_transactions, _oldState, state) {
      if (selectionTouchesTitle(state) && state.storedMarks?.length) return state.tr.setStoredMarks([]);
      return null;
    },
    props: {
      handleTextInput(view, from, _to, text) {
        if (from >= view.state.doc.firstChild!.nodeSize || validTitleText(text)) return false;
        onInvalidInput();
        return true;
      },
      handlePaste(view, _event, slice) {
        const { state } = view;
        if (!selectionTouchesTitle(state)) return false;
        const lines = slice.content.textBetween(0, slice.content.size, '\n', '\n').split(/\r?\n/);
        if (!validTitleText(lines[0]!)) {
          onInvalidInput();
          return true;
        }
        const tr = state.tr.deleteSelection();
        const at = Math.min(Math.max(1, tr.selection.from), tr.doc.firstChild!.nodeSize - 1);
        if (lines[0]) tr.insertText(lines[0], at).setStoredMarks([]);
        if (lines.length > 1) {
          const end = tr.doc.firstChild!.nodeSize;
          const paragraphs = lines.slice(1).map((text) => state.schema.nodes.paragraph!.create(null, text ? state.schema.text(text) : null));
          tr.insert(end, paragraphs);
          tr.setSelection(TextSelection.create(tr.doc, end + paragraphs.reduce((size, node) => size + node.nodeSize, 0) - 1));
        }
        view.dispatch(closeHistory(tr).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'));
        view.dispatch(closeHistory(view.state.tr));
        return true;
      },
      handleDrop(view, _event, _slice, moved) {
        // Moving the title would remove the required first block. Other drops
        // still pass through the same content/formatting validation as typing.
        return moved && selectionTouchesTitle(view.state);
      },
    },
  });
}

export const ProtectedTitle = Extension.create<{ onInvalidInput: () => void; onCommit: (editor: Editor) => void }>({
  name: 'protectedTitle',
  priority: 1000,
  addOptions() { return { onInvalidInput: () => {}, onCommit: () => {} }; },
  addKeyboardShortcuts() {
    const run = (command: Command) => () => command(this.editor.state, this.editor.view.dispatch, this.editor.view);
    const enter = () => {
      if (this.editor.view.composing) return false;
      const handled = run(enterTitleBody)();
      if (handled) this.options.onCommit(this.editor);
      return handled;
    };
    return {
      ...Object.fromEntries(FORMATTING_SHORTCUTS.map((key) => [key, () => selectionTouchesTitle(this.editor.state)])),
      Enter: enter,
      'Shift-Enter': enter,
      Backspace: run(protectTitleBackspace),
      'Shift-Backspace': run(protectTitleBackspace),
      'Mod-Backspace': run(protectTitleBackspace),
      'Alt-Backspace': run(protectTitleBackspace),
      Delete: run(protectTitleDelete),
      'Mod-Delete': run(protectTitleDelete),
      'Alt-Delete': run(protectTitleDelete),
    };
  },
  addProseMirrorPlugins() { return [titleProtectionPlugin(this.options.onInvalidInput)]; },
});
