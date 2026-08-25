import { generateHTML } from '@tiptap/html';
import { Placeholder } from '@tiptap/extensions/placeholder';
import StarterKit from '@tiptap/starter-kit';

import type { TiptapDoc } from '../../shared/tiptap-document';

export const canvasTiptapSchemaExtensions = [
  StarterKit.configure({
    blockquote: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    listItem: false,
    listKeymap: false,
    link: false,
    orderedList: false,
    strike: false,
    underline: false,
    trailingNode: false,
  }),
];

export const canvasTiptapEditorExtensions = [
  ...canvasTiptapSchemaExtensions,
  Placeholder.configure({
    placeholder: 'Type…',
  }),
];

export function renderTiptapDocToHtml(doc: TiptapDoc): string {
  return generateHTML(doc, canvasTiptapSchemaExtensions);
}
