import type { TiptapDoc } from '../../shared/tiptap-document';
import { renderTiptapDocToHtml } from './tiptap-schema';

// Documents are immutable. Weak keys reuse HTML after viewport remounts without
// retaining documents that have been closed or replaced by newer revisions.
const previews = new WeakMap<TiptapDoc, { __html: string }>();

export function getDocumentPreview(doc: TiptapDoc) {
  const cached = previews.get(doc);
  if (cached) return cached;
  const preview = { __html: renderTiptapDocToHtml(doc) };
  previews.set(doc, preview);
  return preview;
}
