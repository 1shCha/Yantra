import { describe, expect, it } from 'vitest';

import { renderTiptapDocToHtml } from './tiptap-schema';

describe('renderTiptapDocToHtml', () => {
  it('keeps empty paragraphs as line-height breaks in preview HTML', () => {
    const html = renderTiptapDocToHtml({
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title', marks: [{ type: 'bold' }] }],
        },
        { type: 'paragraph' },
        { type: 'paragraph' },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'hello' }],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('<p><br></p>');
    expect(html.match(/<p><br><\/p>/g)?.length).toBe(2);
    expect(html).toContain('<ol>');
  });

  it('renders highlight, alignment, and links in preview HTML', () => {
    const html = renderTiptapDocToHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'Go',
              marks: [
                { type: 'highlight' },
                {
                  type: 'link',
                  attrs: { href: 'https://example.com' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('text-align: center');
    expect(html).toContain('<mark>');
    expect(html).toContain('href="https://example.com"');
  });
});
