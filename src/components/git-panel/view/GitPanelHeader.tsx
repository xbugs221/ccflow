/** PURPOSE: Show current branch and remote sync actions for the Git panel. */
import { Download, GitBranch, RefreshCw, Upload } from 'lucide-react';
import type { ConfirmationRequest, GitRemoteStatus } from '../types/types';

type GitPanelHeaderProps = {
  isMobile: boolean;
  currentBranch: string;
  remoteStatus: GitRemoteStatus | null;
  isLoading: boolean;
  isFetching: boolean;
  isPulling: boolean;
  isPushing: boolean;
  isPublishing: boolean;
  onRefresh: () => void;
  onFetch: () => Promise<void>;
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
  onPublish: () => Promise<void>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
};

export default function GitPanelHeader({
  isMobile,
  currentBranch,
  remoteStatus,
  isLoading,
  isFetching,
  isPulling,
  isPushing,
  isPublishing,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onPublish,
  onRequestConfirmation,
}: GitPanelHeaderProps) {
  const aheadCount = remoteStatus?.ahead || 0;
  const behindCount = remoteStatus?.behind || 0;
  const remoteName = remoteStatus?.remoteName || 'remote';

  /**
   * Route remote operations through the shared confirmation modal.
   */
  function requestConfirmation(type: 'pull' | 'push' | 'publish') {
    const handlers = {
      pull: {
        message: `Pull ${behindCount} commit${behindCount !== 1 ? 's' : ''} from ${remoteName}?`,
        onConfirm: onPull,
      },
      push: {
        message: `Push ${aheadCount} commit${aheadCount !== 1 ? 's' : ''} to ${remoteName}?`,
        onConfirm: onPush,
      },
      publish: {
        message: `Publish branch "${currentBranch}" to ${remoteName}?`,
        onConfirm: onPublish,
      },
    };

    onRequestConfirmation({
      type,
      message: handlers[type].message,
      onConfirm: handlers[type].onConfirm,
    });
  }

  return (
    <div className={`flex items-center justify-between border-b border-border/60 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'}`}>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center gap-2 rounded-md border border-border/70 px-3 py-1.5">
          <GitBranch className={`${isMobile ? 'h-3 w-3' : 'h-4 w-4'} text-muted-foreground`} />
          <span className={`truncate font-medium ${isMobile ? 'text-xs' : 'text-sm'}`}>{currentBranch || 'No branch'}</span>
        </div>

        {remoteStatus?.hasRemote && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {aheadCount > 0 && <span title={`${aheadCount} ahead`}>{'\u2191'}{aheadCount}</span>}
            {behindCount > 0 && <span title={`${behindCount} behind`}>{'\u2193'}{behindCount}</span>}
            {remoteStatus.isUpToDate && <span title="Up to date">{'\u2713'}</span>}
          </span>
        )}
      </div>

      <div className={`flex items-center ${isMobile ? 'gap-1' : 'gap-2'}`}>
        {remoteStatus?.hasRemote && !remoteStatus.hasUpstream && (
          <button
            onClick={() => requestConfirmation('publish')}
            disabled={isPublishing}
            className="flex items-center gap-1 rounded-md bg-purple-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
            title={`Publish branch "${currentBranch}" to ${remoteName}`}
          >
            <Upload className={`h-3 w-3 ${isPublishing ? 'animate-pulse' : ''}`} />
            <span>{isPublishing ? 'Publishing...' : 'Publish'}</span>
          </button>
        )}

        {remoteStatus?.hasRemote && remoteStatus.hasUpstream && behindCount > 0 && (
          <button
            onClick={() => requestConfirmation('pull')}
            disabled={isPulling}
            className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            title={`Pull ${behindCount} commit${behindCount !== 1 ? 's' : ''} from ${remoteName}`}
          >
            <Download className={`h-3 w-3 ${isPulling ? 'animate-pulse' : ''}`} />
            <span>{isPulling ? 'Pulling...' : `Pull ${behindCount}`}</span>
          </button>
        )}

        {remoteStatus?.hasRemote && remoteStatus.hasUpstream && aheadCount > 0 && (
          <button
            onClick={() => requestConfirmation('push')}
            disabled={isPushing}
            className="flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1 text-sm text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
            title={`Push ${aheadCount} commit${aheadCount !== 1 ? 's' : ''} to ${remoteName}`}
          >
            <Upload className={`h-3 w-3 ${isPushing ? 'animate-pulse' : ''}`} />
            <span>{isPushing ? 'Pushing...' : `Push ${aheadCount}`}</span>
          </button>
        )}

        {remoteStatus?.hasRemote && (
          <button
            onClick={() => void onFetch()}
            disabled={isFetching}
            className="flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1 text-sm transition-colors hover:bg-accent disabled:opacity-50"
            title={`Fetch from ${remoteName}`}
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
            <span>{isFetching ? 'Fetching...' : 'Fetch'}</span>
          </button>
        )}

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className={`rounded-md transition-colors hover:bg-accent ${isMobile ? 'p-1' : 'p-1.5'}`}
          title="Refresh git status"
        >
          <RefreshCw className={`text-muted-foreground ${isLoading ? 'animate-spin' : ''} ${isMobile ? 'h-3 w-3' : 'h-4 w-4'}`} />
        </button>
      </div>
    </div>
  );
}
