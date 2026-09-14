import { OperationError } from './operation-result';
import type { TiptapDoc, TiptapNode } from './tiptap-document';
import { MAX_VAULT_NAME_LENGTH } from './vault-paths';

export const TITLE_INPUT_ERROR = 'Titles can contain only English letters, numbers, and spaces. Text was not inserted.';

export function validTitleText(text: string): boolean {
  return !/[^A-Za-z0-9 ]/.test(text);
}

export function titleNameError(text: string): string | null {
  if (!text.trim()) return 'Enter a title before applying the filename.';
  if (!validTitleText(text)) return 'Use only English letters, numbers, and spaces in the title.';
  if (text.length > MAX_VAULT_NAME_LENGTH) return `The title must be ${MAX_VAULT_NAME_LENGTH} characters or fewer to use as a filename.`;
  return null;
}

export function titleFilename(text: string): string {
  const error = titleNameError(text);
  if (error) throw new OperationError({ code: 'invalid-input', message: error });
  return text.replaceAll(' ', '_');
}

export function documentTitle(doc: TiptapDoc): string {
  const first = doc.content?.[0];
  if (first?.type !== 'heading' || first.attrs?.level !== 1) return '';
  return first.content?.map((node) => node.text ?? '').join('') ?? '';
}

export function withDocumentTitle(doc: TiptapDoc, text: string): TiptapDoc {
  if (documentTitle(doc) === text) return doc;
  const title: TiptapNode = { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text }] };
  const content = doc.content ?? [];
  return { ...doc, content: [title, ...content.slice(content[0]?.type === 'heading' && content[0].attrs?.level === 1 ? 1 : 0)] };
}
