/** Normalize known math markup in an inert clipboard document before schema parsing. */
export function normalizeClipboardMathHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let changed = false;
  const replace = (element: Element, latex: string, block: boolean) => {
    const node = doc.createElement(block ? 'div' : 'span');
    node.setAttribute('data-type', block ? 'block-math' : 'inline-math');
    node.setAttribute('data-latex', latex);
    const slice = element.getAttribute('data-pm-slice');
    if (slice !== null) node.setAttribute('data-pm-slice', slice);
    element.replaceWith(node);
    changed = true;
  };
  // Process outer containers first; detached descendants are skipped, preventing
  // duplication of KaTeX's visual HTML and its parallel MathML representation.
  const candidates = doc.querySelectorAll('[data-type="inline-math"], [data-type="block-math"], [data-math-source], .katex-display, .katex, math');
  for (const element of candidates) {
    if (!doc.body.contains(element) || element.closest('pre, code')) continue;
    const native = element.getAttribute('data-type');
    const latex = element.getAttribute('data-math-source')
      ?? element.getAttribute('data-latex')
      ?? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (latex == null) continue;
    const block = native === 'block-math' || element.classList.contains('katex-display')
      || element.getAttribute('display') === 'block' || element.getAttribute('data-math-display') === 'block'
      || element.querySelector('.katex-display, math[display="block"]') !== null;
    replace(element, latex, block);
  }
  for (const code of doc.querySelectorAll('pre > code.language-math, pre > code[data-language="math"]')) {
    if (code.parentElement) replace(code.parentElement, code.textContent ?? '', true);
  }
  return changed ? doc.body.innerHTML : html;
}
