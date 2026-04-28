/**
 * PURPOSE: Render a compact in-session control for switching model and reasoning depth.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ClaudeLogo from '../../../llm-logo-provider/ClaudeLogo';
import { thinkingModes } from '../../constants/thinkingModes';
import type { Provider } from '../../types/types';

type ModelOption = {
  value: string;
  label: string;
};

type ReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

type ProviderLogoProps = {
  className?: string;
};

/**
 * Render the OpenAI/ChatGPT mark for Codex-backed model controls.
 */
function ChatGptLogo({ className = 'w-4 h-4' }: ProviderLogoProps) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" />
    </svg>
  );
}

/**
 * Render Kimi's provider mark for Kimi-backed Claude-compatible model controls.
 */
function KimiLogo({ className = 'w-4 h-4' }: ProviderLogoProps) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z" />
      <path d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z" />
    </svg>
  );
}

/**
 * Convert GPT model labels into the compact trigger digit.
 * GPT-5.5 -> 5, GPT-5.4-Mini -> 4, GPT-5 -> 5.
 */
function toCompactCodexModelLabel(modelLabel: string): string {
  const normalizedLabel = modelLabel.trim();
  const gptMinorMatch = normalizedLabel.match(/\bgpt[-\s]?5\.(\d+)\b/i);
  if (gptMinorMatch) return gptMinorMatch[1].slice(-1);

  const numericMinorMatch = normalizedLabel.match(/\b5\.(\d+)\b/);
  if (numericMinorMatch) return numericMinorMatch[1].slice(-1);

  const gptMajorMatch = normalizedLabel.match(/\bgpt[-\s]?(\d+)\b/i);
  if (gptMajorMatch) return gptMajorMatch[1].slice(-1);

  return normalizedLabel;
}

/**
 * Convert Claude/Kimi model labels into a compact trigger form (one digit).
 *   Kimi-k2.6 -> 6
 */
function toCompactClaudeModelLabel(modelLabel: string): string {
  const normalized = modelLabel.trim().toLowerCase();
  const kimiMatch = normalized.match(/^kimi-k\d+\.(\d+)$/);
  if (kimiMatch) return kimiMatch[1];
  return normalized;
}

/**
 * Convert reasoning effort labels such as Medium or High into a one-letter suffix.
 */
function toCompactDepthLabel(depthLabel: string): string {
  const normalizedLabel = depthLabel.trim().toLowerCase();
  const compactMap: Record<string, string> = {
    low: 'l',
    medium: 'm',
    high: 'h',
    max: 'x',
    xhigh: 'x',
  };

  return compactMap[normalizedLabel] || normalizedLabel.slice(0, 1);
}

interface SessionModelControlsProps {
  provider: Provider | string;
  thinkingMode: string;
  setThinkingMode: (mode: string) => void;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  claudeModelOptions: ModelOption[];
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: ModelOption[];
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: ReasoningOption[];
}

/**
 * Provide a single in-session dropdown that mirrors CLI-style model and effort switching.
 */
export default function SessionModelControls({
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
}: SessionModelControlsProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

  /**
   * Keep the floating model panel anchored to the trigger button in viewport space.
   */
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const updateDropdownPosition = () => {
      const triggerRect = buttonRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }

      const panelWidth = Math.min(896, window.innerWidth - 16);
      const nextLeft = Math.max(8, (window.innerWidth - panelWidth) / 2);

      const panelHeight = dropdownRef.current?.offsetHeight || 320;
      const openAbove = triggerRect.bottom + panelHeight + 8 > window.innerHeight;

      setDropdownPosition({
        top: openAbove
          ? Math.max(8, triggerRect.top - panelHeight - 8)
          : triggerRect.bottom + 8,
        left: nextLeft,
      });
    };

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [isOpen]);

  /**
   * Close the floating panel when the user clicks elsewhere.
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      if (
        dropdownRef.current
        && !dropdownRef.current.contains(targetNode)
        && buttonRef.current
        && !buttonRef.current.contains(targetNode)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const thinkingModeLabel = useMemo(() => {
    const mode = thinkingModes.find((m) => m.id === thinkingMode);
    return mode?.name || thinkingMode;
  }, [thinkingMode]);

  const currentModelLabel = useMemo(() => {
    if (provider === 'codex') {
      return codexModelOptions.find((option) => option.value === codexModel)?.label || codexModel;
    }

    return claudeModelOptions.find((option) => option.value === claudeModel)?.label || claudeModel;
  }, [claudeModel, claudeModelOptions, codexModel, codexModelOptions, provider]);

  const currentDepthLabel = provider === 'codex'
    ? codexReasoningOptions.find((option) => option.value === codexReasoningEffort)?.label || codexReasoningEffort
    : thinkingModeLabel;

  const depthOptions = provider === 'codex'
    ? codexReasoningOptions
    : thinkingModes.map((mode) => ({
      value: mode.id,
      label: mode.name,
      description: mode.description,
    }));
  const currentDepthValue = provider === 'codex' ? codexReasoningEffort : thinkingMode;
  const selectedDepthOption = depthOptions.find((option) => option.value === currentDepthValue);
  const triggerLabel = provider === 'codex'
    ? `${toCompactCodexModelLabel(currentModelLabel)}${toCompactDepthLabel(currentDepthLabel)}`
    : `${toCompactClaudeModelLabel(currentModelLabel)}${toCompactDepthLabel(currentDepthLabel)}`;

  const ProviderIcon = provider === 'codex'
    ? ChatGptLogo
    : currentModelLabel.toLowerCase().includes('kimi')
      ? KimiLogo
      : ClaudeLogo;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="session-model-controls-trigger"
        onClick={() => setIsOpen((previous) => !previous)}
        className="h-8 sm:h-9 min-w-[5rem] px-2.5 sm:px-3 rounded-lg border border-border/60 bg-card hover:bg-accent/50 text-foreground transition-colors inline-flex items-center gap-2"
        title={t('sessionControls.buttonTitle', {
          model: currentModelLabel,
          depth: currentDepthLabel,
        })}
      >
        {ProviderIcon && <ProviderIcon className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-xs sm:text-sm font-medium">{triggerLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[120] w-[min(56rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
          }}
        >
          <div className="flex items-start justify-between gap-3 px-3 py-3 border-b border-border/70">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {t('sessionControls.title')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t(provider === 'codex' ? 'sessionControls.codexDescription' : 'sessionControls.claudeDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors"
              title={t('sessionControls.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3 items-start">
              <label className="block min-w-0 space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('sessionControls.model')}
                </span>
                <select
                  value={provider === 'codex' ? codexModel : claudeModel}
                  onChange={(event) => {
                    if (provider === 'codex') {
                      setCodexModel(event.target.value);
                      return;
                    }
                    setClaudeModel(event.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {(provider === 'codex' ? codexModelOptions : claudeModelOptions).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block min-w-0 space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {provider === 'codex'
                    ? t('sessionControls.reasoningEffort')
                    : t('sessionControls.thinkingMode')}
                </span>
                <select
                  data-testid="session-model-controls-depth"
                  value={currentDepthValue}
                  onChange={(event) => {
                    if (provider === 'codex') {
                      setCodexReasoningEffort(event.target.value);
                      return;
                    }
                    setThinkingMode(event.target.value);
                  }}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {depthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedDepthOption?.description && (
              <p className="text-xs text-muted-foreground leading-relaxed">
                {selectedDepthOption.description}
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
