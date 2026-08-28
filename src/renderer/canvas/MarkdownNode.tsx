import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
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

import { isTiptapDocEmpty, tiptapDocSchema, type TiptapDoc } from '../../shared/tiptap-document';
import { useCanvasStore } from '../stores/canvasStore';
import { useCanvasAlignment } from './canvas-alignment-context';
import { useCanvasEditor } from './canvas-editor-context';
import { EditorToolbar } from './EditorToolbar';
import { lastMeaningfulCaretPos } from './last-meaningful-caret-pos';
import {
  MARKDOWN_NODE_MIN_HEIGHT,
  MARKDOWN_NODE_MIN_WIDTH,
  type MarkdownNodeData,
} from './react-flow-mapping';
import { canvasTiptapEditorExtensions, renderTiptapDocToHtml } from './tiptap-schema';

const EDITOR_TOOLBAR_FLIP_SPACE_PX = 56;
const EDITOR_TOOLBAR_Z_INDEX = 10_000;

interface MarkdownNodeComponentProps {
  id: string;
  data: MarkdownNodeData;
  selected: boolean;
}

interface MarkdownNodeEditorProps {
  doc: TiptapDoc;
  nodeId: string;
  selected: boolean;
  showCreatePlaceholder: boolean;
  onDocChange: (doc: TiptapDoc) => void;
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
  nodeId,
  selected,
  showCreatePlaceholder,
  onDocChange,
}: MarkdownNodeEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const [isEditorScrollable, setIsEditorScrollable] = useState(false);
  const { setEditor } = useCanvasEditor();
  const dismissCreatePlaceholder = useCanvasStore((state) => state.dismissCreatePlaceholder);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: canvasTiptapEditorExtensions,
    content: doc,
    editorProps: {
      attributes: {
        class: 'markdown-node__prose',
        spellcheck: 'true',
      },
    },
    onCreate: ({ editor: currentEditor }) => {
      const pos = lastMeaningfulCaretPos(currentEditor.state.doc);
      currentEditor.chain().setTextSelection(pos).focus().run();
    },
    onUpdate: ({ editor: currentEditor }) => {
      const parsed = tiptapDocSchema.safeParse(currentEditor.getJSON());
      if (parsed.success) {
        onDocChange(parsed.data);
        dismissCreatePlaceholder(nodeId);
      }
    },
  });

  useEffect(() => {
    if (editor === null) {
      return undefined;
    }

    setEditor(editor);
    return () => {
      setEditor(null);
      dismissCreatePlaceholder(nodeId);
    };
  }, [dismissCreatePlaceholder, editor, nodeId, setEditor]);

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
      data-create-placeholder={showCreatePlaceholder ? 'true' : 'false'}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

function MarkdownNodeComponent({ id, data, selected }: MarkdownNodeComponentProps) {
  const nodeRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isBodyScrollable, setIsBodyScrollable] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isEditing = useCanvasStore((state) => state.editingNodeId === id);
  const activateNode = useCanvasStore((state) => state.activateNode);
  const setNodeGeometry = useCanvasStore((state) => state.setNodeGeometry);
  const updateNodeDoc = useCanvasStore((state) => state.updateNodeDoc);
  const { applyResizeAlignment, clearAlignmentGuides, setResizeStartBounds } =
    useCanvasAlignment();
  const previewHtml = useMemo(() => renderTiptapDocToHtml(data.doc), [data.doc]);
  const isPreviewEmpty = isTiptapDocEmpty(data.doc);
  const viewport = useViewport();
  const internalNode = useInternalNode(id);
  const nodeScreenTop =
    internalNode === undefined
      ? EDITOR_TOOLBAR_FLIP_SPACE_PX
      : internalNode.internals.positionAbsolute.y * viewport.zoom + viewport.y;
  const toolbarPosition =
    nodeScreenTop < EDITOR_TOOLBAR_FLIP_SPACE_PX ? Position.Bottom : Position.Top;
  const menuSide = toolbarPosition === Position.Top ? 'below' : 'above';

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
      setResizeStartBounds(id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
    },
    [id, setResizeStartBounds],
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
      <NodeToolbar
        isVisible={isEditing && isEditorReady}
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
      <section
        ref={nodeRef}
        className="markdown-node"
        data-editing={isEditing}
        onClickCapture={handleClickCapture}
        onPointerDownCapture={handlePointerDownCapture}
      >
        <NodeResizer
          isVisible={selected}
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
            doc={data.doc}
            nodeId={id}
            selected={selected}
            showCreatePlaceholder={data.showCreatePlaceholder === true}
            onDocChange={handleDocChange}
          />
        ) : (
          <div
            ref={bodyRef}
            className={`markdown-node__body ${selected && isBodyScrollable ? 'nowheel' : ''}`}
          >
            {isPreviewEmpty ? (
              <span className="markdown-node__placeholder">Click to select</span>
            ) : (
              <div
                className="markdown-node__preview"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>
        )}
      </section>
    </>
  );
}

export const MarkdownNode = memo(MarkdownNodeComponent);
