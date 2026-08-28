import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import type { TiptapDoc, TiptapNode } from '../../shared/tiptap-document';
import { lastMeaningfulCaretPos } from './last-meaningful-caret-pos';
import { canvasTiptapSchemaExtensions } from './tiptap-schema';

const schema = getSchema(canvasTiptapSchemaExtensions);

function caretPos(doc: TiptapDoc): number {
  return lastMeaningfulCaretPos(Node.fromJSON(schema, doc));
}

function paragraphDoc(...blocks: TiptapNode[]): TiptapDoc {
  return {
    type: 'doc',
    content: blocks,
  };
}

describe('lastMeaningfulCaretPos', () => {
  it('places the caret inside an empty paragraph', () => {
    expect(caretPos(paragraphDoc({ type: 'paragraph' }))).toBe(1);
  });

  it('skips trailing spaces in the last text', () => {
    expect(
      caretPos(
        paragraphDoc({
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello   ' }],
        }),
      ),
    ).toBe(6);
  });

  it('skips trailing hard breaks after text', () => {
    expect(
      caretPos(
        paragraphDoc({
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello' }, { type: 'hardBreak' }, { type: 'hardBreak' }],
        }),
      ),
    ).toBe(6);
  });

  it('skips trailing empty paragraphs', () => {
    expect(
      caretPos(
        paragraphDoc(
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hello' }],
          },
          { type: 'paragraph' },
          { type: 'paragraph' },
        ),
      ),
    ).toBe(6);
  });
});
