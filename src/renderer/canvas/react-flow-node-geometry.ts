import type { MarkdownFlowNode } from './react-flow-mapping';

export interface CanvasNodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function readNodeDimension(
  measuredDimension: number | undefined,
  declaredDimension: number | undefined,
  styledDimension: number | string | undefined,
): number | null {
  const dimension = measuredDimension ?? declaredDimension ?? Number(styledDimension);

  return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

export function toCanvasNodeRect(node: MarkdownFlowNode): CanvasNodeRect | null {
  const width = readNodeDimension(node.measured?.width, node.width, node.style?.width);
  const height = readNodeDimension(node.measured?.height, node.height, node.style?.height);

  if (
    width === null ||
    height === null ||
    !Number.isFinite(node.position.x) ||
    !Number.isFinite(node.position.y)
  ) {
    return null;
  }

  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width,
    height,
  };
}
