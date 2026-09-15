import { describe, expect, it } from 'vitest';

import {
  createEmptyTiptapDoc,
  isTiptapDocEmpty,
  tiptapDocFromPlainText,
  tiptapDocSchema,
} from './tiptap-document';

describe('tiptapDocFromPlainText', () => {
  it('starts empty documents with a Heading 1 title', () => {
    expect(tiptapDocFromPlainText('')).toEqual(createEmptyTiptapDoc());
    expect(createEmptyTiptapDoc().content).toEqual([{ type: 'heading', attrs: { level: 1 } }]);
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

  it('keeps task checked state and code block language', () => {
    const parsed = tiptapDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Done' }],
                },
              ],
            },
          ],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [{ type: 'text', text: 'print(1)' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Item' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.content?.[0]?.content?.[0]?.attrs?.checked).toBe(true);
    expect(parsed.content?.[1]?.attrs?.language).toBe('python');
    expect(parsed.content?.[2]?.type).toBe('bulletList');
  });

  it('keeps highlight, paragraph alignment, and link marks', () => {
    const parsed = tiptapDocSchema.parse({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'Marked',
              marks: [
                { type: 'highlight' },
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: 'nodrag',
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(parsed.content?.[0]?.attrs?.textAlign).toBe('center');
    expect(parsed.content?.[0]?.content?.[0]?.marks).toEqual(
      expect.arrayContaining([
        { type: 'highlight' },
        expect.objectContaining({
          type: 'link',
          attrs: expect.objectContaining({ href: 'https://example.com' }),
        }),
      ]),
    );
  });
});

// Validate at the editor boundary too: unsupported content must not be silently
// stripped before the stricter file decoder has a chance to inspect it.
describe('strict shared content validation', () => {
  it.each([
    { type: 'futureNode' },
    { type: 'paragraph', futureField: true },
    { type: 'paragraph', attrs: { futureSetting: true } },
    { type: 'text', text: 'Keep me', marks: [{ type: 'futureMark' }] },
    { type: 'text', text: 'Keep me', marks: [{ type: 'bold', futureField: true }] },
    { type: 'text', text: 'Keep me', marks: [{ type: 'link', attrs: { href: 'https://example.com', futureSetting: true } }] },
  ])('rejects unsupported nested content without mutating it: %j', (node) => {
    const doc = { type: 'doc', content: [{ type: 'blockquote', content: [node] }] };
    const before = JSON.stringify(doc);
    expect(tiptapDocSchema.safeParse(doc).success).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('rejects unknown document fields', () => {
    expect(tiptapDocSchema.safeParse({ type: 'doc', content: [], futureField: true }).success).toBe(false);
  });
});
