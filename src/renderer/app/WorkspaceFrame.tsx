import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from 'react';

import yantraLogo from '../assets/yantra-logo.svg';
import { SidebarIcon } from '../vault-ui/SidebarIcon';

interface WorkspaceFrameProps {
  children: ReactNode;
  sidebar?: ReactNode;
  rightSidebar?: ReactNode;
  frameRef?: Ref<HTMLElement>;
  defaultSidebarOpen?: boolean;
}

type SidebarSide = 'left' | 'right';

const LEFT_DEFAULT_WIDTH = 165;
const LEFT_MIN_WIDTH = 165;
const LEFT_MAX_WIDTH = 420;
const RIGHT_DEFAULT_WIDTH = 320;
const RIGHT_MIN_WIDTH = 220;
const MIN_SURFACE_WIDTH = 320;
const KEYBOARD_RESIZE_STEP = 16;

const WIDTH_STORAGE_KEYS = {
  left: 'yantra:sidebar-width:left',
  right: 'yantra:sidebar-width:right',
} satisfies Record<SidebarSide, string>;

function readStoredWidth(side: SidebarSide, fallback: number): number {
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEYS[side]);
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function storeWidth(side: SidebarSide, width: number) {
  window.localStorage.setItem(WIDTH_STORAGE_KEYS[side], String(Math.round(width)));
}

interface SidebarDrag {
  side: SidebarSide;
  startX: number;
  startWidth: number;
}

