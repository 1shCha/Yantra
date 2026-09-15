import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import { tiptapDocSchema, tiptapNodeSchema, tiptapMarkSchema, tiptapNodeTypeSchema, tiptapMarkTypeSchema } from '../../shared/tiptap-document';
import { decodeDocument, newDocument } from '../../shared/vault-format';
import { readingNotes } from '../vault-preview/preview-documents';

import { documentEditorExtensions, documentSchemaExtensions, renderTiptapDocToHtml } from './tiptap-schema';

describe('shared document schema', () => {
  it('matches the shared storage node and mark vocabulary, including extension defaults', () => {
    for (const extensions of [documentEditorExtensions, documentSchemaExtensions]) {
      const schema = getSchema(extensions);
      expect(Object.keys(schema.nodes).filter(name => name !== 'doc').sort())
        .toEqual([...tiptapNodeTypeSchema.options].sort());
      expect(Object.keys(schema.marks).sort()).toEqual([...tiptapMarkTypeSchema.options].sort());
      for (const [name, type] of Object.entries(schema.nodes)) {
        if (name === 'doc' || name === 'text') continue;
        const json = type.create().toJSON();
        expect(tiptapNodeSchema.parse(json)).toEqual(json);
      }
      for (const type of Object.values(schema.marks)) {
        const json = type.create().toJSON();
        expect(tiptapMarkSchema.parse(json)).toEqual(json);
      }
    }
  });

  it('round-trips rich document content through both editor and preview schemas', () => {
    const editorSchema = getSchema(documentEditorExtensions);
    const previewSchema = getSchema(documentSchemaExtensions);
    const editorDoc = editorSchema.nodeFromJSON(readingNotes);
    editorDoc.check();
    const storedDoc = tiptapDocSchema.parse(editorDoc.toJSON());
    const previewDoc = previewSchema.nodeFromJSON(storedDoc);
    previewDoc.check();
    expect(previewDoc.toJSON()).toEqual(editorDoc.toJSON());
    expect(editorSchema.nodeFromJSON(storedDoc).eq(editorDoc)).toBe(true);
  });

  it('preserves ordered-list styles and link titles through disk and preview round trips', () => {
    const schema = getSchema(documentEditorExtensions);
    const model = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Notes' }] },
      { type: 'orderedList', attrs: { start: 3, type: 'A' }, content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [
          { type: 'text', text: 'Reference', marks: [{ type: 'link', attrs: { href: 'https://example.com', title: 'Source title' } }] },
        ] }] },
      ] },
    ] });
    model.check();
    const doc = tiptapDocSchema.parse(model.toJSON());
    const reopened = decodeDocument(JSON.stringify({ ...newDocument('Notes'), doc }));
    expect(reopened.doc).toEqual(model.toJSON());
    expect(schema.nodeFromJSON(reopened.doc).eq(model)).toBe(true);
    const html = renderTiptapDocToHtml(reopened.doc);
    expect(html).toContain('type="A"');
    expect(html).toContain('title="Source title"');
  });

  it('keeps the same content types when adding editor-only behavior', () => {
    const editorSchema = getSchema(documentEditorExtensions);
    const previewSchema = getSchema(documentSchemaExtensions);
    expect(Object.keys(editorSchema.nodes)).toEqual(Object.keys(previewSchema.nodes));
    expect(Object.keys(editorSchema.marks)).toEqual(Object.keys(previewSchema.marks));
  });
});

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
