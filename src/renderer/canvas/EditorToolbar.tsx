import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';

import { useCanvasEditor } from './canvas-editor-context';

type HeadingLevel = 1 | 2 | 3;
type TextAlignment = 'left' | 'center' | 'right';

interface EditorToolbarState {
  canRedo: boolean;
  canUndo: boolean;
  codeBlockLanguage: string;
  headingLevel: HeadingLevel | null;
  isBold: boolean;
  isBulletList: boolean;
  isCodeBlock: boolean;
  isHighlight: boolean;
  isItalic: boolean;
  isLink: boolean;
  isOrderedList: boolean;
  isTaskList: boolean;
  linkHref: string;
  textAlign: TextAlignment | null;
}

const CODE_BLOCK_LANGUAGES = [
  { label: 'Plain', value: '' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'Python', value: 'python' },
  { label: 'Rust', value: 'rust' },
  { label: 'Go', value: 'go' },
  { label: 'JSON', value: 'json' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'Bash', value: 'bash' },
  { label: 'SQL', value: 'sql' },
] as const;

function getTextAlignment(editor: Editor): TextAlignment | null {
  if (editor.isActive({ textAlign: 'left' })) {
    return 'left';
  }

  if (editor.isActive({ textAlign: 'center' })) {
    return 'center';
  }

  if (editor.isActive({ textAlign: 'right' })) {
    return 'right';
  }

  return null;
}

function getLinkHref(editor: Editor): string {
  if (!editor.isActive('link')) {
    return '';
  }

  const { href } = editor.getAttributes('link');
  if (href === null || href === undefined || href === '') {
    return '';
  }

  return `${href}`;
}

function normalizeLinkHref(raw: string): string | null {
  const href = raw.trim();
  if (href === '') {
    return null;
  }

  try {
    const parsed = new URL(href);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    try {
      const parsed = new URL(`https://${href}`);
      if (parsed.protocol === 'https:' && parsed.hostname !== '') {
        return parsed.toString();
      }
    } catch {
      return null;
    }
  }

  return null;
}

function getHeadingLevel(editor: Editor): HeadingLevel | null {
  if (editor.isActive('heading', { level: 1 })) {
    return 1;
  }

  if (editor.isActive('heading', { level: 2 })) {
    return 2;
  }

  if (editor.isActive('heading', { level: 3 })) {
    return 3;
  }

  return null;
}

function getCodeBlockLanguage(editor: Editor): string {
  if (!editor.isActive('codeBlock')) {
    return '';
  }

  const { language } = editor.getAttributes('codeBlock');
  return language === null || language === undefined ? '' : String(language);
}

function readToolbarState(editor: Editor): EditorToolbarState {
  return {
    canRedo: editor.can().redo(),
    canUndo: editor.can().undo(),
    codeBlockLanguage: getCodeBlockLanguage(editor),
    headingLevel: getHeadingLevel(editor),
    isBold: editor.isActive('bold'),
    isBulletList: editor.isActive('bulletList'),
    isCodeBlock: editor.isActive('codeBlock'),
    isHighlight: editor.isActive('highlight'),
    isItalic: editor.isActive('italic'),
    isLink: editor.isActive('link'),
    isOrderedList: editor.isActive('orderedList'),
    isTaskList: editor.isActive('taskList'),
    linkHref: getLinkHref(editor),
    textAlign: getTextAlignment(editor),
  };
}

function preventToolbarMouseDown(event: React.MouseEvent<HTMLElement>) {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  event.preventDefault();
}

function setCodeBlockLanguage(editor: Editor, language: string) {
  editor
    .chain()
    .focus()
    .updateAttributes('codeBlock', {
      language: language === '' ? null : language,
    })
    .run();
}

function applyLinkHref(editor: Editor, raw: string) {
  const href = normalizeLinkHref(raw);
  if (href === null) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
}

