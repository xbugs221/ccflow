/** PURPOSE: Render staged and unstaged changes, diff review, and commit actions. */
const GitBranch = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
const GitCommit = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConfirmationRequest, FileStatusCode, GitDiffMap, GitStatusResponse } from '../../types/types';
import { getAllChangedFiles, hasChangedFiles } from '../../utils/gitPanelUtils';
import CommitComposer from './CommitComposer';
import FileChangeList from './FileChangeList';
import FileSelectionControls from './FileSelectionControls';
import FileStatusLegend from './FileStatusLegend';

type ChangesViewProps = {
  isMobile: boolean;
  gitStatus: GitStatusResponse | null;
  gitDiff: GitDiffMap;
  isLoading: boolean;
  wrapText: boolean;
  isCreatingInitialCommit: boolean;
  onWrapTextChange: (wrapText: boolean) => void;
  onCreateInitialCommit: () => Promise<boolean>;
  onOpenFile: (filePath: string) => Promise<void>;
  onDiscardFile: (filePath: string) => Promise<void>;
  onDeleteFile: (filePath: string) => Promise<void>;
  onCommitChanges: (message: string, files: string[]) => Promise<boolean>;
  onGenerateCommitMessage: (files: string[]) => Promise<string | null>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
  onExpandedFilesChange: (hasExpandedFiles: boolean) => void;
};

export default function ChangesView({
  isMobile,
  gitStatus,
  gitDiff,
  isLoading,
  wrapText,
  isCreatingInitialCommit,
  onWrapTextChange,
  onCreateInitialCommit,
  onOpenFile,
  onDiscardFile,
  onDeleteFile,
  onCommitChanges,
  onGenerateCommitMessage,
  onRequestConfirmation,
  onExpandedFilesChange,
}: ChangesViewProps) {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const changedFiles = useMemo(() => getAllChangedFiles(gitStatus), [gitStatus]);
  const hasExpandedFiles = expandedFiles.size > 0;

  useEffect(() => {
    if (!gitStatus || gitStatus.error) {
      setSelectedFiles(new Set());
      return;
    }

    // Preserve previous behavior: every fresh status snapshot reselects changed files.
    setSelectedFiles(new Set(getAllChangedFiles(gitStatus)));
  }, [gitStatus]);

  useEffect(() => {
    onExpandedFilesChange(hasExpandedFiles);
  }, [hasExpandedFiles, onExpandedFilesChange]);

  useEffect(() => {
    return () => {
      onExpandedFilesChange(false);
    };
  }, [onExpandedFilesChange]);

  const toggleFileExpanded = useCallback((filePath: string) => {
    setExpandedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const toggleFileSelected = useCallback((filePath: string) => {
    setSelectedFiles((previous) => {
      const next = new Set(previous);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const requestFileAction = useCallback(
    (filePath: string, status: FileStatusCode) => {
      if (status === 'U') {
        onRequestConfirmation({
          type: 'delete',
          message: `Delete untracked file "${filePath}"? This action cannot be undone.`,
          onConfirm: async () => {
            await onDeleteFile(filePath);
          },
        });
        return;
      }

      onRequestConfirmation({
        type: 'discard',
        message: `Discard all changes to "${filePath}"? This action cannot be undone.`,
        onConfirm: async () => {
          await onDiscardFile(filePath);
        },
      });
    },
    [onDeleteFile, onDiscardFile, onRequestConfirmation],
  );

  const commitSelectedFiles = useCallback(
    (message: string) => {
      return onCommitChanges(message, Array.from(selectedFiles));
    },
    [onCommitChanges, selectedFiles],
  );

  const generateMessageForSelection = useCallback(() => {
    return onGenerateCommitMessage(Array.from(selectedFiles));
  }, [onGenerateCommitMessage, selectedFiles]);

  return (
    <>
      <CommitComposer
        isMobile={isMobile}
        selectedFileCount={selectedFiles.size}
        isHidden={hasExpandedFiles}
        onCommit={commitSelectedFiles}
        onGenerateMessage={generateMessageForSelection}
        onRequestConfirmation={onRequestConfirmation}
      />

      {gitStatus && !gitStatus.error && (
        <FileSelectionControls
          isMobile={isMobile}
          selectedCount={selectedFiles.size}
          totalCount={changedFiles.length}
          isHidden={hasExpandedFiles}
          onSelectAll={() => setSelectedFiles(new Set(changedFiles))}
          onDeselectAll={() => setSelectedFiles(new Set())}
        />
      )}

      {!gitStatus?.error && <FileStatusLegend isMobile={isMobile} />}

      <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-mobile-nav' : ''}`}>
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : gitStatus?.hasCommits === false ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <GitBranch className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium mb-2 text-foreground">No commits yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              This repository doesn&apos;t have any commits yet. Create your first commit to start tracking changes.
            </p>
            <button
              onClick={() => void onCreateInitialCommit()}
              disabled={isCreatingInitialCommit}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
            >
              {isCreatingInitialCommit ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Creating Initial Commit...</span>
                </>
              ) : (
                <>
                  <GitCommit className="w-4 h-4" />
                  <span>Create Initial Commit</span>
                </>
              )}
            </button>
          </div>
        ) : !gitStatus || !hasChangedFiles(gitStatus) ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <GitCommit className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">No changes detected</p>
          </div>
        ) : (
          <div className={isMobile ? 'pb-4' : ''}>
            <div className="border-b border-border/60 px-3 py-2 text-sm text-muted-foreground">
              {changedFiles.length} changed file{changedFiles.length !== 1 ? 's' : ''}
            </div>
            <FileChangeList
              gitStatus={gitStatus}
              gitDiff={gitDiff}
              expandedFiles={expandedFiles}
              selectedFiles={selectedFiles}
              isMobile={isMobile}
              wrapText={wrapText}
              onToggleSelected={toggleFileSelected}
              onToggleExpanded={toggleFileExpanded}
              onOpenFile={(filePath) => {
                void onOpenFile(filePath);
              }}
              onToggleWrapText={() => onWrapTextChange(!wrapText)}
              onRequestFileAction={requestFileAction}
            />
          </div>
        )}
      </div>
    </>
  );
}
