const Check = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>;
const ChevronDown = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>;
const GitCommit = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>;
const RefreshCw = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const Sparkles = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>;
import { useState } from 'react';
import MicButton from '../../../mic-button/view/MicButton';
import type { ConfirmationRequest } from '../../types/types';

type CommitComposerProps = {
  isMobile: boolean;
  selectedFileCount: number;
  isHidden: boolean;
  onCommit: (message: string) => Promise<boolean>;
  onGenerateMessage: () => Promise<string | null>;
  onRequestConfirmation: (request: ConfirmationRequest) => void;
};

export default function CommitComposer({
  isMobile,
  selectedFileCount,
  isHidden,
  onCommit,
  onGenerateMessage,
  onRequestConfirmation,
}: CommitComposerProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(isMobile);

  const handleCommit = async (message = commitMessage) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || selectedFileCount === 0 || isCommitting) {
      return false;
    }

    setIsCommitting(true);
    try {
      const success = await onCommit(trimmedMessage);
      if (success) {
        setCommitMessage('');
      }
      return success;
    } finally {
      setIsCommitting(false);
    }
  };

  const handleGenerateMessage = async () => {
    if (selectedFileCount === 0 || isGeneratingMessage) {
      return;
    }

    setIsGeneratingMessage(true);
    try {
      const generatedMessage = await onGenerateMessage();
      if (generatedMessage) {
        setCommitMessage(generatedMessage);
      }
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const requestCommitConfirmation = () => {
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage || selectedFileCount === 0 || isCommitting) {
      return;
    }

    onRequestConfirmation({
      type: 'commit',
      message: `Commit ${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''} with message: "${trimmedMessage}"?`,
      onConfirm: async () => {
        await handleCommit(trimmedMessage);
      },
    });
  };

  return (
    <div
      className={`transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 opacity-0 -translate-y-2 overflow-hidden' : 'max-h-96 opacity-100 translate-y-0'
      }`}
    >
      {isMobile && isCollapsed ? (
        <div className="px-4 py-2 border-b border-border/60">
          <button
            onClick={() => setIsCollapsed(false)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <GitCommit className="w-4 h-4" />
            <span>Commit {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-border/60">
          {isMobile && (
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Commit Changes</span>
              <button
                onClick={() => setIsCollapsed(true)}
                className="p-1 hover:bg-accent rounded-lg transition-colors"
              >
                <ChevronDown className="w-4 h-4 rotate-180" />
              </button>
            </div>
          )}

          <div className="relative">
            <textarea
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Message (Ctrl+Enter to commit)"
              className="w-full px-3 py-2 text-sm border border-border rounded-xl bg-background text-foreground placeholder:text-muted-foreground resize-none pr-20 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30"
              rows={3}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void handleCommit();
                }
              }}
            />
            <div className="absolute right-2 top-2 flex gap-1">
              <button
                onClick={() => void handleGenerateMessage()}
                disabled={selectedFileCount === 0 || isGeneratingMessage}
                className="p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Generate commit message"
              >
                {isGeneratingMessage ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
              </button>
              <div style={{ display: 'none' }}>
                <MicButton
                  onTranscript={(transcript) => setCommitMessage(transcript)}
                  mode="default"
                  className="p-1.5"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-sm text-muted-foreground">
              {selectedFileCount} file{selectedFileCount !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={requestCommitConfirmation}
              disabled={!commitMessage.trim() || selectedFileCount === 0 || isCommitting}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
            >
              <Check className="w-3 h-3" />
              <span>{isCommitting ? 'Committing...' : 'Commit'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
