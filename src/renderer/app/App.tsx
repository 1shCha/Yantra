import { ReactFlowProvider } from '@xyflow/react';

import { CanvasView } from '../canvas/CanvasView';
import { useCanvasFilePersistence } from '../canvas/useCanvasFilePersistence';

function CanvasApp() {
  const persistenceStatus = useCanvasFilePersistence();

  return <CanvasView persistenceStatus={persistenceStatus} />;
}

export function App() {
  return (
    <ReactFlowProvider>
      <CanvasApp />
    </ReactFlowProvider>
  );
}
