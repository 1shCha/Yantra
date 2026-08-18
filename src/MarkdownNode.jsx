import { memo, useCallback, useEffect, useRef } from 'react';

function MarkdownNodeComponent({ id, data }) {
  const editorRef = useRef(null);

  const handleChange = useCallback(
    (event) => {
      data.onContentChange(id, event.target.value);
    },
    [data, id],
  );

  useEffect(() => {
    if (data.isEditing) {
      editorRef.current?.focus();
    }
  }, [data.isEditing]);

  return (
    <section className="markdown-node" data-editing={data.isEditing}>
      {data.isEditing ? (
        <textarea
          ref={editorRef}
          className="markdown-node__editor nodrag"
          value={data.content}
          onChange={handleChange}
          placeholder="Type markdown..."
          spellCheck="true"
        />
      ) : (
        <div className="markdown-node__body">
          {data.content || <span className="markdown-node__placeholder">Click to select</span>}
        </div>
      )}
    </section>
  );
}

export const MarkdownNode = memo(MarkdownNodeComponent);
