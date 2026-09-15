import { inlineMathTokenizer, blockMathTokenizer } from './math-markdown';
import { InlineMath, BlockMath } from '@tiptap/extension-mathematics';
import { mathOptions, renderMath } from './math';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions/placeholder';
import { generateHTML } from '@tiptap/html';
import StarterKit from '@tiptap/starter-kit';
import { Node } from '@tiptap/core';

import type { TiptapDoc } from '../../shared/tiptap-document';
import { ProtectedDocument, ProtectedTitle } from './protected-title';

export const documentSchemaExtensions = [
  Node.create({ name: 'doc', topNode: true, content: 'block+', renderMarkdown: (node, helpers) => helpers.renderChildren(node.content ?? [], '\n\n') }),
  StarterKit.configure({
    document: false,
    horizontalRule: false,
    link: false,
    strike: false,
    underline: false,
    trailingNode: false,
  }),
  InlineMath.extend({
    addInputRules: () => [],
    markdownTokenizer: inlineMathTokenizer,
    renderText: ({ node }) => `\\(${node.attrs.latex}\\)`,
    renderMarkdown: node => `\\(${node.attrs?.latex ?? ''}\\)`,
  }).configure({ katexOptions: { ...mathOptions, displayMode: false } }),
  BlockMath.extend({
    addInputRules: () => [],
    markdownTokenizer: blockMathTokenizer,
    renderText: ({ node }) => `\\[\n${node.attrs.latex}\n\\]`,
    renderMarkdown: node => `\\[\n${node.attrs?.latex ?? ''}\n\\]`,
  }).configure({ katexOptions: { ...mathOptions, displayMode: true } }),
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

export const documentEditorExtensions = [
  ...documentSchemaExtensions.map((extension) => extension.name === 'doc' ? ProtectedDocument : extension),
  ProtectedTitle,
  Placeholder.configure({
    placeholder: ({ pos }) => pos === 0 ? 'Title' : 'Type…',
    includeChildren: true,
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
  // Node views are not used by generateHTML. Substitute only placeholders made
  // by these serializers, never user HTML or a scan of ordinary document text.
  const equations: string[] = [];
  const extensions = documentSchemaExtensions.map((extension) =>
    extension instanceof Node && (extension.name === 'inlineMath' || extension.name === 'blockMath')
      ? extension.extend({
        renderHTML({ node }) {
          const block = node.type.name === 'blockMath';
          const index = equations.push(renderMath(node.attrs.latex, block)) - 1;
          return [block ? 'div' : 'span', {
            class: 'tiptap-mathematics-render',
            'data-type': block ? 'block-math' : 'inline-math',
          }, ['span', { 'data-yantra-math-preview': String(index) }]];
        },
      }) : extension);
  const html = generateHTML(doc, extensions).replace(
    /<span data-yantra-math-preview="(\d+)"><\/span>/g,
    (_match, index: string) => equations[Number(index)]!,
  );
  return withLineBreaksInEmptyBlocks(html);
}
