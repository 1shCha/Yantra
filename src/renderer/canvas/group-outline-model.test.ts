import { describe, expect, it, vi } from 'vitest';

import type { CanvasGroup } from './react-flow-mapping';
import type { CanvasNodeRect } from './react-flow-node-geometry';
import { calculateCompositeGroupOutline } from './group-hull';
import { GroupOutlineGeometryCache } from './group-outline-model';

function createRect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): CanvasNodeRect {
  return { id, x, y, width, height };
}

function createRectMap(rects: readonly CanvasNodeRect[]) {
  return new Map(rects.map((rect) => [rect.id, rect]));
}

const twoGroups: CanvasGroup[] = [
  { id: 'group-a', nodeIds: ['a-1', 'a-2'] },
  { id: 'group-b', nodeIds: ['b-1', 'b-2'] },
];

describe('GroupOutlineGeometryCache', () => {
  it('recalculates only the group whose relative member geometry changed', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const readRect = vi.fn((rect: CanvasNodeRect) => rect);
    const cache = new GroupOutlineGeometryCache(readRect, calculateOutline);
    const initialRects = [
      createRect('a-1', 0, 0),
      createRect('a-2', 180, 100),
      createRect('b-1', 500, 0),
      createRect('b-2', 680, 100),
    ];

    cache.createModels(twoGroups, createRectMap(initialRects));
    expect(calculateOutline).toHaveBeenCalledTimes(2);

    cache.createModels(
      twoGroups,
      createRectMap(
        initialRects.map((rect) =>
          rect.id === 'a-2' ? { ...rect, x: rect.x + 25 } : rect,
        ),
      ),
    );
    expect(calculateOutline).toHaveBeenCalledTimes(3);
    expect(readRect).toHaveBeenCalledTimes(8);
  });

  it('invalidates one group when a member is resized', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const cache = new GroupOutlineGeometryCache(
      (rect: CanvasNodeRect) => rect,
      calculateOutline,
    );
    const initialRects = [
      createRect('a-1', 0, 0),
      createRect('a-2', 180, 100),
      createRect('b-1', 500, 0),
      createRect('b-2', 680, 100),
    ];

    cache.createModels(twoGroups, createRectMap(initialRects));
    cache.createModels(
      twoGroups,
      createRectMap(
        initialRects.map((rect) =>
          rect.id === 'b-1' ? { ...rect, width: rect.width + 40 } : rect,
        ),
      ),
    );

    expect(calculateOutline).toHaveBeenCalledTimes(3);
  });

  it('reuses a shape when every member receives the same translation', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const cache = new GroupOutlineGeometryCache(
      (rect: CanvasNodeRect) => rect,
      calculateOutline,
    );
    const group: CanvasGroup = { id: 'group', nodeIds: ['first', 'second'] };
    const initialRects = [
      createRect('first', 0, 0),
      createRect('second', 0.3, 120.2),
    ];
    const [initialModel] = cache.createModels([group], createRectMap(initialRects));
    const delta = { x: 0.1, y: 0.1 };
    const [translatedModel] = cache.createModels(
      [group],
      createRectMap(
        initialRects.map((rect) => ({
          ...rect,
          x: rect.x + delta.x,
          y: rect.y + delta.y,
        })),
      ),
    );

    expect(calculateOutline).toHaveBeenCalledTimes(1);
    expect(translatedModel?.points).toBe(initialModel?.points);
    expect(translatedModel?.width).toBe(initialModel?.width);
    expect(translatedModel?.height).toBe(initialModel?.height);
    expect(translatedModel?.left).toBe((initialModel?.left ?? 0) + delta.x);
    expect(translatedModel?.top).toBe((initialModel?.top ?? 0) + delta.y);
  });

  it('reuses models when new node objects have unchanged geometry', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const readRect = vi.fn((rect: CanvasNodeRect) => rect);
    const cache = new GroupOutlineGeometryCache(readRect, calculateOutline);
    const rects = createRectMap([
      createRect('a-1', 0, 0),
      createRect('a-2', 180, 100),
      createRect('b-1', 500, 0),
      createRect('b-2', 680, 100),
    ]);

    const initialModels = cache.createModels(twoGroups, rects);
    const repeatedModels = cache.createModels(
      twoGroups,
      createRectMap(Array.from(rects.values(), (rect) => ({ ...rect }))),
    );

    expect(calculateOutline).toHaveBeenCalledTimes(2);
    expect(readRect).toHaveBeenCalledTimes(8);
    expect(repeatedModels[0]).toBe(initialModels[0]);
    expect(repeatedModels[1]).toBe(initialModels[1]);
  });

  it('reuses a shape when member order changes without changing geometry', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const cache = new GroupOutlineGeometryCache(
      (rect: CanvasNodeRect) => rect,
      calculateOutline,
    );
    const initialGroup: CanvasGroup = {
      id: 'group',
      nodeIds: ['first', 'second'],
    };
    const reorderedGroup: CanvasGroup = {
      id: 'group',
      nodeIds: ['second', 'first'],
    };
    const rects = createRectMap([
      createRect('first', 0, 0),
      createRect('second', 180, 100),
    ]);

    cache.createModels([initialGroup], rects);
    cache.createModels([reorderedGroup], rects);

    expect(calculateOutline).toHaveBeenCalledTimes(1);
  });

  it('invalidates a group when its measured membership changes', () => {
    const calculateOutline = vi.fn(calculateCompositeGroupOutline);
    const cache = new GroupOutlineGeometryCache(
      (rect: CanvasNodeRect) => rect,
      calculateOutline,
    );
    const initialGroup: CanvasGroup = { id: 'group', nodeIds: ['first'] };
    const expandedGroup: CanvasGroup = {
      id: 'group',
      nodeIds: ['first', 'second'],
    };
    const rects = createRectMap([
      createRect('first', 0, 0),
      createRect('second', 200, 100),
    ]);

    cache.createModels([initialGroup], rects);
    cache.createModels([expandedGroup], rects);

    expect(calculateOutline).toHaveBeenCalledTimes(2);
  });
});
