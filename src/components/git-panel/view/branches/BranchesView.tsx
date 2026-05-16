/** PURPOSE: Render local and remote branch workflows for the Git panel. */
const GitBranch = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
const Plus = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
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
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`block min-w-0 truncate text-sm ${isCurrent ? 'font-semibold text-foreground' : 'text-foreground'}`}>{name}</span>
          {badge && <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted-foreground">{badge}</span>}
        </div>
        {helperText && <p className="mt-1 text-xs text-muted-foreground">{helperText}</p>}
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
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

      <div className="grid grid-cols-1 gap-4 p-4">
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
