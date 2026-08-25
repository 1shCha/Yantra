import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type NodeMouseHandler,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react';

import { REACT_FLOW_TEXT_NODE_TYPE } from '../../shared/json-canvas';
import { useCanvasStore } from '../stores/canvasStore';
import { AlignmentGuides } from './AlignmentGuides';
import {
  calculateAlignment,
  calculateResizeAlignment,
  isAlignmentRectVisible,
  type AlignmentRect,
  type AlignmentResult,
  type AlignmentViewport,
} from './alignment-guides';
import {
  CanvasAlignmentProvider,
  type NodeGeometry,
} from './canvas-alignment-context';
import { CanvasPersistenceStatus, type PersistenceStatus } from './CanvasPersistenceStatus';
import { GroupOutlines } from './GroupOutlines';
import { MarkdownNode } from './MarkdownNode';
import {
  MARKDOWN_NODE_MIN_HEIGHT,
  MARKDOWN_NODE_MIN_WIDTH,
  type MarkdownFlowNode,
} from './react-flow-mapping';
import { toCanvasNodeRect } from './react-flow-node-geometry';
import { SelectionToolbar } from './SelectionToolbar';

const ALIGNMENT_TOLERANCE_SCREEN_PIXELS = 6;

function isElementTarget(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function toAlignmentViewport(
  container: HTMLElement | null,
  viewport: Viewport,
): AlignmentViewport | null {
  if (
    container === null ||
    container.clientWidth <= 0 ||
    container.clientHeight <= 0 ||
    viewport.zoom <= 0
  ) {
    return null;
  }

  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: container.clientWidth / viewport.zoom,
    height: container.clientHeight / viewport.zoom,
  };
}

interface CanvasViewProps {
  persistenceStatus: PersistenceStatus;
}

interface GroupDragState {
  groupId: string;
  lastClientX: number;
  lastClientY: number;
  pointerId: number;
}

