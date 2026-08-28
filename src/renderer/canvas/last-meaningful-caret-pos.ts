import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function lastMeaningfulCaretPos(doc: ProseMirrorNode): number {
  let found = 1;

  doc.descendants((node, pos) => {
    if (!node.isText) {
      return;
    }

    const text = node.text;
    if (text === undefined) {
      return;
    }

    const trimmedLength = text.trimEnd().length;
    if (trimmedLength > 0) {
      found = pos + trimmedLength;
    }
  });

  return found;
}
