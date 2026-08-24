import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  NodeResizer,
  type ResizeDragEvent,
  type ResizeParams,
  type ResizeParamsWithDirection,
} from '@xyflow/react';

import { useCanvasStore } from '../stores/canvasStore';
import { useCanvasAlignment } from './canvas-alignment-context';
import type { MarkdownNodeData } from './react-flow-mapping';

interface MarkdownNodeComponentProps {
  id: string;
  data: MarkdownNodeData;
  selected: boolean;
}

const NODE_MIN_WIDTH = 220;
const NODE_MIN_HEIGHT = 160;

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

function focusEditorAtEnd(editor: HTMLTextAreaElement) {
  const caretPosition = editor.value.length;
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(caretPosition, caretPosition);
  editor.scrollTop = editor.scrollHeight;
}

function MarkdownNodeComponent({ id, data, selected }: MarkdownNodeComponentProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isBodyScrollable, setIsBodyScrollable] = useState(false);
  const [isEditorScrollable, setIsEditorScrollable] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const isEditing = useCanvasStore((state) => state.editingNodeId === id);
  const activateNode = useCanvasStore((state) => state.activateNode);
  const setNodeGeometry = useCanvasStore((state) => state.setNodeGeometry);
  const updateNodeContent = useCanvasStore((state) => state.updateNodeContent);
  const { applyResizeAlignment, clearAlignmentGuides, setResizeStartBounds } =
    useCanvasAlignment();

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeContent(id, event.target.value);
    },
    [id, updateNodeContent],
  );

  const handlePointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isElementTarget(event.target)) {
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
      if (!event.shiftKey || isEditing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [isEditing],
  );

  const handleSelectStart = useCallback(
    (event: React.SyntheticEvent<HTMLElement>) => {
      if (isEditorReady) {
        return;
      }

      event.preventDefault();
    },
    [isEditorReady],
  );

  useLayoutEffect(() => {
    if (!isEditing) {
      setIsEditorReady(false);
      return undefined;
    }

    // Keep the preview mounted until leftover click/dblclick events finish so
    // they cannot select a word in the textarea.
    const timeoutId = window.setTimeout(() => {
      setIsEditorReady(true);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isEditing]);

  useLayoutEffect(() => {
    if (!isEditorReady) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    focusEditorAtEnd(editor);
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
  }, [data.content, isEditing, selected]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !isEditorReady) {
      setIsEditorScrollable(false);
      return undefined;
    }

    const updateScrollableState = () => {
      setIsEditorScrollable(editor.scrollHeight > editor.clientHeight);
    };

    updateScrollableState();

    const resizeObserver = new ResizeObserver(updateScrollableState);
    resizeObserver.observe(editor);

    return () => {
      resizeObserver.disconnect();
    };
  }, [data.content, isEditorReady]);

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
    <section
      className="markdown-node"
      data-editing={isEditing}
      onClickCapture={handleClickCapture}
      onPointerDownCapture={handlePointerDownCapture}
      onSelectStart={handleSelectStart}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={NODE_MIN_WIDTH}
        minHeight={NODE_MIN_HEIGHT}
        handleClassName="markdown-node__resize-handle"
        lineClassName="markdown-node__resize-line"
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
        shouldResize={handleShouldResize}
      />
      {isEditorReady ? (
        <textarea
          ref={editorRef}
          className={`markdown-node__editor nodrag ${
            selected && isEditorScrollable ? 'nowheel' : ''
          }`}
          value={data.content}
          onChange={handleChange}
          placeholder="Type markdown..."
          spellCheck
        />
      ) : (
        <div
          ref={bodyRef}
          className={`markdown-node__body ${selected && isBodyScrollable ? 'nowheel' : ''}`}
        >
          {data.content || <span className="markdown-node__placeholder">Click to select</span>}
        </div>
      )}
    </section>
  );
}

export const MarkdownNode = memo(MarkdownNodeComponent);
