import { tiptapDocSchema } from './tiptap-document';
import { describe, expect, it } from 'vitest';
import { decodeDocument, newDocument } from './vault-format';
import { readingNotes } from '../renderer/vault-preview/preview-documents';

describe('public document format', () => {
  it('round-trips the existing rich editor content', () => {
    const document = { ...newDocument('Reading_notes'), doc: tiptapDocSchema.parse(readingNotes) };
    expect(decodeDocument(JSON.stringify(document))).toEqual(document);
  });

  it('rejects future versions, content types, and attributes instead of stripping them', () => {
    const document = newDocument('Notes');
    expect(() => decodeDocument(JSON.stringify({ ...document, formatVersion: 2 }))).toThrow('Unsupported');
    expect(() => decodeDocument(JSON.stringify({ ...document, doc: { type: 'doc', content: [{ type: 'futureNode' }] } }))).toThrow();
    expect(() => decodeDocument(JSON.stringify({ ...document, doc: { type: 'doc', content: [{ type: 'paragraph', attrs: { futureSetting: true } }] } }))).toThrow();
  });
});
