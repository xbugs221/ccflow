/**
 * Realtime chat event handling.
 * Consumes backend WebSocket messages in sequence and updates chat/session UI state.
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { SocketMessageEnvelope } from '../../../contexts/WebSocketContext';
import { getPendingSocketMessages } from '../../../../shared/socket-message-utils.js';
import { decodeHtmlEntities, formatUsageLimitText } from '../utils/chatFormatting';
import { safeLocalStorage } from '../utils/chatStorage';
import type { ChatMessage, PendingPermissionRequest } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  clientRequestId?: string;
  draftSessionId?: string | null;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  messageHistory: SocketMessageEnvelope[];
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setSessionMessages: Dispatch<SetStateAction<any[]>>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: (status: { text: string; tokens: number; can_interrupt: boolean } | null) => void;
  setTokenBudget: (budget: Record<string, unknown> | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  sendMessage: (message: unknown) => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    sessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
    },
  ) => void;
  codexModelSwitchSessionId: string | null;
  loadSessionMessages: (
    projectName: string,
    sessionId: string,
    loadMore?: boolean,
    provider?: string,
  ) => Promise<any[]>;
  onCodexModelSwitchComplete?: () => void;
  onRawMessage?: (message: LatestChatMessage) => void;
  onTurnOutcome?: (payload: { sessionId: string | null; status: 'completed' | 'failed' }) => void;
}

const isTemporarySessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId)));

const isCcflowRouteSessionId = (sessionId?: string | null): boolean =>
  Boolean(sessionId && /^c\d+$/.test(sessionId));

/** 
 * Check whether a provider session-created event belongs to the draft request
 * currently shown in this chat view.
 */
const isSessionCreatedForPendingView = (
  latestMessage: LatestChatMessage,
  pendingViewSession: PendingViewSession | null,
): boolean => {
  if (!pendingViewSession) {
    return false;
  }

  const expectedRequestId = pendingViewSession.clientRequestId;
  if (!expectedRequestId) {
    return true;
  }

  return latestMessage.clientRequestId === expectedRequestId;
};

const buildWorkflowNavigationOptions = (
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
  provider: SessionProvider,
) => {
  if (!selectedSession?.workflowId) {
    return undefined;
  }

  return {
    provider: selectedSession.__provider || provider,
    projectName: selectedSession.__projectName || selectedProject?.name || '',
    projectPath: selectedSession.projectPath || selectedProject?.fullPath || selectedProject?.path || '',
    workflowId: selectedSession.workflowId,
    workflowStageKey: selectedSession.stageKey,
  };
};

const markPendingUserMessagesDelivered = (
  msgs: ChatMessage[],
): ChatMessage[] =>
  msgs.map((msg) =>
    msg.type === 'user' && msg.deliveryStatus === 'pending' && !msg.clientRequestId
      ? { ...msg, deliveryStatus: 'sent' as const }
      : msg,
  );

/**
 * Mark the accepted user send as sent, falling back to the newest pending user row.
 */
const markAcceptedUserMessageSent = (
  msgs: ChatMessage[],
  clientRequestId?: string,
): ChatMessage[] => {
  const exactIndex = clientRequestId
    ? msgs.findIndex((msg) =>
      msg.type === 'user'
      && msg.deliveryStatus === 'pending'
      && msg.clientRequestId === clientRequestId)
    : -1;

  const acceptedIndex = exactIndex >= 0
    ? exactIndex
    : (() => {
      for (let index = msgs.length - 1; index >= 0; index -= 1) {
        const msg = msgs[index];
        if (msg.type === 'user' && msg.deliveryStatus === 'pending') {
          return index;
        }
      }
      return -1;
    })();

  if (acceptedIndex < 0) {
    return msgs;
  }

  return msgs.map((msg, index) =>
    index === acceptedIndex
      ? { ...msg, deliveryStatus: 'sent' as const }
      : msg,
  );
};

