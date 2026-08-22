import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { NodeResizer } from '@xyflow/react';
import { useCanvasStore } from './stores/canvasStore.js';

function MarkdownNodeComponent({ id, data, selected }) {
  const editorRef = useRef(null);
  const bodyRef = useRef(null);
  const [isBodyScrollable, setIsBodyScrollable] = useState(false);
  const [isEditorScrollable, setIsEditorScrollable] = useState(false);
  const isEditing = useCanvasStore((state) => state.editingNodeId === id);
  const activateNode = useCanvasStore((state) => state.activateNode);
  const updateNodeContent = useCanvasStore((state) => state.updateNodeContent);

  const handleChange = useCallback(
    (event) => {
      updateNodeContent(id, event.target.value);
    },
    [id, updateNodeContent],
  );

  const handlePointerDownCapture = useCallback(
    (event) => {
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
    (event) => {
      if (!event.shiftKey || isEditing) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [isEditing],
  );

  useEffect(() => {
    if (isEditing) {
      editorRef.current?.focus();
    }
  }, [isEditing]);

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
    if (!editor || !isEditing) {
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
  }, [data.content, isEditing]);

  return (
    <section
      className="markdown-node"
      data-editing={isEditing}
      onClickCapture={handleClickCapture}
      onPointerDownCapture={handlePointerDownCapture}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={160}
        handleClassName="markdown-node__resize-handle"
        lineClassName="markdown-node__resize-line"
      />
      {isEditing ? (
        <textarea
          ref={editorRef}
          className={`markdown-node__editor nodrag ${
            selected && isEditorScrollable ? 'nowheel' : ''
          }`}
          value={data.content}
          onChange={handleChange}
          placeholder="Type markdown..."
          spellCheck="true"
        />
      ) : (
        <div
          ref={bodyRef}
          className={`markdown-node__body ${
            selected && isBodyScrollable ? 'nowheel' : ''
          }`}
        >
          {data.content || <span className="markdown-node__placeholder">Click to select</span>}
        </div>
      )}
    </section>
  );
}

export const MarkdownNode = memo(MarkdownNodeComponent);
