/**
 * PURPOSE: Shared helpers for ordered WebSocket message consumption.
 * These utilities keep realtime consumers aligned on how to skip historical backlog,
 * select pending messages, and apply batched project updates without losing ordering.
 */

/**
 * Return the latest processed sequence number from a message history snapshot.
 * Consumers use this to avoid replaying stale messages after a remount.
 *
 * @param {Array<{sequence?: number}>} messageHistory
 * @returns {number}
 */
export function getMessageHistoryTailSequence(messageHistory) {
  if (!Array.isArray(messageHistory) || messageHistory.length === 0) {
    return 0;
  }

  const tailSequence = messageHistory[messageHistory.length - 1]?.sequence;
  return Number.isFinite(tailSequence) ? tailSequence : 0;
}

/**
 * Collect socket messages that have not been processed yet.
 *
 * @param {Array<{sequence?: number, message?: unknown}>} messageHistory
 * @param {number} lastProcessedSequence
 * @returns {Array<{sequence: number, message: unknown}>}
 */
export function getPendingSocketMessages(messageHistory, lastProcessedSequence) {
  if (!Array.isArray(messageHistory) || messageHistory.length === 0) {
    return [];
  }

  return messageHistory.filter((entry) => {
    const sequence = entry?.sequence;
    return Number.isFinite(sequence) && sequence > lastProcessedSequence;
  });
}

/**
 * Apply a batch of `projects_updated` messages using evolving local snapshots.
 * This preserves ordering when multiple project payloads arrive before React rerenders.
 *
 * @param {Object} params
 * @param {Array<Record<string, any>>} params.messages
 * @param {Array<Record<string, any>>} params.projects
 * @param {Record<string, any> | null} params.selectedProject
 * @param {Record<string, any> | null} params.selectedSession
 * @param {Set<string>} params.activeSessions
 * @param {(project: Record<string, any>) => Array<Record<string, any>>} params.getProjectSessions
 * @param {(currentProjects: Array<Record<string, any>>, updatedProjects: Array<Record<string, any>>, selectedProject: Record<string, any> | null, selectedSession: Record<string, any> | null) => boolean} params.isUpdateAdditive
 * @returns {{
 *   projects: Array<Record<string, any>>,
 *   selectedProject: Record<string, any> | null,
 *   selectedSession: Record<string, any> | null,
 *   externalMessageUpdateCount: number
 * }}
 */
export function reduceProjectsUpdatedMessages({
  messages,
  projects,
  selectedProject,
  selectedSession,
  activeSessions,
  getProjectSessions,
  isUpdateAdditive,
}) {
  let currentProjects = Array.isArray(projects) ? projects : [];
  let currentSelectedProject = selectedProject || null;
  let currentSelectedSession = selectedSession || null;
  let externalMessageUpdateCount = 0;

  const isTemporarySessionId = (sessionId) =>
    typeof sessionId === 'string' && (sessionId.startsWith('new-session-') || /^c\d+$/.test(sessionId));

  for (const latestMessage of Array.isArray(messages) ? messages : []) {
    if (!latestMessage || latestMessage.type !== 'projects_updated') {
      continue;
    }

    if (!Array.isArray(latestMessage.projects)) {
      continue;
    }

    if (latestMessage.changedFile && currentSelectedSession && currentSelectedProject) {
      const normalized = String(latestMessage.changedFile).replace(/\\/g, '/');
      const changedFileParts = normalized.split('/');

      if (changedFileParts.length >= 2) {
        const filename = changedFileParts[changedFileParts.length - 1];
        const changedSessionId = filename.replace('.jsonl', '');

        if (changedSessionId === currentSelectedSession.id && !activeSessions.has(currentSelectedSession.id)) {
          externalMessageUpdateCount += 1;
        }
      }
    }

    const hasActiveSession =
      (currentSelectedSession && activeSessions.has(currentSelectedSession.id)) ||
      Array.from(activeSessions).some((id) => isTemporarySessionId(id));

    const updatedProjects = latestMessage.projects;

    if (
      hasActiveSession &&
      !isUpdateAdditive(
        currentProjects,
        updatedProjects,
        currentSelectedProject,
        currentSelectedSession,
      )
    ) {
      continue;
    }

    currentProjects = updatedProjects;

    if (!currentSelectedProject) {
      continue;
    }

    const updatedSelectedProject = updatedProjects.find(
      (project) => project.name === currentSelectedProject?.name,
    );

    if (!updatedSelectedProject) {
      continue;
    }

    currentSelectedProject = updatedSelectedProject;

    if (!currentSelectedSession) {
      continue;
    }

    const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
      (session) => session.id === currentSelectedSession?.id,
    );

    /**
     * Keep temporary manual sessions stable while background project refreshes
     * stream in. They are route-backed client placeholders, so they do not
     * appear in `projects_updated` payloads until the backend creates a real
     * session id.
     */
    if (!updatedSelectedSession && isTemporarySessionId(currentSelectedSession?.id)) {
      continue;
    }

    /**
     * A projects_updated payload is a sidebar snapshot, not an authoritative
     * instruction to close the currently open chat. The selected session can be
     * absent because the refreshed list is paginated or because another session
     * changed recency. Preserve the open chat to avoid clearing and rehydrating
     * the message pane on unrelated background updates.
     */
    if (!updatedSelectedSession && currentSelectedSession) {
      continue;
    }

    currentSelectedSession = updatedSelectedSession || null;
  }

  return {
    projects: currentProjects,
    selectedProject: currentSelectedProject,
    selectedSession: currentSelectedSession,
    externalMessageUpdateCount,
  };
}
