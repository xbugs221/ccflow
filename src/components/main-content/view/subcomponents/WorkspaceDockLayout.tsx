/**
 * PURPOSE: Workspace dock layout shell.
 * Renders center chat area with scroll-safe docks and top-aligned pane controls.
 */
import React from 'react';
import { Maximize2, Minimize2, Move } from 'lucide-react';
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
  bottomDockActions?: React.ReactNode;
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
  bottomDockActions,
}: WorkspaceDockLayoutProps) {
  const { rightDock, bottomDock } = layout;

  // Fullscreen modes
  if (!isMobile && rightDock.fullscreen && rightDock.activePanel) {
    return (
      <div className="flex flex-col h-full">
        <DockPanelHeader
          title={rightDock.activePanel === 'files' ? '文件' : '源代码管理'}
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
          onFullscreenToggle={onBottomDockFullscreenToggle}
          isFullscreen
          actions={bottomDockActions}
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
    <div className="flex h-full w-full min-w-0 flex-1 overflow-hidden" data-testid="workspace-dock-layout">
      {/* Center area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">{centerContent}</div>

        {/* Bottom dock */}
        {effectiveShowBottomDock && (
          <>
            <DockResizeHandle
              direction="horizontal"
              onResize={(delta) => onBottomDockHeightChange(layout.bottomDock.height + delta)}
            />
            <DockPanelFrame
              direction="bottom"
              size={layout.bottomDock.height}
              title="终端"
              onFullscreenToggle={onBottomDockFullscreenToggle}
              onMoveTerminal={onMoveTerminalToRightSplit}
              actions={bottomDockActions}
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
            onResize={(delta) => onRightDockWidthChange(layout.rightDock.width - delta)}
          />
          <DockPanelFrame
            direction="right"
            size={layout.rightDock.width}
            title={showRightSplit ? '文件 / 终端' : rightDock.activePanel === 'files' ? '文件' : '源代码管理'}
            onFullscreenToggle={onRightDockFullscreenToggle}
            onMoveTerminal={onMoveTerminalToBottom}
            actions={showRightSplit ? bottomDockActions : undefined}
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
  onFullscreenToggle,
  onMoveTerminal,
  isFullscreen,
  actions,
}: {
  title: string;
  onFullscreenToggle: () => void;
  onMoveTerminal?: () => void;
  isFullscreen: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between px-3 py-2 border-b border-border/60 bg-background" data-testid="dock-panel-header">
      <span className="text-sm font-medium text-foreground">{title}</span>
      <div className="flex items-center gap-1">
        {actions}
        {onMoveTerminal && (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onMoveTerminal}
            aria-label="移动终端"
            title="移动终端"
          >
            <Move className="h-3.5 w-3.5" />
          </button>
        )}
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
  title,
  children,
  onFullscreenToggle,
  onMoveTerminal,
  actions,
}: {
  direction: 'right' | 'bottom';
  size: number;
  title: string;
  children: React.ReactNode;
  onFullscreenToggle: () => void;
  onMoveTerminal?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`flex-shrink-0 flex flex-col overflow-hidden bg-background border-border/40 ${
        direction === 'right' ? 'border-l' : 'border-t'
      }`}
      style={direction === 'right' ? { width: size } : { height: size }}
      data-testid={`dock-panel-${direction}`}
    >
      <DockPanelHeader
        title={title}
        onFullscreenToggle={onFullscreenToggle}
        onMoveTerminal={onMoveTerminal}
        isFullscreen={false}
        actions={actions}
      />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
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