export function WorkspaceFrame({ children, sidebar, rightSidebar, frameRef, defaultSidebarOpen = false }: WorkspaceFrameProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBrandSidebarOpen, setIsBrandSidebarOpen] = useState(defaultSidebarOpen);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth('left', LEFT_DEFAULT_WIDTH));
  const [rightWidth, setRightWidth] = useState(() => readStoredWidth('right', RIGHT_DEFAULT_WIDTH));
  const [resizingSide, setResizingSide] = useState<SidebarSide | null>(null);
  const dragRef = useRef<SidebarDrag | null>(null);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;
    if (canvasApi === undefined) {
      return;
    }

    return canvasApi.onFullscreenChange(setIsFullscreen);
  }, []);

  const clampWidth = (side: SidebarSide, width: number): number => {
    const otherWidth = side === 'left'
      ? (isRightSidebarOpen ? rightWidth : 0)
      : (isBrandSidebarOpen ? leftWidth : 0);
    const available = window.innerWidth - otherWidth - MIN_SURFACE_WIDTH;
    const min = side === 'left' ? LEFT_MIN_WIDTH : RIGHT_MIN_WIDTH;
    const max = side === 'left' ? Math.min(LEFT_MAX_WIDTH, available) : available;
    return Math.max(min, Math.min(width, max));
  };

  const applyWidth = (side: SidebarSide, width: number) => {
    if (side === 'left') {
      setLeftWidth(width);
    } else {
      setRightWidth(width);
    }
  };

  const beginResize = (side: SidebarSide) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      side,
      startX: event.clientX,
      startWidth: side === 'left' ? leftWidth : rightWidth,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizingSide(side);
  };

  const draggedWidth = (drag: SidebarDrag, clientX: number): number => {
    const delta = clientX - drag.startX;
    return clampWidth(drag.side, drag.side === 'left' ? drag.startWidth + delta : drag.startWidth - delta);
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }

    applyWidth(drag.side, draggedWidth(drag, event.clientX));
  };

  const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }

    const width = draggedWidth(drag, event.clientX);
    applyWidth(drag.side, width);
    storeWidth(drag.side, width);
    dragRef.current = null;
    setResizingSide(null);
  };

  const resizeByKey = (side: SidebarSide) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (direction === 0) {
      return;
    }

    event.preventDefault();
    const current = side === 'left' ? leftWidth : rightWidth;
    const outward = side === 'left' ? direction : -direction;
    const width = clampWidth(side, current + KEYBOARD_RESIZE_STEP * outward);
    applyWidth(side, width);
    storeWidth(side, width);
  };

  const resetWidth = (side: SidebarSide) => () => {
    const width = clampWidth(side, side === 'left' ? LEFT_DEFAULT_WIDTH : RIGHT_DEFAULT_WIDTH);
    applyWidth(side, width);
    storeWidth(side, width);
  };

  return (
    <main
      ref={frameRef}
      className={`app-shell${isFullscreen ? ' app-shell--fullscreen' : ''}${
        isBrandSidebarOpen ? ' app-shell--sidebar-open' : ''
      }${
        isRightSidebarOpen ? ' app-shell--right-sidebar-open' : ''
      }${
        resizingSide === null ? '' : ' app-shell--resizing'
      }`}
      // SAFETY: React's CSSProperties type omits custom `--*` properties, but the DOM style API accepts them.
      style={{
        '--left-sidebar-width': `${leftWidth}px`,
        '--right-sidebar-width': `${rightWidth}px`,
      } as CSSProperties}
    >
      <aside
        className={`app-shell__sidebar${isBrandSidebarOpen ? ' app-shell__sidebar--open' : ''}`}
        aria-hidden={!isBrandSidebarOpen}
        aria-label="Yantra sidebar"
        inert={!isBrandSidebarOpen}
      >
        {sidebar}
      </aside>
      <div className="app-shell__notch" aria-label="Yantra">
        <button
          type="button"
          className="app-shell__name"
          aria-label={isBrandSidebarOpen ? 'Yantra — close sidebar' : 'Yantra — open sidebar'}
          aria-expanded={isBrandSidebarOpen}
          onClick={() => setIsBrandSidebarOpen((isOpen) => !isOpen)}
        >
          <span className="app-shell__name-mark" aria-hidden="true">
            <img className="app-shell__name-logo" src={yantraLogo} alt="" />
            <SidebarIcon className="app-shell__name-toggle" kind="panelLeft" size={25} />
          </span>
          <span className="app-shell__name-text">Yantra</span>
        </button>
      </div>
      <aside
        id="right-sidebar"
        className={`app-shell__sidebar app-shell__sidebar--right${isRightSidebarOpen ? ' app-shell__sidebar--open' : ''}`}
        aria-hidden={!isRightSidebarOpen}
        aria-label="Right sidebar"
        inert={!isRightSidebarOpen}
      >
        {rightSidebar}
      </aside>
      <div className="app-shell__notch app-shell__notch--right">
        <button
          type="button"
          className="app-shell__right-toggle"
          aria-label={isRightSidebarOpen ? 'Close right sidebar' : 'Open right sidebar'}
          aria-expanded={isRightSidebarOpen}
          aria-controls="right-sidebar"
          onClick={() => setIsRightSidebarOpen((isOpen) => !isOpen)}
        >
          <SidebarIcon kind="panelRight" size={25} />
        </button>
      </div>
      <div className="app-shell__surface">
        {children}
      </div>
      {isBrandSidebarOpen ? (
        <div
          className="app-shell__resizer app-shell__resizer--left"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
          aria-valuenow={Math.round(leftWidth)}
          aria-valuemin={LEFT_MIN_WIDTH}
          aria-valuemax={LEFT_MAX_WIDTH}
          tabIndex={0}
          data-resizing={resizingSide === 'left' ? 'true' : undefined}
          onPointerDown={beginResize('left')}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={resizeByKey('left')}
          onDoubleClick={resetWidth('left')}
        />
      ) : null}
      {isRightSidebarOpen ? (
        <div
          className="app-shell__resizer app-shell__resizer--right"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right sidebar"
          aria-valuenow={Math.round(rightWidth)}
          aria-valuemin={RIGHT_MIN_WIDTH}
          tabIndex={0}
          data-resizing={resizingSide === 'right' ? 'true' : undefined}
          onPointerDown={beginResize('right')}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onKeyDown={resizeByKey('right')}
          onDoubleClick={resetWidth('right')}
        />
      ) : null}
    </main>
  );
}
