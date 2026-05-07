/** PURPOSE: Show dismissible inline Git operation failures within the panel. */
import { AlertTriangle, X } from 'lucide-react';
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
