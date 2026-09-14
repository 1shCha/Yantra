interface SelectionToolbarProps {
  canGroupSelectedNodes: boolean;
  isGroupSelected: boolean;
  selectedNodeCount: number;
  onDeleteSelectedGroup: () => void;
  onDeleteSelectedNodes: () => void;
  onGroupSelectedNodes: () => void;
  onUngroupSelectedGroup: () => void;
  allowRemoval?: boolean;
}

export function SelectionToolbar({
  canGroupSelectedNodes,
  isGroupSelected,
  selectedNodeCount,
  onDeleteSelectedGroup,
  onDeleteSelectedNodes,
  onGroupSelectedNodes,
  onUngroupSelectedGroup,
  allowRemoval = true,
}: SelectionToolbarProps) {
  if (selectedNodeCount === 0 && !isGroupSelected) {
    return null;
  }

  if (isGroupSelected) {
    return (
      <aside className="selection-toolbar" aria-label="Selected group actions">
        <span className="selection-toolbar__count">Group selected</span>
        <button
          className="selection-toolbar__action"
          type="button"
          onClick={onUngroupSelectedGroup}
        >
          Ungroup
        </button>
        {allowRemoval && <button
          className="selection-toolbar__delete"
          type="button"
          onClick={onDeleteSelectedGroup}
        >
          Delete
        </button>}
      </aside>
    );
  }

  return (
    <aside className="selection-toolbar" aria-label="Selected node actions">
      <span className="selection-toolbar__count">{selectedNodeCount} selected</span>
      {canGroupSelectedNodes ? (
        <button
          className="selection-toolbar__action"
          type="button"
          onClick={onGroupSelectedNodes}
        >
          Group
        </button>
      ) : null}
      {allowRemoval && <button className="selection-toolbar__delete" type="button" onClick={onDeleteSelectedNodes}>
        Delete
      </button>}
    </aside>
  );
}
