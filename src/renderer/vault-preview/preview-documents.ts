import type { TiptapDoc, TiptapNode } from '../../shared/tiptap-document';

function paragraph(text: string): TiptapNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

export const readingNotes: TiptapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Reading notes' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Local-first software', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' starts with a simple question: ' },
      { type: 'text', text: 'who owns the working copy?', marks: [{ type: 'italic' }] },
    ] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Observations' }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [paragraph('A useful idea often belongs in more than one conversation.')] },
      { type: 'listItem', content: [paragraph('Spatial context can help explain why two ideas belong together.')] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Identity should survive a change in location.', marks: [{ type: 'highlight' }] }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Questions to follow' }] },
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [paragraph('Compare file paths with stable identifiers.')] },
      { type: 'taskItem', attrs: { checked: false }, content: [paragraph('Explore what happens when a document moves.')] },
    ] },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'A small example' }] },
    { type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text: '{\n  "id": "reading-notes",\n  "title": "Reading notes"\n}' }] },
    { type: 'orderedList', content: [
      { type: 'listItem', content: [paragraph('Read the source and capture the useful questions.')] },
      { type: 'listItem', content: [paragraph('Arrange the notes beside related work.')] },
      { type: 'listItem', content: [paragraph('Return to the original context before drawing conclusions.')] },
    ] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Reference notes', marks: [{ type: 'link', attrs: { href: 'https://example.com/reading' } }] }] },
  ],
};

export const questions: TiptapDoc = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Open questions' }] },
    paragraph('What gives a document its identity?'),
    paragraph('Which relationships belong to the content, and which belong to the canvas?'),
  ],
};

export const nextSteps: TiptapDoc = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next reading' }] },
    paragraph('Revisit these ideas alongside the architecture notes.'),
  ],
};
