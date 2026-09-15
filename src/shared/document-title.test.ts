import { describe, expect, it } from 'vitest';
import { documentTitle, titleFilename, titleNameError, withDocumentTitle } from './document-title';
import { createEmptyTiptapDoc, type TiptapDoc } from './tiptap-document';

describe('document title filenames', () => {
  it('converts every space deterministically without changing case or numbers', () => {
    expect(titleFilename('My Project 2')).toBe('My_Project_2');
    expect(titleFilename('  Two  Spaces ')).toBe('__Two__Spaces_');
    expect(titleFilename('2026')).toBe('2026');
    expect(titleFilename('A'.repeat(180))).toHaveLength(180);
  });
  it('rejects blank, invalid, and overlong names instead of silently changing them', () => {
    for (const title of ['', '  ', 'A_B', 'A-B', 'A/B', 'A.B', 'A\nB', 'A'.repeat(181)]) {
      expect(titleNameError(title)).not.toBeNull();
      expect(() => titleFilename(title)).toThrow();
    }
  });
  it('updates only the first title block and keeps already-matching content stable', () => {
    const doc = { ...createEmptyTiptapDoc(), content: [...createEmptyTiptapDoc().content!, { type: 'paragraph', content: [{ type: 'text', text: 'Body 123!' }] }] } satisfies TiptapDoc;
    const updated = withDocumentTitle(doc, 'Project 2');
    expect(documentTitle(updated)).toBe('Project 2');
    expect(updated.content?.[1]).toEqual(doc.content[1]);
    expect(withDocumentTitle(updated, 'Project 2')).toBe(updated);
  });
});
