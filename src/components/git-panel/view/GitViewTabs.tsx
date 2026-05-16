/** PURPOSE: Render the Git panel's top-level workflow tabs. */
const FileText = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>;
const GitBranch = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
const History = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>;
import type { GitPanelView } from '../types/types';

type GitViewTabsProps = {
  activeView: GitPanelView;
  isHidden: boolean;
  onChange: (view: GitPanelView) => void;
};

export default function GitViewTabs({ activeView, isHidden, onChange }: GitViewTabsProps) {
  return (
    <div
      className={`flex border-b border-border/60 transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 opacity-0 -translate-y-2 overflow-hidden' : 'max-h-16 opacity-100 translate-y-0'
      }`}
    >
      <button
        onClick={() => onChange('changes')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'changes'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" />
          <span>Changes</span>
        </span>
      </button>
      <button
        onClick={() => onChange('history')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'history'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <History className="w-4 h-4" />
          <span>History</span>
        </span>
      </button>
      <button
        onClick={() => onChange('branches')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'branches'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <GitBranch className="w-4 h-4" />
          <span>Branches</span>
        </span>
      </button>
    </div>
  );
}
