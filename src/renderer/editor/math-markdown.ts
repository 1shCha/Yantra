import type { JSONContent } from '@tiptap/core';
import type { MarkdownManager } from '@tiptap/markdown';

function escapedAt(source: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function delimited(source: string, open: string, close: string, multiline: boolean) {
  if (!source.startsWith(open)) return undefined;
  for (let end = open.length; end < source.length; end++) {
    if (!multiline && source[end] === '\n') return undefined;
    if (!source.startsWith(close, end) || escapedAt(source, end)) continue;
    const latex = source.slice(open.length, end);
    if (!latex.trim()) return undefined;
    return { raw: source.slice(0, end + close.length), latex };
  }
  return undefined;
}

export const inlineMathTokenizer = {
  name: 'inlineMath',
  level: 'inline' as const,
  start: (source: string) => source.search(/\$|\\[()[\]]/),
  tokenize(source: string) {
    if (source.startsWith('$$')) return undefined;
    const parenthesized = source.startsWith('\\(');
    const match = delimited(source, parenthesized ? '\\(' : '$', parenthesized ? '\\)' : '$', false);
    if (!match) return source.startsWith('\\') && /[()[\]]/.test(source[1] ?? '')
      ? { type: 'text', raw: source.slice(0, 2), text: source.slice(0, 2) } : undefined;
    if (!parenthesized) {
      // Dollar notation is deliberately conservative around currency and spaces.
      if (/^\s|\s$/.test(match.latex) || /^\d/.test(source.slice(match.raw.length))
        || /^\d+(?:[.,]\d+)?(?:$|\s|[.,]\s)/.test(match.latex) || source[match.raw.length] === '$') return undefined;
    }
    return { type: 'inlineMath', ...match };
  },
};

export const blockMathTokenizer = {
  name: 'blockMath',
  level: 'block' as const,
  start: (source: string) => source.search(/^(?: {0,3})(?:\$\$|\\\[)/m),
  tokenize(source: string) {
    const indentation = source.match(/^ {0,3}/)![0];
    const text = source.slice(indentation.length);
    const bracketed = text.startsWith('\\[');
    const match = delimited(text, bracketed ? '\\[' : '$$', bracketed ? '\\]' : '$$', true);
    if (!match || !/^[ \t]*(?:\n|$)/.test(text.slice(match.raw.length))) return undefined;
    const trailing = text.slice(match.raw.length).match(/^[ \t]*(?:\n|$)/)![0];
    return { type: 'blockMath', latex: match.latex.trim(), raw: indentation + match.raw + trailing };
  },
};

export function normalizeMarkdownMath(node: JSONContent): JSONContent {
  if (node.type === 'codeBlock' && node.attrs?.language?.toLowerCase() === 'math') {
    return { type: 'blockMath', attrs: { latex: node.content?.map(child => child.text ?? '').join('') ?? '' } };
  }
  return node.content ? { ...node, content: node.content.map(normalizeMarkdownMath) } : node;
}

export function parseClipboardMarkdown(manager: MarkdownManager, text: string): JSONContent {
  return normalizeMarkdownMath(manager.parse(text));
}

export function looksLikeMarkdown(text: string): boolean {
  return /(^|\n) {0,3}(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s|`{3}|~{3}|\$\$|\\\[)/.test(text)
    || /\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^\n]+\)|\$[^$\n]+\$|\\\(/.test(text);
}
