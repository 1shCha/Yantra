import { expect, it } from 'vitest';
import { fitSidebarWidths } from './sidebar-widths';

it('caps oversized saved widths when opening both sidebars', () => {
  const widths = fitSidebarWidths(900, { left: 165, right: 1000 }, true, true);
  expect(widths).toEqual({ left: 165, right: 407 });
});
it('preserves valid preferences and ignores a closed sidebar', () => {
  expect(fitSidebarWidths(1280, { left: 200, right: 320 }, true, true)).toEqual({ left: 200, right: 320 });
  expect(fitSidebarWidths(900, { left: 420, right: 1000 }, false, true)).toEqual({ left: 0, right: 572 });
});
it.each([640, 900, 1280])('keeps the surface usable after resizing to %i', (viewport) => {
  const widths = fitSidebarWidths(viewport, { left: 420, right: 1000 }, true, true);
  expect(widths.left + widths.right).toBeLessThanOrEqual(viewport - 328);
  expect(widths.left).toBeGreaterThan(0);
  expect(widths.right).toBeGreaterThan(0);
});
it('rejects negative stored sizes through minimum widths', () => {
  expect(fitSidebarWidths(900, { left: -10, right: -30 }, true, true)).toEqual({ left: 165, right: 220 });
});
