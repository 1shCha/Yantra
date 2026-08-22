import { ReactFlowProvider } from '@xyflow/react';
import { CanvasView } from '../canvas/CanvasView.jsx';
import { useCanvasFilePersistence } from '../canvas/useCanvasFilePersistence.js';

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
