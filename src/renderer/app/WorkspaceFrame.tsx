import { useEffect, useState, type ReactNode, type Ref } from 'react';

interface WorkspaceFrameProps {
  children: ReactNode;
  sidebar?: ReactNode;
  rightSidebar?: ReactNode;
  frameRef?: Ref<HTMLElement>;
  defaultSidebarOpen?: boolean;
}

export function WorkspaceFrame({ children, sidebar, rightSidebar, frameRef, defaultSidebarOpen = false }: WorkspaceFrameProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBrandSidebarOpen, setIsBrandSidebarOpen] = useState(defaultSidebarOpen);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);

  useEffect(() => {
    const canvasApi = window.yantraCanvas;
    if (canvasApi === undefined) {
      return;
    }

    return canvasApi.onFullscreenChange(setIsFullscreen);
  }, []);


  return (
    <main
      ref={frameRef}
      className={`app-shell${isFullscreen ? ' app-shell--fullscreen' : ''}${
        isBrandSidebarOpen ? ' app-shell--sidebar-open' : ''
      }${
        isRightSidebarOpen ? ' app-shell--right-sidebar-open' : ''
      }`}
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
            <svg
              className="app-shell__name-logo"
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path d="M3 3h18L12 21Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
              <circle cx="12" cy="9" r="2" fill="currentColor" />
            </svg>
            <svg
              className="app-shell__name-toggle"
              width="25"
              height="25"
              viewBox="0 0 24 24"
              fill="none"
            >
              <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M9 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
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
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M15 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="app-shell__surface">
        {children}
      </div>
    </main>
  );
}
