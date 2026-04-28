/**
 * PURPOSE: Share the five icon-only session actions used by sidebar rows and
 * project overview cards so both surfaces expose the same behavior.
 */
import { forwardRef, type CSSProperties } from 'react';
import { Clock, Edit2, EyeOff, Star, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type SessionActionIconMenuProps = {
  className?: string;
  style?: CSSProperties;
  isFavorite?: boolean;
  isPending?: boolean;
  isHidden?: boolean;
  labels: {
    rename: string;
    favorite: string;
    unfavorite: string;
    pending: string;
    unpending: string;
    hide: string;
    unhide: string;
    delete: string;
  };
  testIds?: {
    rename?: string;
    favorite?: string;
    pending?: string;
    hide?: string;
    delete?: string;
  };
  onRename: () => void;
  onToggleFavorite: () => void;
  onTogglePending: () => void;
  onToggleHidden: () => void;
  onDelete: () => void;
};

function getButtonLabel(label: string): string {
  /**
   * Keep the accessible name and tooltip in sync while rendering icon-only UI.
   */
  return label;
}

const SessionActionIconMenu = forwardRef<HTMLDivElement, SessionActionIconMenuProps>(function SessionActionIconMenu({
  className,
  style,
  isFavorite = false,
  isPending = false,
  isHidden = false,
  labels,
  testIds,
  onRename,
  onToggleFavorite,
  onTogglePending,
  onToggleHidden,
  onDelete,
}, ref) {
  const favoriteLabel = getButtonLabel(isFavorite ? labels.unfavorite : labels.favorite);
  const pendingLabel = getButtonLabel(isPending ? labels.unpending : labels.pending);
  const hiddenLabel = getButtonLabel(isHidden ? labels.unhide : labels.hide);

  return (
    <div
      ref={ref}
      className={cn('fixed z-[80] flex flex-col items-center gap-1 rounded-md border border-border bg-popover p-1 shadow-lg', className)}
      style={style}
    >
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
        onClick={onRename}
        title={labels.rename}
        aria-label={labels.rename}
        data-testid={testIds?.rename}
      >
        <Edit2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
        onClick={onToggleFavorite}
        title={favoriteLabel}
        aria-label={favoriteLabel}
        data-testid={testIds?.favorite}
      >
        <Star
          className={cn(
            'h-4 w-4',
            isFavorite
              ? 'fill-current text-yellow-500 dark:text-yellow-400'
              : 'text-yellow-600/70 dark:text-yellow-500/70',
          )}
        />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
        onClick={onTogglePending}
        title={pendingLabel}
        aria-label={pendingLabel}
        data-testid={testIds?.pending}
      >
        <Clock
          className={cn(
            'h-4 w-4',
            isPending ? 'text-amber-600 dark:text-amber-300' : 'text-muted-foreground',
          )}
        />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-sm hover:bg-accent"
        onClick={onToggleHidden}
        title={hiddenLabel}
        aria-label={hiddenLabel}
        data-testid={testIds?.hide}
      >
        <EyeOff
          className={cn(
            'h-4 w-4',
            isHidden ? 'text-muted-foreground' : '',
          )}
        />
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        onClick={onDelete}
        title={labels.delete}
        aria-label={labels.delete}
        data-testid={testIds?.delete}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
});

export default SessionActionIconMenu;
