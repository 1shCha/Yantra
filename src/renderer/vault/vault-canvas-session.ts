import { reconcileCanvasPresentation } from '../../shared/canvas-presentation';
import type { CanvasFile, CanvasPresentation } from '../../shared/vault-canvas';
import { MarkerType } from '@xyflow/react';
import { getFlowNodeHeight, getFlowNodeWidth, hydrateEdges, jsonCanvasEdgeFromFlowEdge, type MarkdownFlowNode } from '../canvas/react-flow-mapping';
import { createCanvasStore } from '../stores/canvasStore';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';

function nodesFromFile(file: CanvasFile, previous: readonly MarkdownFlowNode[] = []): MarkdownFlowNode[] {
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return file.nodes.map((node) => {
    const existing = previousById.get(node.id);
    // Keep React Flow's unchanged nodes (including measurements) across workspace updates.
    if (existing && existing.position.x === node.x && existing.position.y === node.y
      && existing.width === node.width && existing.height === node.height
      && existing.data.documentId === node.documentId && existing.data.color === node.color) return existing;
    return {
      id: node.id, type: 'markdownNode', position: { x: node.x, y: node.y },
      width: node.width, height: node.height, style: { width: node.width, height: node.height },
      data: { canvasType: 'text', documentId: node.documentId, color: node.color },
    };
  });
}

function edgesFromFile(file: CanvasFile) {
  return hydrateEdges(file.edges).map((edge) => ({ ...edge,
    sourceHandle: edge.data?.fromSide ?? 'right', targetHandle: edge.data?.toSide ?? 'left',
    markerStart: edge.data?.fromEnd === 'arrow' ? { type: MarkerType.ArrowClosed } : undefined,
    markerEnd: edge.data?.toEnd === 'arrow' ? { type: MarkerType.ArrowClosed } : undefined,
    style: edge.data?.color ? { stroke: edge.data.color } : undefined,
  }));
}

// Interaction state owns geometry and selection only. Content never enters this store.
export function createVaultCanvasSession(workspace: ReturnType<typeof createVaultWorkspace>, canvasId: string) {
  const initial = workspace.getState().canvases.get(canvasId);
  if (!initial) throw new Error('Canvas must be loaded before mounting its view.');
  let lastFile = initial.file;
  let synchronizing = false;
  let publishing = false;
  const flow = createCanvasStore({
    onDeleteNodes: (nodeIds) => { void workspace.getState().deleteCanvasNodes(canvasId, nodeIds); },
    onCreateNode: (position) => { void workspace.getState().createCanvasNode(canvasId, position); },
    onUpdateNodeDoc: (nodeId, doc) => {
      const state = workspace.getState();
      const documentId = flow.getState().nodes.find((node) => node.id === nodeId)?.data.documentId;
      if (!state.busy && documentId) state.updateDocument(documentId, doc);
    },
  });
  flow.setState({ nodes: nodesFromFile(lastFile), edges: edgesFromFile(lastFile), groups: lastFile.groups, layerOrder: lastFile.layerOrder });

  function publish(viewport = lastFile.viewport) {
    if (synchronizing || workspace.getState().busy || workspace.getState().deletingCanvasId === canvasId) return;
    const state = flow.getState();
    const presentation: CanvasPresentation = {
      nodes: state.nodes.map((node) => {
        if (!node.data.documentId) throw new Error('Vault node has no document reference.');
        return { id: node.id, kind: 'document', documentId: node.data.documentId, x: node.position.x, y: node.position.y,
          width: getFlowNodeWidth(node), height: getFlowNodeHeight(node), color: node.data.color };
      }),
      edges: state.edges.map(jsonCanvasEdgeFromFlowEdge), groups: state.groups, layerOrder: state.layerOrder, viewport,
    };
    const next = reconcileCanvasPresentation(presentation, lastFile);
    if (next === lastFile) return;
    publishing = true;
    try {
      workspace.getState().updateCanvas(canvasId, next);
      lastFile = workspace.getState().canvases.get(canvasId)!.file;
    } finally { publishing = false; }
  }

  function synchronize() {
    const loaded = workspace.getState().canvases.get(canvasId);
    if (publishing || !loaded || loaded.file === lastFile) return;
    const previousIds = new Set(flow.getState().nodes.map((node) => node.id));
    const previousFile = lastFile;
    lastFile = loaded.file;
    synchronizing = true;
    try {
      const added = lastFile.nodes.find((node) => !previousIds.has(node.id));
      const current = flow.getState();
      let nodes = nodesFromFile(lastFile, current.nodes);
      const selectAdded = added && workspace.getState().activeCanvasId === canvasId;
      if (selectAdded) nodes = nodes.map((node) => Boolean(node.selected) === (node.id === added.id)
        ? node : { ...node, selected: node.id === added.id });
      const update: Partial<ReturnType<typeof flow.getState>> = {
        nodes: nodes.length === current.nodes.length && nodes.every((node, index) => node === current.nodes[index]) ? current.nodes : nodes,
        edges: lastFile.edges === previousFile.edges ? current.edges : edgesFromFile(lastFile),
        groups: lastFile.groups, layerOrder: lastFile.layerOrder,
      };
      const availableIds = new Set(nodes.map((node) => node.id));
      Object.assign(update, {
        selectedNodeIds: current.selectedNodeIds.filter((id) => availableIds.has(id)),
        editingNodeId: availableIds.has(current.editingNodeId ?? '') ? current.editingNodeId : null,
        selectedGroupId: lastFile.groups.some((group) => group.id === current.selectedGroupId) ? current.selectedGroupId : null,
      });
      if (selectAdded) Object.assign(update, { selectedNodeIds: [added.id], selectedGroupId: null, editingNodeId: null });
      flow.setState(update);
    } finally { synchronizing = false; }
  }

  return {
    flow,
    defaultViewport: initial.file.viewport,
    setViewport: (viewport: CanvasPresentation['viewport']) => publish(viewport),
    connect() {
      synchronize();
      const stopWorkspace = workspace.subscribe(synchronize);
      const stopFlow = flow.subscribe((state, previous) => {
        if (state.nodes !== previous.nodes || state.edges !== previous.edges
          || state.groups !== previous.groups || state.layerOrder !== previous.layerOrder) publish();
      });
      return () => { stopWorkspace(); stopFlow(); };
    },
  };
}
