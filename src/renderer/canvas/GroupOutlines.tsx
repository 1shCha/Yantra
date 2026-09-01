import { useMemo } from 'react';
import { ViewportPortal, useViewport } from '@xyflow/react';

import type { CanvasGroup, MarkdownFlowNode } from './react-flow-mapping';
import { toCanvasNodeRect } from './react-flow-node-geometry';
import { GroupOutlineGeometryCache } from './group-outline-model';

const GROUP_OUTLINE_SCREEN_PIXELS = 1.5;
const SELECTED_GROUP_OUTLINE_SCREEN_PIXELS = 2;
const GROUP_HIT_TARGET_SCREEN_PIXELS = 14;

interface GroupOutlinesProps {
  groups: readonly CanvasGroup[];
  nodes: readonly MarkdownFlowNode[];
  selectedGroupId: string | null;
  groupOutlineZIndexById: ReadonlyMap<string, number>;
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

export function GroupOutlines({
  groups,
  nodes,
  selectedGroupId,
  groupOutlineZIndexById,
  onGroupPointerDown,
  onGroupPointerMove,
  onGroupPointerUp,
  onSelectGroup,
}: GroupOutlinesProps) {
  const { zoom } = useViewport();
  const hitTargetWidth = GROUP_HIT_TARGET_SCREEN_PIXELS / zoom;
  const hitTargetMargin = hitTargetWidth / 2;
  const geometryCache = useMemo(
    () => new GroupOutlineGeometryCache(toCanvasNodeRect),
    [],
  );
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const outlineModels = useMemo(
    () => geometryCache.createModels(groups, nodesById),
    [geometryCache, groups, nodesById],
  );

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
              height: outline.height + hitTargetWidth,
              left: outline.left - hitTargetMargin,
              top: outline.top - hitTargetMargin,
              width: outline.width + hitTargetWidth,
              zIndex: groupOutlineZIndexById.get(outline.groupId) ?? 0,
            }}
          >
            <g transform={`translate(${hitTargetMargin} ${hitTargetMargin})`}>
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
            </g>
          </svg>
        );
      })}
    </ViewportPortal>
  );
}
