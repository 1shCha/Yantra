import { Selection } from '@tiptap/pm/state';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import {
  NodeResizer,
  NodeToolbar,
  Position,
  useInternalNode,
  useViewport,
  type ResizeDragEvent,
  type ResizeParams,
  type ResizeParamsWithDirection,
} from '@xyflow/react';

import { createEmptyTiptapDoc, isTiptapDocEmpty, type TiptapDoc } from '../../shared/tiptap-document';
import { useDocumentEditor } from '../editor/useDocumentEditor';
import { useCanvasState as useCanvasStore } from './canvas-store-context';
import { useCanvasAlignment } from './canvas-alignment-context';
import { useCanvasEditor } from './canvas-editor-context';
import { EditorToolbar } from './EditorToolbar';
import { lastMeaningfulCaretPos } from './last-meaningful-caret-pos';
import {
  MARKDOWN_NODE_MIN_HEIGHT,
  MARKDOWN_NODE_MIN_WIDTH,
  type MarkdownNodeData,
} from './react-flow-mapping';
import { getDocumentPreview } from '../editor/document-preview';
import type { OperationResult } from '../../shared/operation-result';

const EDITOR_TOOLBAR_FLIP_SPACE_PX = 56;
const EDITOR_TOOLBAR_Z_INDEX = 10_000;
const emptyDoc = createEmptyTiptapDoc();

interface MarkdownNodeComponentProps {
  id: string;
  data: MarkdownNodeData;
  selected: boolean;
  editable?: boolean;
  titleCommitError?: string | null;
  onTitleCommit?: () => Promise<OperationResult>;
}

interface MarkdownNodeEditorProps {
  doc: TiptapDoc;
  selected: boolean;
  onDocChange: (doc: TiptapDoc) => void;
  editable: boolean;
  titleCommitError?: string | null;
  onTitleCommit?: () => Promise<OperationResult>;
}

function isSameGeometry(
  first: ResizeParamsWithDirection,
  second: { height: number; width: number; x: number; y: number },
): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height
  );
}

