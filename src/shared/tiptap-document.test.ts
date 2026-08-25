import { describe, expect, it } from 'vitest';

import {
  createEmptyTiptapDoc,
  isTiptapDocEmpty,
  tiptapDocFromPlainText,
  tiptapDocSchema,
} from './tiptap-document';

describe('tiptapDocFromPlainText', () => {
  it('wraps empty text in an empty paragraph document', () => {
    expect(tiptapDocFromPlainText('')).toEqual(createEmptyTiptapDoc());
    expect(isTiptapDocEmpty(tiptapDocFromPlainText(''))).toBe(true);
  });

  it('keeps legacy newlines as hard breaks instead of parsing markdown', () => {
    expect(tiptapDocFromPlainText('Hello\n**world**')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'hardBreak' },
            { type: 'text', text: '**world**' },
          ],
        },
      ],
    });
    expect(isTiptapDocEmpty(tiptapDocFromPlainText('Hello'))).toBe(false);
  });
});

describe('tiptapDocSchema', () => {
  it('accepts a bold heading document', () => {
    const parsed = tiptapDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Title', marks: [{ type: 'bold' }] }],
        },
      ],
    });

    expect(parsed.content?.[0]?.type).toBe('heading');
    expect(parsed.content?.[0]?.attrs?.level).toBe(2);
  });
});
