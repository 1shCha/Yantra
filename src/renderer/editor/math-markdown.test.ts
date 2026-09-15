import { describe, expect, it } from 'vitest';
import { MarkdownManager } from '@tiptap/markdown';
import { documentSchemaExtensions } from './tiptap-schema';
import { parseClipboardMarkdown } from './math-markdown';

const manager = new MarkdownManager({ extensions: documentSchemaExtensions });
const parse = (text: string) => parseClipboardMarkdown(manager, text);

describe('Markdown equation import', () => {
  it('parses inline delimiters without losing backslashes', () => {
    const doc = parse('A $x^2$ and \\(\\frac{a}{b}\\).');
    expect(doc.content?.[0]?.content).toEqual([
      { type: 'text', text: 'A ' }, { type: 'inlineMath', attrs: { latex: 'x^2' } },
      { type: 'text', text: ' and ' }, { type: 'inlineMath', attrs: { latex: '\\frac{a}{b}' } }, { type: 'text', text: '.' },
    ]);
  });
  it.each(['$$\n\\frac{a}{b}\n$$', '\\[\n\\frac{a}{b}\n\\]', '```math\n\\frac{a}{b}\n```'])('parses display math: %s', source => {
    expect(parse(source).content).toEqual([{ type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } }]);
  });
  it('preserves code, currency, escaped dollars, and unmatched delimiters', () => {
    const source = 'Price $5 and $10. Escaped \\$x$ and unmatched \\(x. `F=ma` and `$x$`.\n\n```js\nconst x = "$x$";\n```';
    const doc = parse(source);
    expect(JSON.stringify(doc)).not.toContain('Math');
    expect(doc.content?.[0]?.content).toContainEqual({ type: 'text', text: 'F=ma', marks: [{ type: 'code' }] });
    expect(doc.content?.[1]?.type).toBe('codeBlock');
  });
  it('retains lists, bold, and blockquotes around equations', () => {
    const doc = parse('## Notes\n\n> **Force** $F=ma$\n\n- \\(x\\)\n- Second\n\n  ```math\n  y^2\n  ```');
    expect(doc.content?.map(node => node.type)).toEqual(['heading', 'blockquote', 'bulletList']);
    expect(JSON.stringify(doc)).toContain('blockMath');
    expect(JSON.stringify(doc)).toContain('bold');
  });
  it('round-trips valid math through Markdown serialization', () => {
    const doc = parse('A $x^2$.\n\n$$\n\\frac{a}{b}\n$$');
    expect(parse(manager.serialize(doc))).toEqual(doc);
  });
});

it('preserves unmatched delimiters and avoids numeric currency conversion', () => {
  const doc = parse('Unmatched \\(x and price $5$.');
  expect(doc.content?.[0]?.content).toEqual([{ type: 'text', text: 'Unmatched \\(x and price $5$.' }]);
});

it('round-trips numeric equations with unambiguous exported delimiters', () => {
  const doc = parse('\\(5\\)');
  expect(parse(manager.serialize(doc))).toEqual(doc);
});
