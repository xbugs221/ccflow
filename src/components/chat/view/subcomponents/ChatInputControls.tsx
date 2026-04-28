import React from 'react';
import { useTranslation } from 'react-i18next';
import SessionModelControls from './SessionModelControls';
import type { Provider } from '../../types/types';

interface ChatInputControlsProps {
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: (mode: string) => void;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  claudeModelOptions: { value: string; label: string }[];
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: { value: string; label: string }[];
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: { value: string; label: string; description?: string }[];
  slashCommandsCount: number;
  onToggleCommandMenu: () => void;
  hasInput: boolean;
  onClearInput: () => void;
  isUserScrolledUp: boolean;
  hasMessages: boolean;
  onScrollToBottom: () => void;
}

export default function ChatInputControls({
  provider,
  thinkingMode,
  setThinkingMode,
  claudeModel,
  setClaudeModel,
  claudeModelOptions,
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  slashCommandsCount,
  onToggleCommandMenu,
  hasInput,
  onClearInput,
  isUserScrolledUp,
  hasMessages,
  onScrollToBottom,
}: ChatInputControlsProps) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
      <SessionModelControls
        provider={provider}
        thinkingMode={thinkingMode}
        setThinkingMode={setThinkingMode}
        claudeModel={claudeModel}
        setClaudeModel={setClaudeModel}
        claudeModelOptions={claudeModelOptions}
        codexModel={codexModel}
        setCodexModel={setCodexModel}
        codexModelOptions={codexModelOptions}
        codexReasoningEffort={codexReasoningEffort}
        setCodexReasoningEffort={setCodexReasoningEffort}
        codexReasoningOptions={codexReasoningOptions}
      />

      <button
        type="button"
        onClick={onToggleCommandMenu}
        className="relative w-7 h-7 sm:w-8 sm:h-8 text-muted-foreground hover:text-foreground rounded-lg flex items-center justify-center transition-colors hover:bg-accent/60"
        title={t('input.showAllCommands')}
      >
        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
        {slashCommandsCount > 0 && (
          <span
            className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center"
          >
            {slashCommandsCount}
          </span>
        )}
      </button>

      {hasInput && (
        <button
          type="button"
          onClick={onClearInput}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-card hover:bg-accent/60 border border-border/50 rounded-lg flex items-center justify-center transition-all duration-200 group shadow-sm"
          title={t('input.clearInput', { defaultValue: 'Clear input' })}
        >
          <svg
            className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground group-hover:text-foreground transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {isUserScrolledUp && hasMessages && (
        <button
          onClick={onScrollToBottom}
          className="w-7 h-7 sm:w-8 sm:h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-sm flex items-center justify-center transition-all duration-200 hover:scale-105"
          title={t('input.scrollToBottom', { defaultValue: 'Scroll to bottom' })}
        >
          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}
    </div>
  );
}
