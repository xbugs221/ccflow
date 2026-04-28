/** PURPOSE: Render changed files, grouped by staged and unstaged sections. */
import { FILE_STATUS_GROUPS } from '../../constants/constants';
import type { FileStatusCode, GitChangedFile, GitDiffMap, GitStatusResponse } from '../../types/types';
import FileChangeItem from './FileChangeItem';

type FileChangeListProps = {
  gitStatus: GitStatusResponse;
  gitDiff: GitDiffMap;
  expandedFiles: Set<string>;
  selectedFiles: Set<string>;
  isMobile: boolean;
  wrapText: boolean;
  onToggleSelected: (filePath: string) => void;
  onToggleExpanded: (filePath: string) => void;
  onOpenFile: (filePath: string) => void;
  onToggleWrapText: () => void;
  onRequestFileAction: (filePath: string, status: FileStatusCode) => void;
};

export default function FileChangeList({
  gitStatus,
  gitDiff,
  expandedFiles,
  selectedFiles,
  isMobile,
  wrapText,
  onToggleSelected,
  onToggleExpanded,
  onOpenFile,
  onToggleWrapText,
  onRequestFileAction,
}: FileChangeListProps) {
  /**
   * Keep legacy status responses working while preferring the newer staged and
   * unstaged groups from the backend.
   */
  function buildSections(): Array<{ key: string, title: string, items: GitChangedFile[] }> {
    if (gitStatus.stagedChanges || gitStatus.unstagedChanges) {
      return [
        { key: 'staged', title: `Staged (${gitStatus.stagedChanges?.length || 0})`, items: gitStatus.stagedChanges || [] },
        { key: 'unstaged', title: `Unstaged (${gitStatus.unstagedChanges?.length || 0})`, items: gitStatus.unstagedChanges || [] },
      ];
    }

    return [
      {
        key: 'all',
        title: 'Changes',
        items: FILE_STATUS_GROUPS.flatMap(({ key, status }) =>
          (gitStatus[key] || []).map((filePath) => ({ path: filePath, status })),
        ),
      },
    ];
  }

  return (
    <>
      {buildSections().map((section) => (
        <section key={section.key} className="border-b border-border/60 last:border-b-0">
          <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur">
            <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
          </div>
          {section.items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No files in this section.</p>
          ) : (
            section.items.map(({ path: filePath, status }, index) => (
              <FileChangeItem
                key={`${section.key}:${filePath}:${index}`}
                filePath={filePath}
                status={status}
                isMobile={isMobile}
                isExpanded={expandedFiles.has(filePath)}
                isSelected={selectedFiles.has(filePath)}
                diff={gitDiff[filePath]}
                wrapText={wrapText}
                onToggleSelected={onToggleSelected}
                onToggleExpanded={onToggleExpanded}
                onOpenFile={onOpenFile}
                onToggleWrapText={onToggleWrapText}
                onRequestFileAction={onRequestFileAction}
              />
            ))
          )}
        </section>
      ))}
    </>
  );
}
