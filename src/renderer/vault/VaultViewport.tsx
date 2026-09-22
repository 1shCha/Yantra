import { titleFilename, titleNameError } from '../../shared/document-title';
import { findVaultEntry, nameValidationError, renamedPath } from './vault-organize-helpers';
import { memo, useCallback } from 'react';
import { FilePlus2, PanelsTopLeft } from 'lucide-react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { VaultFileHeader, type VaultSaveState } from '../vault-ui/VaultFileHeader';
import type { SaveStatus } from '../persistence/save-coordinator';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import type { WorkspaceTab } from '../stores/workspace-tabs';
import type { useVaultNavigation } from './useVaultNavigation';
import { DocumentEditor } from './DocumentEditor';
import { VaultCanvasView } from './VaultCanvasView';

const saveLabels = { clean: 'Saved', dirty: 'Unsaved', saving: 'Saving', error: 'Failed' } satisfies Record<SaveStatus['state'], VaultSaveState>;
type Workspace = ReturnType<typeof createVaultWorkspace>;
type Navigation = ReturnType<typeof useVaultNavigation>['viewport'];

const VaultTabPane = memo(function VaultTabPane({ store, tab, active, navigation }: {
  store: Workspace; tab: WorkspaceTab; active: boolean; navigation: Navigation;
}) {
  const state = useStore(store, useShallow((current) => ({
    document: tab.kind === 'document' ? current.documents.get(tab.fileId) : undefined,
    canvas: tab.kind === 'canvas' ? current.canvases.get(tab.fileId) : undefined,
    canvasSaveState: tab.kind === 'canvas' ? (() => {
      const canvas = current.canvases.get(tab.fileId);
      const saves = canvas ? [canvas.save.state, ...canvas.file.nodes.flatMap((node) => {
        const document = current.documents.get(node.documentId);
        return document ? [document.save.state] : [];
      })] : [];
      return saves.includes('error') ? 'Failed' as const : saves.includes('saving') ? 'Saving' as const : saves.includes('dirty') ? 'Unsaved' as const : 'Saved' as const;
    })() : 'Saved' as const,
    titleError: current.titleErrors.get(tab.fileId),
    deleting: current.deletingDocumentIds.has(tab.fileId), busy: active && current.busy,
    loadState: (tab.kind === 'document' ? current.documents.has(tab.fileId) : current.canvases.has(tab.fileId))
      ? 'ready' : current.loadState,
  })));
  const file = state.document;
  const canvas = state.canvas;
  const validateName = useCallback((name: string) => {
    const error = tab.kind === 'document' ? titleNameError(name) : nameValidationError(name);
    if (error) return error;
    const path = renamedPath(tab.path, tab.kind, tab.kind === 'document' ? titleFilename(name) : name);
    const existing = findVaultEntry(store.getState().vault?.entries ?? [], path);
    return existing && path !== tab.path ? 'An item with this name already exists in this location.' : null;
  }, [store, tab.kind, tab.path]);
  const renameDocument = useCallback((name: string) => navigation.renameFile(tab.fileId, 'document', name), [navigation, tab.fileId]);
  const renameCanvas = useCallback((name: string) => navigation.renameFile(tab.fileId, 'canvas', name), [navigation, tab.fileId]);
  const retryDocument = useCallback(() => { void store.getState().retry(tab.fileId); }, [store, tab.fileId]);
  const handleFocus = useCallback(() => navigation.setFocusDocumentId(null), [navigation]);
  const retryCanvas = useCallback(async () => {
    const current = store.getState();
    const loaded = current.canvases.get(tab.fileId);
    if (!loaded) return;
    const results = await Promise.all(loaded.file.nodes.flatMap((node) => current.documents.has(node.documentId) ? [current.retry(node.documentId)] : []));
    if (results.every((result) => result.status === 'success')) await current.retryCanvas(loaded.file.id);
  }, [store, tab.fileId]);
  return <section id={`pane-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`} aria-hidden={!active} inert={!active}
    className={`vault-tab-pane${active ? '' : ' vault-tab-pane--inactive'} ${tab.kind === 'canvas' ? 'vault-canvas-view' : 'vault-document-view'}`}>
    {file ? <DocumentEditor key={file.reloadRevision} file={file.file} busy={state.busy || state.deleting || !active} store={store}
      onRename={renameDocument} validateName={validateName} saveState={saveLabels[file.save.state]} commitError={state.titleError} onRetry={retryDocument}
      focusRequested={active && navigation.focusDocumentId === file.file.id} onFocusHandled={handleFocus} />
      : canvas ? <>
        <VaultFileHeader title={canvas.file.title} kind="canvas" busy={state.busy} saveState={state.canvasSaveState}
          onRename={renameCanvas} validateName={validateName} onRetry={() => { void retryCanvas(); }} />
        <VaultCanvasView key={canvas.reloadRevision} workspace={store} canvasId={canvas.file.id} active={active} />
      </> : active && state.loadState === 'error' ? <div className="vault-file-state"><h1>Unable to open {tab.kind}</h1>
        <button onClick={() => { void store.getState().activateTab(tab.id); }}>Retry</button></div>
        : <div className="vault-file-state" role="status">Loading...</div>}
  </section>;
});

export const VaultViewport = memo(function VaultViewport({ store, navigation }: { store: Workspace; navigation: Navigation }) {
  const state = useStore(store, useShallow((current) => ({
    session: current.vault?.sessionId, tabs: current.tabs, activeTabId: current.activeTabId,
    busy: current.busy, loadState: current.loadState, error: current.error, retry: current.retry, retryCanvas: current.retryCanvas,
  })));
  const failures = useStore(store, useShallow((current) => [...current.documents.values()].filter((document) => document.save.state === 'error')));
  const canvasFailures = useStore(store, useShallow((current) => [...current.canvases.values()].filter((canvas) => canvas.save.state === 'error')));
  return <div className="vault-workspace" aria-busy={state.busy || state.loadState === 'loading'}>
    {state.error && !navigation.dialogOpen && <div className="vault-error" role="alert">{state.error}</div>}
    {failures.map((document) => <div key={document.file.id} className="vault-error" role="alert">
      <span>{document.file.title}: {document.save.error || 'Could not save document.'}</span>
      <button disabled={state.busy} onClick={() => { void state.retry(document.file.id); }}>Retry save</button>
    </div>)}
    {canvasFailures.map((canvas) => <div key={canvas.file.id} className="vault-error" role="alert">
      <span>{canvas.file.title}: {canvas.save.error || 'Could not save canvas.'}</span>
      <button disabled={state.busy} onClick={() => { void state.retryCanvas(canvas.file.id); }}>Retry canvas save</button>
    </div>)}
    <div className="vault-pane-stack">
      {state.tabs.map((tab) => <VaultTabPane key={`${state.session}:${tab.id}:${tab.kind}:${tab.fileId}`} store={store} tab={tab}
        active={tab.id === state.activeTabId} navigation={navigation} />)}
      {!state.tabs.length && (state.busy ? <div className="vault-file-state" role="status">Loading...</div>
        : <div className="vault-empty">{state.session && <div className="vault-empty__actions">
          <button onClick={() => navigation.createDocument()}><FilePlus2 size={17} />New Document</button>
          <button onClick={() => navigation.createCanvas()}><PanelsTopLeft size={17} />New Canvas</button>
        </div>}</div>)}
    </div>
  </div>;
});
