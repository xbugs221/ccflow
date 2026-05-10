/**
 * PURPOSE: Workspace dock layout shell.
 * Renders center chat area with optional right dock and bottom dock.
 */
import React from 'react';
import { Maximize2, Minimize2, PanelLeft, PanelBottom, Move } from 'lucide-react';
import type { WorkspaceLayoutState } from '../../hooks/useWorkspaceLayoutState';

export type WorkspaceDockLayoutProps = {
  layout: WorkspaceLayoutState;
  isMobile: boolean;
  centerContent: React.ReactNode;
  rightDockContent: React.ReactNode;
  bottomDockContent: React.ReactNode;
  onRightDockWidthChange: (width: number) => void;
  onBottomDockHeightChange: (height: number) => void;
  onRightDockCollapseToggle: () => void;
  onBottomDockCollapseToggle: () => void;
  onRightDockFullscreenToggle: () => void;
  onBottomDockFullscreenToggle: () => void;
  onMoveTerminalToRightSplit?: () => void;
  onMoveTerminalToBottom?: () => void;
  onRightDockSplitRatioChange?: (ratio: number) => void;
};

export default function WorkspaceDockLayout({
  layout,
  isMobile,
  centerContent,
  rightDockContent,
  bottomDockContent,
  onRightDockWidthChange,
  onBottomDockHeightChange,
  onRightDockCollapseToggle,
  onBottomDockCollapseToggle,
  onRightDockFullscreenToggle,
  onBottomDockFullscreenToggle,
  onMoveTerminalToRightSplit,
  onMoveTerminalToBottom,
  onRightDockSplitRatioChange,
}: WorkspaceDockLayoutProps) {
  const { rightDock, bottomDock } = layout;

  // Fullscreen modes
  if (!isMobile && rightDock.fullscreen && rightDock.activePanel) {
    return (
      <div className="flex flex-col h-full">
        <DockPanelHeader
          title={rightDock.activePanel === 'files' ? '文件' : '源代码管理'}
          onCollapseToggle={onRightDockCollapseToggle}
          onFullscreenToggle={onRightDockFullscreenToggle}
          isFullscreen
        />
        <div className="flex-1 min-h-0 overflow-hidden">{rightDockContent}</div>
      </div>
    );
  }

  if (!isMobile && bottomDock.fullscreen && bottomDock.activePanel) {
    return (
      <div className="flex flex-col h-full">
        <DockPanelHeader
          title="终端"
          onCollapseToggle={onBottomDockCollapseToggle}
          onFullscreenToggle={onBottomDockFullscreenToggle}
          isFullscreen
        />
        <div className="flex-1 min-h-0 overflow-hidden">{bottomDockContent}</div>
      </div>
    );
  }

  // Mobile layout: no docks, just center
  if (isMobile) {
    return <div className="flex flex-col h-full">{centerContent}</div>;
  }

  const showRightDock = rightDock.activePanel && !rightDock.collapsed;
  const showBottomDock = bottomDock.activePanel && !bottomDock.collapsed;
  const showRightSplit = rightDock.split !== null;
  // When terminal is in right split, bottom dock is not shown
  const effectiveShowBottomDock = showBottomDock && !showRightSplit;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Center area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">{centerContent}</div>

        {/* Bottom dock */}
        {effectiveShowBottomDock && (
          <>
            <DockResizeHandle
              direction="horizontal"
              onResize={(delta) => onBottomDockHeightChange(layout.bottomDock.height - delta)}
            />
            <DockPanelFrame
              direction="bottom"
              size={layout.bottomDock.height}
              onCollapseToggle={onBottomDockCollapseToggle}
              onFullscreenToggle={onBottomDockFullscreenToggle}
              onMoveTerminal={onMoveTerminalToRightSplit}
            >
              {bottomDockContent}
            </DockPanelFrame>
          </>
        )}
      </div>

      {/* Right dock */}
      {showRightDock && (
        <>
          <DockResizeHandle
            direction="vertical"
            onResize={(delta) => onRightDockWidthChange(layout.rightDock.width + delta)}
          />
          <DockPanelFrame
            direction="right"
            size={layout.rightDock.width}
            onCollapseToggle={onRightDockCollapseToggle}
            onFullscreenToggle={onRightDockFullscreenToggle}
            onMoveTerminal={onMoveTerminalToBottom}
          >
            {showRightSplit ? (
              <RightSplitPanel
                split={rightDock.split!}
                topContent={rightDockContent}
                bottomContent={bottomDockContent}
                onRatioChange={onRightDockSplitRatioChange}
              />
            ) : (
              rightDockContent
            )}
          </DockPanelFrame>
        </>
      )}
    </div>
  );
}

/**
 * PURPOSE: Header for dock panels with collapse and fullscreen controls.
 */
