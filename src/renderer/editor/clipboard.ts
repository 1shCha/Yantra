import { tiptapDocSchema } from '../../shared/tiptap-document';
import { Extension } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Slice } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { Plugin, PluginKey } from '@tiptap/pm/state';

import { selectionTouchesTitle } from './protected-title';
import { looksLikeMarkdown, parseClipboardMarkdown } from './math-markdown';
import { normalizeClipboardMathHtml } from './math-clipboard-html';

export { Markdown };

export const Clipboard = Extension.create({
  name: 'yantraClipboard',
  priority: 200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    let plainPaste = false;
    return [new Plugin({
      key: new PluginKey('yantraClipboard'),
      props: {
        transformPastedText(text, plain) { plainPaste = plain; return text; },
        transformPastedHTML(html, view) {
          plainPaste = false;
          if (selectionTouchesTitle(view.state) || view.state.selection.$from.parent.type.spec.code || editor.isActive('code')) return html;
          return normalizeClipboardMathHtml(html);
        },
        handlePaste(view, event) {
          const plain = plainPaste;
          plainPaste = false;
          if (!editor.isEditable || selectionTouchesTitle(view.state)
            || view.state.selection.$from.parent.type.spec.code) return false;
          const text = event.clipboardData?.getData('text/plain');
          if (editor.isActive('code') && text) {
            view.dispatch(closeHistory(view.state.tr).insertText(text).scrollIntoView()
              .setMeta('paste', true).setMeta('uiEvent', 'paste'));
            view.dispatch(closeHistory(view.state.tr));
            return true;
          }
          if (plain) return false;
          // Rich HTML already passed through the math normalizer; let ProseMirror
          // keep its slice metadata, marks, list structure, and normal paste rules.
          if (event.clipboardData?.getData('text/html') || !text || !editor.markdown || !looksLikeMarkdown(text)) return false;
          try {
            const json = tiptapDocSchema.parse(parseClipboardMarkdown(editor.markdown, text));
            const node = view.state.schema.nodeFromJSON(json);
            node.forEach(child => child.check());
            const slice = Slice.maxOpen(node.content);
            const tr = closeHistory(view.state.tr).replaceSelection(slice).scrollIntoView()
              .setMeta('paste', true).setMeta('uiEvent', 'paste');
            view.dispatch(tr);
            view.dispatch(closeHistory(view.state.tr));
            return true;
          } catch {
            // Unsupported input remains available as plain text through the normal paste path.
            return false;
          }
        },

      },
    })];
  },
});
