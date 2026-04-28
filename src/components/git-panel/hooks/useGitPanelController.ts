/** PURPOSE: Centralize Git panel data loading, operations, refresh, and error state. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { DEFAULT_BRANCH, RECENT_COMMITS_LIMIT } from '../constants/constants';
import type {
  GitApiErrorResponse,
  GitBranchesResponse,
  GitCommitSummary,
  GitCommitsResponse,
  GitDiffMap,
  GitDiffResponse,
  GitFileWithDiffResponse,
  GitGenerateMessageResponse,
  GitLocalBranch,
  GitOperationError,
  GitOperationResponse,
  GitPanelController,
  GitRemoteBranch,
  GitRemoteStatus,
  GitStatusResponse,
  UseGitPanelControllerOptions,
} from '../types/types';
import { getAllChangedFiles } from '../utils/gitPanelUtils';
import { useSelectedProvider } from './useSelectedProvider';

const fetchWithAuth = authenticatedFetch as (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Keep Git panel requests pinned to the selected project's real path so
 * hyphenated names do not need to round-trip back into filesystem paths.
 */
function buildGitQuery(projectName: string, projectPath?: string, extraParams: Record<string, string> = {}) {
  const query = new URLSearchParams({ project: projectName });

  if (typeof projectPath === 'string' && projectPath.length > 0) {
    query.set('projectPath', projectPath);
  }

  for (const [key, value] of Object.entries(extraParams)) {
    query.set(key, value);
  }

  return query.toString();
}

function buildGitBody(projectName: string, projectPath?: string, extraFields: Record<string, unknown> = {}) {
  return JSON.stringify({
    project: projectName,
    ...(typeof projectPath === 'string' && projectPath.length > 0 ? { projectPath } : {}),
    ...extraFields,
  });
}

/**
 * Identify user-initiated request cancellation so it does not overwrite state.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Read JSON while respecting an optional AbortSignal.
 */
async function readJson<T>(response: Response, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  const data = (await response.json()) as T;
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  return data;
}

/**
 * Convert API responses into a stable inline error payload.
 */
function toOperationError(data: GitOperationResponse, fallbackOperation: string): GitOperationError {
  return {
    operation: data.operation || fallbackOperation,
    error: data.error || `${fallbackOperation} failed`,
    details: data.details,
  };
}