/**
 * Mark optimistic user sends as persisted once the backend reports the agent turn is complete.
 */
const markUserMessagesPersisted = (
  msgs: ChatMessage[],
): ChatMessage[] =>
  msgs.map((msg) =>
    msg.type === 'user' && (msg.deliveryStatus === 'pending' || msg.deliveryStatus === 'sent')
      ? { ...msg, deliveryStatus: 'persisted' as const }
      : msg,
  );

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && !last.isToolUse && last.isStreaming) {
      const nextContent = newline
        ? last.content
          ? `${last.content}\n${chunk}`
          : chunk
        : `${last.content || ''}${chunk}`;
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, content: nextContent };
    } else {
      updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true });
    }
    return markPendingUserMessagesDelivered(updated);
  });
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>) => {
  setChatMessages((previous) => {
    const updated = [...previous];
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (last && last.type === 'assistant' && last.isStreaming) {
      // Clone the message instead of mutating in place so React can reliably detect state updates.
      updated[lastIndex] = { ...last, isStreaming: false };
    }
    return markPendingUserMessagesDelivered(updated);
  });
};

/**
 * Reload persisted Codex transcript entries so completed Edit tools replace
 * any transient realtime placeholders.
 */
const reloadCodexSessionMessages = async ({
  selectedProject,
  selectedSession,
  sessionId,
  loadSessionMessages,
  setSessionMessages,
}: {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sessionId: string | null;
  loadSessionMessages: (
    projectName: string,
    sessionId: string,
    loadMore?: boolean,
    provider?: string,
  ) => Promise<any[]>;
  setSessionMessages: Dispatch<SetStateAction<any[]>>;
}) => {
  if (!selectedProject?.name || !sessionId || isTemporarySessionId(sessionId)) {
    return;
  }

  const provider = selectedSession?.__provider || 'codex';
  const projectName = provider === 'codex'
    ? selectedProject.name
    : selectedSession?.__projectName || selectedProject.name;

  const messages = await loadSessionMessages(projectName, sessionId, false, provider);
  setSessionMessages(Array.isArray(messages) ? messages : []);
};

