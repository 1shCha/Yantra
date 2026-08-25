import { z } from 'zod';

const tiptapNodeAttrsSchema = z.object({
  level: z.number().int().min(1).max(6).optional(),
});

const tiptapMarkSchema = z.object({
  type: z.string(),
  attrs: tiptapNodeAttrsSchema.optional(),
});

export const tiptapNodeSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  attrs: tiptapNodeAttrsSchema.optional(),
  marks: z.array(tiptapMarkSchema).optional(),
  get content() {
    return z.array(tiptapNodeSchema).optional();
  },
});

export const tiptapDocSchema = z.object({
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
    content: [{ type: 'paragraph' }],
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
  if (node.type === 'hardBreak') {
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
