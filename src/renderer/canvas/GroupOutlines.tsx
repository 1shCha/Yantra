import { useMemo } from 'react';
import { ViewportPortal, useViewport } from '@xyflow/react';

import type { CanvasGroup, MarkdownFlowNode } from './react-flow-mapping';
import { toCanvasNodeRect, type CanvasNodeRect } from './react-flow-node-geometry';
import { calculateCompositeGroupOutline } from './group-hull';

const GROUP_HULL_PADDING_FLOW_UNITS = 16;
const GROUP_OUTLINE_SCREEN_PIXELS = 1.5;
const SELECTED_GROUP_OUTLINE_SCREEN_PIXELS = 2;
const GROUP_HIT_TARGET_SCREEN_PIXELS = 14;

interface GroupOutlineModel {
  groupId: string;
  height: number;
  left: number;
  points: string;
  top: number;
  width: number;
}

interface GroupOutlinesProps {
  groups: readonly CanvasGroup[];
  nodes: readonly MarkdownFlowNode[];
  selectedGroupId: string | null;
  onGroupPointerDown: (
    event: React.PointerEvent<SVGPolygonElement>,
    groupId: string,
  ) => void;
  onGroupPointerMove: (
    event: React.PointerEvent<SVGPolygonElement>,
    groupId: string,
  ) => void;
  onGroupPointerUp: (
    event: React.PointerEvent<SVGPolygonElement>,
    groupId: string,
  ) => void;
  onSelectGroup: (groupId: string) => void;
}

function createOutlineModel(
  group: CanvasGroup,
  nodeRects: ReadonlyMap<string, CanvasNodeRect>,
  margin: number,
): GroupOutlineModel | null {
  const memberRects: CanvasNodeRect[] = [];
  for (const nodeId of group.nodeIds) {
    const rect = nodeRects.get(nodeId);
    if (rect !== undefined) {
      memberRects.push(rect);
    }
  }

  const hull = calculateCompositeGroupOutline(
    memberRects,
    GROUP_HULL_PADDING_FLOW_UNITS,
  );
  if (hull.length < 3) {
    return null;
  }

  const xCoordinates = hull.map((point) => point.x);
  const yCoordinates = hull.map((point) => point.y);
  const left = Math.min(...xCoordinates) - margin;
  const top = Math.min(...yCoordinates) - margin;
  const right = Math.max(...xCoordinates) + margin;
  const bottom = Math.max(...yCoordinates) + margin;

  return {
    groupId: group.id,
    height: bottom - top,
    left,
    points: hull.map((point) => `${point.x - left},${point.y - top}`).join(' '),
    top,
    width: right - left,
  };
}

export function GroupOutlines({
  groups,
  nodes,
  selectedGroupId,
  onGroupPointerDown,
  onGroupPointerMove,
  onGroupPointerUp,
  onSelectGroup,
}: GroupOutlinesProps) {
  const { zoom } = useViewport();
  const hitTargetWidth = GROUP_HIT_TARGET_SCREEN_PIXELS / zoom;
  const outlineModels = useMemo(() => {
    const nodeRects = new Map<string, CanvasNodeRect>();
    for (const node of nodes) {
      const rect = toCanvasNodeRect(node);
      if (rect !== null) {
        nodeRects.set(node.id, rect);
      }
    }

    const models: GroupOutlineModel[] = [];
    for (const group of groups) {
      const model = createOutlineModel(group, nodeRects, hitTargetWidth / 2);
      if (model !== null) {
        models.push(model);
      }
    }

    return models;
  }, [groups, hitTargetWidth, nodes]);

  return (
    <ViewportPortal>
      {outlineModels.map((outline) => {
        const isSelected = outline.groupId === selectedGroupId;
        const outlineWidth =
          (isSelected
            ? SELECTED_GROUP_OUTLINE_SCREEN_PIXELS
            : GROUP_OUTLINE_SCREEN_PIXELS) / zoom;

        return (
          <svg
            key={outline.groupId}
            className="group-outline"
            data-selected={isSelected}
            style={{
              height: outline.height,
              left: outline.left,
              top: outline.top,
              width: outline.width,
            }}
          >
            <polygon
              className="group-outline__visible"
              fill="none"
              points={outline.points}
              strokeWidth={outlineWidth}
            />
            <polygon
              aria-label="Select group"
              className="group-outline__hit-target"
              fill="transparent"
              points={outline.points}
              role="button"
              strokeWidth={hitTargetWidth}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return;
                }

                event.preventDefault();
                event.stopPropagation();
                onSelectGroup(outline.groupId);
              }}
              onPointerDown={(event) => {
                onGroupPointerDown(event, outline.groupId);
              }}
              onPointerMove={(event) => {
                onGroupPointerMove(event, outline.groupId);
              }}
              onPointerUp={(event) => {
                onGroupPointerUp(event, outline.groupId);
              }}
              onLostPointerCapture={(event) => {
                onGroupPointerUp(event, outline.groupId);
              }}
            />
          </svg>
        );
      })}
    </ViewportPortal>
  );
}
