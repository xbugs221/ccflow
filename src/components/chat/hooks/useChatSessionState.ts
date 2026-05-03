/**
 * PURPOSE: Manage chat session history loading, pagination, and view state.
 * Session API routing must honor merged worktree sessions that keep their
 * original Claude project directory in `selectedSession.__projectName`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  TouchEvent as ReactTouchEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import type { ChatMessage } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import { safeLocalStorage } from '../utils/chatStorage';
import { dedupeAdjacentChatMessages } from '../utils/messageDedup';
import {
  dedupeSessionMessagesByIdentity,
  getSessionMessageIdentity,
  getUniqueIncomingSessionMessages,
} from '../utils/sessionMessageDedup';
import {
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';
import { getIntrinsicMessageKey } from '../utils/messageKeys';

const MESSAGES_PER_PAGE = 100;
const INITIAL_VISIBLE_MESSAGES = 100;
const USER_UPLOAD_NOTE_MARKER = '[User uploaded files for this message]';

/**
 * Normalize user message text so optimistic and persisted copies can be matched
 * even when whitespace changes during provider serialization.
 */
function normalizeUserMessageText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Check whether the persisted user text confirms the optimistic send text.
 */
function isPersistedUserTextMatch(optimisticContent: string, persistedContent: string): boolean {
  if (!optimisticContent || !persistedContent) {
    return false;
  }

  if (optimisticContent === persistedContent) {
    return true;
  }

  return persistedContent.startsWith(`${optimisticContent} ${USER_UPLOAD_NOTE_MARKER}`);
}

/**
 * Match upload-only sends when the provider transcript only has the file note.
 */
function isPersistedAttachmentNoteMatch(optimisticMessage: ChatMessage, persistedContent: string): boolean {
  if (!persistedContent.includes(USER_UPLOAD_NOTE_MARKER) || !Array.isArray(optimisticMessage.attachments)) {
    return false;
  }

  const attachmentPaths = optimisticMessage.attachments
    .map((attachment) => (
      normalizeUserMessageText(attachment.absolutePath)
      || normalizeUserMessageText(attachment.relativePath)
      || normalizeUserMessageText(attachment.name)
    ))
    .filter(Boolean);

  return attachmentPaths.length > 0
    && attachmentPaths.every((attachmentPath) => persistedContent.includes(attachmentPath));
}

/**
 * Detect stale local user bubbles that contain only provider-facing upload notes.
 */
function isUploadNoteOnlyUserMessage(message: ChatMessage): boolean {
  if (message.type !== 'user') {
    return false;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  const markerIndex = content.indexOf(USER_UPLOAD_NOTE_MARKER);
  if (markerIndex < 0) {
    return false;
  }

  const visibleText = content.slice(0, markerIndex).trim();
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  return !visibleText && !hasAttachments;
}

/**
 * Check whether a persisted transcript entry confirms an optimistic user send.
 */
function isPersistedUserMessageMatch(optimisticMessage: ChatMessage, persistedMessage: ChatMessage): boolean {
  if (optimisticMessage.type !== 'user' || persistedMessage.type !== 'user') {
    return false;
  }

  if (
    typeof optimisticMessage.clientRequestId === 'string'
    && optimisticMessage.clientRequestId
    && optimisticMessage.clientRequestId === persistedMessage.clientRequestId
  ) {
    return true;
  }

  const persistedContent = normalizeUserMessageText(persistedMessage.content);
  const optimisticContents = [
    optimisticMessage.content,
    optimisticMessage.submittedContent,
  ].map(normalizeUserMessageText).filter(Boolean);

  return optimisticContents.some((optimisticContent) => (
    isPersistedUserTextMatch(optimisticContent, persistedContent)
  )) || isPersistedAttachmentNoteMatch(optimisticMessage, persistedContent);
}

/**
 * Preserve local user sends until session history confirms or times them out.
 */
interface MessageMergeOptions {
  preservePreviousMessages?: boolean;
}

/**
 * Keep local realtime messages visible while the persisted history catches up.
 */
function shouldPreserveLocalMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    if (isUploadNoteOnlyUserMessage(message)) {
      return false;
    }
    return Boolean(message.deliveryStatus);
  }

  return Boolean(
    message.isStreaming ||
    message.isInteractivePrompt ||
    message.source === 'codex-realtime' ||
    message.source === 'claude-realtime'
  );
}

/**
 * Merge persisted history with local in-flight messages from the same session.
 */
