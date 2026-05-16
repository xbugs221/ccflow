/** PURPOSE: Confirm destructive or state-changing Git panel actions. */
import { useEffect } from 'react';
const Check = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const Download = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const Trash2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>;
const Upload = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17,8 12,3 7,8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
import {
  CONFIRMATION_ACTION_LABELS,
  CONFIRMATION_BUTTON_CLASSES,
  CONFIRMATION_ICON_CONTAINER_CLASSES,
  CONFIRMATION_TITLES,
} from '../../constants/constants';
import type { ConfirmationRequest } from '../../types/types';

type ConfirmActionModalProps = {
  action: ConfirmationRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function renderConfirmActionIcon(actionType: ConfirmationRequest['type']) {
  if (actionType === 'discard' || actionType === 'delete') {
    return <Trash2 className="w-4 h-4" />;
  }

  if (actionType === 'deleteBranch') {
    return <Trash2 className="w-4 h-4" />;
  }

  if (actionType === 'commit') {
    return <Check className="w-4 h-4" />;
  }

  if (actionType === 'pull') {
    return <Download className="w-4 h-4" />;
  }

  return <Upload className="w-4 h-4" />;
}

export default function ConfirmActionModal({ action, onCancel, onConfirm }: ConfirmActionModalProps) {
  const titleId = action ? `confirmation-title-${action.type}` : undefined;

  useEffect(() => {
    if (!action) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [action, onCancel]);

  if (!action) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        className="relative bg-card border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="p-6">
          <div className="flex items-center mb-4">
            <div className={`p-2 rounded-full mr-3 ${CONFIRMATION_ICON_CONTAINER_CLASSES[action.type]}`}>
              {renderConfirmActionIcon(action.type)}
            </div>
            <h3 id={titleId} className="text-lg font-semibold text-foreground">
              {CONFIRMATION_TITLES[action.type]}
            </h3>
          </div>

          <p className="text-sm text-muted-foreground mb-6">{action.message}</p>

          <div className="flex justify-end space-x-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`px-4 py-2 text-sm text-white rounded-lg transition-colors flex items-center space-x-2 ${CONFIRMATION_BUTTON_CLASSES[action.type]}`}
            >
              {renderConfirmActionIcon(action.type)}
              <span>{CONFIRMATION_ACTION_LABELS[action.type]}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
