/**
 * Chat interface container.
 * Coordinates composer, realtime handlers, session state, and resilience UX such as network timeout feedback.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTasksSettings } from '../../../contexts/TasksSettingsContext';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import type { ChatInterfaceProps } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import type { Provider } from '../types/types';
import { api } from '../../../utils/api';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  clientRequestId?: string;
  draftSessionId?: string | null;
};

const NETWORK_RESPONSE_TIMEOUT_MS = 30_000;
const NETWORK_TIMEOUT_MESSAGE =
  '30 秒内没有收到服务端响应，疑似网络连接异常。请检查网络后重试。';
const NETWORK_DISCONNECTED_MESSAGE =
  '与服务端的实时连接已断开，本次请求已停止等待。请确认公网反代支持 WebSocket 后重试。';
const SESSION_STATUS_RECONCILE_INTERVAL_MS = 4_000;

type ChatSearchResult = {
  projectName: string;
  projectDisplayName: string;
  provider: 'claude' | 'codex';
  sessionId: string;
  sessionSummary: string;
  messageKey: string;
  snippet: string;
};

type ChatSearchStatus = 'idle' | 'loading' | 'success-empty' | 'success-hit' | 'error';

const isTemporarySessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId)));

/**
 * Build the project identity needed by session-scoped config APIs.
 */
const resolveSessionConfigTarget = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  selectedSession: ChatInterfaceProps['selectedSession'],
) => ({
  projectName: selectedSession?.__projectName || selectedProject?.name || '',
  projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
});

/**
 * PURPOSE: Infer the authoritative provider for a persisted session from the
 * currently loaded project collections when route metadata is missing.
 */
const resolveProjectSessionProvider = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  sessionId?: string | null,
): 'claude' | 'codex' | null => {
  if (!selectedProject || !sessionId || isTemporarySessionId(sessionId)) {
    return null;
  }

  if ((selectedProject.codexSessions || []).some((session) => session.id === sessionId)) {
    return 'codex';
  }

  if ((selectedProject.sessions || []).some((session) => session.id === sessionId)) {
    return 'claude';
  }

  return null;
};

/**
 * Recover workflow routing context from persisted session metadata instead of query parameters.
 */
const resolveWorkflowSessionContext = (
  selectedProject: ChatInterfaceProps['selectedProject'],
  selectedSession: ChatInterfaceProps['selectedSession'],
) => {
  const reviewPassIndex = Number(selectedSession?.reviewPassIndex);
  return {
    projectName: selectedSession?.__projectName || selectedProject?.name || '',
    projectPath: selectedSession?.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
    workflowId: typeof selectedSession?.workflowId === 'string' ? selectedSession.workflowId : '',
    workflowStageKey: typeof selectedSession?.stageKey === 'string' ? selectedSession.stageKey : '',
    workflowSubstageKey: typeof selectedSession?.substageKey === 'string' ? selectedSession.substageKey : '',
    workflowReviewPass: Number.isInteger(reviewPassIndex) && reviewPassIndex > 0 ? reviewPassIndex : 0,
  };
};

/**
 * Validate the chat-search API contract so HTML fallback pages and malformed JSON
 * surface as explicit errors instead of being treated as empty search results.
 */
const parseChatSearchResponse = async (response: Response): Promise<ChatSearchResult[]> => {
  const contentType = response.headers.get('content-type') || '';
  const isJsonResponse = contentType.toLowerCase().includes('application/json');

  if (!isJsonResponse) {
    throw new Error('Search endpoint returned HTML instead of JSON');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Search endpoint returned invalid JSON');
  }

  const errorMessage = typeof payload === 'object' && payload !== null && 'error' in payload
    && typeof payload.error === 'string' && payload.error
    ? payload.error
    : null;

  if (!response.ok) {
    throw new Error(errorMessage || 'Failed to search chat history');
  }

  if (
    typeof payload !== 'object'
    || payload === null
    || !('results' in payload)
    || !Array.isArray(payload.results)
  ) {
    throw new Error('Search endpoint returned an unexpected payload');
  }

  return payload.results as ChatSearchResult[];
};

/**
 * Identify whether a WebSocket message can be treated as backend activity for chat requests.
 */
