import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type SVGProps } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';

import { useCanvasEditor } from './canvas-editor-context';

type HeadingLevel = 1 | 2 | 3;
type TextAlignment = 'left' | 'center' | 'right';
type OpenToolbarMenu = 'heading' | 'link' | null;

export type EditorToolbarMenuSide = 'above' | 'below';

interface EditorToolbarProps {
  menuSide: EditorToolbarMenuSide;
}

interface EditorToolbarControlsProps {
  editor: Editor;
  menuSide: EditorToolbarMenuSide;
}

interface ToolbarButtonProps {
  children: ReactNode;
  disabled?: boolean;
  expanded?: boolean;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}

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

const HEADING_OPTIONS: ReadonlyArray<{ label: string; level: HeadingLevel | null }> = [
  { label: 'Paragraph', level: null },
  { label: 'Heading 1', level: 1 },
  { label: 'Heading 2', level: 2 },
  { label: 'Heading 3', level: 3 },
];

const toolbarIconProps: SVGProps<SVGSVGElement> = {
  'aria-hidden': true,
  fill: 'none',
  height: 16,
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 2,
  viewBox: '0 0 24 24',
  width: 16,
};

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

function preventToolbarMouseDown(event: MouseEvent<HTMLElement>) {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
  ) {
    return;
  }

  event.preventDefault();
}

function stopToolbarPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
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

function applyHeading(editor: Editor, level: HeadingLevel | null) {
  if (level === null) {
    editor.chain().focus().setParagraph().run();
    return;
  }

  editor.chain().focus().toggleHeading({ level }).run();
}

