/**
 * PURPOSE: Keep chat provider, model, and reasoning-depth state aligned with the active session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CODEX_REASONING_EFFORTS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

type CodexReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

type ModelOption = {
  value: string;
  label: string;
};

type CodexModelOption = {
  value: string;
  label: string;
  defaultReasoningEffort: string;
  reasoningOptions: CodexReasoningOption[];
};

const SUPPORTED_PROVIDERS: SessionProvider[] = ['claude', 'codex'];
const FALLBACK_CLAUDE_MODEL_OPTIONS: ModelOption[] = [];
const FALLBACK_CODEX_MODEL_OPTIONS: CodexModelOption[] = [];
const DEFAULT_CODEX_REASONING_OPTIONS: CodexReasoningOption[] = CODEX_REASONING_EFFORTS.OPTIONS.map((reasoningOption) => ({
  value: reasoningOption.value,
  label: reasoningOption.label,
  description: reasoningOption.description,
}));

function getModelValues(modelOptions: ModelOption[]): Set<string> {
  return new Set(modelOptions.map((option) => option.value));
}

function getCodexModelValues(modelOptions: CodexModelOption[]): Set<string> {
  return getModelValues(modelOptions);
}

/**
 * Resolve the default Claude-compatible model from the active catalog.
 * @param {ModelOption[]} modelOptions - Available Claude-compatible models.
 * @param {string} defaultModel - Server-detected default model.
 * @returns {string} Default Claude model value.
 */
function getDefaultClaudeModel(modelOptions: ModelOption[], defaultModel: string): string {
  const modelValues = getModelValues(modelOptions);
  if (modelValues.has(defaultModel)) {
    return defaultModel;
  }

  return modelOptions[0]?.value || defaultModel || '';
}

/**
 * Resolve the default Codex model from the active catalog.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @returns {string} Default Codex model value.
 */
function getDefaultCodexModel(modelOptions: CodexModelOption[]): string {
  return modelOptions[0]?.value || '';
}

/**
 * Check whether a persisted value is an actual Codex model instead of a provider alias.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @param {string} model - Persisted model value.
 * @returns {boolean} Whether the model can be selected by the UI.
 */
function isSelectableCodexModel(modelOptions: CodexModelOption[], model: string): boolean {
  return getCodexModelValues(modelOptions).has(model.trim());
}

function getStoredCodexReasoningEffort(): string {
  return localStorage.getItem('codex-reasoning-effort') || CODEX_REASONING_EFFORTS.DEFAULT;
}

/**
 * Resolve the active Codex model config when the model catalog is missing or delayed.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @param {string} model - Selected Codex model value.
 * @returns {CodexModelOption} Model config with usable reasoning options.
 */
function getCodexModelOption(modelOptions: CodexModelOption[], model: string): CodexModelOption {
  return modelOptions.find((option) => option.value === model) || modelOptions[0] || {
    value: model,
    label: model,
    defaultReasoningEffort: CODEX_REASONING_EFFORTS.DEFAULT,
    reasoningOptions: DEFAULT_CODEX_REASONING_OPTIONS,
  };
}

function normalizeProvider(value: unknown): SessionProvider {
  return SUPPORTED_PROVIDERS.includes(value as SessionProvider) ? (value as SessionProvider) : 'codex';
}

function getStoredProvider(): SessionProvider {
  return normalizeProvider(localStorage.getItem('selected-provider'));
}

/**
 * Resolve Codex model from local storage while preferring the current default.
 * Legacy stored default is upgraded to keep new sessions on the latest model.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @returns {string} Effective codex model.
 */