export function useGitPanelController({
  selectedProject,
  activeView,
  onFileOpen,
}: UseGitPanelControllerOptions): GitPanelController {
  const [gitStatus, setGitStatus] = useState<GitStatusResponse | null>(null);
  const [gitDiff, setGitDiff] = useState<GitDiffMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [localBranches, setLocalBranches] = useState<GitLocalBranch[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitRemoteBranch[]>([]);
  const [operationError, setOperationError] = useState<GitOperationError | null>(null);
  const [recentCommits, setRecentCommits] = useState<GitCommitSummary[]>([]);
  const [commitDiffs, setCommitDiffs] = useState<GitDiffMap>({});
  const [remoteStatus, setRemoteStatus] = useState<GitRemoteStatus | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isCreatingInitialCommit, setIsCreatingInitialCommit] = useState(false);
  const selectedProjectNameRef = useRef<string | null>(selectedProject?.name ?? null);
  const selectedProjectPath = selectedProject?.fullPath || selectedProject?.path || '';

  useEffect(() => {
    selectedProjectNameRef.current = selectedProject?.name ?? null;
  }, [selectedProject]);

  const provider = useSelectedProvider();

  const fetchFileDiff = useCallback(
    async (filePath: string, signal?: AbortSignal) => {
      if (!selectedProject) {
        return;
      }

      const projectName = selectedProject.name;
      try {
        const response = await fetchWithAuth(
          `/api/git/diff?${buildGitQuery(projectName, selectedProjectPath, { file: filePath })}`,
          { signal },
        );
        const data = await readJson<GitDiffResponse>(response, signal);
        if (signal?.aborted || selectedProjectNameRef.current !== projectName) {
          return;
        }

        if (!data.error && typeof data.diff === 'string') {
          setGitDiff((previous) => ({ ...previous, [filePath]: data.diff as string }));
        }
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) {
          return;
        }
        console.error('Error fetching file diff:', error);
      }
    },
    [selectedProject, selectedProjectPath],
  );

  const fetchGitStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!selectedProject) {
        return;
      }

      const projectName = selectedProject.name;
      setIsLoading(true);
      try {
        const response = await fetchWithAuth(`/api/git/status?${buildGitQuery(projectName, selectedProjectPath)}`, { signal });
        const data = await readJson<GitStatusResponse>(response, signal);

        if (signal?.aborted || selectedProjectNameRef.current !== projectName) {
          return;
        }

        if (data.error) {
          setGitStatus({ error: data.error, details: data.details });
          setCurrentBranch('');
          return;
        }

        setGitStatus(data);
        setCurrentBranch(data.branch || DEFAULT_BRANCH);
        const changedFiles = getAllChangedFiles(data);
        changedFiles.forEach((filePath) => {
          void fetchFileDiff(filePath, signal);
        });
      } catch (error) {
        if (signal?.aborted || isAbortError(error) || selectedProjectNameRef.current !== projectName) {
          return;
        }

        console.error('Error fetching git status:', error);
        setGitStatus({ error: 'Git operation failed', details: String(error) });
        setCurrentBranch('');
      } finally {
        if (signal?.aborted || selectedProjectNameRef.current !== projectName) {
          return;
        }
        setIsLoading(false);
      }
    },
    [fetchFileDiff, selectedProject, selectedProjectPath],
  );

  const fetchBranches = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/git/branches?${buildGitQuery(selectedProject.name, selectedProjectPath)}`);
      const data = await readJson<GitBranchesResponse>(response);
      if (!data.error) {
        setLocalBranches(data.localBranches || []);
        setRemoteBranches(data.remoteBranches || []);
        if (data.currentBranch) {
          setCurrentBranch(data.currentBranch);
        }
        return;
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }

    setLocalBranches([]);
    setRemoteBranches([]);
  }, [selectedProject, selectedProjectPath]);

  const fetchRemoteStatus = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(`/api/git/remote-status?${buildGitQuery(selectedProject.name, selectedProjectPath)}`);
      const data = await readJson<GitRemoteStatus | GitApiErrorResponse>(response);
      if (!data.error) {
        setRemoteStatus(data as GitRemoteStatus);
        return;
      }
    } catch (error) {
      console.error('Error fetching remote status:', error);
    }

    setRemoteStatus(null);
  }, [selectedProject, selectedProjectPath]);

  const fetchRecentCommits = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    try {
      const response = await fetchWithAuth(
        `/api/git/commits?${buildGitQuery(selectedProject.name, selectedProjectPath, {
          limit: String(RECENT_COMMITS_LIMIT),
        })}`,
      );
      const data = await readJson<GitCommitsResponse>(response);
      if (!data.error && data.commits) {
        setRecentCommits(data.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  }, [selectedProject, selectedProjectPath]);

  const refreshAll = useCallback(() => {
    void fetchGitStatus();
    void fetchBranches();
    void fetchRemoteStatus();
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus]);

  /**
   * Execute a Git operation, surface structured failures inline, and always
   * refresh panel state afterward so the UI stays coherent.
   */
  const runGitOperation = useCallback(
    async (
      operation: string,
      request: () => Promise<Response>,
      onSuccess?: (data: GitOperationResponse) => void,
    ): Promise<boolean> => {
      try {
        const response = await request();
        const data = await readJson<GitOperationResponse>(response);
        if (data.success) {
          setOperationError(null);
          onSuccess?.(data);
          return true;
        }

        setOperationError(toOperationError(data, operation));
        return false;
      } catch (error) {
        console.error(`Error running ${operation}:`, error);
        setOperationError({
          operation,
          error: `${operation} failed`,
          details: String(error),
        });
        return false;
      } finally {
        refreshAll();
      }
    },
    [refreshAll],
  );

  const switchBranch = useCallback(
    async (branchName: string, startPoint?: string) => {
      if (!selectedProject) {
        return false;
      }

      const success = await runGitOperation(
        'switch branch',
        () =>
          fetchWithAuth('/api/git/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildGitBody(selectedProject.name, selectedProjectPath, {
                branch: branchName,
                ...(startPoint ? { startPoint } : {}),
              }),
          }),
        () => {
          setCurrentBranch(branchName);
        },
      );

      return success;
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const createBranch = useCallback(
    async (branchName: string) => {
      const trimmedBranchName = branchName.trim();
      if (!selectedProject || !trimmedBranchName) {
        return false;
      }

      setIsCreatingBranch(true);
      try {
        const success = await runGitOperation(
          'create branch',
          () =>
            fetchWithAuth('/api/git/create-branch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: buildGitBody(selectedProject.name, selectedProjectPath, {
                branch: trimmedBranchName,
              }),
            }),
          () => {
            setCurrentBranch(trimmedBranchName);
          },
        );
        return success;
      } finally {
        setIsCreatingBranch(false);
      }
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const deleteBranch = useCallback(
    async (branchName: string) => {
      if (!selectedProject) {
        return false;
      }

      return runGitOperation('delete branch', () =>
        fetchWithAuth('/api/git/delete-branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            branch: branchName,
          }),
        }),
      );
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const handleFetch = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsFetching(true);
    try {
      await runGitOperation('fetch', () =>
        fetchWithAuth('/api/git/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath),
        }),
      );
    } finally {
      setIsFetching(false);
    }
  }, [runGitOperation, selectedProject, selectedProjectPath]);

  const handlePull = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPulling(true);
    try {
      await runGitOperation('pull', () =>
        fetchWithAuth('/api/git/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath),
        }),
      );
    } finally {
      setIsPulling(false);
    }
  }, [runGitOperation, selectedProject, selectedProjectPath]);

  const handlePush = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPushing(true);
    try {
      await runGitOperation('push', () =>
        fetchWithAuth('/api/git/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath),
        }),
      );
    } finally {
      setIsPushing(false);
    }
  }, [runGitOperation, selectedProject, selectedProjectPath]);

  const handlePublish = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    setIsPublishing(true);
    try {
      await runGitOperation('publish', () =>
        fetchWithAuth('/api/git/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            branch: currentBranch,
          }),
        }),
      );
    } finally {
      setIsPublishing(false);
    }
  }, [currentBranch, runGitOperation, selectedProject, selectedProjectPath]);

  const discardChanges = useCallback(
    async (filePath: string) => {
      if (!selectedProject) {
        return;
      }

      await runGitOperation('discard', () =>
        fetchWithAuth('/api/git/discard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            file: filePath,
          }),
        }),
      );
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const deleteUntrackedFile = useCallback(
    async (filePath: string) => {
      if (!selectedProject) {
        return;
      }

      await runGitOperation('delete untracked file', () =>
        fetchWithAuth('/api/git/delete-untracked', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            file: filePath,
          }),
        }),
      );
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const fetchCommitDiff = useCallback(
    async (commitHash: string) => {
      if (!selectedProject) {
        return;
      }

      try {
        const response = await fetchWithAuth(
          `/api/git/commit-diff?${buildGitQuery(selectedProject.name, selectedProjectPath, { commit: commitHash })}`,
        );
        const data = await readJson<GitDiffResponse>(response);
        if (!data.error && data.diff) {
          setCommitDiffs((previous) => ({ ...previous, [commitHash]: data.diff as string }));
        }
      } catch (error) {
        console.error('Error fetching commit diff:', error);
      }
    },
    [selectedProject, selectedProjectPath],
  );

  const generateCommitMessage = useCallback(
    async (files: string[]) => {
      if (!selectedProject || files.length === 0) {
        return null;
      }

      try {
        const response = await authenticatedFetch('/api/git/generate-commit-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            files,
            provider,
          }),
        });

        const data = await readJson<GitGenerateMessageResponse>(response);
        if (data.message) {
          return data.message;
        }
      } catch (error) {
        console.error('Error generating commit message:', error);
      }

      return null;
    },
    [provider, selectedProject, selectedProjectPath],
  );

  const commitChanges = useCallback(
    async (message: string, files: string[]) => {
      if (!selectedProject || !message.trim() || files.length === 0) {
        return false;
      }

      return runGitOperation('commit', () =>
        fetchWithAuth('/api/git/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath, {
            message,
            files,
          }),
        }),
      );
    },
    [runGitOperation, selectedProject, selectedProjectPath],
  );

  const createInitialCommit = useCallback(async () => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }

    setIsCreatingInitialCommit(true);
    try {
      const success = await runGitOperation('initial commit', () =>
        fetchWithAuth('/api/git/initial-commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildGitBody(selectedProject.name, selectedProjectPath),
        }),
      );
      if (!success) {
        throw new Error('Failed to create initial commit');
      }
      return true;
    } finally {
      setIsCreatingInitialCommit(false);
    }
  }, [runGitOperation, selectedProject, selectedProjectPath]);

  const openFile = useCallback(
    async (filePath: string) => {
      if (!onFileOpen) {
        return;
      }

      if (!selectedProject) {
        onFileOpen(filePath);
        return;
      }

      try {
        const response = await fetchWithAuth(
          `/api/git/file-with-diff?${buildGitQuery(selectedProject.name, selectedProjectPath, { file: filePath })}`,
        );
        const data = await readJson<GitFileWithDiffResponse>(response);
        if (data.error) {
          onFileOpen(filePath);
          return;
        }

        onFileOpen(filePath, {
          old_string: data.oldContent || '',
          new_string: data.currentContent || '',
        });
      } catch (error) {
        console.error('Error opening file:', error);
        onFileOpen(filePath);
      }
    },
    [onFileOpen, selectedProject, selectedProjectPath],
  );

  const dismissOperationError = useCallback(() => {
    setOperationError(null);
  }, []);

  const projectName = selectedProject?.name ?? null;
  useEffect(() => {
    const controller = new AbortController();

    setCurrentBranch('');
    setLocalBranches([]);
    setRemoteBranches([]);
    setGitStatus(null);
    setRemoteStatus(null);
    setGitDiff({});
    setRecentCommits([]);
    setCommitDiffs({});
    setOperationError(null);
    setIsLoading(false);

    if (!projectName) {
      return () => {
        controller.abort();
      };
    }

    void fetchGitStatus(controller.signal);
    void fetchBranches();
    void fetchRemoteStatus();

    return () => {
      controller.abort();
    };
  }, [fetchBranches, fetchGitStatus, fetchRemoteStatus, projectName]);

  useEffect(() => {
    if (!projectName || activeView !== 'history') {
      return;
    }

    void fetchRecentCommits();
  }, [activeView, fetchRecentCommits, projectName]);

  return {
    gitStatus,
    gitDiff,
    isLoading,
    currentBranch,
    localBranches,
    remoteBranches,
    operationError,
    recentCommits,
    commitDiffs,
    remoteStatus,
    isCreatingBranch,
    isFetching,
    isPulling,
    isPushing,
    isPublishing,
    isCreatingInitialCommit,
    refreshAll,
    dismissOperationError,
    switchBranch,
    createBranch,
    deleteBranch,
    handleFetch,
    handlePull,
    handlePush,
    handlePublish,
    discardChanges,
    deleteUntrackedFile,
    fetchCommitDiff,
    generateCommitMessage,
    commitChanges,
    createInitialCommit,
    openFile,
  };
}
