/** PURPOSE: Show dismissible inline Git operation failures within the panel. */
const AlertTriangle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const X = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
import type { GitOperationError } from '../types/types';

type OperationErrorBannerProps = {
  error: GitOperationError;
  onDismiss: () => void;
};

export default function OperationErrorBanner({ error, onDismiss }: OperationErrorBannerProps) {
  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{error.error}</p>
            <p className="text-sm text-red-800/90 dark:text-red-100/85">
              {error.details || `The ${error.operation} operation did not complete.`}
            </p>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="rounded-md p-1 transition-colors hover:bg-red-100 dark:hover:bg-red-900/40"
          aria-label="Dismiss error"
          title="Dismiss error"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
