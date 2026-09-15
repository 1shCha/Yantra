import katex from 'katex';

export const mathOptions = { throwOnError: false, trust: false, maxSize: 20, maxExpand: 1000 };
export type MathKind = 'inlineMath' | 'blockMath';

export function renderMath(latex: string, block: boolean): string {
  return katex.renderToString(latex, { ...mathOptions, displayMode: block });
}

