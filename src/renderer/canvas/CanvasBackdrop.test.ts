import { describe, expect, it } from 'vitest';

import { calculateCanvasGridMetrics } from './CanvasBackdrop';

describe('calculateCanvasGridMetrics', () => {
  it('keeps grid lines one screen pixel wide at every zoom', () => {
    for (const zoom of [0.2, 0.5, 1, 2]) {
      const metrics = calculateCanvasGridMetrics(zoom);

      expect(metrics.lineWidthFlowUnits * zoom).toBe(1);
    }
  });

  it('uses a coarser grid level at minimum zoom', () => {
    const metrics = calculateCanvasGridMetrics(0.2);

    expect(metrics.gapFlowUnits).toBe(72);
    expect(metrics.gapFlowUnits * 0.2).toBeGreaterThanOrEqual(12);
  });

  it('returns to the base flow-space grid when it is readable', () => {
    expect(calculateCanvasGridMetrics(1).gapFlowUnits).toBe(18);
    expect(calculateCanvasGridMetrics(2).gapFlowUnits).toBe(18);
  });
});
