export interface SidebarWidths {
  left: number;
  right: number;
}

// Reserve the surface and its two four-pixel outer gutters.
export function fitSidebarWidths(viewport: number, requested: SidebarWidths, leftOpen: boolean, rightOpen: boolean): SidebarWidths {
  const budget = Math.max(0, viewport - 328);
  let left = leftOpen ? Math.max(165, Math.min(requested.left, 420)) : 0;
  let right = rightOpen ? Math.max(220, requested.right) : 0;
  const minimumLeft = leftOpen ? 165 : 0;
  const minimumRight = rightOpen ? 220 : 0;
  const minimumTotal = minimumLeft + minimumRight;
  if (left + right > budget) {
    if (budget < minimumTotal) {
      left = budget * minimumLeft / minimumTotal;
      right = budget * minimumRight / minimumTotal;
    } else {
      const scale = (budget - minimumTotal) / (left + right - minimumTotal);
      left = minimumLeft + (left - minimumLeft) * scale;
      right = minimumRight + (right - minimumRight) * scale;
    }
  }
  return { left, right };
}