function mergePersistedAndOptimisticMessages(
  persistedMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  options: MessageMergeOptions = {},
): ChatMessage[] {
  const { preservePreviousMessages = true } = options;
  const mergedMessages = [...persistedMessages];
  const matchedPersistedIndexes = new Set<number>();
  const hasPersistedTranscript = persistedMessages.length > 0;

  previousMessages
    .filter((message) => message.type === 'user' && message.deliveryStatus)
    .forEach((optimisticMessage) => {
      let matchIndex = -1;
      for (let index = mergedMessages.length - 1; index >= 0; index -= 1) {
        if (
          !matchedPersistedIndexes.has(index)
          && isPersistedUserMessageMatch(optimisticMessage, mergedMessages[index])
        ) {
          matchIndex = index;
          break;
        }
      }

      if (matchIndex >= 0) {
        matchedPersistedIndexes.add(matchIndex);
        const optimisticAttachments = Array.isArray(optimisticMessage.attachments)
          && optimisticMessage.attachments.length > 0
          ? optimisticMessage.attachments
          : undefined;
        const optimisticContent = typeof optimisticMessage.submittedContent === 'string'
          ? optimisticMessage.submittedContent
          : (typeof optimisticMessage.content === 'string' ? optimisticMessage.content : '');
        mergedMessages[matchIndex] = {
          ...mergedMessages[matchIndex],
          clientRequestId: optimisticMessage.clientRequestId || mergedMessages[matchIndex].clientRequestId,
          content: optimisticContent || mergedMessages[matchIndex].content,
          submittedContent: optimisticMessage.submittedContent || mergedMessages[matchIndex].submittedContent,
          attachments: optimisticAttachments || mergedMessages[matchIndex].attachments,
          deliveryStatus: 'persisted',
        };
        return;
      }

      if (
        !preservePreviousMessages
        || isUploadNoteOnlyUserMessage(optimisticMessage)
        || (hasPersistedTranscript && optimisticMessage.deliveryStatus === 'persisted')
      ) {
        return;
      }

      mergedMessages.push(optimisticMessage);
    });

  // Preserve transient assistant messages (streaming, interactive prompts, etc.)
  // that have not yet been persisted to session history.
  const persistedKeys = new Set(
    persistedMessages.map((m) => getIntrinsicMessageKey(m)).filter((k): k is string => Boolean(k)),
  );

  previousMessages.forEach((message) => {
    if (message.type === 'user' && message.deliveryStatus) {
      return;
    }

    if (!preservePreviousMessages || !shouldPreserveLocalMessage(message)) {
      return;
    }

    const key = getIntrinsicMessageKey(message);
    if (key && persistedKeys.has(key)) {
      return;
    }

    mergedMessages.push(message);
  });

  return dedupeAdjacentChatMessages(mergedMessages) as ChatMessage[];
}

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  sendMessage: (message: unknown) => void;
  isFollowingLatest?: boolean;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<string>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
}

type LoadAllMessagesOptions = {
  reveal?: boolean;
  silent?: boolean;
};

interface ScrollRestoreState {
  height: number;
  top: number;
}

/**
 * Temporary route ids represent an unsaved new-session draft view.
 */
function isTemporarySessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId));
}

/**
 * Resolve the provider from explicit metadata first, then project session membership.
 */
function resolveSessionProvider(
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): SessionProvider | null {
  const explicitProvider = selectedSession?.__provider || selectedSession?.provider;
  if (explicitProvider === 'claude' || explicitProvider === 'codex' || explicitProvider === 'opencode') {
    return explicitProvider;
  }

  const sessionId = selectedSession?.id;
  if (!selectedProject || !sessionId) {
    return null;
  }

  if ((selectedProject.codexSessions || []).some((session) => session.id === sessionId)) {
    return 'codex';
  }

  if ((selectedProject.opencodeSessions || []).some((session) => session.id === sessionId)) {
    return 'opencode';
  }

  if ((selectedProject.sessions || []).some((session) => session.id === sessionId)) {
    return 'claude';
  }

  return null;
}

/**
 * Resolve the backend project name for a session.
 */
function getSessionProjectName(selectedProject: Project | null, selectedSession: ProjectSession | null): string {
  if (resolveSessionProvider(selectedProject, selectedSession) === 'codex') {
    return selectedProject?.name || '';
  }

  if (typeof selectedSession?.__projectName === 'string' && selectedSession.__projectName) {
    return selectedSession.__projectName;
  }

  return selectedProject?.name || '';
}

/**
 * Resolve a stable key for anchoring a frozen transcript tail.
 */
function getViewMessageKey(message: ChatMessage, index: number): string {
  return getIntrinsicMessageKey(message) || `message-position-${index}`;
}