function ToolbarButton({
  children,
  disabled,
  expanded,
  label,
  pressed,
  onClick,
}: ToolbarButtonProps) {
  return (
    <button
      className="editor-toolbar__action"
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function EditorToolbarControls({ editor, menuSide }: EditorToolbarControlsProps) {
  const toolbarRef = useRef<HTMLElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<OpenToolbarMenu>(null);
  const [linkHref, setLinkHref] = useState('');
  const state = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => readToolbarState(currentEditor),
  });
  const hasKnownLanguage = CODE_BLOCK_LANGUAGES.some(
    (language) => language.value === state.codeBlockLanguage,
  );

  useEffect(() => {
    if (openMenu === null) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (toolbarRef.current?.contains(target) === true) {
        return;
      }

      setOpenMenu(null);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== 'link') {
      return;
    }

    linkInputRef.current?.focus();
    linkInputRef.current?.select();
  }, [openMenu]);

  return (
    <aside
      ref={toolbarRef}
      className="editor-toolbar nodrag nopan nowheel"
      data-menu-side={menuSide}
      aria-label="Text formatting"
      onMouseDown={preventToolbarMouseDown}
      onPointerDown={stopToolbarPropagation}
      onDoubleClick={stopToolbarPropagation}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || openMenu === null) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
        editor.chain().focus().run();
      }}
    >
      <ToolbarButton
        label="Undo"
        disabled={!state.canUndo}
        onClick={() => {
          editor.chain().focus().undo().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.7 2.9L3 13" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Redo"
        disabled={!state.canRedo}
        onClick={() => {
          editor.chain().focus().redo().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6.7 2.9L21 13" />
        </svg>
      </ToolbarButton>

      <span className="editor-toolbar__divider" role="separator" />

      <span className="editor-toolbar__control">
        <button
          className="editor-toolbar__action editor-toolbar__heading"
          type="button"
          aria-label="Heading"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'heading'}
          aria-pressed={state.headingLevel !== null}
          onClick={() => {
            setOpenMenu((current) => (current === 'heading' ? null : 'heading'));
          }}
        >
          <span className="editor-toolbar__heading-label">H</span>
          <svg {...toolbarIconProps} width={12} height={12}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {openMenu === 'heading' ? (
          <div className="editor-toolbar__popover" role="menu" aria-label="Heading">
            {HEADING_OPTIONS.map((option) => {
              const isActive = option.level === state.headingLevel;
              return (
                <button
                  key={option.label}
                  className="editor-toolbar__menu-item"
                  type="button"
                  role="menuitem"
                  aria-pressed={isActive}
                  onClick={() => {
                    applyHeading(editor, option.level);
                    setOpenMenu(null);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
      <ToolbarButton
        label="Bullet list"
        pressed={state.isBulletList}
        onClick={() => {
          editor.chain().focus().toggleBulletList().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M8 6h13" />
          <path d="M8 12h13" />
          <path d="M8 18h13" />
          <path d="M3 6h.01" />
          <path d="M3 12h.01" />
          <path d="M3 18h.01" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        pressed={state.isOrderedList}
        onClick={() => {
          editor.chain().focus().toggleOrderedList().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M10 6h11" />
          <path d="M10 12h11" />
          <path d="M10 18h11" />
          <path d="M4 6h1v4" />
          <path d="M4 10h2" />
          <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Task list"
        pressed={state.isTaskList}
        onClick={() => {
          editor.chain().focus().toggleTaskList().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <rect x="3" y="5" width="6" height="6" rx="1" />
          <path d="m4.5 8 1.2 1.2 2.3-2.4" />
          <path d="M12 7h9" />
          <rect x="3" y="13" width="6" height="6" rx="1" />
          <path d="M12 16h9" />
        </svg>
      </ToolbarButton>

      <span className="editor-toolbar__divider" role="separator" />

      <ToolbarButton
        label="Code block"
        pressed={state.isCodeBlock}
        onClick={() => {
          editor.chain().focus().toggleCodeBlock().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="m16 18 6-6-6-6" />
          <path d="m8 6-6 6 6 6" />
        </svg>
      </ToolbarButton>
      {state.isCodeBlock ? (
        <select
          className="editor-toolbar__select"
          aria-label="Code language"
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
      ) : null}

      <span className="editor-toolbar__divider" role="separator" />

      <ToolbarButton
        label="Bold"
        pressed={state.isBold}
        onClick={() => {
          editor.chain().focus().toggleBold().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M6 4h8a4 4 0 0 1 0 8H6z" />
          <path d="M6 12h9a4 4 0 0 1 0 8H6z" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        pressed={state.isItalic}
        onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <line x1="19" x2="10" y1="4" y2="4" />
          <line x1="14" x2="5" y1="20" y2="20" />
          <line x1="15" x2="9" y1="4" y2="20" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Highlight"
        pressed={state.isHighlight}
        onClick={() => {
          editor.chain().focus().toggleHighlight().run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="m9 11-6 6v3h9l3-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      </ToolbarButton>
      <span className="editor-toolbar__control">
        <ToolbarButton
          label="Link"
          pressed={state.isLink || openMenu === 'link'}
          expanded={openMenu === 'link'}
          onClick={() => {
            if (openMenu === 'link') {
              setOpenMenu(null);
              return;
            }

            setLinkHref(getLinkHref(editor));
            setOpenMenu('link');
          }}
        >
          <svg {...toolbarIconProps}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </ToolbarButton>
        {openMenu === 'link' ? (
          <div className="editor-toolbar__popover editor-toolbar__popover--row">
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
                  setOpenMenu(null);
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpenMenu(null);
                  editor.chain().focus().run();
                }
              }}
            />
            <button
              className="editor-toolbar__text-action"
              type="button"
              onClick={() => {
                applyLinkHref(editor, linkHref);
                setOpenMenu(null);
              }}
            >
              Apply
            </button>
            <button
              className="editor-toolbar__text-action"
              type="button"
              disabled={!state.isLink}
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkHref('');
                setOpenMenu(null);
              }}
            >
              Remove
            </button>
          </div>
        ) : null}
      </span>

      <span className="editor-toolbar__divider" role="separator" />

      <ToolbarButton
        label="Align left"
        pressed={state.textAlign === 'left'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('left').run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M3 6h18" />
          <path d="M3 12h12" />
          <path d="M3 18h18" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Align center"
        pressed={state.textAlign === 'center'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('center').run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M3 6h18" />
          <path d="M6 12h12" />
          <path d="M3 18h18" />
        </svg>
      </ToolbarButton>
      <ToolbarButton
        label="Align right"
        pressed={state.textAlign === 'right'}
        onClick={() => {
          editor.chain().focus().toggleTextAlign('right').run();
        }}
      >
        <svg {...toolbarIconProps}>
          <path d="M3 6h18" />
          <path d="M9 12h12" />
          <path d="M3 18h18" />
        </svg>
      </ToolbarButton>
    </aside>
  );
}

export function EditorToolbar({ menuSide }: EditorToolbarProps) {
  const { editor } = useCanvasEditor();
  if (editor === null) {
    return null;
  }

  return <EditorToolbarControls editor={editor} menuSide={menuSide} />;
}