function isElementTarget(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function isHttpHref(href: string): boolean {
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function openPreviewHref(href: string) {
  if (!isHttpHref(href)) {
    return;
  }

  window.open(href, '_blank', 'noopener,noreferrer');
}

function stopToolbarPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function MarkdownNodeEditor({
  doc,
  selected,
  onDocChange,
  editable,
  titleCommitError,
  onTitleCommit,
}: MarkdownNodeEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [isEditorScrollable, setIsEditorScrollable] = useState(false);
  const { setEditor } = useCanvasEditor();
  const { editor, titleError } = useDocumentEditor({
    initialContent: doc,
    editable,
    onTitleCommit,
    editorProps: {
      attributes: {
        class: 'markdown-node__prose',
        spellcheck: 'true',
      },
    },
    onCreate: (currentEditor) => {
      const pos = lastMeaningfulCaretPos(currentEditor.state.doc);
      currentEditor.view.dispatch(currentEditor.state.tr.setSelection(Selection.near(currentEditor.state.doc.resolve(pos), -1)));
      currentEditor.commands.focus();
    },
    onChange: (nextDoc) => {
      onDocChange(nextDoc);
    },
  });

  useEffect(() => {
    if (editor === null) {
      return undefined;
    }

    setEditor(editor);
    return () => {
      setEditor(null);
    };
  }, [editor, setEditor]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (container === null) {
      setIsEditorScrollable(false);
      return undefined;
    }

    const updateScrollableState = () => {
      setIsEditorScrollable(container.scrollHeight > container.clientHeight);
    };

    updateScrollableState();

    const resizeObserver = new ResizeObserver(updateScrollableState);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [doc, editor]);

  return (
    <div
      ref={editorContainerRef}
      className={`markdown-node__editor nodrag ${
        selected && isEditorScrollable ? 'nowheel' : ''
      }`}
      onMouseDown={(event) => {
        // Padding belongs to the editor too; do not focus the outer flow node.
        if (event.button === 0 && event.target === event.currentTarget && editor) {
          event.preventDefault();
          editor.commands.focus();
        }
      }}
    >
      {titleError && <div className="document-title-error" role="status">{titleError}</div>}
      {titleCommitError && <div className="document-title-error" role="alert">{titleCommitError}</div>}
      <EditorContent className="markdown-node__editor-content" editor={editor} />
    </div>
  );
}

// Only the active toolbar subscribes to viewport and node-position changes.
function ActiveNodeToolbar({ id }: { id: string }) {
  const viewport = useViewport();
  const internalNode = useInternalNode(id);
  const nodeScreenTop =
    internalNode === undefined
      ? EDITOR_TOOLBAR_FLIP_SPACE_PX
      : internalNode.internals.positionAbsolute.y * viewport.zoom + viewport.y;
  const toolbarPosition =
    nodeScreenTop < EDITOR_TOOLBAR_FLIP_SPACE_PX ? Position.Bottom : Position.Top;
  const menuSide = toolbarPosition === Position.Top ? 'below' : 'above';

  return (
    <NodeToolbar
      isVisible
      position={toolbarPosition}
      align="center"
      offset={8}
      className="nodrag nopan nowheel"
      style={{ zIndex: EDITOR_TOOLBAR_Z_INDEX }}
      onPointerDown={stopToolbarPropagation}
      onDoubleClick={stopToolbarPropagation}
    >
      <EditorToolbar menuSide={menuSide} />
    </NodeToolbar>
  );
}

const DocumentPreview = memo(function DocumentPreview({ doc }: { doc: TiptapDoc }) {
  if (isTiptapDocEmpty(doc)) return <span className="markdown-node__placeholder">Click to select</span>;
  return <div className="markdown-node__preview" dangerouslySetInnerHTML={getDocumentPreview(doc)} />;
});

function MarkdownNodeComponent({ id, data, selected, editable = true, titleCommitError, onTitleCommit }: MarkdownNodeComponentProps) {
  const doc = data.doc ?? emptyDoc;
  const nodeRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isBodyScrollable, setIsBodyScrollable] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isEditing = useCanvasStore((state) => state.editingNodeId === id);
  const activateNode = useCanvasStore((state) => state.activateNode);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const setNodeGeometry = useCanvasStore((state) => state.setNodeGeometry);
  const updateNodeDoc = useCanvasStore((state) => state.updateNodeDoc);
  const { applyResizeAlignment, clearAlignmentGuides, setResizeStartBounds } =
    useCanvasAlignment();

  const handleDocChange = useCallback(
    (doc: TiptapDoc) => {
      updateNodeDoc(id, doc);
    },
    [id, updateNodeDoc],
  );

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isElementTarget(event.target)) {
        return;
      }

      if (event.target.closest('.markdown-node__preview a') !== null) {
        event.stopPropagation();
        return;
      }

      if (
        isEditing ||
        event.target.closest('.markdown-node__resize-handle') ||
        event.target.closest('.markdown-node__resize-line')
      ) {
        return;
      }

      if (event.shiftKey) {
        event.stopPropagation();
        activateNode(id, { isMultiSelect: true });
        return;
      }

      activateNode(id);
    },
    [activateNode, id, isEditing],
  );

  const handleClickCapture = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!isEditing && isElementTarget(event.target)) {
        const link = event.target.closest('.markdown-node__preview a');
        if (link instanceof HTMLAnchorElement) {
          event.preventDefault();
          event.stopPropagation();
          openPreviewHref(link.href);
          return;
        }
      }

      if (!event.shiftKey || isEditing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [isEditing],
  );

  useLayoutEffect(() => {
    if (!isEditing) {
      setIsEditorReady(false);
      return undefined;
    }

    // Keep the preview mounted until leftover click/dblclick events finish so
    // they cannot select a word in the editor.
    const timeoutId = window.setTimeout(() => {
      setIsEditorReady(true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isEditing]);

  useEffect(() => {
    const node = nodeRef.current;
    if (node === null || isEditorReady) {
      return undefined;
    }

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    node.addEventListener('selectstart', handleSelectStart);
    return () => {
      node.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isEditorReady]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || isEditing) {
      setIsBodyScrollable(false);
      return undefined;
    }

    const updateScrollableState = () => {
      setIsBodyScrollable(body.scrollHeight > body.clientHeight);
    };

    updateScrollableState();

    const resizeObserver = new ResizeObserver(updateScrollableState);
    resizeObserver.observe(body);

    return () => {
      resizeObserver.disconnect();
    };
  }, [data.doc, isEditing, selected]);

  const handleResizeStart = useCallback(
    (_event: ResizeDragEvent, params: ResizeParams) => {
      if (!selected) {
        selectNode(id);
      }
      setResizeStartBounds(id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
    },
    [id, selected, selectNode, setResizeStartBounds],
  );

  const handleShouldResize = useCallback(
    (_event: ResizeDragEvent, params: ResizeParamsWithDirection) => {
      const { geometry } = applyResizeAlignment(id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });

      if (!isSameGeometry(params, geometry)) {
        setNodeGeometry(id, geometry);
        return false;
      }

      return true;
    },
    [applyResizeAlignment, id, setNodeGeometry],
  );

  const handleResizeEnd = useCallback(() => {
    clearAlignmentGuides();
  }, [clearAlignmentGuides]);

  return (
    <>
      {isEditing && isEditorReady && <ActiveNodeToolbar id={id} />}
      <section
        ref={nodeRef}
        className="markdown-node"
        data-editing={isEditing}
        onClickCapture={handleClickCapture}
        onPointerDownCapture={handlePointerDownCapture}
      >
        <NodeResizer
          isVisible
          minWidth={MARKDOWN_NODE_MIN_WIDTH}
          minHeight={MARKDOWN_NODE_MIN_HEIGHT}
          handleClassName="markdown-node__resize-handle"
          lineClassName="markdown-node__resize-line"
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          shouldResize={handleShouldResize}
        />
        {isEditorReady ? (
          <MarkdownNodeEditor
            doc={doc}
            selected={selected}
            onDocChange={handleDocChange}
            editable={editable}
            titleCommitError={titleCommitError}
            onTitleCommit={onTitleCommit}
          />
        ) : (
          <div
            ref={bodyRef}
            className={`markdown-node__body ${selected && isBodyScrollable ? 'nowheel' : ''}`}
          >
            {titleCommitError && <div className="document-title-error" role="alert">{titleCommitError}</div>}
            <DocumentPreview doc={doc} />
          </div>
        )}
      </section>
    </>
  );
}

export const MarkdownNode = memo(MarkdownNodeComponent);
