export function SelectionToolbar({ selectedNodeCount, onDeleteSelectedNodes }) {
  if (selectedNodeCount === 0) {
    return null;
  }

  return (
    <aside className="selection-toolbar" aria-label="Selected node actions">
      <span className="selection-toolbar__count">
        {selectedNodeCount} selected
      </span>
      <button
        className="selection-toolbar__delete"
        type="button"
        onClick={onDeleteSelectedNodes}
      >
        Delete
      </button>
    </aside>
  );
}