function EditorToolbarControls({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => readToolbarState(currentEditor),
  });
  const hasKnownLanguage = CODE_BLOCK_LANGUAGES.some(
    (language) => language.value === state.codeBlockLanguage,
  );
  const [isLinkPopoverOpen, setIsLinkPopoverOpen] = useState(false);
  const [linkHref, setLinkHref] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLinkPopoverOpen) {
      return;
    }

    linkInputRef.current?.focus();
    linkInputRef.current?.select();
  }, [isLinkPopoverOpen]);

  return (
    <aside
      className="editor-toolbar"
      aria-label="Text formatting"
      onMouseDown={preventToolbarMouseDown}
    >
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isBold}
        onClick={() => {
          editor.chain().focus().toggleBold().run();
        }}
      >
        Bold
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isItalic}
        onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      >
        Italic
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isHighlight}
        onClick={() => {
          editor.chain().focus().toggleHighlight().run();
        }}
      >
        Highlight
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.headingLevel === 1}
        onClick={() => {
          editor.chain().focus().toggleHeading({ level: 1 }).run();
        }}
      >
        H1
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.headingLevel === 2}
        onClick={() => {
          editor.chain().focus().toggleHeading({ level: 2 }).run();
        }}
      >
        H2
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.headingLevel === 3}
        onClick={() => {
          editor.chain().focus().toggleHeading({ level: 3 }).run();
        }}
      >
        H3
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.textAlign === 'left'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('left').run();
        }}
      >
        Left
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.textAlign === 'center'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('center').run();
        }}
      >
        Center
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.textAlign === 'right'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('right').run();
        }}
      >
        Right
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isBulletList}
        onClick={() => {
          editor.chain().focus().toggleBulletList().run();
        }}
      >
        List
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isOrderedList}
        onClick={() => {
          editor.chain().focus().toggleOrderedList().run();
        }}
      >
        Numbered
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isTaskList}
        onClick={() => {
          editor.chain().focus().toggleTaskList().run();
        }}
      >
        Tasks
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isCodeBlock}
        onClick={() => {
          editor.chain().focus().toggleCodeBlock().run();
        }}
      >
        Code
      </button>
      <select
        className="editor-toolbar__select"
        aria-label="Code language"
        disabled={!state.isCodeBlock}
        value={state.codeBlockLanguage}
        onChange={(event) => {
          setCodeBlockLanguage(editor, event.currentTarget.value);
        }}
      >
        {hasKnownLanguage ? null : (
          <option value={state.codeBlockLanguage}>{state.codeBlockLanguage}</option>
        )}
        {CODE_BLOCK_LANGUAGES.map((language) => (
          <option key={language.value === '' ? 'plain' : language.value} value={language.value}>
            {language.label}
          </option>
        ))}
      </select>
      <button
        className="editor-toolbar__action"
        type="button"
        aria-pressed={state.isLink || isLinkPopoverOpen}
        onClick={() => {
          if (isLinkPopoverOpen) {
            setIsLinkPopoverOpen(false);
            return;
          }

          setLinkHref(getLinkHref(editor));
          setIsLinkPopoverOpen(true);
        }}
      >
        Link
      </button>
      {isLinkPopoverOpen ? (
        <span className="editor-toolbar__link-popover">
          <input
            ref={linkInputRef}
            className="editor-toolbar__link-input"
            type="text"
            aria-label="Link URL"
            placeholder="https://"
            value={linkHref}
            onChange={(event) => {
              setLinkHref(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLinkHref(editor, linkHref);
                setIsLinkPopoverOpen(false);
              }

              if (event.key === 'Escape') {
                event.preventDefault();
                setIsLinkPopoverOpen(false);
              }
            }}
          />
          <button
            className="editor-toolbar__action"
            type="button"
            onClick={() => {
              applyLinkHref(editor, linkHref);
              setIsLinkPopoverOpen(false);
            }}
          >
            Apply
          </button>
          <button
            className="editor-toolbar__action"
            type="button"
            disabled={!state.isLink}
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setLinkHref('');
              setIsLinkPopoverOpen(false);
            }}
          >
            Remove
          </button>
        </span>
      ) : null}
      <button
        className="editor-toolbar__action"
        type="button"
        disabled={!state.canUndo}
        onClick={() => {
          editor.chain().focus().undo().run();
        }}
      >
        Undo
      </button>
      <button
        className="editor-toolbar__action"
        type="button"
        disabled={!state.canRedo}
        onClick={() => {
          editor.chain().focus().redo().run();
        }}
      >
        Redo
      </button>
    </aside>
  );
}

export function EditorToolbar() {
  const { editor } = useCanvasEditor();
  if (editor === null) {
    return null;
  }

  return <EditorToolbarControls editor={editor} />;
}
