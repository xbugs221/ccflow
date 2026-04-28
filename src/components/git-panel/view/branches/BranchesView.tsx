/** PURPOSE: Render local and remote branch workflows for the Git panel. */
import { GitBranch, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { ConfirmationRequest, GitLocalBranch, GitRemoteBranch } from '../../types/types';
import NewBranchModal from '../modals/NewBranchModal';

type BranchesViewProps = {
  currentBranch: string;
  localBranches: GitLocalBranch[];
  remoteBranches: GitRemoteBranch[];
  isMobile: boolean;
  isLoading: boolean;
  isCreatingBranch: boolean;
  onRefresh: () => void;
  onCreateBranch: (branchName: string) => Promise<boolean>;
  onSwitchBranch: (branchName: string, startPoint?: string) => Promise<boolean>;
  onDeleteBranch: (branchName: string) => Promise<boolean>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
};

type BranchRowProps = {
  name: string;
  badge?: string;
  actionLabel?: string;
  deleteTitle?: string;
  isCurrent?: boolean;
  helperText?: string;
  onAction?: () => void;
  onDelete?: () => void;
};

function BranchRow({
  name,
  badge,
  actionLabel,
  deleteTitle,
  isCurrent = false,
  helperText,
  onAction,
  onDelete,
}: BranchRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`truncate text-sm ${isCurrent ? 'font-semibold text-foreground' : 'text-foreground'}`}>{name}</span>
          {badge && <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
        </div>
        {helperText && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
      </div>

      <div className="flex items-center gap-2">
        {onAction && actionLabel && (
          <button
            onClick={onAction}
            className="rounded-md border border-border/70 px-2.5 py-1 text-sm transition-colors hover:bg-accent"
          >
            {actionLabel}
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10"
            title={deleteTitle}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default function BranchesView({
  currentBranch,
  localBranches,
  remoteBranches,
  isMobile,
  isLoading,
  isCreatingBranch,
  onRefresh,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  onRequestConfirmation,
}: BranchesViewProps) {
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);

  /**
   * Confirm local branch deletion before asking the controller to execute it.
   */
  function requestDeleteBranch(branchName: string) {
    onRequestConfirmation({
      type: 'deleteBranch',
      message: `Delete branch "${branchName}"?`,
      onConfirm: async () => {
        await onDeleteBranch(branchName);
      },
    });
  }

  return (
    <>
      <div className={`flex items-center justify-between border-b border-border/60 ${isMobile ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <div>
          <p className="text-sm font-medium text-foreground">Current branch: {currentBranch || 'None'}</p>
          <p className="text-xs text-muted-foreground">Manage local and remote branches without leaving the panel.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewBranchModal(true)}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3 w-3" />
            <span>New branch</span>
          </button>
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="rounded-md border border-border/70 p-2 transition-colors hover:bg-accent disabled:opacity-50"
            title="Refresh branches"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className={`grid gap-4 p-4 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
        <section className="overflow-hidden rounded-md border border-border/70">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Local</h3>
            <span className="text-xs text-muted-foreground">{localBranches.length}</span>
          </div>
          {localBranches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No local branches found.</p>
          ) : (
            localBranches.map((branch) => (
              <BranchRow
                key={branch.name}
                name={branch.name}
                badge={branch.isCurrent ? 'Current' : undefined}
                helperText={branch.isCurrent ? 'Current branch cannot be deleted.' : undefined}
                actionLabel={branch.isCurrent ? undefined : 'Switch'}
                deleteTitle={branch.isCurrent ? undefined : `Delete ${branch.name}`}
                isCurrent={branch.isCurrent}
                onAction={branch.isCurrent ? undefined : () => void onSwitchBranch(branch.name)}
                onDelete={branch.isCurrent ? undefined : () => requestDeleteBranch(branch.name)}
              />
            ))
          )}
        </section>

        <section className="overflow-hidden rounded-md border border-border/70">
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Remote</h3>
            <span className="text-xs text-muted-foreground">{remoteBranches.length}</span>
          </div>
          {remoteBranches.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No remote branches found.</p>
          ) : (
            remoteBranches.map((branch: GitRemoteBranch) => (
              <BranchRow
                key={branch.name}
                name={branch.name}
                badge={branch.isCurrent ? 'Current' : branch.hasLocal ? 'Tracked' : branch.remoteName}
                helperText={branch.hasLocal ? `Local branch: ${branch.localName}` : `Create local branch ${branch.localName} from this remote branch.`}
                actionLabel={branch.isCurrent ? undefined : branch.hasLocal ? 'Switch' : 'Track'}
                isCurrent={branch.isCurrent}
                onAction={
                  branch.isCurrent
                    ? undefined
                    : branch.hasLocal
                    ? () => void onSwitchBranch(branch.localName)
                    : () => void onSwitchBranch(branch.localName, branch.name)
                }
              />
            ))
          )}
        </section>
      </div>

      <NewBranchModal
        isOpen={showNewBranchModal}
        currentBranch={currentBranch}
        isCreatingBranch={isCreatingBranch}
        onClose={() => setShowNewBranchModal(false)}
        onCreateBranch={onCreateBranch}
      />
    </>
  );
}
