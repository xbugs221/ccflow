import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import NextTaskBanner from '../../../taskmaster/view/NextTaskBanner.jsx';
import type { ProjectSession, SessionProvider } from '../../../../types/app';

interface ProviderSelectionEmptyStateProps {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: SessionProvider;
  setProvider: (next: SessionProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  claudeModelOptions: Array<{ value: string; label: string }>;
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: Array<{ value: string; label: string }>;
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: Array<{ value: string; label: string; description?: string }>;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
}

type ProviderDef = {
  id: SessionProvider;
  name: string;
  infoKey: string;
  accent: string;
  ring: string;
  check: string;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    infoKey: 'providerSelection.providerInfo.anthropic',
    accent: 'border-primary',
    ring: 'ring-primary/15',
    check: 'bg-primary text-primary-foreground',
  },
  {
    id: 'codex',
    name: 'Codex',
    infoKey: 'providerSelection.providerInfo.openai',
    accent: 'border-emerald-600 dark:border-emerald-400',
    ring: 'ring-emerald-600/15',
    check: 'bg-emerald-600 dark:bg-emerald-500 text-white',
  },
];

function getModelOptions(
  provider: SessionProvider,
  claudeModelOptions: Array<{ value: string; label: string }>,
  codexModelOptions: Array<{ value: string; label: string }>,
) {
  if (provider === 'claude') {
    return claudeModelOptions;
  }

  if (provider === 'codex') {
    return codexModelOptions;
  }

  return claudeModelOptions;
}

function getModelValue(p: SessionProvider, c: string, co: string) {
  if (p === 'claude') return c;
  if (p === 'codex') return co;
  return c;
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  claudeModelOptions,
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation('chat');
  const nextTaskPrompt = t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });

  const selectProvider = (next: SessionProvider) => {
    setProvider(next);
    localStorage.setItem('selected-provider', next);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleModelChange = (value: string) => {
    if (provider === 'claude') { setClaudeModel(value); localStorage.setItem('claude-model', value); }
    else if (provider === 'codex') { setCodexModel(value); localStorage.setItem('codex-model', value); }
  };

  const handleReasoningChange = (value: string) => {
    if (provider !== 'codex') {
      return;
    }

    setCodexReasoningEffort(value);
    localStorage.setItem('codex-reasoning-effort', value);
  };

  const modelOptions = getModelOptions(provider, claudeModelOptions, codexModelOptions);
  const currentModel = getModelValue(provider, claudeModel, codexModel);

  /* ── New session — provider picker ── */
  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div className="w-full max-w-md">
          {/* Heading */}
          <div className="text-center mb-8">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground tracking-tight">
              {t('providerSelection.title')}
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              {t('providerSelection.description')}
            </p>
          </div>

          {/* Provider cards — horizontal row, equal width */}
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 mb-6">
            {PROVIDERS.map((p) => {
              const active = provider === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p.id)}
                  className={`
                    relative flex flex-col items-center gap-2.5 pt-5 pb-4 px-2
                    rounded-xl border-[1.5px] transition-all duration-150
                    active:scale-[0.97]
                    ${active
                      ? `${p.accent} ${p.ring} ring-2 bg-card shadow-sm`
                      : 'border-border bg-card/60 hover:bg-card hover:border-border/80'
                    }
                  `}
                >
                  <SessionProviderLogo
                    provider={p.id}
                    className={`w-9 h-9 transition-transform duration-150 ${active ? 'scale-110' : ''}`}
                  />
                  <div className="text-center">
                    <p className="text-[13px] font-semibold text-foreground leading-none">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{t(p.infoKey)}</p>
                  </div>
                  {/* Check badge */}
                  {active && (
                    <div className={`absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full ${p.check} flex items-center justify-center shadow-sm`}>
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Model picker — appears after provider is chosen */}
          <div className={`transition-all duration-200 ${provider ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
            <div className="flex items-center justify-center gap-2 mb-5">
              <span className="text-sm text-muted-foreground">{t('providerSelection.selectModel')}</span>
              <div className="relative">
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  tabIndex={-1}
                  className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium bg-muted/50 border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {modelOptions.map(({ value, label }: { value: string; label: string }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            {provider === 'codex' && codexReasoningOptions.length > 0 && (
              <div className="flex items-center justify-center gap-2 mb-5">
                <span className="text-sm text-muted-foreground">{t('providerSelection.selectReasoning')}</span>
                <div className="relative">
                  <select
                    value={codexReasoningEffort}
                    onChange={(e) => handleReasoningChange(e.target.value)}
                    tabIndex={-1}
                    className="appearance-none pl-3 pr-7 py-1.5 text-sm font-medium bg-muted/50 border border-border/60 rounded-lg text-foreground cursor-pointer hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {codexReasoningOptions.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            )}

            <p className="text-center text-sm text-muted-foreground/70">
              {
                {
                  claude: t('providerSelection.readyPrompt.claude', { model: claudeModel }),
                  codex: t('providerSelection.readyPrompt.codex', {
                    model: codexModel,
                    effort: codexReasoningEffort,
                  }),
                  opencode: t('providerSelection.readyPrompt.opencode', { model: codexModel }),
                }[provider]
              }
            </p>
          </div>

          {/* Task banner */}
          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Existing session — continue prompt ── */
  if (selectedSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-6 max-w-md">
          <p className="text-lg font-semibold text-foreground mb-1.5">{t('session.continue.title')}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{t('session.continue.description')}</p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner onStartTask={() => setInput(nextTaskPrompt)} onShowAllTasks={onShowAllTasks} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
