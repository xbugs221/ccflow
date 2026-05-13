/**
 * Type declarations for shared/socket-message-utils.js
 */

export interface SocketMessageEntry {
  sequence?: number;
  message?: unknown;
}

export interface ProjectsUpdatedMessage {
  type: string;
  projects?: Array<Record<string, unknown>>;
  changedFile?: string;
}

export interface ReduceProjectsUpdatedParams {
  messages: Array<ProjectsUpdatedMessage>;
  projects: Array<Record<string, unknown>>;
  selectedProject: Record<string, unknown> | null;
  selectedSession: Record<string, unknown> | null;
  activeSessions: Set<string>;
  getProjectSessions: (project: Record<string, unknown>) => Array<Record<string, unknown>>;
  isUpdateAdditive: (
    currentProjects: Array<Record<string, unknown>>,
    updatedProjects: Array<Record<string, unknown>>,
    selectedProject: Record<string, unknown> | null,
    selectedSession: Record<string, unknown> | null,
  ) => boolean;
}

export interface ReduceProjectsUpdatedResult {
  projects: Array<Record<string, unknown>>;
  selectedProject: Record<string, unknown> | null;
  selectedSession: Record<string, unknown> | null;
  externalMessageUpdateCount: number;
}

export declare function getMessageHistoryTailSequence(messageHistory: Array<SocketMessageEntry>): number;
export interface PendingSocketMessageEntry {
  sequence: number;
  message?: unknown;
}

export declare function getPendingSocketMessages(
  messageHistory: Array<SocketMessageEntry>,
  lastProcessedSequence: number,
): Array<PendingSocketMessageEntry>;
export declare function reduceProjectsUpdatedMessages(params: ReduceProjectsUpdatedParams): ReduceProjectsUpdatedResult;