export function CanvasView({ persistenceStatus }: CanvasViewProps) {
  const canvasRef = useRef<HTMLElement>(null);
  const groupDragStateRef = useRef<GroupDragState | null>(null);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const groups = useCanvasStore((state) => state.groups);
  const selectedNodeIds = useCanvasStore((state) => state.selectedNodeIds);
  const selectedGroupId = useCanvasStore((state) => state.selectedGroupId);
  const onNodesChange = useCanvasStore((state) => state.onNodesChange);
  const onEdgesChange = useCanvasStore((state) => state.onEdgesChange);
  const createMarkdownNode = useCanvasStore((state) => state.createMarkdownNode);
  const setNodePosition = useCanvasStore((state) => state.setNodePosition);
  const editNode = useCanvasStore((state) => state.editNode);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const groupSelectedNodes = useCanvasStore((state) => state.groupSelectedNodes);
  const selectGroup = useCanvasStore((state) => state.selectGroup);
  const ungroupSelectedGroup = useCanvasStore((state) => state.ungroupSelectedGroup);
  const moveGroupBy = useCanvasStore((state) => state.moveGroupBy);
  const deleteSelectedNodes = useCanvasStore((state) => state.deleteSelectedNodes);
  const deleteSelectedGroup = useCanvasStore((state) => state.deleteSelectedGroup);
  const { getViewport, getZoom, screenToFlowPosition } = useReactFlow();
  const [alignmentResult, setAlignmentResult] = useState<AlignmentResult | null>(null);
  const resizeStartBoundsRef = useRef<{ bounds: NodeGeometry; nodeId: string } | null>(null);

  const nodeTypes = useMemo(
    () => ({
      [REACT_FLOW_TEXT_NODE_TYPE]: MarkdownNode,
    }),
    [],
  );

  const handleCanvasDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isElementTarget(event.target)) {
        return;
      }

      if (
        event.target.closest('.react-flow__node') ||
        event.target.closest('.react-flow__controls')
      ) {
        return;
      }

      const flowPosition = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      createMarkdownNode(flowPosition);
    },
    [createMarkdownNode, screenToFlowPosition],
  );

  const nodesWithInteractionState = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: selectedNodeIds.includes(node.id),
      })),
    [nodes, selectedNodeIds],
  );

  const canGroupSelectedNodes = useMemo(() => {
    if (selectedNodeIds.length < 2) {
      return false;
    }

    const groupedNodeIds = new Set(groups.flatMap((group) => group.nodeIds));
    return selectedNodeIds.every((nodeId) => !groupedNodeIds.has(nodeId));
  }, [groups, selectedNodeIds]);

  const handleNodeDoubleClick = useCallback<NodeMouseHandler>(
    (event, node) => {
      event.preventDefault();
      event.stopPropagation();
      editNode(node.id);
    },
    [editNode],
  );

  const handlePaneClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

  const handleGroupPointerDown = useCallback(
    (event: React.PointerEvent<SVGPolygonElement>, groupId: string) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      selectGroup(groupId);
      setAlignmentResult(null);
      groupDragStateRef.current = {
        groupId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pointerId: event.pointerId,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [selectGroup],
  );

  const handleGroupPointerMove = useCallback(
    (event: React.PointerEvent<SVGPolygonElement>, groupId: string) => {
      const dragState = groupDragStateRef.current;
      if (
        dragState === null ||
        dragState.groupId !== groupId ||
        dragState.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const zoom = getZoom();
      const delta = {
        x: (event.clientX - dragState.lastClientX) / zoom,
        y: (event.clientY - dragState.lastClientY) / zoom,
      };
      groupDragStateRef.current = {
        ...dragState,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
      };
      moveGroupBy(groupId, delta);
    },
    [getZoom, moveGroupBy],
  );

  const handleGroupPointerUp = useCallback(
    (event: React.PointerEvent<SVGPolygonElement>, groupId: string) => {
      const dragState = groupDragStateRef.current;
      if (
        dragState === null ||
        dragState.groupId !== groupId ||
        dragState.pointerId !== event.pointerId
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      groupDragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const clearAlignmentGuides = useCallback<OnNodeDrag<MarkdownFlowNode>>(() => {
    setAlignmentResult(null);
  }, []);

  const getReferenceRects = useCallback((): AlignmentRect[] => {
    const visibleViewport = toAlignmentViewport(canvasRef.current, getViewport());
    if (visibleViewport === null) {
      return [];
    }

    const referenceRects: AlignmentRect[] = [];
    for (const node of nodes) {
      const referenceRect = toCanvasNodeRect(node);
      if (referenceRect !== null && isAlignmentRectVisible(referenceRect, visibleViewport)) {
        referenceRects.push(referenceRect);
      }
    }

    return referenceRects;
  }, [getViewport, nodes]);

  const getFlowTolerance = useCallback(() => {
    return ALIGNMENT_TOLERANCE_SCREEN_PIXELS / getZoom();
  }, [getZoom]);

  const alignmentContextValue = useMemo(
    () => ({
      applyResizeAlignment: (nodeId: string, geometry: NodeGeometry) => {
        const resizeStart = resizeStartBoundsRef.current;
        if (resizeStart === null || resizeStart.nodeId !== nodeId || selectedNodeIds.length > 1) {
          return { geometry, guides: null };
        }

        const referenceRects = getReferenceRects().filter((rect) => rect.id !== nodeId);
        const resizeAlignment = calculateResizeAlignment(
          geometry,
          resizeStart.bounds,
          referenceRects,
          getFlowTolerance(),
          MARKDOWN_NODE_MIN_WIDTH,
          MARKDOWN_NODE_MIN_HEIGHT,
        );
        const guides: AlignmentResult = {
          position: {
            x: resizeAlignment.bounds.x,
            y: resizeAlignment.bounds.y,
          },
          horizontalGuide: resizeAlignment.horizontalGuide,
          verticalGuide: resizeAlignment.verticalGuide,
        };
        setAlignmentResult(guides);

        return {
          geometry: resizeAlignment.bounds,
          guides,
        };
      },
      clearAlignmentGuides: () => {
        resizeStartBoundsRef.current = null;
        setAlignmentResult(null);
      },
      setResizeStartBounds: (nodeId: string, geometry: NodeGeometry) => {
        resizeStartBoundsRef.current = { nodeId, bounds: geometry };
        setAlignmentResult(null);
      },
    }),
    [getFlowTolerance, getReferenceRects, selectedNodeIds.length],
  );

  const getNodeAlignment = useCallback(
    (draggedNode: MarkdownFlowNode): AlignmentResult | null => {
      if (selectedNodeIds.length > 1) {
        return null;
      }

      const draggedRect = toCanvasNodeRect(draggedNode);
      if (draggedRect === null) {
        return null;
      }

      return calculateAlignment(draggedRect, getReferenceRects(), getFlowTolerance());
    },
    [getFlowTolerance, getReferenceRects, selectedNodeIds.length],
  );

  const applySnappedPosition = useCallback(
    (draggedNode: MarkdownFlowNode, result: AlignmentResult | null) => {
      if (
        result === null ||
        (result.position.x === draggedNode.position.x &&
          result.position.y === draggedNode.position.y)
      ) {
        return;
      }

      setNodePosition(draggedNode.id, result.position);
    },
    [setNodePosition],
  );

  const handleNodeDrag = useCallback<OnNodeDrag<MarkdownFlowNode>>(
    (_event, draggedNode) => {
      const result = getNodeAlignment(draggedNode);
      setAlignmentResult(result);
      applySnappedPosition(draggedNode, result);
    },
    [applySnappedPosition, getNodeAlignment],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<MarkdownFlowNode>>(
    (_event, draggedNode) => {
      const result = getNodeAlignment(draggedNode);
      applySnappedPosition(draggedNode, result);
      setAlignmentResult(null);
    },
    [applySnappedPosition, getNodeAlignment],
  );

  return (
    <main ref={canvasRef} className="app-shell">
      <CanvasAlignmentProvider value={alignmentContextValue}>
        <SelectionToolbar
          canGroupSelectedNodes={canGroupSelectedNodes}
          isGroupSelected={selectedGroupId !== null}
          selectedNodeCount={selectedNodeIds.length}
          onDeleteSelectedGroup={deleteSelectedGroup}
          onDeleteSelectedNodes={deleteSelectedNodes}
          onGroupSelectedNodes={groupSelectedNodes}
          onUngroupSelectedGroup={ungroupSelectedGroup}
        />
        <CanvasPersistenceStatus status={persistenceStatus} />
        <ReactFlow
          nodes={nodesWithInteractionState}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeDragStart={clearAlignmentGuides}
          onNodeDrag={handleNodeDrag}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={handlePaneClick}
          onDoubleClick={handleCanvasDoubleClick}
          fitView
          minZoom={0.2}
          maxZoom={2}
          zoomOnScroll={false}
          zoomOnPinch
          zoomOnDoubleClick={false}
          panOnDrag={false}
          panOnScroll
          selectionOnDrag
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          selectionMode={SelectionMode.Partial}
        >
          <Background variant={BackgroundVariant.Lines} gap={18} size={1} />
          <GroupOutlines
            groups={groups}
            nodes={nodes}
            selectedGroupId={selectedGroupId}
            onGroupPointerDown={handleGroupPointerDown}
            onGroupPointerMove={handleGroupPointerMove}
            onGroupPointerUp={handleGroupPointerUp}
            onSelectGroup={selectGroup}
          />
          <AlignmentGuides
            horizontalGuide={alignmentResult?.horizontalGuide ?? null}
            verticalGuide={alignmentResult?.verticalGuide ?? null}
          />
          <Controls position="bottom-right" />
        </ReactFlow>
      </CanvasAlignmentProvider>
    </main>
  );
}