function DockPanelHeader({
  title,
  onCollapseToggle,
  onFullscreenToggle,
  isFullscreen,
}: {
  title: string;
  onCollapseToggle: () => void;
  onFullscreenToggle: () => void;
  isFullscreen: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 bg-background">
      <span className="text-sm font-medium text-foreground">{title}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          onClick={onCollapseToggle}
          aria-label="折叠"
          title="折叠"
        >
          <PanelLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          onClick={onFullscreenToggle}
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * PURPOSE: Resize handle for dock panels.
 */
function DockResizeHandle({
  direction,
  onResize,
}: {
  direction: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
}) {
  const [isResizing, setIsResizing] = React.useState(false);
  const startRef = React.useRef(0);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      startRef.current = direction === 'vertical' ? event.clientX : event.clientY;
    },
    [direction],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      if (!isResizing) return;
      const current = direction === 'vertical' ? event.clientX : event.clientY;
      const delta = direction === 'vertical' ? current - startRef.current : startRef.current - current;
      startRef.current = current;
      onResize(delta);
    },
    [isResizing, direction, onResize],
  );

  const handlePointerUp = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  return (
    <div
      className={`flex-shrink-0 z-10 ${
        direction === 'vertical'
          ? 'w-[3px] cursor-col-resize hover:bg-primary/30 active:bg-primary/50'
          : 'h-[3px] cursor-row-resize hover:bg-primary/30 active:bg-primary/50'
      } ${isResizing ? 'bg-primary/50' : 'bg-transparent'}`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="separator"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      data-testid={`resize-handle-${direction}`}
    />
  );
}

/**
 * PURPOSE: Frame wrapper for dock panels.
 */
function DockPanelFrame({
  direction,
  size,
  children,
  onCollapseToggle,
  onFullscreenToggle,
  onMoveTerminal,
}: {
  direction: 'right' | 'bottom';
  size: number;
  children: React.ReactNode;
  onCollapseToggle: () => void;
  onFullscreenToggle: () => void;
  onMoveTerminal?: () => void;
}) {
  return (
    <div
      className={`flex-shrink-0 flex ${direction === 'right' ? 'flex-row' : 'flex-col'} overflow-hidden bg-background border-border/40 ${
        direction === 'right' ? 'border-l' : 'border-t'
      }`}
      style={direction === 'right' ? { width: size } : { height: size }}
      data-testid={`dock-panel-${direction}`}
    >
      {direction === 'right' && (
        <div className="flex flex-col items-center gap-1 px-1 py-2 border-r border-border/40 bg-muted/30">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onCollapseToggle}
            aria-label="折叠侧边栏"
            title="折叠"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onFullscreenToggle}
            aria-label="全屏"
            title="全屏"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {onMoveTerminal && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              onClick={onMoveTerminal}
              aria-label="移动终端到此处"
              title="移动终端"
            >
              <Move className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
      {direction === 'bottom' && (
        <div className="flex items-center gap-1 px-2 py-1 border-t border-border/40 bg-muted/30">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onCollapseToggle}
            aria-label="折叠底部面板"
            title="折叠"
          >
            <PanelBottom className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onFullscreenToggle}
            aria-label="全屏"
            title="全屏"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          {onMoveTerminal && (
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              onClick={onMoveTerminal}
              aria-label="移动终端到此处"
              title="移动终端"
            >
              <Move className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * PURPOSE: Split panel for right dock with terminal in bottom section.
 */
function RightSplitPanel({
  split,
  topContent,
  bottomContent,
  onRatioChange,
}: {
  split: NonNullable<WorkspaceLayoutState['rightDock']['split']>;
  topContent: React.ReactNode;
  bottomContent: React.ReactNode;
  onRatioChange?: (ratio: number) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = React.useState(false);

  const handlePointerDown = React.useCallback((event: React.PointerEvent) => {
    if (!onRatioChange || !containerRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }, [onRatioChange]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent) => {
    if (!isResizing || !onRatioChange || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const newRatio = Math.max(0.2, Math.min(0.8, relativeY / rect.height));
    onRatioChange(newRatio);
  }, [isResizing, onRatioChange]);

  const handlePointerUp = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const topHeight = `${Math.round(split.ratio * 100)}%`;

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full">
      <div className="overflow-hidden" style={{ height: topHeight }}>{topContent}</div>
      <div
        className={`h-[3px] cursor-row-resize hover:bg-primary/30 active:bg-primary/50 ${isResizing ? 'bg-primary/50' : 'bg-transparent'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="separator"
        aria-orientation="horizontal"
        data-testid="resize-handle-split"
      />
      <div className="flex-1 min-h-0 overflow-hidden">{bottomContent}</div>
    </div>
  );
}
