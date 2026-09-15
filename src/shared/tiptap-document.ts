import { z } from 'zod';

// Shared by editor updates, clipboard imports, and vault persistence. Unknown
// content must fail validation rather than disappear during the next save.
export const tiptapNodeAttrsSchema = z.strictObject({
  checked: z.boolean().optional(),
  class: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  latex: z.string().optional(),
  level: z.number().int().min(1).max(6).optional(),
  rel: z.string().nullable().optional(),
  start: z.number().int().optional(),
  target: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  textAlign: z.string().nullable().optional(),
});

export const tiptapMarkTypeSchema = z.enum(['bold', 'italic', 'highlight', 'link', 'code']);

export const tiptapMarkSchema = z.strictObject({
  type: tiptapMarkTypeSchema,
  attrs: tiptapNodeAttrsSchema.optional(),
});

export const tiptapNodeTypeSchema = z.enum(['paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'codeBlock', 'inlineMath', 'blockMath', 'blockquote']);

export const tiptapNodeSchema = z.strictObject({
  type: tiptapNodeTypeSchema,
  text: z.string().optional(),
  attrs: tiptapNodeAttrsSchema.optional(),
  marks: z.array(tiptapMarkSchema).optional(),
  get content() {
    return z.array(tiptapNodeSchema).optional();
  },
});

export const tiptapDocSchema = z.strictObject({
  type: z.literal('doc'),
  get content() {
    return z.array(tiptapNodeSchema).optional();
  },
});

export type TiptapNode = z.infer<typeof tiptapNodeSchema>;
export type TiptapDoc = z.infer<typeof tiptapDocSchema>;

export function createEmptyTiptapDoc(): TiptapDoc {
  return {
    type: 'doc',
    content: [{ type: 'heading', attrs: { level: 1 } }],
  };
}

export function tiptapDocFromPlainText(text: string): TiptapDoc {
  if (text === '') {
    return createEmptyTiptapDoc();
  }

  const lines = text.split('\n');
  const inlineNodes: TiptapNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index > 0) {
      inlineNodes.push({ type: 'hardBreak' });
    }

    if (line !== undefined && line !== '') {
      inlineNodes.push({ type: 'text', text: line });
    }
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: inlineNodes,
      },
    ],
  };
}

function isTiptapNodeEmpty(node: TiptapNode): boolean {
  if (
    node.type === 'inlineMath' ||
    node.type === 'blockMath' ||
    node.type === 'bulletList' ||
    node.type === 'codeBlock' ||
    node.type === 'hardBreak' ||
    node.type === 'orderedList' ||
    node.type === 'taskList'
  ) {
    return false;
  }

  if (node.text !== undefined && node.text !== '') {
    return false;
  }

  const children = node.content;
  if (children === undefined || children.length === 0) {
    return true;
  }

  return children.every((child) => isTiptapNodeEmpty(child));
}

export function isTiptapDocEmpty(doc: TiptapDoc): boolean {
  const blocks = doc.content;
  if (blocks === undefined || blocks.length === 0) {
    return true;
  }

  return blocks.every((block) => isTiptapNodeEmpty(block));
}

export function isSameTiptapDoc(left: TiptapDoc, right: TiptapDoc): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
