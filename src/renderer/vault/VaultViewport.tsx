import { memo } from 'react';
import { FilePlus2, PanelsTopLeft } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { VaultFileHeader, type VaultSaveState } from '../vault-ui/VaultFileHeader';
import type { SaveStatus } from '../persistence/save-coordinator';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import type { useVaultNavigation } from './useVaultNavigation';
import { DocumentEditor } from './DocumentEditor';
import { VaultCanvasView } from './VaultCanvasView';

const saveLabels = { clean: 'Saved', dirty: 'Unsaved', saving: 'Saving', error: 'Failed' } satisfies Record<SaveStatus['state'], VaultSaveState>;

export const VaultViewport = memo(function VaultViewport({ store, navigation }: { store: ReturnType<typeof createVaultWorkspace>; navigation: ReturnType<typeof useVaultNavigation>['viewport'] }) {
  const state = useStore(store, useShallow((current) => ({
    session: current.vault?.sessionId, vaultName: current.vault?.name, documents: current.documents, canvases: current.canvases, titleErrors: current.titleErrors,
    activeDocumentId: current.activeDocumentId, activeCanvasId: current.activeCanvasId, activePath: current.activePath,
    documentDeleting: current.deletingDocumentIds.has(current.activeDocumentId ?? ''),
    busy: current.busy, loadState: current.loadState, error: current.error, retry: current.retry, retryCanvas: current.retryCanvas,
  })));
  const session = state.session ?? '';
  const active = state.activeDocumentId ? state.documents.get(state.activeDocumentId) : undefined;
  const activeCanvas = state.activeCanvasId ? state.canvases.get(state.activeCanvasId) : undefined;
  const failures = [...state.documents.values()].filter((document) => document.save.state === 'error');
  const canvasFailures = [...state.canvases.values()].filter((canvas) => canvas.save.state === 'error');
  const canvasSaveStates = activeCanvas ? [activeCanvas.save.state, ...activeCanvas.file.nodes.flatMap((node) => {
    const document = state.documents.get(node.documentId);
    return document ? [document.save.state] : [];
  })] : [];
  const canvasSaveState = canvasSaveStates.includes('error') ? 'Failed' : canvasSaveStates.includes('saving') ? 'Saving'
    : canvasSaveStates.includes('dirty') ? 'Unsaved' : 'Saved';

  async function retryActiveCanvas() {
    if (!activeCanvas) return;
    const results = await Promise.all(activeCanvas.file.nodes.flatMap((node) => state.documents.has(node.documentId) ? [state.retry(node.documentId)] : []));
    if (results.every((result) => result.status === 'success')) await state.retryCanvas(activeCanvas.file.id);
  }


  return (
    <div className="vault-workspace" aria-busy={state.busy || state.loadState === 'loading'}>
      {state.error && !navigation.dialogOpen && <div className="vault-error" role="alert">{state.error}</div>}
      {failures.map((document) => <div key={document.file.id} className="vault-error" role="alert">
        <span>{document.file.title}: {document.save.error || 'Could not save document.'}</span>
        <button disabled={state.busy} onClick={() => { void state.retry(document.file.id).catch(() => { /* The queue retains the failure for display. */ }); }}>Retry save</button>
      </div>)}
      {canvasFailures.map((canvas) => <div key={canvas.file.id} className="vault-error" role="alert">
        <span>{canvas.file.title}: {canvas.save.error || 'Could not save canvas.'}</span>
        <button disabled={state.busy} onClick={() => { void state.retryCanvas(canvas.file.id).catch(() => { /* The queue retains the error. */ }); }}>Retry canvas save</button>
      </div>)}
      {active && state.session ? <section className="vault-document-view">
        <DocumentEditor key={`${session}:${active.file.id}:${active.reloadRevision}`} file={active.file} busy={state.busy || state.documentDeleting} store={store}
          saveState={saveLabels[active.save.state]} commitError={state.titleErrors.get(active.file.id)}
          onRetry={() => { void state.retry(active.file.id).catch(() => { /* Failure is displayed above. */ }); }}
          focusRequested={navigation.focusDocumentId === active.file.id} onFocusHandled={() => navigation.setFocusDocumentId(null)} />
      </section> : activeCanvas && state.session ? <section className="vault-canvas-view">
        <VaultFileHeader title={activeCanvas.file.title} folder={`${state.vaultName} / ${activeCanvas.path.split('/').slice(0, -1).join('/')}`}
          kind="canvas" busy={state.busy} saveState={canvasSaveState}
          onRetry={() => { void retryActiveCanvas(); }} />
        <VaultCanvasView key={`${session}:${activeCanvas.file.id}`} workspace={store} canvasId={activeCanvas.file.id} busy={state.busy} />
      </section> : state.busy || state.loadState === 'loading' ? <div className="vault-file-state" role="status">Loading...</div>
        : state.loadState === 'error' ? <div className="vault-file-state"><h1>{state.activePath?.endsWith('.yantraC') ? 'Unable to open canvas' : 'Unable to open document'}</h1><button onClick={() => { if (state.activePath) navigation.openFile(state.activePath); }}>Retry</button></div>
          : <div className="vault-empty">{state.session && <div className="vault-empty__actions"><button onClick={() => navigation.createDocument(navigation.folder)}><FilePlus2 size={17} />New Document</button><button onClick={() => navigation.createCanvas(navigation.folder)}><PanelsTopLeft size={17} />New Canvas</button></div>}</div>}
    </div>
  );
});
