import { getSchema } from '@tiptap/core';
import { EditorState, NodeSelection } from '@tiptap/pm/state';
import { closeHistory, history, redo, undo } from '@tiptap/pm/history';
import { describe, expect, it } from 'vitest';
import { documentEditorExtensions, renderTiptapDocToHtml } from './tiptap-schema';
import { titleProtectionPlugin } from './protected-title';
import { isTiptapDocEmpty, tiptapDocSchema, type TiptapDoc } from '../../shared/tiptap-document';
import { decodeDocument, newDocument } from '../../shared/vault-format';
import { lastMeaningfulCaretPos } from '../canvas/last-meaningful-caret-pos';

const source = '\\frac{a}{b} + \\sqrt{x}';
const doc: TiptapDoc = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 } },
  { type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: source } }] },
  { type: 'blockMath', attrs: { latex: source } },
] };
const schema = getSchema(documentEditorExtensions);

describe('equations', () => {
  it('preserves source through editor validation, disk encoding, and reopening', () => {
    const model = schema.nodeFromJSON(doc);
    model.check();
    const stored = tiptapDocSchema.parse(model.toJSON());
    const file = { ...newDocument('Equations'), doc: stored };
    const reopened = decodeDocument(JSON.stringify(file));
    expect(schema.nodeFromJSON(reopened.doc).eq(model)).toBe(true);
    expect(reopened.doc.content?.[2]?.attrs?.latex).toBe(source);
    expect(isTiptapDocEmpty(reopened.doc)).toBe(false);
  });

  it('typesets both preview modes with MathML and preserves malformed source', () => {
    const html = renderTiptapDocToHtml(doc);
    expect(html).toContain('katex-display');
    expect(html.match(/class="katex-mathml"/g)).toHaveLength(2);
    expect(html).not.toContain('data-yantra-math-preview');
    const malformed = renderTiptapDocToHtml({ type: 'doc', content: [
      { type: 'blockMath', attrs: { latex: '\\frac{' } },
    ] });
    expect(malformed).toContain('katex-error');
    expect(malformed).toContain('\\frac{');
  });

  it('escapes HTML-like source rather than introducing executable markup', () => {
    const html = renderTiptapDocToHtml({ type: 'doc', content: [
      { type: 'blockMath', attrs: { latex: '<script>alert(1)</script>' } },
    ] });
    expect(html).not.toContain('<script>');
  });

  it('supports undo/redo of equation edits and rejects equations in the title', () => {
    let state = EditorState.create({ schema, doc: schema.nodeFromJSON(doc), plugins: [history(), titleProtectionPlugin(() => {})] });
    const original = state.doc;
    state = state.applyTransaction(state.tr.insert(1, schema.nodes.inlineMath!.create({ latex: 'x' }))).state;
    expect(state.doc.eq(original)).toBe(true);
    const pos = state.doc.child(0).nodeSize + 1;
    state = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos)));
    state = state.apply(closeHistory(state.tr).setNodeMarkup(pos, undefined, { latex: 'x^2' }));
    undo(state, tr => { state = state.apply(tr); });
    expect(state.doc.eq(original)).toBe(true);
    redo(state, tr => { state = state.apply(tr); });
    expect(state.doc.nodeAt(pos)?.attrs.latex).toBe('x^2');
  });

  it('recognizes inline-only and block-only math and positions the caret after it', () => {
    for (const content of [doc.content!.slice(1, 2), doc.content!.slice(2)]) {
      const value: TiptapDoc = { type: 'doc', content };
      expect(isTiptapDocEmpty(value)).toBe(false);
    }
    const model = schema.nodeFromJSON(doc);
    expect(lastMeaningfulCaretPos(model)).toBe(model.content.size);
  });
});
