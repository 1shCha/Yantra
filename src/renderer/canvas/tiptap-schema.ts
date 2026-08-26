import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';

import type { TiptapDoc } from '../../shared/tiptap-document';

export const canvasTiptapSchemaExtensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
    trailingNode: false,
  }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  Highlight,
  TextAlign.configure({
    types: ['heading', 'paragraph'],
    alignments: ['left', 'center', 'right'],
  }),
  Link.configure({
    openOnClick: false,
    defaultProtocol: 'https',
    HTMLAttributes: {
      class: 'nodrag',
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    },
  }),
];

export const canvasTiptapEditorExtensions = [
  ...canvasTiptapSchemaExtensions,
  Placeholder.configure({
    placeholder: 'Type…',
  }),
];

const EMPTY_PREVIEW_BLOCK_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function withLineBreaksInEmptyBlocks(html: string): string {
  let result = html;
  for (const tag of EMPTY_PREVIEW_BLOCK_TAGS) {
    result = result.replaceAll(`<${tag}></${tag}>`, `<${tag}><br></${tag}>`);
    result = result.replaceAll(
      new RegExp(`<${tag}(\\s[^>]*)><\\/${tag}>`, 'g'),
      `<${tag}$1><br></${tag}>`,
    );
  }
  return result;
}

export function renderTiptapDocToHtml(doc: TiptapDoc): string {
  return withLineBreaksInEmptyBlocks(generateHTML(doc, canvasTiptapSchemaExtensions));
}