export function useChatSessionState({
  selectedProject,
  selectedSession,
  sendMessage,
  isFollowingLatest = false,
  autoScrollToBottom,
  externalMessageUpdate,
  processingSessions,
  resetStreamingState,
  pendingViewSessionRef,
}: UseChatSessionStateArgs) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      const saved = safeLocalStorage.getItem(`chat_messages_${selectedProject.name}`);
      if (saved) {
        try {
          return dedupeAdjacentChatMessages(JSON.parse(saved) as ChatMessage[]) as ChatMessage[];
        } catch {
          console.error('Failed to parse saved chat messages, resetting');
          safeLocalStorage.removeItem(`chat_messages_${selectedProject.name}`);
          return [];
        }
      }
      return [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, setTokenBudget] = useState<Record<string, unknown> | null>(null);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean } | null>(null);
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);
  const [isLoadingAllMessages, setIsLoadingAllMessages] = useState(false);
  const [loadAllJustFinished, setLoadAllJustFinished] = useState(false);
  const [showLoadAllOverlay, setShowLoadAllOverlay] = useState(false);
  const [frozenTailMessageKey, setFrozenTailMessageKey] = useState<string | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const allMessagesLoadedRef = useRef(false);
  const isLoadingAllMessagesRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const loadAllFinishedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic counter to discard stale loadSessionMessages results when sessions change quickly.
  const sessionLoadGenRef = useRef(0);
  const loadAllOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionMessagesRef = useRef<any[]>(sessionMessages);
  const chatMessagesRef = useRef<ChatMessage[]>(chatMessages);
  const totalMessagesRef = useRef(totalMessages);
  const isUserScrolledUpRef = useRef(isUserScrolledUp);
  const lastHydratedSessionIdRef = useRef<string | null>(null);
  const chatMergeSessionKeyRef = useRef<string | null>(null);
  const previousSelectedSessionIdRef = useRef<string | null>(null);
  const frozenTailMessageKeyRef = useRef<string | null>(null);
  const latestTouchYRef = useRef<number | null>(null);
  const refreshLatestMessagesRef = useRef<() => Promise<void>>(async () => {});
  sessionMessagesRef.current = sessionMessages;
  chatMessagesRef.current = chatMessages;
  totalMessagesRef.current = totalMessages;
  isUserScrolledUpRef.current = isUserScrolledUp;
  frozenTailMessageKeyRef.current = frozenTailMessageKey;

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  /**
   * Fetch a session message window without mutating local pagination state.
   */
  const fetchSessionMessages = useCallback(
    async (
      projectName: string,
      sessionId: string,
      limit: number | null,
      offset = 0,
      provider: string = 'claude',
      afterLine: number | null = null,
    ) => {
      if (!projectName || !sessionId) {
        return {
          messages: [] as any[],
          total: 0,
          hasMore: false,
          tokenUsage: null as Record<string, unknown> | null,
        };
      }

      try {
        const response = await (api.sessionMessages as any)(
          projectName,
          sessionId,
          limit,
          offset,
          provider,
          afterLine,
        );
        if (!response.ok) {
          throw new Error('Failed to load session messages');
        }

        const data = await response.json();
        const messages = Array.isArray(data?.messages)
          ? data.messages
          : (Array.isArray(data) ? data : []);

        return {
          messages,
          total: Number.isFinite(Number(data?.total)) ? Number(data.total) : messages.length,
          hasMore: Boolean(data?.hasMore),
          tokenUsage: (data?.tokenUsage || null) as Record<string, unknown> | null,
        };
      } catch (error) {
        console.error('Error loading session messages:', error);
        return {
          messages: [] as any[],
          total: 0,
          hasMore: false,
          tokenUsage: null as Record<string, unknown> | null,
        };
      }
    },
    [],
  );

  const loadSessionMessages = useCallback(
    async (projectName: string, sessionId: string, loadMore = false, provider: string = 'claude') => {
      const isInitialLoad = !loadMore;
      if (isInitialLoad) {
        setIsLoadingSessionMessages(true);
      } else {
        setIsLoadingMoreMessages(true);
      }

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const result = await fetchSessionMessages(
          projectName,
          sessionId,
          MESSAGES_PER_PAGE,
          currentOffset,
          provider,
        );
        if (isInitialLoad && result.tokenUsage) {
          setTokenBudget(result.tokenUsage);
        }

        if (result.total > 0 || result.hasMore) {
          const loadedCount = result.messages.length;
          setHasMoreMessages(result.total > 0 ? result.total > currentOffset + loadedCount : result.hasMore);
          setTotalMessages(result.total > 0 ? result.total : loadedCount);
          messagesOffsetRef.current = currentOffset + loadedCount;
          return result.messages;
        }

        const messages = result.messages;
        setHasMoreMessages(false);
        setTotalMessages(messages.length);
        messagesOffsetRef.current = messages.length;
        return messages;
      } finally {
        if (isInitialLoad) {
          setIsLoadingSessionMessages(false);
        } else {
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [fetchSessionMessages],
  );

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    frozenTailMessageKeyRef.current = null;
    isUserScrolledUpRef.current = false;
    setFrozenTailMessageKey(null);
    setIsUserScrolledUp(false);
    void refreshLatestMessagesRef.current().finally(() => {
      window.requestAnimationFrame(scrollToBottom);
    });
    scrollToBottom();
    if (allMessagesLoaded && !Number.isFinite(visibleMessageCount)) {
      setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    }
  }, [allMessagesLoaded, scrollToBottom, visibleMessageCount]);

  /**
   * Reset the visible chat view before a different concrete session hydrates.
   */
  const resetSessionViewState = useCallback(() => {
    resetStreamingState();
    pendingViewSessionRef.current = null;
    chatMergeSessionKeyRef.current = null;
    setChatMessages([]);
    setSessionMessages([]);
    setIsLoading(false);
    setIsLoadingSessionMessages(false);
    setIsLoadingMoreMessages(false);
    setClaudeStatus(null);
    setCanAbortSession(false);
    setTokenBudget(null);
    messagesOffsetRef.current = 0;
    setHasMoreMessages(false);
    setTotalMessages(0);
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setAllMessagesLoaded(false);
    allMessagesLoadedRef.current = false;
    setIsLoadingAllMessages(false);
    isLoadingAllMessagesRef.current = false;
    setLoadAllJustFinished(false);
    setShowLoadAllOverlay(false);
    setFrozenTailMessageKey(null);
    if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
    pendingInitialScrollRef.current = false;
    pendingScrollRestoreRef.current = null;
    topLoadLockRef.current = false;
  }, [pendingViewSessionRef, resetStreamingState]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const isAtHardBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    return container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
  }, []);

  const freezeTailAtCurrentEnd = useCallback(() => {
    if (isFollowingLatest || isAtHardBottom() || frozenTailMessageKeyRef.current) {
      return false;
    }

    const messages = chatMessagesRef.current;
    const lastIndex = messages.length - 1;
    if (lastIndex < 0) {
      return false;
    }

    setFrozenTailMessageKey(getViewMessageKey(messages[lastIndex], lastIndex));
    return true;
  }, [isAtHardBottom, isFollowingLatest]);

  const releaseFrozenTail = useCallback(() => {
    if (!frozenTailMessageKeyRef.current && !isUserScrolledUpRef.current) {
      return;
    }

    frozenTailMessageKeyRef.current = null;
    isUserScrolledUpRef.current = false;
    setFrozenTailMessageKey(null);
    setIsUserScrolledUp(false);
    void refreshLatestMessagesRef.current().finally(() => {
      window.requestAnimationFrame(scrollToBottom);
    });
    window.requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }
      if (allMessagesLoadedRef.current) return false;
      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = resolveSessionProvider(selectedProject, selectedSession) || 'claude';
      const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const moreMessages = await loadSessionMessages(
          sessionProjectName,
          selectedSession.id,
          true,
          sessionProvider,
        );

        if (moreMessages.length === 0) {
          return false;
        }

        const uniqueMoreMessages = getUniqueIncomingSessionMessages(
          sessionMessagesRef.current,
          moreMessages,
        );

        if (uniqueMoreMessages.length === 0) {
          setHasMoreMessages(totalMessagesRef.current > messagesOffsetRef.current);
          return false;
        }

        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop,
        };
        setHasMoreMessages(totalMessagesRef.current > messagesOffsetRef.current);
        setSessionMessages((previous) => dedupeSessionMessagesByIdentity([
          ...uniqueMoreMessages,
          ...previous,
        ]));
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + uniqueMoreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [hasMoreMessages, isLoadingMoreMessages, loadSessionMessages, selectedProject, selectedSession],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const hardBottom = isAtHardBottom();
    const didFreeze = !hardBottom ? freezeTailAtCurrentEnd() : false;
    const nextIsUserScrolledUp = !hardBottom || didFreeze || Boolean(frozenTailMessageKeyRef.current);
    isUserScrolledUpRef.current = nextIsUserScrolledUp;
    setIsUserScrolledUp(nextIsUserScrolledUp);

    if (!allMessagesLoadedRef.current) {
      const scrolledNearTop = container.scrollTop < 100;
      if (!scrolledNearTop) {
        topLoadLockRef.current = false;
        return;
      }

      if (topLoadLockRef.current) {
        if (container.scrollTop > 20) {
          topLoadLockRef.current = false;
        }
        return;
      }

      const didLoad = await loadOlderMessages(container);
      if (didLoad) {
        topLoadLockRef.current = true;
      }
    }
  }, [freezeTailAtCurrentEnd, isAtHardBottom, loadOlderMessages]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY > 0 && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  const handleTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    latestTouchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY ?? null;
    const previousY = latestTouchYRef.current;
    latestTouchYRef.current = currentY;
    if (currentY === null || previousY === null) {
      return;
    }

    const isTryingToScrollDown = previousY - currentY > 0;
    if (isTryingToScrollDown && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollDownKeys = new Set(['ArrowDown', 'PageDown', 'End', ' ']);
    if (scrollDownKeys.has(event.key) && isAtHardBottom()) {
      releaseFrozenTail();
    }
  }, [isAtHardBottom, releaseFrozenTail]);

  useLayoutEffect(() => {
    const temporarySessionId = selectedSession?.id;
    if (isTemporarySessionId(temporarySessionId)) {
      const temporaryViewSessionId = temporarySessionId ?? null;
      if (lastHydratedSessionIdRef.current !== temporaryViewSessionId) {
        resetSessionViewState();
      }
      lastHydratedSessionIdRef.current = temporaryViewSessionId;
      setCurrentSessionId(temporaryViewSessionId);
      return;
    }

    const nextSessionId = selectedSession?.id ?? null;
    const previousSessionId = previousSelectedSessionIdRef.current;
    previousSelectedSessionIdRef.current = nextSessionId;
    if (!nextSessionId || previousSessionId === nextSessionId) {
      return;
    }

    lastHydratedSessionIdRef.current = null;
    const hasLiveCodexRealtimeTail =
      selectedSession?.__provider === 'codex' &&
      chatMessagesRef.current.some((message) => message.source === 'codex-realtime');
    const isPromotingTemporarySession =
      isSystemSessionChange &&
      isTemporarySessionId(currentSessionId) &&
      !isTemporarySessionId(nextSessionId);
    if (!isPromotingTemporarySession || !hasLiveCodexRealtimeTail) {
      resetSessionViewState();
    }

    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const scrollDiff = newScrollHeight - height;
    container.scrollTop = top + Math.max(scrollDiff, 0);
    pendingScrollRestoreRef.current = null;
  }, [
    currentSessionId,
    isSystemSessionChange,
    pendingScrollRestoreRef,
    resetSessionViewState,
    selectedSession?.__provider,
    selectedSession?.id,
  ]);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    topLoadLockRef.current = false;
    pendingScrollRestoreRef.current = null;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
  }, [selectedProject?.name, selectedSession?.id]);

  useLayoutEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      return;
    }

    pendingInitialScrollRef.current = false;
    scrollToBottom();
    const animationFrameId = requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [chatMessages.length, isLoadingSessionMessages, scrollToBottom]);

  // 用 ref 持有最新的 selectedProject / selectedSession，effect 通过 ref 读取，
  // 依赖只关注 name/id，避免 projects_updated 导致对象引用变化时反复重载消息。
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;

  useEffect(() => {
    // Bump generation so any in-flight loadSessionMessages from a previous session is discarded.
    const gen = ++sessionLoadGenRef.current;
    const curProject = selectedProjectRef.current;
    const curSession = selectedSessionRef.current;

    const loadMessages = async () => {
      if (curSession && curProject) {
        if (isTemporarySessionId(curSession.id)) {
          setCurrentSessionId(curSession.id);
          return;
        }

        const sessionProvider = resolveSessionProvider(curProject, curSession) || 'claude';
        const sessionProjectName = getSessionProjectName(curProject, curSession);
        isLoadingSessionRef.current = true;

        const sessionChanged = currentSessionId !== null && currentSessionId !== curSession.id;
        const shouldResetForConcreteSessionSwitch = sessionChanged && !isTemporarySessionId(currentSessionId);
        const needsFreshSessionView = lastHydratedSessionIdRef.current !== curSession.id;
        const shouldResetForSessionLoad = shouldResetForConcreteSessionSwitch || needsFreshSessionView;
        if (sessionChanged || needsFreshSessionView) {
          const isDraftToConcreteSessionHandoff =
            sessionChanged &&
            Boolean(currentSessionId) &&
            isTemporarySessionId(currentSessionId) &&
            !isTemporarySessionId(curSession.id);
          const hasLiveCodexRealtimeTail =
            sessionProvider === 'codex' &&
            chatMessagesRef.current.some((message) => message.source === 'codex-realtime');
          const hasUnconfirmedUserDelivery = chatMessagesRef.current.some((message) => (
            message.type === 'user' &&
            Boolean(message.deliveryStatus) &&
            message.deliveryStatus !== 'persisted'
          ));
          if (!isSystemSessionChange || shouldResetForSessionLoad) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            /**
             * PURPOSE: A new manual session first lives on a stable `/cN` draft
             * route, then receives the provider's real session id before jsonl is
             * guaranteed to exist. Keep the local user send visible through that
             * handoff so persisted history can later confirm or fail it.
             */
            if (!hasLiveCodexRealtimeTail && !(isDraftToConcreteSessionHandoff && hasUnconfirmedUserDelivery)) {
              setChatMessages([]);
            }
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
          }

          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);
          setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
          setAllMessagesLoaded(false);
          allMessagesLoadedRef.current = false;
          setFrozenTailMessageKey(null);
          setIsLoadingAllMessages(false);
          isLoadingAllMessagesRef.current = false;
          setLoadAllJustFinished(false);
          setShowLoadAllOverlay(false);
          if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          setTokenBudget(null);
          setIsLoading(false);

          // Always send check-session-status via sendMessage (which handles queuing
          // when WebSocket is temporarily disconnected) instead of gating on the ws
          // object which may be stale in the useMemo closure.
          sendMessage({
            type: 'check-session-status',
            sessionId: curSession.id,
            provider: sessionProvider,
          });
        } else if (currentSessionId === null) {
          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setTotalMessages(0);

          sendMessage({
            type: 'check-session-status',
            sessionId: curSession.id,
            provider: sessionProvider,
          });
        }

        setCurrentSessionId(curSession.id);

        if (!isSystemSessionChange || shouldResetForSessionLoad) {
          const messages = await loadSessionMessages(
            sessionProjectName,
            curSession.id,
            false,
            sessionProvider,
          );
          // Discard stale result: another session switch happened while we were loading.
          if (sessionLoadGenRef.current !== gen) {
            return;
          }
          lastHydratedSessionIdRef.current = curSession.id;
          setSessionMessages(messages);
        } else {
          setIsSystemSessionChange(false);
        }
      } else {
        if (!isSystemSessionChange) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
          setSessionMessages([]);
          setClaudeStatus(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }

        lastHydratedSessionIdRef.current = null;
        setCurrentSessionId(null);
        messagesOffsetRef.current = 0;
        setHasMoreMessages(false);
        setTotalMessages(0);
        setFrozenTailMessageKey(null);
        setTokenBudget(null);
      }

      setTimeout(() => {
        isLoadingSessionRef.current = false;
      }, 250);
    };

    loadMessages();
  }, [
    // 只关注标识变化，不关注对象引用变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedProject?.name,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    selectedSession?.id,
    isSystemSessionChange,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    sendMessage,
  ]);

  const appendLatestSessionMessages = useCallback(async () => {
    const curProject = selectedProjectRef.current;
    const curSession = selectedSessionRef.current;
    if (!curSession || !curProject) {
      return;
    }

    const gen = sessionLoadGenRef.current;
    try {
      const sessionProjectName = getSessionProjectName(curProject, curSession);
      const knownTotal = totalMessagesRef.current;
      const result = await fetchSessionMessages(
        sessionProjectName,
        curSession.id,
        null,
        0,
        resolveSessionProvider(curProject, curSession) || 'claude',
        knownTotal,  // afterLine: 只返回第 knownTotal 行之后的新内容
      );
      // Discard if user navigated away from this session while loading.
      if (sessionLoadGenRef.current !== gen) {
        return;
      }

      const newMessages = result.messages;
      const newTotal = result.total > 0
        ? result.total
        : Math.max(knownTotal, knownTotal + newMessages.length);

      if (newMessages.length === 0 && newTotal === knownTotal) {
        return;
      }

      if (result.tokenUsage) {
        setTokenBudget(result.tokenUsage);
      }

      if (newMessages.length > 0) {
        if (frozenTailMessageKeyRef.current || isUserScrolledUpRef.current) {
          return;
        }

        const uniqueNewMessages = getUniqueIncomingSessionMessages(
          sessionMessagesRef.current,
          newMessages,
        );
        if (uniqueNewMessages.length === 0) {
          setTotalMessages(newTotal);
          return;
        }

        setSessionMessages((previous) => dedupeSessionMessagesByIdentity([
          ...previous,
          ...uniqueNewMessages,
        ]));
        messagesOffsetRef.current += uniqueNewMessages.length;
        if (!frozenTailMessageKeyRef.current) {
          setVisibleMessageCount((previousCount) =>
            Number.isFinite(previousCount) ? previousCount + uniqueNewMessages.length : previousCount,
          );
        }
      }

      setTotalMessages(newTotal);

      // hasMore 取决于用户已加载的历史头部是否还有更早内容
      const totalLoaded = sessionMessagesRef.current.length + newMessages.length;
      if (newTotal > totalLoaded) {
        setHasMoreMessages(true);
      }

      if (allMessagesLoadedRef.current && newTotal > totalLoaded) {
        allMessagesLoadedRef.current = false;
        setAllMessagesLoaded(false);
      }
    } catch (error) {
      console.error('Error appending messages from external update:', error);
    }
  }, [fetchSessionMessages]);

  useEffect(() => {
    refreshLatestMessagesRef.current = appendLatestSessionMessages;
  }, [appendLatestSessionMessages]);

  // 外部消息更新（终端 Claude 写入 .jsonl 触发 projects_updated）时，
  // 外部消息更新：用已知行数作为游标，只拉取新增行直接 append。
  // JSONL 是 append-only 的，行号天然单调递增，不需要签名对比。
  useEffect(() => {
    if (!externalMessageUpdate) {
      return;
    }

    void appendLatestSessionMessages();
    // 通过 ref 读取 project/session，依赖不包含对象引用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appendLatestSessionMessages,
    externalMessageUpdate,
  ]);

  useEffect(() => {
    if (selectedSession?.id && !isTemporarySessionId(selectedSession.id)) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);

  useEffect(() => {
    const activeSessionId = selectedSession?.id ?? currentSessionId;
    const activeSessionKey = activeSessionId
      ? [
        getSessionProjectName(selectedProject, selectedSession),
        resolveSessionProvider(selectedProject, selectedSession) || 'claude',
        activeSessionId,
      ].join(':')
      : null;

    if (
      selectedSession?.id &&
      !isTemporarySessionId(selectedSession.id) &&
      lastHydratedSessionIdRef.current !== selectedSession.id
    ) {
      chatMergeSessionKeyRef.current = null;
      setChatMessages([]);
      return;
    }

    const preservePreviousMessages =
      Boolean(activeSessionKey) &&
      chatMergeSessionKeyRef.current === activeSessionKey;
    chatMergeSessionKeyRef.current = activeSessionKey;

    setChatMessages((previous) => mergePersistedAndOptimisticMessages(
      convertedMessages,
      previous,
      { preservePreviousMessages },
    ));
  }, [
    convertedMessages,
    currentSessionId,
    selectedProject,
    selectedSession,
  ]);

  useEffect(() => {
    if (selectedProject && chatMessages.length > 0) {
      const dedupedMessages = dedupeAdjacentChatMessages(chatMessages) as ChatMessage[];
      safeLocalStorage.setItem(`chat_messages_${selectedProject.name}`, JSON.stringify(dedupedMessages));
    }
  }, [chatMessages, selectedProject]);

  useEffect(() => {
    if (!selectedProject || !selectedSession?.id || isTemporarySessionId(selectedSession.id)) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = resolveSessionProvider(selectedProject, selectedSession);
    if (!sessionProvider) {
      setTokenBudget(null);
      return;
    }
    const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${sessionProjectName}/sessions/${selectedSession.id}/token-usage?provider=${encodeURIComponent(sessionProvider)}`;
        const response = await authenticatedFetch(url);
        if (response.status === 204) {
          setTokenBudget(null);
        } else if (response.ok) {
          const data = await response.json();
          setTokenBudget(data);
        } else {
          setTokenBudget(null);
        }
      } catch (error) {
        console.error('Failed to fetch initial token usage:', error);
      }
    };

    fetchInitialTokenUsage();
  }, [selectedProject, selectedSession?.id, selectedSession?.__projectName, selectedSession?.__provider, selectedSession?.provider]);

  const visibleMessages = useMemo(() => {
    const displayMessages = dedupeAdjacentChatMessages(chatMessages) as ChatMessage[];
    const visibleCount = Number.isFinite(visibleMessageCount)
      ? Math.max(0, visibleMessageCount)
      : displayMessages.length;
    let endIndex = displayMessages.length;

    if (frozenTailMessageKey) {
      const frozenIndex = displayMessages.findIndex((message, index) =>
        getViewMessageKey(message, index) === frozenTailMessageKey,
      );
      if (frozenIndex >= 0) {
        endIndex = frozenIndex + 1;
      }
    }

    if (endIndex <= visibleCount) {
      return displayMessages.slice(0, endIndex);
    }
    return displayMessages.slice(endIndex - visibleCount, endIndex);
  }, [chatMessages, frozenTailMessageKey, visibleMessageCount]);

  useEffect(() => {
    if (isFollowingLatest) {
      setFrozenTailMessageKey(null);
    }
  }, [isFollowingLatest]);

  // 消息追加（底部增长）不需要调整 scrollTop——浏览器天然保持上方内容位置。
  // 加载更早的历史消息（顶部增长）由 pendingScrollRestoreRef + useLayoutEffect 处理。

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const activeViewSessionId = selectedSession?.id || currentSessionId;
    if (!activeViewSessionId || !processingSessions) {
      return;
    }

    const shouldBeProcessing = processingSessions.has(activeViewSessionId);
    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, processingSessions, selectedSession?.id]);

  // Show "Load all" overlay after a batch finishes loading, persist for 2s then hide
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = isLoadingMoreMessages;

    if (wasLoading && !isLoadingMoreMessages && hasMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(true);
      loadAllOverlayTimerRef.current = setTimeout(() => {
        setShowLoadAllOverlay(false);
      }, 2000);
    }
    if (!hasMoreMessages && !isLoadingMoreMessages) {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
      setShowLoadAllOverlay(false);
    }
    return () => {
      if (loadAllOverlayTimerRef.current) clearTimeout(loadAllOverlayTimerRef.current);
    };
  }, [isLoadingMoreMessages, hasMoreMessages]);

  const loadAllMessages = useCallback(async (options: LoadAllMessagesOptions = {}) => {
    if (!selectedSession || !selectedProject) return;
    if (isLoadingAllMessagesRef.current) return;
    const { reveal = true, silent = false } = options;
    const sessionProvider = resolveSessionProvider(selectedProject, selectedSession) || 'claude';
    const sessionProjectName = getSessionProjectName(selectedProject, selectedSession);

    const requestSessionId = selectedSession.id;

    allMessagesLoadedRef.current = true;
    isLoadingMoreRef.current = true;
    isLoadingAllMessagesRef.current = true;
    if (!silent) {
      setIsLoadingAllMessages(true);
    }
    if (!silent) {
      setShowLoadAllOverlay(true);
    }

    const container = scrollContainerRef.current;
    const previousScrollHeight = container ? container.scrollHeight : 0;
    const previousScrollTop = container ? container.scrollTop : 0;

    try {
      const response = await (api.sessionMessages as any)(
        sessionProjectName,
        requestSessionId,
        null,
        0,
        sessionProvider,
      );

      if (currentSessionId !== requestSessionId) return;

      if (response.ok) {
        const data = await response.json();
        const allMessages = data.messages || data;

        if (container) {
          pendingScrollRestoreRef.current = {
            height: previousScrollHeight,
            top: previousScrollTop,
          };
        }

        setSessionMessages(Array.isArray(allMessages) ? allMessages : []);
        setHasMoreMessages(false);
        setTotalMessages(Array.isArray(allMessages) ? allMessages.length : 0);
        messagesOffsetRef.current = Array.isArray(allMessages) ? allMessages.length : 0;

        if (reveal) {
          setVisibleMessageCount(Infinity);
          setFrozenTailMessageKey(null);
        }
        setAllMessagesLoaded(true);

        if (!silent) {
          setLoadAllJustFinished(true);
          if (loadAllFinishedTimerRef.current) clearTimeout(loadAllFinishedTimerRef.current);
          loadAllFinishedTimerRef.current = setTimeout(() => {
            setLoadAllJustFinished(false);
            setShowLoadAllOverlay(false);
          }, 1000);
        }
      } else {
        allMessagesLoadedRef.current = false;
        setShowLoadAllOverlay(false);
      }
    } catch (error) {
      console.error('Error loading all messages:', error);
      allMessagesLoadedRef.current = false;
      setShowLoadAllOverlay(false);
    } finally {
      isLoadingMoreRef.current = false;
      isLoadingAllMessagesRef.current = false;
      if (!silent) {
        setIsLoadingAllMessages(false);
      }
    }
  }, [selectedSession, selectedProject, currentSessionId]);

  const loadEarlierMessages = useCallback(() => {
    setVisibleMessageCount((previousCount) => previousCount + 100);
  }, []);

  return {
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
    isNearBottom,
    isAtHardBottom,
    handleScroll,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleKeyDown,
    loadSessionMessages,
  };
}
