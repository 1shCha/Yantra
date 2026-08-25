import { ViewportPortal, useStore, useViewport } from '@xyflow/react';

const GRID_GAP_FLOW_UNITS = 18;
const VIEWPORT_OVERSCAN_FLOW_UNITS = 8;

export function CanvasBackdrop() {
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { x, y, zoom } = useViewport();

  if (width <= 0 || height <= 0 || zoom <= 0) {
    return null;
  }

  const left = -x / zoom - VIEWPORT_OVERSCAN_FLOW_UNITS;
  const top = -y / zoom - VIEWPORT_OVERSCAN_FLOW_UNITS;
  const gridSize = `${GRID_GAP_FLOW_UNITS}px ${GRID_GAP_FLOW_UNITS}px`;

  return (
    <ViewportPortal>
      <div
        aria-hidden="true"
        className="canvas-backdrop"
        style={{
          backgroundPosition: `${-left}px ${-top}px`,
          backgroundSize: gridSize,
          height: height / zoom + VIEWPORT_OVERSCAN_FLOW_UNITS * 2,
          left,
          top,
          width: width / zoom + VIEWPORT_OVERSCAN_FLOW_UNITS * 2,
          zIndex: 0,
        }}
      />
    </ViewportPortal>
  );
}
