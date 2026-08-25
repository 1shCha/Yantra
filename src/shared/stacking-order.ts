export interface LayerGroup {
  id: string;
  nodeIds: readonly string[];
}

export interface StackingZIndices {
  groupOutlineZIndexById: ReadonlyMap<string, number>;
  nodeZIndexById: ReadonlyMap<string, number>;
}

const STACKING_STRIDE = 2;
const OUTLINE_SLOT = 0;
const CONTENT_SLOT = 1;

export function deriveLayerOrder(
  nodeIds: readonly string[],
  groups: readonly LayerGroup[],
): string[] {
  const groupIdByNodeId = new Map<string, string>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      groupIdByNodeId.set(nodeId, group.id);
    }
  }

  const layerOrder: string[] = [];
  const seenIds = new Set<string>();

  for (const nodeId of nodeIds) {
    const groupId = groupIdByNodeId.get(nodeId);
    if (groupId === undefined) {
      if (seenIds.has(nodeId)) {
        continue;
      }

      layerOrder.push(nodeId);
      seenIds.add(nodeId);
      continue;
    }

    if (seenIds.has(groupId)) {
      continue;
    }

    layerOrder.push(groupId);
    seenIds.add(groupId);
  }

  for (const group of groups) {
    if (seenIds.has(group.id)) {
      continue;
    }

    layerOrder.push(group.id);
    seenIds.add(group.id);
  }

  return layerOrder;
}

export function reconcileLayerOrder(
  layerOrder: readonly string[],
  nodeIds: readonly string[],
  groups: readonly LayerGroup[],
): string[] {
  const derivedIds = deriveLayerOrder(nodeIds, groups);
  const validIds = new Set(derivedIds);
  const kept: string[] = [];
  const keptIds = new Set<string>();

  for (const unitId of layerOrder) {
    if (!validIds.has(unitId) || keptIds.has(unitId)) {
      continue;
    }

    kept.push(unitId);
    keptIds.add(unitId);
  }

  for (const unitId of derivedIds) {
    if (keptIds.has(unitId)) {
      continue;
    }

    kept.push(unitId);
    keptIds.add(unitId);
  }

  return kept;
}

export function moveUnitToFront(layerOrder: readonly string[], unitId: string): string[] {
  if (layerOrder[layerOrder.length - 1] === unitId) {
    return [...layerOrder];
  }

  return [...layerOrder.filter((candidateId) => candidateId !== unitId), unitId];
}

export function stackingUnitIdForNode(
  nodeId: string,
  groups: readonly LayerGroup[],
): string {
  for (const group of groups) {
    if (group.nodeIds.includes(nodeId)) {
      return group.id;
    }
  }

  return nodeId;
}

export function getStackingZIndices(
  layerOrder: readonly string[],
  groups: readonly LayerGroup[],
): StackingZIndices {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const groupOutlineZIndexById = new Map<string, number>();
  const nodeZIndexById = new Map<string, number>();

  for (const [index, unitId] of layerOrder.entries()) {
    const zBase = index * STACKING_STRIDE + 1;
    const group = groupById.get(unitId);
    if (group === undefined) {
      nodeZIndexById.set(unitId, zBase + CONTENT_SLOT);
      continue;
    }

    groupOutlineZIndexById.set(unitId, zBase + OUTLINE_SLOT);
    const memberZIndex = zBase + CONTENT_SLOT;
    for (const nodeId of group.nodeIds) {
      nodeZIndexById.set(nodeId, memberZIndex);
    }
  }

  return {
    groupOutlineZIndexById,
    nodeZIndexById,
  };
}
