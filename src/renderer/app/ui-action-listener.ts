import { vaultTrace } from '../persistence/vault-diagnostics';

export interface UiActionEvent {
  time: number;
  kind: 'action-start' | 'checkpoint' | 'mutation' | 'error';
  actionId?: number;
  label?: string;
  detail: object;
}

interface UiActionDebug {
  snapshot: () => UiActionEvent[];
  clear: () => void;
  lastAction: () => UiActionEvent[];
  lastActionJson: () => string;
  copyLastAction: () => Promise<void>;
  dispose: () => void;
}

declare global {
  interface Window {
    yantraUiDebug?: UiActionDebug;
  }
}

const LIMIT = 1000;
const CHECKPOINTS = [0, 25, 100, 500];

function textOf(element: Element | null): string | undefined {
  const text = element?.textContent?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 120) : undefined;
}

function describe(element: Element | null, includeText = true) {
  if (!element) return {};
  const button = element.closest<HTMLElement>('button, [role="button"]') ?? element;
  return {
    tag: button.tagName.toLowerCase(),
    id: button.id || undefined,
    ariaLabel: button.getAttribute('aria-label') || undefined,
    title: button.getAttribute('title') || undefined,
    text: includeText ? textOf(button) : undefined,
    classes: button.className || undefined,
    path: button.getAttribute('data-path') || undefined,
    resourceId: button.getAttribute('data-resource-id') || undefined,
  };
}

function domState() {
  const activeTab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  const activePane = document.querySelector<HTMLElement>('.vault-tab-pane[aria-hidden="false"]');
  const flow = activePane?.querySelector<HTMLElement>('.react-flow');
  const background = activePane?.querySelector<HTMLElement>('.react-flow__background');
  const pattern = background?.querySelector('pattern');
  const patternFill = background?.querySelector('rect')?.getAttribute('fill') ?? undefined;
  const navigationToken = vaultTrace.snapshot().filter((event) => event.event === 'navigation.begin').at(-1)?.operation;
  return {
    activeTab: activeTab ? { id: activeTab.id, fileId: activeTab.dataset.fileId, title: textOf(activeTab) } : undefined,
    activePane: activePane ? { id: activePane.id, className: activePane.className, ariaHidden: activePane.getAttribute('aria-hidden') } : undefined,
    busy: document.querySelector('[aria-busy="true"]') !== null,
    popoverOpen: document.querySelector('[popover]:popover-open')?.id,
    navigationToken,
    flow: flow ? { width: flow.getBoundingClientRect().width, height: flow.getBoundingClientRect().height } : undefined,
    background: background ? {
      width: background.getBoundingClientRect().width,
      height: background.getBoundingClientRect().height,
      visibility: getComputedStyle(background).visibility,
      patternId: pattern?.id,
      patternFill,
    } : undefined,
  };
}

// Installs only in Vite's development build. Use window.yantraUiDebug.snapshot()
// in DevTools after reproducing an interaction and copy the returned JSON.
export function installUiActionListener(): void {
  if (!vaultTrace.enabled) return;
  window.yantraUiDebug?.dispose?.();

  const events: UiActionEvent[] = [];
  let nextActionId = 0;
  let lastActionId: number | null = null;
  let currentAction: { id: number; timers: number[] } | null = null;

  const stopAction = () => {
    currentAction?.timers.forEach((timer) => window.clearTimeout(timer));
    currentAction = null;
  };

  const record = (event: UiActionEvent) => {
    events.push(event);
    if (events.length > LIMIT) events.shift();
    if (event.kind === 'action-start' || event.kind === 'error') console.info('[Yantra UI]', event);
  };

  const checkpoint = (id: number, label: string, delay: number) => {
    const timer = window.setTimeout(() => {
      if (!currentAction || currentAction.id !== id) return;
      record({ time: Date.now(), kind: 'checkpoint', actionId: id, label,
        detail: { delay, dom: domState(), activeElement: describe(document.activeElement) } });
      if (delay === CHECKPOINTS.at(-1)) currentAction = null;
    }, delay);
    currentAction?.timers.push(timer);
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, [role="button"]') : null;
    if (!target) return;
    stopAction();
    const id = ++nextActionId;
    lastActionId = id;
    currentAction = { id, timers: [] };
    record({ time: Date.now(), kind: 'action-start', actionId: id, label: textOf(target) || target.getAttribute('aria-label') || target.tagName,
      detail: { event: { type: event.type, detail: event.detail, button: event.button }, target: describe(target), domBefore: domState() } });
    CHECKPOINTS.forEach((delay) => checkpoint(id, `after-${delay}ms`, delay));
  };
  document.addEventListener('click', onClick, true);

  const observer = new MutationObserver((mutations) => {
    if (!currentAction || !mutations.length) return;
    const relevant = mutations.slice(0, 30).map((mutation) => ({
      type: mutation.type,
      target: describe(mutation.target instanceof Element ? mutation.target : null, false),
      attribute: mutation.type === 'attributes' ? mutation.attributeName : undefined,
      added: mutation.type === 'childList' ? mutation.addedNodes.length : undefined,
      removed: mutation.type === 'childList' ? mutation.removedNodes.length : undefined,
    }));
    record({ time: Date.now(), kind: 'mutation', actionId: currentAction.id,
      detail: { count: mutations.length, mutations: relevant } });
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-busy', 'aria-selected', 'aria-hidden', 'class', 'style', 'hidden'] });

  const onError = (event: ErrorEvent) => {
    record({ time: Date.now(), kind: 'error', actionId: currentAction?.id,
      detail: { message: event.message, source: event.filename, line: event.lineno, column: event.colno } });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    record({ time: Date.now(), kind: 'error', actionId: currentAction?.id,
      detail: { message: event.reason instanceof Error ? event.reason.message : String(event.reason) } });
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const lastAction = () => events.filter((event) => event.actionId === lastActionId).map((event) => ({ ...event, detail: { ...event.detail } }));
  const debug: UiActionDebug = {
    snapshot: () => events.map((event) => ({ ...event, detail: { ...event.detail } })),
    clear: () => { stopAction(); events.length = 0; lastActionId = null; },
    lastAction,
    lastActionJson: () => JSON.stringify(lastAction(), null, 2),
    dispose: () => {
      stopAction();
      observer.disconnect();
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      if (window.yantraUiDebug === debug) delete window.yantraUiDebug;
    },
    async copyLastAction() {
      const json = this.lastActionJson();
      try {
        await navigator.clipboard.writeText(json);
        console.info('[Yantra UI] Copied last action trace to clipboard.');
      } catch (error) {
        console.warn('[Yantra UI] Clipboard unavailable; use copy(window.yantraUiDebug.lastActionJson()) in DevTools.', error);
        console.log(json);
      }
    },
  };

  window.yantraUiDebug = debug;
}