export function useChatRealtimeHandlers({
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
  onCodexModelSwitchComplete,
  onRawMessage,
  onTurnOutcome,
}: UseChatRealtimeHandlersArgs) {
  /**
   * Replay buffered socket messages for routes that mount after the socket event.
   */
  const lastProcessedSequenceRef = useRef(0);

  useEffect(() => {
    let bridgedSocket: any = null;
    let bridgeTimer: number | null = null;
    const handleCodexTestMessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(String(event.data || '{}'));
        const codexData = parsed?.type === 'codex-response' ? parsed.data : null;
        if (codexData?.type !== 'item') {
          return;
        }
        // Codex item payloads are rendered only after they are persisted to JSONL.
      } catch {
        // Ignore malformed test socket payloads.
      }
    };

    const attachBridge = () => {
      const testSocket = (window as any).__codexRealtimeSocket;
      if (!testSocket || testSocket.__ccflowCodexBridge) {
        return;
      }
      bridgedSocket = testSocket;
      bridgedSocket.__ccflowCodexBridge = true;
      bridgedSocket.addEventListener?.('message', handleCodexTestMessage);
      if (bridgeTimer !== null) {
        window.clearInterval(bridgeTimer);
        bridgeTimer = null;
      }
    };

    attachBridge();
    if (!bridgedSocket) {
      bridgeTimer = window.setInterval(attachBridge, 25);
    }

    return () => {
      if (bridgeTimer !== null) {
        window.clearInterval(bridgeTimer);
      }
      bridgedSocket?.removeEventListener?.('message', handleCodexTestMessage);
      if (bridgedSocket) {
        bridgedSocket.__ccflowCodexBridge = false;
      }
    };
  }, [setChatMessages]);

  useEffect(() => {
    const pendingMessages = getPendingSocketMessages(
      messageHistory,
      lastProcessedSequenceRef.current,
    ) as Array<{ sequence: number; message: LatestChatMessage }>;
    if (pendingMessages.length === 0) {
      return;
    }

    pendingMessages.forEach(({ sequence, message: latestMessage }) => {
      lastProcessedSequenceRef.current = sequence;
      onRawMessage?.(latestMessage);

      const messageData = latestMessage.data?.message || latestMessage.data;
      const structuredMessageData =
        messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
      const rawStructuredData =
        latestMessage.data && typeof latestMessage.data === 'object'
          ? (latestMessage.data as Record<string, any>)
          : null;

      const globalMessageTypes = ['projects_updated', 'taskmaster-project-updated', 'session-created'];
      const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
      const projectsUpdateProvider = latestMessage.provider || latestMessage.watchProvider;
      if (
        latestMessage.type === 'projects_updated' &&
        projectsUpdateProvider === 'codex' &&
        selectedSession?.__provider === 'codex'
      ) {
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: selectedSession.id,
          loadSessionMessages,
          setSessionMessages,
        });
      }
      const lifecycleMessageTypes = new Set([
        'claude-complete',
        'codex-complete',
        'session-aborted',
        'claude-error',
        'codex-error',
      ]);

      const isClaudeSystemInit =
        latestMessage.type === 'claude-response' &&
        structuredMessageData &&
        structuredMessageData.type === 'system' &&
        structuredMessageData.subtype === 'init';

      const systemInitSessionId = isClaudeSystemInit ? structuredMessageData?.session_id : null;

      const activeViewSessionId =
        selectedSession?.id || currentSessionId || pendingViewSessionRef.current?.sessionId || null;
      const isTemporaryViewSession = isTemporarySessionId(activeViewSessionId);
      const isCcflowRouteView = isCcflowRouteSessionId(activeViewSessionId);
      const messageRouteSessionId =
        latestMessage.ccflowSessionId || latestMessage.ccflow_session_id || latestMessage.sessionId;
      const isSystemInitForView =
        systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
      const shouldBypassSessionFilter = isGlobalMessage
        || Boolean(isSystemInitForView)
        || (latestMessage.type === 'session-created' && isTemporaryViewSession);
      const isUnscopedError =
        !latestMessage.sessionId &&
        pendingViewSessionRef.current &&
        !pendingViewSessionRef.current.sessionId &&
        (latestMessage.type === 'claude-error' ||
          latestMessage.type === 'codex-error');

      const handleBackgroundLifecycle = (sessionId?: string) => {
        if (!sessionId) {
          return;
        }
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
      };

      const collectSessionIds = (...sessionIds: Array<string | null | undefined>) =>
        Array.from(
          new Set(
            sessionIds.filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
          ),
        );

      const clearLoadingIndicators = () => {
        setIsLoading(false);
        setCanAbortSession(false);
        setClaudeStatus(null);
      };

      const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
        const normalizedSessionIds = collectSessionIds(...sessionIds);
        normalizedSessionIds.forEach((sessionId) => {
          onSessionInactive?.(sessionId);
          onSessionNotProcessing?.(sessionId);
        });
      };
      const isCodexModelSwitchForCurrentSession = Boolean(
        codexModelSwitchSessionId
        && selectedSession?.id === codexModelSwitchSessionId
        && selectedSession?.__provider === 'codex',
      );
      const clearCodexModelSwitchState = () => {
        if (!isCodexModelSwitchForCurrentSession) {
          return;
        }
        onCodexModelSwitchComplete?.();
      };

      if (!shouldBypassSessionFilter) {
        if (!activeViewSessionId) {
          if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
            handleBackgroundLifecycle(latestMessage.sessionId);
          }
          if (!latestMessage.sessionId && latestMessage.type === 'codex-response') {
            lastProcessedSequenceRef.current = sequence - 1;
          }
          if (!isUnscopedError) {
            return;
          }
        }

        if (!messageRouteSessionId && latestMessage.type === 'codex-response') {
          // Codex CLI item events can be scoped by the current view route rather than the socket envelope.
        } else if (!messageRouteSessionId && !isUnscopedError) {
          return;
        }

        if (messageRouteSessionId && messageRouteSessionId !== activeViewSessionId) {
          if (messageRouteSessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
            handleBackgroundLifecycle(messageRouteSessionId);
          }
          return;
        }
      }

      switch (latestMessage.type) {
      case 'message-accepted':
        setChatMessages((previous) =>
          markAcceptedUserMessageSent(previous, latestMessage.clientRequestId));
        break;
      case 'session-created':
        if (
          !isCodexModelSwitchForCurrentSession
          && !isSessionCreatedForPendingView(latestMessage, pendingViewSessionRef.current)
        ) {
          return;
        }
        if (
          latestMessage.sessionId
          && (!currentSessionId || isTemporarySessionId(currentSessionId))
          && !isCcflowRouteView
        ) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(latestMessage.sessionId);
          onNavigateToSession?.(
            latestMessage.sessionId,
            buildWorkflowNavigationOptions(selectedProject, selectedSession, provider),
          );

          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: latestMessage.sessionId },
            ),
          );
          setChatMessages((previous) => markPendingUserMessagesDelivered(previous));
          return;
        }

        if (latestMessage.sessionId && isCodexModelSwitchForCurrentSession) {
          sessionStorage.setItem('pendingSessionId', latestMessage.sessionId);
          if (pendingViewSessionRef.current && !pendingViewSessionRef.current.sessionId) {
            pendingViewSessionRef.current.sessionId = latestMessage.sessionId;
          }

          onReplaceTemporarySession?.(latestMessage.sessionId);
          clearCodexModelSwitchState();
          onNavigateToSession?.(
            latestMessage.sessionId,
            buildWorkflowNavigationOptions(selectedProject, selectedSession, provider),
          );
        }
        setChatMessages((previous) => markPendingUserMessagesDelivered(previous));
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 100);
            }
            return;
          }

          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id !== currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          !currentSessionId &&
          isSystemInitForView
        ) {
          setIsSystemSessionChange(true);
          onNavigateToSession?.(structuredMessageData.session_id);
          return;
        }

        if (
          structuredMessageData?.type === 'system' &&
          structuredMessageData.subtype === 'init' &&
          structuredMessageData.session_id &&
          currentSessionId &&
          structuredMessageData.session_id === currentSessionId &&
          isSystemInitForView
        ) {
          return;
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type === 'tool_use') {
              const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

              // Check if this is a child tool from a subagent
              if (parentToolUseId) {
                setChatMessages((previous) =>
                  previous.map((message) => {
                    if (message.toolId === parentToolUseId && message.isSubagentContainer) {
                      const childTool = {
                        toolId: part.id,
                        toolName: part.name,
                        toolInput: part.input,
                        toolResult: null,
                        timestamp: new Date(),
                      };
                      const existingChildren = message.subagentState?.childTools || [];
                      return {
                        ...message,
                        subagentState: {
                          childTools: [...existingChildren, childTool],
                          currentToolIndex: existingChildren.length,
                          isComplete: false,
                        },
                      };
                    }
                    return message;
                  }),
                );
                return;
              }

              // Check if this is a subagent tool (Task for legacy, Agent for Claude preset)
              const isSubagentContainer = part.name === 'Task' || part.name === 'Agent';

              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content: '',
                  timestamp: new Date(),
                  isToolUse: true,
                  toolName: part.name,
                  toolInput,
                  toolId: part.id,
                  toolResult: null,
                  isSubagentContainer,
                  subagentState: isSubagentContainer
                    ? { childTools: [], currentToolIndex: -1, isComplete: false }
                    : undefined,
                },
              ]);
              return;
            }

            if (part.type === 'text' && part.text?.trim()) {
              let content = decodeHtmlEntities(part.text);
              content = formatUsageLimitText(content);
              setChatMessages((previous) => [
                ...previous,
                {
                  type: 'assistant',
                  content,
                  timestamp: new Date(),
                },
              ]);
            }
          });
        } else if (structuredMessageData && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          let content = decodeHtmlEntities(structuredMessageData.content);
          content = formatUsageLimitText(content);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content,
              timestamp: new Date(),
            },
          ]);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          const parentToolUseId = rawStructuredData?.parentToolUseId;

          structuredMessageData.content.forEach((part: any) => {
            if (part.type !== 'tool_result') {
              return;
            }

            setChatMessages((previous) =>
              previous.map((message) => {
                // Handle child tool results (route to parent's subagentState)
                if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
                  return {
                    ...message,
                    subagentState: {
                      ...message.subagentState!,
                      childTools: message.subagentState!.childTools.map((child) => {
                        if (child.toolId === part.tool_use_id) {
                          return {
                            ...child,
                            toolResult: {
                              content: part.content,
                              isError: part.is_error,
                              timestamp: new Date(),
                            },
                          };
                        }
                        return child;
                      }),
                    },
                  };
                }

                // Handle normal tool results (including parent Task tool completion)
                if (message.isToolUse && message.toolId === part.tool_use_id) {
                  const result = {
                    ...message,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                  // Mark subagent as complete when parent Task receives its result
                  if (message.isSubagentContainer && message.subagentState) {
                    result.subagentState = {
                      ...message.subagentState,
                      isComplete: true,
                    };
                  }
                  return result;
                }
                return message;
              }),
            );
          });
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 100);
          }
        }
        break;
      }

      case 'claude-interactive-prompt':
        // Interactive prompts are parsed/rendered as text in the UI.
        // Normalize to string to keep ChatMessage.content shape consistent.
        {
          const interactiveContent =
            typeof latestMessage.data === 'string'
              ? latestMessage.data
              : JSON.stringify(latestMessage.data ?? '', null, 2);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: interactiveContent,
              timestamp: new Date(),
              isInteractivePrompt: true,
            },
          ]);
        }
        break;

      case 'claude-permission-request':
        // YOLO模式：自动批准所有权限请求，不弹出UI
        if (latestMessage.requestId) {
          sendMessage({
            type: 'claude-permission-response',
            requestId: latestMessage.requestId,
            allow: true,
          });
        }
        break;

      case 'claude-permission-cancelled':
        break;

      case 'claude-error':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: `Error: ${latestMessage.error}`,
            timestamp: new Date(),
          },
        ]);
        break;

      case 'claude-complete': {
        const pendingSessionId = sessionStorage.getItem('pendingSessionId');
        const completedSessionId =
          latestMessage.ccflowSessionId
          || latestMessage.ccflow_session_id
          || currentSessionId
          || latestMessage.sessionId
          || pendingSessionId;

        clearLoadingIndicators();
        setChatMessages((previous) => markUserMessagesPersisted(previous));
        markSessionsAsCompleted(
          completedSessionId,
          currentSessionId,
          selectedSession?.id,
          pendingSessionId,
        );

        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          sessionStorage.removeItem('pendingSessionId');
          console.log('New session complete, ID set to:', pendingSessionId);
        }

        if (selectedProject && latestMessage.exitCode === 0) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) {
          break;
        }

        if (codexData.type === 'item' && !['agent_message', 'reasoning', 'command_execution', 'file_change', 'mcp_tool_call', 'error'].includes(codexData.itemType)) {
          console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
        }

        if (codexData.type === 'turn_complete') {
          clearLoadingIndicators();
          setChatMessages((previous) => markUserMessagesPersisted(previous));
          markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'completed',
          });
        }

        if (codexData.type === 'turn_failed') {
          clearLoadingIndicators();
          markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          onTurnOutcome?.({
            sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
            status: 'failed',
          });
        }
        break;
      }

      case 'codex-complete': {
        const codexPendingSessionId = sessionStorage.getItem('pendingSessionId');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId =
          latestMessage.sessionId || currentSessionId || codexPendingSessionId;

        clearLoadingIndicators();
        setChatMessages((previous) => markUserMessagesPersisted(previous));
        markSessionsAsCompleted(
          codexCompletedSessionId,
          codexActualSessionId,
          currentSessionId,
          selectedSession?.id,
          codexPendingSessionId,
        );

        if (codexPendingSessionId && !currentSessionId) {
          setCurrentSessionId(codexActualSessionId);
          setIsSystemSessionChange(true);
          if (codexActualSessionId) {
            onNavigateToSession?.(codexActualSessionId);
          }
          sessionStorage.removeItem('pendingSessionId');
        }
        if (isCodexModelSwitchForCurrentSession) {
          clearCodexModelSwitchState();
          if (codexCompletedSessionId) {
            onNavigateToSession?.(codexCompletedSessionId);
          }
        }

        if (selectedProject) {
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
        }
        void reloadCodexSessionMessages({
          selectedProject,
          selectedSession,
          sessionId: codexCompletedSessionId,
          loadSessionMessages,
          setSessionMessages,
        });
        break;
      }

      case 'codex-error':
        setIsLoading(false);
        setCanAbortSession(false);
        if (isCodexModelSwitchForCurrentSession) {
          clearCodexModelSwitchState();
        }
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || 'An error occurred with Codex',
            timestamp: new Date(),
          },
        ]);
        break;

      case 'session-aborted': {
        const pendingSessionId =
          typeof window !== 'undefined' ? sessionStorage.getItem('pendingSessionId') : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        const abortSucceeded = latestMessage.success !== false;

        if (abortSucceeded) {
          clearLoadingIndicators();
          markSessionsAsCompleted(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (isCodexModelSwitchForCurrentSession) {
            clearCodexModelSwitchState();
          }
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            sessionStorage.removeItem('pendingSessionId');
          }

          setPendingPermissionRequests([]);
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: 'Session interrupted by user.',
              timestamp: new Date(),
            },
          ]);
        } else {
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'error',
              content: 'Stop request failed. The session is still running.',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        if (!statusSessionId) {
          break;
        }

        const isCurrentSession =
          statusSessionId === currentSessionId || (selectedSession && statusSessionId === selectedSession.id);

        if (latestMessage.isProcessing) {
          onSessionProcessing?.(statusSessionId);
          if (isCurrentSession) {
            setIsLoading(true);
            setCanAbortSession(true);
          }
          break;
        }

        onSessionInactive?.(statusSessionId);
        onSessionNotProcessing?.(statusSessionId);
        if (isCurrentSession) {
          clearLoadingIndicators();
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data;
        if (!statusData) {
          break;
        }

        const statusInfo: { text: string; tokens: number; can_interrupt: boolean } = {
          text: 'Working...',
          tokens: 0,
          can_interrupt: true,
        };

        if (statusData.message) {
          statusInfo.text = statusData.message;
        } else if (statusData.status) {
          statusInfo.text = statusData.status;
        } else if (typeof statusData === 'string') {
          statusInfo.text = statusData;
        }

        if (statusData.tokens) {
          statusInfo.tokens = statusData.tokens;
        } else if (statusData.token_count) {
          statusInfo.tokens = statusData.token_count;
        }

        if (statusData.can_interrupt !== undefined) {
          statusInfo.can_interrupt = statusData.can_interrupt;
        }

        setClaudeStatus(statusInfo);
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }

        default:
          break;
      }
    });
  }, [
    messageHistory,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    setCurrentSessionId,
    setChatMessages,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    sendMessage,
    onSessionInactive,
    onSessionProcessing,
    onSessionNotProcessing,
    onReplaceTemporarySession,
    onNavigateToSession,
    onRawMessage,
  ]);
}
