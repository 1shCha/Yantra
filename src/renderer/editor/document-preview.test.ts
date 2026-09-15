import { expect, it } from 'vitest';
import type { TiptapDoc } from '../../shared/tiptap-document';
import { getDocumentPreview } from './document-preview';


it('reuses a preview across consumers and renders a new immutable revision once', () => {
  const doc: TiptapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
  const preview = getDocumentPreview(doc);
  expect(getDocumentPreview(doc)).toBe(preview);
  expect(preview.__html).toContain('<p><br></p>');
  const updated: TiptapDoc = { type: 'doc', content: [{ type: 'blockMath', attrs: { latex: 'x' } }] };
  expect(getDocumentPreview(updated)).not.toBe(preview);
  expect(getDocumentPreview(updated).__html).toContain('katex');
});
