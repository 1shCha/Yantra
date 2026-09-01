import { ViewportPortal, useStore, useViewport } from '@xyflow/react';

const GRID_GAP_FLOW_UNITS = 18;
const GRID_LINE_SCREEN_PIXELS = 1;
const MIN_GRID_GAP_SCREEN_PIXELS = 12;
const VIEWPORT_OVERSCAN_FLOW_UNITS = 8;

interface CanvasGridMetrics {
  gapFlowUnits: number;
  lineWidthFlowUnits: number;
}

export function calculateCanvasGridMetrics(zoom: number): CanvasGridMetrics {
  const baseGapScreenPixels = GRID_GAP_FLOW_UNITS * zoom;
  const level = Math.max(
    0,
    Math.ceil(Math.log2(MIN_GRID_GAP_SCREEN_PIXELS / baseGapScreenPixels)),
  );

  return {
    gapFlowUnits: GRID_GAP_FLOW_UNITS * 2 ** level,
    lineWidthFlowUnits: GRID_LINE_SCREEN_PIXELS / zoom,
  };
}

export function CanvasBackdrop() {
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const { x, y, zoom } = useViewport();

  if (width <= 0 || height <= 0 || zoom <= 0) {
    return null;
  }

  const left = -x / zoom - VIEWPORT_OVERSCAN_FLOW_UNITS;
  const top = -y / zoom - VIEWPORT_OVERSCAN_FLOW_UNITS;
  const { gapFlowUnits, lineWidthFlowUnits } = calculateCanvasGridMetrics(zoom);
  const gridSize = `${gapFlowUnits}px ${gapFlowUnits}px`;
  const lineWidth = `${lineWidthFlowUnits}px`;
  const gridImage = [
    `linear-gradient(to right, rgba(32, 32, 29, 0.1) ${lineWidth}, transparent ${lineWidth})`,
    `linear-gradient(to bottom, rgba(32, 32, 29, 0.1) ${lineWidth}, transparent ${lineWidth})`,
  ].join(', ');

  return (
    <ViewportPortal>
      <div
        aria-hidden="true"
        className="canvas-backdrop"
        style={{
          backgroundImage: gridImage,
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
