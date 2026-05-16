/**
 * PURPOSE: Render the file-tree search field, view toggles, and root-scoped
 * toolbar actions for mutation workflows.
 */
const ChevronUpSquare = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 14 4-4 4 4"/></svg>;
const Eye = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const FolderPlus = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>;
const List = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const Search = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const SquarePen = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m15 9-6 6"/><path d="M9 9h.01"/><path d="M15 15h.01"/><path d="m9 15 3-3 3 3"/></svg>;
const TableProperties = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M12 3v18"/></svg>;
const Upload = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { FileTreeViewMode } from '../types/types';

type FileTreeHeaderProps = {
  viewMode: FileTreeViewMode;
  onViewModeChange: (mode: FileTreeViewMode) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  showTitle?: boolean;
  disabled?: boolean;
};

export default function FileTreeHeader({
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchQueryChange,
  onNewFile,
  onNewFolder,
  onRefresh,
  onCollapseAll,
  onUploadFiles,
  onUploadFolder,
  showTitle = false,
  disabled = false,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        {showTitle ? (
          <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
        ) : (
          <span className="sr-only">{t('fileTree.files')}</span>
        )}
        <div className="flex gap-0.5">
          <Button
            variant={viewMode === 'simple' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('simple')}
            title={t('fileTree.simpleView')}
          >
            <List className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={viewMode === 'compact' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('compact')}
            title={t('fileTree.compactView')}
          >
            <Eye className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant={viewMode === 'detailed' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => onViewModeChange('detailed')}
            title={t('fileTree.detailedView')}
          >
            <TableProperties className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onNewFile} disabled={disabled}>
          <SquarePen className="mr-1 h-3.5 w-3.5" />
          Add File
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onNewFolder} disabled={disabled}>
          <FolderPlus className="mr-1 h-3.5 w-3.5" />
          Add Folder
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onUploadFiles} disabled={disabled}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          Upload Files
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onUploadFolder} disabled={disabled}>
          <Upload className="mr-1 h-3.5 w-3.5" />
          Upload Folder
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onRefresh} disabled={disabled}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" />
          Reload
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={onCollapseAll} disabled={disabled}>
          <ChevronUpSquare className="mr-1 h-3.5 w-3.5" />
          Collapse All
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t('fileTree.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-8 pr-8 h-8 text-sm"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-0.5 top-1/2 -translate-y-1/2 h-5 w-5 p-0 hover:bg-accent"
            onClick={() => onSearchQueryChange('')}
            title={t('fileTree.clearSearch')}
          >
            <X className="w-3 h-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
