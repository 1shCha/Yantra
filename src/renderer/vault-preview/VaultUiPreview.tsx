import { useCallback, useState } from 'react';
import { FilePlus2, PanelsTopLeft } from 'lucide-react';
import { WorkspaceFrame } from '../app/WorkspaceFrame';
import { VaultSidebar, type VaultTreeEntry } from '../vault-ui/VaultSidebar';
import { DocumentPreview } from './DocumentPreview';
import { CanvasPreview } from './CanvasPreview';
import { FileStatePreview, VaultOverlayPreview, overlayStates, fileStates } from './VaultStatePreview';
import type { VaultSaveState } from '../vault-ui/VaultFileHeader';
import './vault-preview.css';

const entries: readonly VaultTreeEntry[] = [
  { id: 'overview', name: 'Overview.yantraC', kind: 'canvas' },
  { id: 'research', name: 'Research', kind: 'folder', children: [
    { id: 'ideas', name: 'Ideas.yantraC', kind: 'canvas' },
    { id: 'notes', name: 'Reading_notes.yantraD', kind: 'document' },
    { id: 'systems', name: 'Systems', kind: 'folder', children: [
      { id: 'local', name: 'Local-first_software_and_durable_document_identity.yantraD', kind: 'document' },
    ] },
  ] },
  { id: 'projects', name: 'Projects', kind: 'folder', children: [
    { id: 'roadmap', name: 'Roadmap.yantraC', kind: 'canvas' },
  ] },
  { id: 'unfiled', name: 'Unfiled', kind: 'folder', children: [
    { id: 'untitled', name: 'Untitled.yantraD', kind: 'document' },
  ] },
];
const expandedIds = new Set(['research', 'systems', 'unfiled']);
const collapsedIds = new Set<string>();
const scrollEntries: readonly VaultTreeEntry[] = [...entries, ...Array.from({ length: 40 }, (_, index): VaultTreeEntry => ({
  id: `note-${index}`, name: `Research_note_${index + 1}.yantraD`, kind: 'document',
}))];
const states = ['Populated', 'Collapsed folders', 'Long names', 'Scrolling', 'Empty vault', 'Document', 'Document - long title', 'Document - unplaced', 'Canvas', 'Canvas - missing document', 'Save - Unsaved', 'Save - Saving', 'Save - Saved', 'Save - Failed', ...fileStates, ...overlayStates];
function inertAction() {}

export default function VaultUiPreview() {
  const [state, setState] = useState('Populated');
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  const isOverlay = overlayStates.some((value) => value === state);
  const isFileState = fileStates.some((value) => value === state);
  const saveState: VaultSaveState = state === 'Save - Unsaved' ? 'Unsaved' : state === 'Save - Saving' ? 'Saving' : state === 'Save - Failed' ? 'Failed' : 'Saved';
  const visibleEntries = state === 'Empty vault' ? [] : state === 'Scrolling' ? scrollEntries : entries;
  return (
    <WorkspaceFrame defaultSidebarOpen sidebar={
      <VaultSidebar
        name={state === 'Long names' ? 'Personal research and working notes' : 'My vault'}
        entries={visibleEntries}
        expandedIds={state === 'Collapsed folders' ? collapsedIds : expandedIds}
        selectedId={state.startsWith('Document') ? (state === 'Document - unplaced' ? 'untitled' : 'notes') : state === 'Long names' ? 'local' : state === 'Empty vault' ? undefined : 'overview'}
        onOpen={inertAction} onToggleFolder={inertAction}
        onCreateDocument={inertAction} onCreateCanvas={inertAction}
        onCreateFolder={inertAction} onRefresh={inertAction}
      />
    }>
      <div className="vault-preview-workspace">
      {isFileState ? <FileStatePreview state={state} /> : state.startsWith('Document') || state.startsWith('Save -') ? <DocumentPreview key={state} longTitle={state === 'Document - long title'} unplaced={state === 'Document - unplaced'} saveState={saveState} /> : state.startsWith('Canvas') || state === 'Menu - node' ? <CanvasPreview missingDocument={state === 'Canvas - missing document'} /> : <div className="vault-empty">
        <div className="vault-empty__actions">
          <button onClick={inertAction}><FilePlus2 size={18} /><span>New Document</span></button>
          <button onClick={inertAction}><PanelsTopLeft size={18} /><span>New Canvas</span></button>
        </div>
      </div>}
        <label className="vault-preview-selector">
          <span>UI preview</span>
          <select value={state} onChange={(event) => { setState(event.target.value); setDismissed(false); }} aria-label="Preview state">
            {states.map((name) => <option key={name}>{name}</option>)}
          </select>
        </label>
        {isOverlay && dismissed && <button className="vault-preview-reopen" onClick={() => setDismissed(false)}>Reopen preview</button>}
        {isOverlay && !dismissed && <VaultOverlayPreview key={state} state={state} onDismiss={dismiss} />}
      </div>
    </WorkspaceFrame>
  );
}
