import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import { flushSync } from 'react-dom';
import type { createVaultWorkspace } from '../stores/vaultWorkspace';
import { pointerContentDelta, previewTabDrag, tabDragShouldCommit, toContentRects, type TabDragEndReason } from './tab-drag-model';

/** Preview with transforms; commit once so dragging cannot disturb mounted panes. */
export function useTabDrag(store: ReturnType<typeof createVaultWorkspace>) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback((event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0 || !event.isPrimary || store.getState().busy) return;
    cleanup.current?.();
    const button = event.currentTarget;
    const item = button.parentElement!;
    const list = item.parentElement!;
    const items = Array.from(list.children).filter((element): element is HTMLElement => element instanceof HTMLElement);
    const from = store.getState().tabs.findIndex((tab) => tab.id === id);
    if (from < 0 || items.length < 2) return;
    const startX = event.clientX;
    const startScroll = list.scrollLeft;
    const rects = toContentRects(items.map((element) => element.getBoundingClientRect()), startScroll);
    let x = startX;
    let to = from;
    let previousDelta = 0;
    let dragging = false;
    let finished = false;
    let frame = 0;
    let lastTime = 0;
    const pointerId = event.pointerId;

    function preview(delta: number) {
      const next = previewTabDrag(rects, from, to, previousDelta, delta);
      to = next.to;
      previousDelta = delta;
      items.forEach((element, index) => { element.style.transform = `translateX(${next.offsets[index]}px)`; });
    }

    function currentDelta() {
      return pointerContentDelta(x, startX, list.scrollLeft, startScroll);
    }

    function guardReleaseClick() {
      const suppress = (click: MouseEvent) => { click.preventDefault(); click.stopPropagation(); };
      const clear = () => {
        window.removeEventListener('click', suppress, true);
        window.removeEventListener('pointerdown', clear, true);
      };
      window.addEventListener('click', suppress, { capture: true, once: true });
      window.addEventListener('pointerdown', clear, { capture: true, once: true });
      setTimeout(clear, 0);
    }

    function detach() {
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', key);
      button.removeEventListener('lostpointercapture', lostCapture);
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    }

    function finish(reason: TabDragEndReason) {
      if (finished) return;
      finished = true;
      if (dragging) preview(currentDelta());
      const shouldCommit = tabDragShouldCommit({
        reason, dragging, busy: store.getState().busy,
        tabOpen: store.getState().tabs.some((tab) => tab.id === id), from, to,
      });
      if (shouldCommit) flushSync(() => { store.getState().reorderTab(id, to); });
      detach();
      for (const element of items) { element.style.transform = ''; delete element.dataset.tabDragging; }
      list.classList.remove('vault-tabs__list--dragging');
      cleanup.current = null;
      if (dragging) guardReleaseClick();
    }

    function key(keyEvent: globalThis.KeyboardEvent) {
      if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish('escape'); }
    }
    function end(pointer: globalThis.PointerEvent) {
      if (pointer.pointerId !== pointerId) return;
      x = pointer.clientX;
      finish(dragging ? (pointer.type === 'pointercancel' ? 'pointercancel' : 'pointerup') : 'replace');
    }
    function lostCapture() {
      finish(dragging ? 'lostpointercapture' : 'replace');
    }
    function draw(time: number) {
      if (finished) return;
      if (!store.getState().busy) {
        const bounds = list.getBoundingClientRect();
        const edge = Math.min(36, bounds.width / 4);
        const speed = x < bounds.left + edge ? -Math.min(1, (bounds.left + edge - x) / edge)
          : x > bounds.right - edge ? Math.min(1, (x - bounds.right + edge) / edge) : 0;
        list.scrollLeft += speed * Math.min(time - (lastTime || time), 32) * .5;
        preview(currentDelta());
      }
      lastTime = time;
      frame = requestAnimationFrame(draw);
    }
    function move(pointer: globalThis.PointerEvent) {
      if (pointer.pointerId !== pointerId) return;
      x = pointer.clientX;
      if (!dragging && Math.abs(x - startX) >= 5) {
        dragging = true;
        button.setPointerCapture(pointerId);
        button.addEventListener('lostpointercapture', lostCapture);
        item.dataset.tabDragging = 'true';
        list.classList.add('vault-tabs__list--dragging');
        if (store.getState().activeTabId !== id) void store.getState().activateTab(id);
        lastTime = 0;
        frame = requestAnimationFrame(draw);
      }
      if (dragging) pointer.preventDefault();
    }
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', key);
    cleanup.current = () => { finish('replace'); };
  }, [store]);
}
