/**
 * PURPOSE: Render the file-tree search field, view toggles, and root-scoped
 * toolbar actions for mutation workflows.
 */
import { ChevronUpSquare, Eye, FolderPlus, List, RefreshCw, Search, SquarePen, TableProperties, Upload, X } from 'lucide-react';
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
  disabled = false,
}: FileTreeHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{t('fileTree.files')}</h3>
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
