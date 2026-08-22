export type PersistenceState = 'loading' | 'saving' | 'dirty' | 'clean' | 'error';

export interface PersistenceStatus {
  error: string | null;
  filePath: string;
  lastSavedAt: string | null;
  state: PersistenceState;
}

function formatSaveTime(value: string | null): string {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

interface CanvasPersistenceStatusProps {
  status: PersistenceStatus;
}

export function CanvasPersistenceStatus({ status }: CanvasPersistenceStatusProps) {
  const label =
    status.state === 'loading'
      ? 'Loading canvas'
      : status.state === 'saving'
        ? 'Saving...'
        : status.state === 'dirty'
          ? 'Unsaved changes'
          : status.state === 'error'
            ? 'Save failed'
            : status.lastSavedAt
              ? `Saved ${formatSaveTime(status.lastSavedAt)}`
              : 'Canvas saved';
  const title = [
    status.filePath ? `File: ${status.filePath}` : '',
    status.lastSavedAt ? `Last saved: ${new Date(status.lastSavedAt).toLocaleString()}` : '',
    status.error ? `Error: ${status.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <aside
      className="canvas-persistence-status"
      data-state={status.state}
      title={title}
      aria-label={`Canvas persistence status: ${label}`}
    >
      <span className="canvas-persistence-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </aside>
  );
}
