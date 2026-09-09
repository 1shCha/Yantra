import { ReactFlowProvider } from '@xyflow/react';
import { lazy, Suspense } from 'react';

import { CanvasView } from '../canvas/CanvasView';
import { useCanvasFilePersistence } from '../canvas/useCanvasFilePersistence';

const VaultUiPreview = import.meta.env.DEV
  ? lazy(() => import('../vault-preview/VaultUiPreview'))
  : null;

function CanvasApp() {
  const persistenceStatus = useCanvasFilePersistence();

  return <CanvasView persistenceStatus={persistenceStatus} />;
}

export function App() {
  if (VaultUiPreview && new URLSearchParams(window.location.search).get('preview') === 'vault-ui') {
    return <Suspense fallback={null}><VaultUiPreview /></Suspense>;
  }

  return (
    <ReactFlowProvider>
      <CanvasApp />
    </ReactFlowProvider>
  );
}
