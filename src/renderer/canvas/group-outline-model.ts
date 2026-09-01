import type { CanvasGroup } from './react-flow-mapping';
import type { CanvasNodeRect } from './react-flow-node-geometry';
import {
  DEFAULT_GROUP_OUTLINE_POLICY,
  calculateCompositeGroupOutline,
  type GroupOutlinePolicy,
  type HullPoint,
} from './group-hull';

const GEOMETRY_KEY_PRECISION = 1_000_000;

export interface GroupOutlineGeometryModel {
  groupId: string;
  height: number;
  left: number;
  points: string;
  top: number;
  width: number;
}

type OutlineCalculator = (
  memberRects: readonly CanvasNodeRect[],
  policy: GroupOutlinePolicy,
) => HullPoint[];

interface NormalizedMemberGeometry {
  geometryKey: string;
  memberRects: CanvasNodeRect[];
  originX: number;
  originY: number;
}

interface RelativeGroupOutline {
  height: number;
  leftOffset: number;
  points: string;
  topOffset: number;
  width: number;
}

interface CachedGroupGeometry {
  geometryKey: string;
  model: GroupOutlineGeometryModel | null;
  outline: RelativeGroupOutline | null;
}

function toGeometryKeyNumber(value: number): number {
  return Math.round(value * GEOMETRY_KEY_PRECISION) / GEOMETRY_KEY_PRECISION;
}

function normalizeMemberGeometry(
  absoluteRects: readonly CanvasNodeRect[],
): NormalizedMemberGeometry | null {
  if (absoluteRects.length === 0) {
    return null;
  }

  const sortedRects = [...absoluteRects].sort((first, second) =>
    first.id.localeCompare(second.id),
  );
  const originX = Math.min(...sortedRects.map((rect) => rect.x));
  const originY = Math.min(...sortedRects.map((rect) => rect.y));
  const memberRects = sortedRects.map((rect) => ({
    ...rect,
    x: rect.x - originX,
    y: rect.y - originY,
  }));
  const geometryKey = JSON.stringify(
    memberRects.map((rect) => [
      rect.id,
      toGeometryKeyNumber(rect.x),
      toGeometryKeyNumber(rect.y),
      toGeometryKeyNumber(rect.width),
      toGeometryKeyNumber(rect.height),
    ]),
  );

  return { geometryKey, memberRects, originX, originY };
}

function createRelativeOutline(hull: readonly HullPoint[]): RelativeGroupOutline | null {
  if (hull.length < 3) {
    return null;
  }

  const xCoordinates = hull.map((point) => point.x);
  const yCoordinates = hull.map((point) => point.y);
  const leftOffset = Math.min(...xCoordinates);
  const topOffset = Math.min(...yCoordinates);
  const rightOffset = Math.max(...xCoordinates);
  const bottomOffset = Math.max(...yCoordinates);

  return {
    height: bottomOffset - topOffset,
    leftOffset,
    points: hull
      .map((point) => `${point.x - leftOffset},${point.y - topOffset}`)
      .join(' '),
    topOffset,
    width: rightOffset - leftOffset,
  };
}

export class GroupOutlineGeometryCache<NodeType extends { id: string }> {
  private readonly entries = new Map<string, CachedGroupGeometry>();

  constructor(
    private readonly readRect: (node: NodeType) => CanvasNodeRect | null,
    private readonly calculateOutline: OutlineCalculator =
      calculateCompositeGroupOutline,
    private readonly policy: GroupOutlinePolicy = DEFAULT_GROUP_OUTLINE_POLICY,
  ) {}

  createModels(
    groups: readonly CanvasGroup[],
    nodesById: ReadonlyMap<string, NodeType>,
  ): GroupOutlineGeometryModel[] {
    const activeGroupIds = new Set(groups.map((group) => group.id));
    for (const groupId of this.entries.keys()) {
      if (!activeGroupIds.has(groupId)) {
        this.entries.delete(groupId);
      }
    }

    const models: GroupOutlineGeometryModel[] = [];
    for (const group of groups) {
      const cached = this.entries.get(group.id);
      const memberRects: CanvasNodeRect[] = [];
      for (const nodeId of group.nodeIds) {
        const node = nodesById.get(nodeId);
        if (node === undefined) {
          continue;
        }

        const rect = this.readRect(node);
        if (rect !== null) {
          memberRects.push(rect);
        }
      }

      const normalized = normalizeMemberGeometry(memberRects);
      if (normalized === null) {
        this.entries.delete(group.id);
        continue;
      }

      const outline =
        cached?.geometryKey === normalized.geometryKey
          ? cached.outline
          : createRelativeOutline(
              this.calculateOutline(
                normalized.memberRects,
                this.policy,
              ),
            );

      const left =
        outline === null ? null : normalized.originX + outline.leftOffset;
      const top = outline === null ? null : normalized.originY + outline.topOffset;
      const canReuseModel =
        cached?.geometryKey === normalized.geometryKey &&
        cached.model !== null &&
        cached.model.left === left &&
        cached.model.top === top;
      const model =
        outline === null || left === null || top === null
          ? null
          : canReuseModel
            ? cached.model
            : {
                groupId: group.id,
                height: outline.height,
                left,
                points: outline.points,
                top,
                width: outline.width,
              };
      this.entries.set(group.id, {
        geometryKey: normalized.geometryKey,
        model,
        outline,
      });
      if (model !== null) {
        models.push(model);
      }
    }

    return models;
  }
}