const isBackendResponseMessage = (messageType?: string): boolean => {
  if (!messageType) {
    return false;
  }

  if (
    messageType === 'projects_updated'
    || messageType === 'loading_progress'
    || messageType === 'session-model-state-updated'
    || messageType.startsWith('taskmaster-')
  ) {
    return false;
  }

  return true;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  ws,
  sendMessage,
  messageHistory,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onNewSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  onShowAllTasks,
}: ChatInterfaceProps) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { t } = useTranslation('chat');
  const location = useLocation();

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const registeredWorkflowSessionsRef = useRef<Set<string>>(new Set());
  const dispatchedWorkflowAutoStartsRef = useRef<Set<string>>(new Set());
  const dispatchedSessionAutoInitsRef = useRef<Set<string>>(new Set());
  const surfacedWorkflowApplyFailuresRef = useRef<Set<string>>(new Set());
  const pendingNetworkTimeoutRef = useRef<number | null>(null);
  const awaitingBackendResponseRef = useRef(false);
  const chatSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [workflowTurnOutcomes, setWorkflowTurnOutcomes] = useState<Record<string, 'completed' | 'failed'>>({});
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState<ChatSearchResult[]>([]);
  const [chatSearchStatus, setChatSearchStatus] = useState<ChatSearchStatus>('idle');
  const [chatSearchError, setChatSearchError] = useState('');
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [isFollowingLatest, setIsFollowingLatest] = useState(false);

  const activeSearchTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const query = params.get('chatSearch');
    const messageKey = params.get('messageKey');

    if (!query || !messageKey) {
      return null;
    }

    return {
      query,
      messageKey,
    };
  }, [location.search]);
  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
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
    setPendingPermissionRequests,
  } = useChatProviderState({
    selectedSession,
  });
  const projectSessionProvider = useMemo(
    () => resolveProjectSessionProvider(selectedProject, selectedSession?.id),
    [selectedProject, selectedSession?.id],
  );
  const workflowSessionContext = useMemo(
    () => resolveWorkflowSessionContext(selectedProject, selectedSession),
    [selectedProject, selectedSession],
  );
  const effectiveProvider = useMemo(() => {
    const sessionProvider = selectedSession?.__provider || null;
    return projectSessionProvider || sessionProvider || provider;
  }, [
    projectSessionProvider,
    provider,
    selectedSession?.__provider,
  ]);
  const [codexModelSwitchSessionId, setCodexModelSwitchSessionId] = useState<string | null>(null);

  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasMoreMessages,
    totalMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessageCount,
    visibleMessages,
    loadEarlierMessages,
    loadAllMessages,
    allMessagesLoaded,
    isLoadingAllMessages,
    loadAllJustFinished,
    showLoadAllOverlay,
    claudeStatus,
    setClaudeStatus,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleKeyDown: handleTranscriptKeyDown,
    loadSessionMessages,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    sendMessage,
    isFollowingLatest,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
  });
  const hasPersistentSession = Boolean(
    (selectedSession?.id && !isTemporarySessionId(selectedSession.id))
    || (currentSessionId && !isTemporarySessionId(currentSessionId)),
  );

  const {
    input,
    setInput,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    filteredCommands,
    frequentCommands,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    openFileDropdown,
    attachedUploads,
    setAttachedUploads,
    uploadingAttachments,
    attachmentErrors,
    isComposerSubmitting,
    getRootProps,
    getInputProps,
    isDragActive,
    openAttachmentPicker,
    handleAttachmentSelection,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleAbortSession,
    handleTranscript,
    handleInputFocusChange,
    isInputFocused,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    currentSessionId,
    provider: effectiveProvider,
    claudeModel,
    codexModel,
    codexModelSwitchSessionId,
    codexReasoningEffort,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive,
    onSessionProcessing,
    onInputFocusChange,
    onFileOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    setPendingPermissionRequests,
    onRequestDispatched: () => {
      awaitingBackendResponseRef.current = true;
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
      }

      pendingNetworkTimeoutRef.current = window.setTimeout(() => {
        if (!awaitingBackendResponseRef.current) {
          return;
        }

        awaitingBackendResponseRef.current = false;
        pendingNetworkTimeoutRef.current = null;
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: NETWORK_TIMEOUT_MESSAGE,
            timestamp: new Date(),
          },
        ]);
      }, NETWORK_RESPONSE_TIMEOUT_MS);
    },
  });
  const shouldPauseStatusReconcile = isInputFocused && input.trim().length > 0;

  const handleSetCodexModel = useCallback(
    (nextModel: string) => {
      const normalizedNextModel = nextModel.trim().toLowerCase();
      const nextSessionId = selectedSession?.id || null;
      const normalizedSessionModel = String(codexModel || '').trim().toLowerCase();
      const shouldStartNewCodexSession =
        effectiveProvider === 'codex'
        && selectedSession?.__provider === 'codex'
        && Boolean(nextSessionId)
        && normalizedSessionModel !== normalizedNextModel;

      if (shouldStartNewCodexSession) {
        setCodexModelSwitchSessionId(nextSessionId);
      } else if (codexModelSwitchSessionId === nextSessionId) {
        setCodexModelSwitchSessionId(null);
      }

      setCodexModel(nextModel);
    },
    [
      codexModelSwitchSessionId,
      effectiveProvider,
      selectedSession?.__provider,
      selectedSession?.id,
      codexModel,
      setCodexModel,
    ],
  );

  const persistCodexSessionModelState = useCallback(
    async (patch: { model?: string; reasoningEffort?: string }) => {
      if (
        effectiveProvider !== 'codex'
        || selectedSession?.__provider !== 'codex'
        || !selectedSession?.id
        || isTemporarySessionId(selectedSession.id)
      ) {
        return;
      }

      const { projectName, projectPath } = resolveSessionConfigTarget(selectedProject, selectedSession);
      if (!projectName || !projectPath) {
        return;
      }

      const response = await api.updateSessionModelState(projectName, selectedSession.id, {
        projectPath,
        ...patch,
      });
      if (!response.ok) {
        throw new Error(`Failed to persist Codex session model state: ${response.status}`);
      }
    },
    [
      effectiveProvider,
      selectedProject,
      selectedSession,
    ],
  );

  const handleSetCodexReasoningEffort = useCallback(
    (nextEffort: string) => {
      setCodexReasoningEffort(nextEffort);
      void persistCodexSessionModelState({
        model: codexModel,
        reasoningEffort: nextEffort,
      }).catch((error) => {
        console.error('Failed to persist Codex reasoning effort:', error);
      });
    },
    [
      codexModel,
      persistCodexSessionModelState,
      setCodexReasoningEffort,
    ],
  );

  useEffect(() => {
    if (
      effectiveProvider !== 'codex'
      || selectedSession?.__provider !== 'codex'
      || !selectedSession?.id
      || isTemporarySessionId(selectedSession.id)
    ) {
      return;
    }

    const { projectName, projectPath } = resolveSessionConfigTarget(selectedProject, selectedSession);
    if (!projectName || !projectPath) {
      return;
    }

    /**
     * Pull the authoritative model controls for the active Codex session.
     */
    const syncCodexSessionModelState = async () => {
      try {
        const response = await api.sessionModelState(projectName, selectedSession.id, projectPath);
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        const model = typeof payload?.state?.model === 'string' ? payload.state.model.trim() : '';
        const reasoningEffort = typeof payload?.state?.reasoningEffort === 'string'
          ? payload.state.reasoningEffort.trim()
          : '';

        if (model && model !== codexModel) {
          setCodexModel(model);
        }
        if (reasoningEffort && reasoningEffort !== codexReasoningEffort) {
          setCodexReasoningEffort(reasoningEffort);
        }
      } catch (error) {
        console.error('Failed to sync Codex session model state:', error);
      }
    };

    void syncCodexSessionModelState();
  }, [
    codexModel,
    codexReasoningEffort,
    effectiveProvider,
    selectedProject,
    selectedSession,
    setCodexModel,
    setCodexReasoningEffort,
  ]);

  const handleCodexModelSwitchComplete = useCallback(() => {
    setCodexModelSwitchSessionId(null);
  }, []);

  useEffect(() => {
    if (!codexModelSwitchSessionId) {
      return;
    }

    if (
      !selectedSession?.id
      || selectedSession.id !== codexModelSwitchSessionId
      || selectedSession.__provider !== 'codex'
    ) {
      setCodexModelSwitchSessionId(null);
    }
  }, [selectedSession?.id, selectedSession?.__provider, codexModelSwitchSessionId]);

  useEffect(() => {
    const workflowId = workflowSessionContext.workflowId;
    const routeProjectName = workflowSessionContext.projectName;
    const workflowStageKey = workflowSessionContext.workflowStageKey || undefined;
    const workflowSubstageKey = workflowSessionContext.workflowSubstageKey || undefined;
    const workflowReviewPass = workflowSessionContext.workflowReviewPass || undefined;
    const workflowSessionId = selectedSession?.id && !isTemporarySessionId(selectedSession.id)
      ? selectedSession.id
      : currentSessionId;
    if (!workflowId || !routeProjectName || !workflowSessionId || isTemporarySessionId(workflowSessionId)) {
      return;
    }

    const registrationKey = `${routeProjectName}:${workflowId}:${workflowSessionId}`;
    if (registeredWorkflowSessionsRef.current.has(registrationKey)) {
      return;
    }
    registeredWorkflowSessionsRef.current.add(registrationKey);

    api.registerProjectWorkflowChildSession(routeProjectName, workflowId, {
      sessionId: workflowSessionId,
      title: selectedSession?.title || selectedSession?.summary || '子会话',
      summary: selectedSession?.summary || selectedSession?.title || '子会话',
      provider: selectedSession?.__provider || effectiveProvider,
      stageKey: workflowStageKey,
      substageKey: workflowSubstageKey,
      reviewPassIndex: workflowReviewPass,
    }).catch((error) => {
      registeredWorkflowSessionsRef.current.delete(registrationKey);
      console.error('Failed to register workflow child session:', error);
    });
  }, [
    currentSessionId,
    selectedSession?.summary,
    selectedSession?.title,
    selectedSession?.__provider,
    effectiveProvider,
    workflowSessionContext,
  ]);

  useEffect(() => {
    const workflowId = workflowSessionContext.workflowId;
    const routeProjectName = workflowSessionContext.projectName;
    const activeSessionId = selectedSession?.id || currentSessionId || '';
    const activeProvider = selectedSession?.__provider || effectiveProvider;
    const autoStartStorageKey = activeSessionId ? `workflow-autostart:${activeSessionId}` : '';
    const locationState = location.state as {
      workflowAutoPrompt?: string;
      workflowStageKey?: string;
      workflowSubstageKey?: string;
      workflowReviewPass?: number;
      workflowReviewProfile?: string;
    } | null;
    let autoStartPrompt = '';

    if (typeof locationState?.workflowAutoPrompt === 'string' && locationState.workflowAutoPrompt.trim()) {
      autoStartPrompt = locationState.workflowAutoPrompt;
    }

    if (!autoStartPrompt && autoStartStorageKey && typeof window !== 'undefined') {
      try {
        const rawPayload = window.sessionStorage.getItem(autoStartStorageKey);
        const payload = rawPayload ? JSON.parse(rawPayload) : null;
        autoStartPrompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
      } catch (error) {
        console.error('Failed to parse workflow auto-start payload:', error);
      }
    }

    if (
      !workflowId
      || !routeProjectName
      || !autoStartPrompt
      || !selectedProject
      || !selectedSession
      || !activeSessionId
    ) {
      return;
    }

    if (!isTemporarySessionId(activeSessionId) || chatMessages.length > 0 || input.trim().length > 0 || isComposerSubmitting) {
      return;
    }

    const dispatchKey = `${workflowId}:${activeSessionId}`;
    if (dispatchedWorkflowAutoStartsRef.current.has(dispatchKey)) {
      return;
    }

    const resolvedProjectName = selectedProject.name || '';
    const resolvedProjectPath = selectedSession.projectPath || selectedProject.fullPath || selectedProject.path || '';
    if (!resolvedProjectName || !resolvedProjectPath) {
      return;
    }

    dispatchedWorkflowAutoStartsRef.current.add(dispatchKey);

    const clientRequestId = `workflow-autostart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    /**
     * Workflow auto-start bypasses the regular composer submit path, so it must
     * establish the same pending draft context before the provider emits the
     * concrete session id. Otherwise a stale pendingSessionId can finalize this
     * workflow draft with another workflow's provider session.
     */
    pendingViewSessionRef.current = {
      sessionId: null,
      startedAt: Date.now(),
      clientRequestId,
      draftSessionId: activeSessionId,
    };
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('pendingSessionId');
      window.sessionStorage.setItem('pendingDraftSessionId', activeSessionId);
      window.sessionStorage.setItem('pendingSessionClientRequestId', clientRequestId);
    }

    setIsLoading(true);
    setCanAbortSession(true);
    setClaudeStatus({
      text: 'Processing',
      tokens: 0,
      can_interrupt: true,
    });

    if (activeProvider === 'codex') {
      sendMessage({
        type: 'codex-command',
        clientRequestId,
        command: autoStartPrompt,
        sessionId: null,
        options: {
          projectName: resolvedProjectName,
          cwd: resolvedProjectPath,
          projectPath: resolvedProjectPath,
          sessionId: null,
          clientRequestId,
          resume: false,
          model: codexModel,
          reasoningEffort: codexReasoningEffort,
          permissionMode: 'bypassPermissions',
          attachments: [],
        },
      });
      return;
    }

    sendMessage({
      type: 'claude-command',
      clientRequestId,
      command: autoStartPrompt,
      options: {
        projectName: resolvedProjectName,
        cwd: resolvedProjectPath,
        projectPath: resolvedProjectPath,
        sessionId: null,
        clientRequestId,
        resume: false,
        model: claudeModel,
        permissionMode: 'bypassPermissions',
        toolsSettings: {
          allowedTools: [],
          disallowedTools: [],
          skipPermissions: true,
        },
        attachments: [],
      },
    });
  }, [
    chatMessages.length,
    claudeModel,
    codexModel,
    codexReasoningEffort,
    currentSessionId,
    effectiveProvider,
    input,
    isComposerSubmitting,
    location.state,
    sendMessage,
    selectedProject?.name,
    selectedProject?.fullPath,
    selectedProject?.path,
    selectedSession?.summary,
    selectedSession?.title,
    selectedProject,
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSession?.projectPath,
    selectedSession,
    effectiveProvider,
    setCanAbortSession,
    setClaudeStatus,
    setIsLoading,
    workflowSessionContext,
  ]);

  useEffect(() => {
    const activeSessionId = selectedSession?.id || currentSessionId || '';
    if (!activeSessionId || typeof window === 'undefined') {
      return;
    }

    if (!chatMessages.length) {
      return;
    }

    window.sessionStorage.removeItem(`workflow-autostart:${activeSessionId}`);
  }, [chatMessages.length, currentSessionId, selectedSession?.id]);

  const reviewLaunchSessionId = selectedSession?.id || currentSessionId || '';
  const isReviewLaunchSessionProcessing = Boolean(
    reviewLaunchSessionId && processingSessions?.has(reviewLaunchSessionId),
  );
  const reviewLaunchTurnOutcome = reviewLaunchSessionId ? workflowTurnOutcomes[reviewLaunchSessionId] : undefined;

  useEffect(() => {
    const workflowId = workflowSessionContext.workflowId;
    const workflowSubstageKey = workflowSessionContext.workflowSubstageKey || '';
    const activeSessionId = reviewLaunchSessionId;

    if (
      !workflowId
      || workflowSubstageKey !== 'node_execution'
      || !activeSessionId
      || reviewLaunchTurnOutcome !== 'failed'
    ) {
      return;
    }

    const failureKey = `${workflowId}:${activeSessionId}`;
    if (surfacedWorkflowApplyFailuresRef.current.has(failureKey)) {
      return;
    }
    surfacedWorkflowApplyFailuresRef.current.add(failureKey);

    setChatMessages((previous) => [
      ...previous,
      {
        type: 'error',
        content: '本次 apply 未成功完成，工作流不会自动进入审核。请人工检查失败原因并决定是否重试或介入处理。',
        timestamp: new Date(),
      },
    ]);
  }, [reviewLaunchSessionId, reviewLaunchTurnOutcome, setChatMessages, workflowSessionContext]);

  useChatRealtimeHandlers({
    messageHistory,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setSessionMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    sendMessage,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    codexModelSwitchSessionId,
    loadSessionMessages,
    onCodexModelSwitchComplete: handleCodexModelSwitchComplete,
    onTurnOutcome: ({ sessionId, status }) => {
      if (!sessionId) {
        return;
      }

      setWorkflowTurnOutcomes((previous) => {
        if (previous[sessionId] === status) {
          return previous;
        }
        return {
          ...previous,
          [sessionId]: status,
        };
      });
    },
    onRawMessage: (message) => {
      if (
        message.type === 'session-model-state-updated'
        && message.provider === 'codex'
        && message.sessionId === selectedSession?.id
      ) {
        const state = message.state && typeof message.state === 'object' ? message.state : {};
        const model = typeof state.model === 'string' ? state.model.trim() : '';
        const reasoningEffort = typeof state.reasoningEffort === 'string' ? state.reasoningEffort.trim() : '';
        if (model && model !== codexModel) {
          setCodexModel(model);
        }
        if (reasoningEffort && reasoningEffort !== codexReasoningEffort) {
          setCodexReasoningEffort(reasoningEffort);
        }
      }

      if (!awaitingBackendResponseRef.current) {
        return;
      }

      if (!isBackendResponseMessage(message.type)) {
        return;
      }

      awaitingBackendResponseRef.current = false;
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
        pendingNetworkTimeoutRef.current = null;
      }
    },
  });

  useEffect(() => {
    return () => {
      if (pendingNetworkTimeoutRef.current) {
        clearTimeout(pendingNetworkTimeoutRef.current);
        pendingNetworkTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!awaitingBackendResponseRef.current || !isLoading || ws?.readyState === WebSocket.OPEN) {
      return;
    }

    // Fail fast when the socket drops after dispatch so users are not left waiting for the full timeout window.
    awaitingBackendResponseRef.current = false;
    if (pendingNetworkTimeoutRef.current) {
      clearTimeout(pendingNetworkTimeoutRef.current);
      pendingNetworkTimeoutRef.current = null;
    }

    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);
    setChatMessages((previous) => [
      ...previous,
      {
        type: 'error',
        content: NETWORK_DISCONNECTED_MESSAGE,
        timestamp: new Date(),
      },
    ]);
  }, [
    isLoading,
    setCanAbortSession,
    setChatMessages,
    setClaudeStatus,
    setIsLoading,
    ws,
  ]);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    if (shouldPauseStatusReconcile) {
      return;
    }

    const activeViewSessionId =
      selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;

    if (!activeViewSessionId || isTemporarySessionId(activeViewSessionId)) {
      return;
    }

    const statusProvider = effectiveProvider === 'codex' ? 'codex' : 'claude';
    const reconcileSessionStatus = () => {
      sendMessage({
        type: 'check-session-status',
        sessionId: activeViewSessionId,
        provider: statusProvider,
      });
    };

    // Run immediately and then poll to recover from missed complete events.
    reconcileSessionStatus();

    const timer = window.setInterval(
      reconcileSessionStatus,
      SESSION_STATUS_RECONCILE_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(timer);
    };
  }, [
    currentSessionId,
    input,
    isLoading,
    isInputFocused,
    effectiveProvider,
    selectedSession?.id,
    sendMessage,
    shouldPauseStatusReconcile,
  ]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!isChatSearchOpen) {
      return;
    }

    chatSearchInputRef.current?.focus();
    chatSearchInputRef.current?.select();
  }, [isChatSearchOpen]);

  useEffect(() => {
    if (!isChatSearchOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      setIsChatSearchOpen(false);
    };

    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleEscape, { capture: true });
    };
  }, [isChatSearchOpen]);

  useEffect(() => {
    window.openChatHistorySearch = () => {
      setIsChatSearchOpen(true);
    };

    return () => {
      if (window.openChatHistorySearch) {
        delete window.openChatHistorySearch;
      }
    };
  }, []);

  useEffect(() => {
    if (!activeSearchTarget || !selectedSession?.id) {
      return;
    }

    const hasTargetMessage = chatMessages.some((message) => message.messageKey === activeSearchTarget.messageKey);
    if (hasTargetMessage || isLoadingAllMessages || allMessagesLoaded) {
      return;
    }

    void loadAllMessages();
  }, [
    activeSearchTarget,
    allMessagesLoaded,
    chatMessages,
    isLoadingAllMessages,
    loadAllMessages,
    selectedSession?.id,
  ]);

  useEffect(() => {
    const clearHighlights = () => {
      document.querySelectorAll('.chat-search-highlight').forEach((element) => {
        const parent = element.parentNode;
        if (!parent) {
          return;
        }

        parent.replaceChild(document.createTextNode(element.textContent || ''), element);
        parent.normalize();
      });
    };

    clearHighlights();

    if (!activeSearchTarget || !selectedSession?.id) {
      return;
    }

    const selector = `.chat-message[data-message-key="${CSS.escape(activeSearchTarget.messageKey)}"]`;
    const targetElement = document.querySelector<HTMLElement>(selector);
    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ block: 'center', behavior: 'auto' });

    const query = activeSearchTarget.query.trim();
    if (!query) {
      return;
    }

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(targetElement, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.nodeValue?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parent = node.parentElement;
        if (!parent || parent.closest('.chat-search-highlight')) {
          return NodeFilter.FILTER_REJECT;
        }

        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = new RegExp(escapedQuery, 'gi');

    textNodes.forEach((textNode) => {
      const textContent = textNode.nodeValue || '';
      matcher.lastIndex = 0;
      if (!matcher.test(textContent)) {
        return;
      }

      matcher.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const match of textContent.matchAll(matcher)) {
        const startIndex = match.index ?? 0;
        if (startIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(textContent.slice(lastIndex, startIndex)));
        }

        const highlight = document.createElement('mark');
        highlight.className = 'chat-search-highlight';
        highlight.textContent = match[0];
        fragment.appendChild(highlight);
        lastIndex = startIndex + match[0].length;
      }

      if (lastIndex < textContent.length) {
        fragment.appendChild(document.createTextNode(textContent.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    });

    return () => {
      clearHighlights();
    };
  }, [activeSearchTarget, chatMessages, selectedSession?.id]);

  useEffect(() => {
    if (hasPersistentSession) {
      return;
    }

    setIsFollowingLatest(false);
  }, [hasPersistentSession]);

  useEffect(() => {
    /**
     * Manual chat sessions should keep the newest assistant progress in view
     * while the user has explicitly enabled follow mode.
     */
    if (!isFollowingLatest || !hasPersistentSession) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom();
      setIsUserScrolledUp(false);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    chatMessages,
    hasPersistentSession,
    isFollowingLatest,
    scrollToBottom,
    setIsUserScrolledUp,
  ]);

  const runChatSearch = useCallback(async () => {
    const trimmedQuery = chatSearchQuery.trim();
    if (!trimmedQuery) {
      setChatSearchResults([]);
      setChatSearchError('');
      setChatSearchStatus('idle');
      return;
    }

    setChatSearchResults([]);
    setChatSearchError('');
    setChatSearchStatus('loading');
    try {
      const response = await api.chatSearch(trimmedQuery);
      const results = await parseChatSearchResponse(response);
      setChatSearchResults(results);
      setChatSearchStatus(results.length > 0 ? 'success-hit' : 'success-empty');
    } catch (error) {
      console.error('Error searching chat history:', error);
      setChatSearchResults([]);
      setChatSearchError(error instanceof Error ? error.message : 'Failed to search chat history');
      setChatSearchStatus('error');
    } finally {
    }
  }, [chatSearchQuery]);

  if (!selectedProject) {
    const selectedProviderLabel =
      effectiveProvider === 'codex'
        ? t('messageTypes.codex')
        : t('messageTypes.claude');

    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">
              {t('projectSelection.startChatWithProvider', {
                provider: selectedProviderLabel,
                defaultValue: 'Select a project to start chatting with {{provider}}',
              })}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 min-h-0 flex flex-col">
        <ChatMessagesPane
          scrollContainerRef={scrollContainerRef}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onKeyDown={handleTranscriptKeyDown}
          isLoadingSessionMessages={isLoadingSessionMessages}
          chatMessages={chatMessages}
          selectedSession={selectedSession}
          currentSessionId={currentSessionId}
          provider={effectiveProvider}
          setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
          textareaRef={textareaRef}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          claudeModelOptions={claudeModelOptions}
          codexModel={codexModel}
          setCodexModel={handleSetCodexModel}
          codexModelOptions={codexModelOptions}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={handleSetCodexReasoningEffort}
          codexReasoningOptions={codexReasoningOptions}
          tasksEnabled={tasksEnabled}
          isTaskMasterInstalled={isTaskMasterInstalled}
          onShowAllTasks={onShowAllTasks}
          setInput={setInput}
          isLoadingMoreMessages={isLoadingMoreMessages}
          hasMoreMessages={hasMoreMessages}
          totalMessages={totalMessages}
          sessionMessagesCount={sessionMessages.length}
          visibleMessageCount={visibleMessageCount}
          visibleMessages={visibleMessages}
          loadEarlierMessages={loadEarlierMessages}
          loadAllMessages={loadAllMessages}
          allMessagesLoaded={allMessagesLoaded}
          isLoadingAllMessages={isLoadingAllMessages}
          loadAllJustFinished={loadAllJustFinished}
          showLoadAllOverlay={showLoadAllOverlay}
          createDiff={createDiff}
          onFileOpen={onFileOpen}
          onShowSettings={onShowSettings}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          showThinking={showThinking}
          selectedProject={selectedProject}
        />

        <ChatComposer
          claudeStatus={claudeStatus}
          isLoading={isLoading}
          isComposerSubmitting={isComposerSubmitting}
          onAbortSession={handleAbortSession}
          provider={effectiveProvider}
          thinkingMode={thinkingMode}
          setThinkingMode={setThinkingMode}
          claudeModel={claudeModel}
          setClaudeModel={setClaudeModel}
          claudeModelOptions={claudeModelOptions}
          codexModel={codexModel}
          setCodexModel={handleSetCodexModel}
          codexModelOptions={codexModelOptions}
          codexReasoningEffort={codexReasoningEffort}
          setCodexReasoningEffort={handleSetCodexReasoningEffort}
          codexReasoningOptions={codexReasoningOptions}
          onToggleCommandMenu={handleToggleCommandMenu}
          onToggleFileMenu={openFileDropdown}
          hasMessages={chatMessages.length > 0 || visibleMessages.length > 0 || sessionMessages.length > 0}
          isFollowingLatest={isFollowingLatest}
          onToggleFollowLatest={() => {
            setIsFollowingLatest((current) => {
              const next = !current;
              if (next) {
                scrollToBottomAndReset();
                setIsUserScrolledUp(false);
              }
              return next;
            });
          }}
          onSubmit={handleSubmit}
          isDragActive={isDragActive}
          attachedUploads={attachedUploads}
          onRemoveAttachment={(index) =>
            setAttachedUploads((previous) =>
              previous.filter((_, currentIndex) => currentIndex !== index),
            )
          }
          uploadingAttachments={uploadingAttachments}
          attachmentErrors={attachmentErrors}
          showFileDropdown={showFileDropdown}
          filteredFiles={filteredFiles}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={selectFile}
          filteredCommands={filteredCommands}
          selectedCommandIndex={selectedCommandIndex}
          onCommandSelect={handleCommandSelect}
          onCloseCommandMenu={resetCommandMenuState}
          isCommandMenuOpen={showCommandMenu}
          frequentCommands={frequentCommands}
          getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
          getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
          openAttachmentPicker={openAttachmentPicker}
          onAttachmentSelection={handleAttachmentSelection}
          inputHighlightRef={inputHighlightRef}
          renderInputWithMentions={renderInputWithMentions}
          textareaRef={textareaRef}
          input={input}
          onInputChange={handleInputChange}
          onTextareaClick={handleTextareaClick}
          onTextareaKeyDown={handleKeyDown}
          onTextareaPaste={handlePaste}
          onTextareaScrollSync={syncInputOverlayScroll}
          onTextareaInput={handleTextareaInput}
          onInputFocusChange={handleInputFocusChange}
          placeholder={t('input.placeholder', {
              provider:
              effectiveProvider === 'codex'
                ? t('messageTypes.codex')
                : t('messageTypes.claude'),
          })}
          isTextareaExpanded={isTextareaExpanded}
          sendByCtrlEnter={sendByCtrlEnter}
          onTranscript={handleTranscript}
        />
      </div>

      {isChatSearchOpen && (
        <div className="fixed inset-0 z-[110] bg-black/20 backdrop-blur-[1px]">
          <div
            className="absolute inset-0"
            onClick={() => setIsChatSearchOpen(false)}
          />
          <div className="relative mx-auto mt-16 w-[min(42rem,calc(100vw-1rem))] rounded-lg border border-border bg-background shadow-xl">
            <form
              className="border-b border-border/50 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void runChatSearch();
              }}
            >
              <input
                ref={chatSearchInputRef}
                data-testid="chat-history-search-input"
                type="search"
                value={chatSearchQuery}
                onChange={(event) => setChatSearchQuery(event.target.value)}
                placeholder={t('search.placeholder')}
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </form>

            <div
              data-testid="chat-history-search-results"
              className="max-h-[min(60vh,28rem)] overflow-y-auto"
            >
              {chatSearchStatus === 'idle' && (
                <div className="px-4 py-4 text-sm text-muted-foreground">
                  {t('search.enterPrompt')}
                </div>
              )}

              {chatSearchStatus === 'loading' && (
                <div
                  data-testid="chat-history-search-loading"
                  className="px-4 py-4 text-sm text-muted-foreground"
                >
                  {t('search.searching')}
                </div>
              )}

              {chatSearchStatus === 'success-empty' && (
                <div
                  data-testid="chat-history-search-empty"
                  className="px-4 py-4 text-sm text-muted-foreground"
                >
                  {t('search.noMatches')}
                </div>
              )}

              {chatSearchStatus === 'error' && (
                <div
                  data-testid="chat-history-search-error"
                  className="px-4 py-4 text-sm text-destructive"
                >
                  {chatSearchError}
                </div>
              )}

              {chatSearchStatus === 'success-hit' && chatSearchResults.map((result) => (
                <button
                  key={`${result.sessionId}:${result.messageKey}`}
                  type="button"
                  data-testid="chat-history-search-result"
                  className="w-full border-b border-border/40 px-4 py-3 text-left transition-colors hover:bg-muted/40 last:border-b-0"
                  onClick={() => {
                    setIsChatSearchOpen(false);
                    onNavigateToSession?.(result.sessionId, {
                      projectName: result.projectName,
                      provider: result.provider,
                      routeSearch: {
                        chatSearch: chatSearchQuery.trim(),
                        messageKey: result.messageKey,
                      },
                    });
                  }}
                >
                  <div className="text-xs text-muted-foreground">
                    {result.projectDisplayName} · {result.provider === 'codex' ? 'Codex' : 'Claude'}
                  </div>
                  <div className="text-sm font-medium">{result.sessionSummary}</div>
                  <div className="text-sm text-muted-foreground">{result.snippet}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default React.memo(ChatInterface);