function getStoredCodexModel(modelOptions: CodexModelOption[]): string {
  const codexModelValues = getCodexModelValues(modelOptions);
  const storedModel = localStorage.getItem('codex-model');
  if (!storedModel) {
    return getDefaultCodexModel(modelOptions);
  }

  if (!codexModelValues.has(storedModel)) {
    const nextModel = getDefaultCodexModel(modelOptions);
    localStorage.setItem('codex-model', nextModel);
    return nextModel;
  }

  return storedModel;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [provider, setProviderState] = useState<SessionProvider>(() => getStoredProvider());
  const permissionMode: PermissionMode = 'bypassPermissions';
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [claudeModelOptions, setClaudeModelOptions] = useState<ModelOption[]>(FALLBACK_CLAUDE_MODEL_OPTIONS);
  const [claudeDefaultModel, setClaudeDefaultModel] = useState<string>('');
  const [codexModelOptions, setCodexModelOptions] = useState<CodexModelOption[]>(FALLBACK_CODEX_MODEL_OPTIONS);
  const [claudeModel, setClaudeModelState] = useState<string>(() => {
    return localStorage.getItem('claude-model') || '';
  });
  const [codexModel, setCodexModelState] = useState<string>(() => {
    return getStoredCodexModel(FALLBACK_CODEX_MODEL_OPTIONS);
  });
  const [codexReasoningEffort, setCodexReasoningEffortState] = useState<string>(() => {
    return getStoredCodexReasoningEffort();
  });

  const lastProviderRef = useRef(provider);

  const setClaudeModel = useCallback((nextModel: string) => {
    setClaudeModelState(nextModel);
    localStorage.setItem('claude-model', nextModel);
  }, []);

  const setCodexModel = useCallback((nextModel: string) => {
    setCodexModelState(nextModel);
    localStorage.setItem('codex-model', nextModel);
  }, []);

  const setCodexReasoningEffort = useCallback((nextEffort: string) => {
    setCodexReasoningEffortState(nextEffort);
    localStorage.setItem('codex-reasoning-effort', nextEffort);
  }, []);

  const setProvider = useCallback((nextProvider: SessionProvider) => {
    const normalizedProvider = normalizeProvider(nextProvider);
    setProviderState(normalizedProvider);
    localStorage.setItem('selected-provider', normalizedProvider);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadClaudeModelCatalog() {
      try {
        const response = await authenticatedFetch('/api/claude/models');
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!data?.success || !Array.isArray(data?.models) || data.models.length === 0) {
          return;
        }

        const normalizedModelOptions = data.models.map((model: ModelOption) => ({
          value: model.value,
          label: model.label,
        }));
        const nextDefaultModel = typeof data.defaultModel === 'string'
          ? data.defaultModel.trim()
          : '';

        if (!isCancelled) {
          setClaudeModelOptions(normalizedModelOptions);
          setClaudeDefaultModel(nextDefaultModel);
        }
      } catch (error) {
        console.error('Failed to load Claude model catalog:', error);
      }
    }

    void loadClaudeModelCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadCodexModelCatalog() {
      try {
        const response = await authenticatedFetch('/api/codex/models');
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!data?.success || !Array.isArray(data?.models) || data.models.length === 0) {
          return;
        }

        const normalizedModelOptions = data.models.map((model: CodexModelOption) => ({
          value: model.value,
          label: model.label,
          defaultReasoningEffort: model.defaultReasoningEffort || CODEX_REASONING_EFFORTS.DEFAULT,
          reasoningOptions: Array.isArray(model.reasoningOptions) && model.reasoningOptions.length > 0
            ? model.reasoningOptions
            : CODEX_REASONING_EFFORTS.OPTIONS,
        }));

        if (!isCancelled) {
          setCodexModelOptions(normalizedModelOptions);
        }
      } catch (error) {
        console.error('Failed to load Codex model catalog:', error);
      }
    }

    void loadCodexModelCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const modelValues = getModelValues(claudeModelOptions);
    if (modelValues.size === 0) {
      if (claudeModel) {
        setClaudeModel('');
      }
      return;
    }

    const storedModel = localStorage.getItem('claude-model')?.trim() || '';
    const nextDefaultModel = getDefaultClaudeModel(claudeModelOptions, claudeDefaultModel);
    const shouldUseDetectedDefault = !storedModel && Boolean(nextDefaultModel);

    if (modelValues.has(claudeModel) && !shouldUseDetectedDefault) {
      return;
    }

    const nextModel = shouldUseDetectedDefault || !modelValues.has(claudeModel)
      ? nextDefaultModel
      : claudeModel;

    if (nextModel && nextModel !== claudeModel) {
      setClaudeModel(nextModel);
    }
  }, [claudeDefaultModel, claudeModel, claudeModelOptions, setClaudeModel]);

  useEffect(() => {
    const sessionModel = typeof selectedSession?.model === 'string' ? selectedSession.model.trim() : '';
    if (
      selectedSession?.__provider === 'codex'
      && sessionModel
      && isSelectableCodexModel(codexModelOptions, sessionModel)
    ) {
      return;
    }

    if (selectedSession?.__provider === 'codex' && sessionModel) {
      const defaultModel = getDefaultCodexModel(codexModelOptions);
      if (codexModel !== defaultModel) {
        setCodexModelState(defaultModel);
      }
      return;
    }

    const modelValues = getCodexModelValues(codexModelOptions);
    if (modelValues.size === 0) {
      if (codexModel) {
        setCodexModel('');
      }
      return;
    }

    if (modelValues.has(codexModel)) {
      return;
    }

    const nextModel = getStoredCodexModel(codexModelOptions);
    setCodexModel(nextModel);
    localStorage.setItem('codex-model', nextModel);
  }, [codexModel, codexModelOptions, selectedSession?.__provider, selectedSession?.model]);

  useEffect(() => {
    const activeModel = getCodexModelOption(codexModelOptions, codexModel);
    const reasoningValues = new Set(activeModel.reasoningOptions.map((option) => option.value));
    if (reasoningValues.has(codexReasoningEffort)) {
      return;
    }

    const nextEffort = activeModel.defaultReasoningEffort || CODEX_REASONING_EFFORTS.DEFAULT;
    setCodexReasoningEffort(nextEffort);
  }, [codexModel, codexModelOptions, codexReasoningEffort, setCodexReasoningEffort]);

  const codexReasoningOptions = getCodexModelOption(codexModelOptions, codexModel).reasoningOptions;

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    const normalizedProvider = normalizeProvider(selectedSession.__provider);
    if (normalizedProvider !== provider) {
      setProviderState(normalizedProvider);
      localStorage.setItem('selected-provider', normalizedProvider);
    }
  }, [provider, selectedSession?.__provider]);

  useEffect(() => {
    const sessionModel = typeof selectedSession?.model === 'string' ? selectedSession.model.trim() : '';
    if (!sessionModel) {
      return;
    }

    if (
      selectedSession?.__provider === 'codex'
      && !isSelectableCodexModel(codexModelOptions, sessionModel)
    ) {
      const defaultModel = getDefaultCodexModel(codexModelOptions);
      if (defaultModel !== codexModel) {
        setCodexModelState(defaultModel);
      }
      return;
    }

    if (selectedSession?.__provider === 'codex' && sessionModel !== codexModel) {
      setCodexModelState(sessionModel);
      return;
    }

    if (selectedSession?.__provider === 'claude' && sessionModel !== claudeModel) {
      setClaudeModelState(sessionModel);
    }
  }, [claudeModel, codexModel, codexModelOptions, selectedSession?.__provider, selectedSession?.id, selectedSession?.model]);

  useEffect(() => {
    const sessionReasoningEffort = typeof selectedSession?.reasoningEffort === 'string'
      ? selectedSession.reasoningEffort.trim()
      : '';
    if (
      selectedSession?.__provider !== 'codex'
      || !sessionReasoningEffort
      || sessionReasoningEffort === codexReasoningEffort
    ) {
      return;
    }

    setCodexReasoningEffort(sessionReasoningEffort);
  }, [
    codexReasoningEffort,
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSession?.reasoningEffort,
    setCodexReasoningEffort,
  ]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  return {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    claudeModelOptions,
    codexModel,
    setCodexModel,
    codexModelOptions,
    codexReasoningEffort,
    setCodexReasoningEffort,
    codexReasoningOptions,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
  };
}
