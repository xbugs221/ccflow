/**
 * PURPOSE: Centralize authenticated HTTP calls used by the web client.
 */
import { IS_PLATFORM } from "../constants/config";

const getUrlToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  return new URLSearchParams(window.location.search).get('token');
};

export const getAuthToken = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  return localStorage.getItem('auth-token') || getUrlToken();
};

// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = getAuthToken();

  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (!IS_PLATFORM && token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

/**
 * PURPOSE: Encode dynamic route segments so project-scoped requests keep
 * working when a derived project name contains URL-sensitive characters.
 */
const encodeRouteSegment = (value) => encodeURIComponent(String(value));

/**
 * Build the common base path for project-scoped API routes.
 */
const projectApiPath = (projectName) => `/api/projects/${encodeRouteSegment(projectName)}`;

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },
  settings: {
    timeContext: () => authenticatedFetch('/api/settings/time-context'),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  projectWorkflows: (projectName) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows`),
  projectWorkflow: (projectName, workflowId) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}`),
  projectOpenSpecChanges: (projectName) =>
    authenticatedFetch(`${projectApiPath(projectName)}/openspec/changes`),
  createProjectWorkflow: (projectName, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  markProjectWorkflowRead: (projectName, workflowId) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/mark-read`, {
      method: 'POST',
    }),
  deleteProjectWorkflow: (projectName, workflowId) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}`, {
      method: 'DELETE',
    }),
  updateProjectWorkflowUiState: (projectName, workflowId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/ui-state`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateProjectWorkflowGateDecision: (projectName, workflowId, gateDecision) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/gate-decision`, {
      method: 'PUT',
      body: JSON.stringify({ gateDecision }),
    }),
  updateWorkflowStageProviders: (projectName, workflowId, stageProviders) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/stage-providers`, {
      method: 'PUT',
      body: JSON.stringify({ stageProviders }),
    }),
  updateWorkflowSchedule: (projectName, workflowId, scheduledAt) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduledAt }),
    }),
  renameProjectWorkflow: (projectName, workflowId, title) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    }),
  advanceProjectWorkflow: (projectName, workflowId) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/advance`, {
      method: 'POST',
    }),
  projectWorkflowLauncherConfig: (projectName, workflowId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/launcher-config`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  registerProjectWorkflowChildSession: (projectName, workflowId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/workflows/${encodeRouteSegment(workflowId)}/child-sessions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions?limit=${limit}&offset=${offset}`),
  chatSearch: (query) =>
    authenticatedFetch(`/api/chat/search?q=${encodeURIComponent(String(query || ''))}`),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = 'claude', afterLine = null) => {
    const params = new URLSearchParams();
    if (afterLine !== null) {
      // afterLine 模式：只返回第 N 行之后的增量内容，忽略 limit/offset
      params.append('afterLine', afterLine);
    } else if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    const queryString = params.toString();

    let url;
    if (provider === 'codex' && !/^c\d+$/.test(String(sessionId || ''))) {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `${projectApiPath(projectName)}/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url);
  },
  renameProject: (projectName, displayName, projectPath) =>
    authenticatedFetch(`${projectApiPath(projectName)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({
        displayName,
        projectPath: typeof projectPath === 'string' ? projectPath : null,
      }),
    }),
  renameSession: (projectName, sessionId, summary, projectPath = '') =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, projectPath: typeof projectPath === 'string' ? projectPath : '' }),
    }),
  createManualSessionDraft: (projectName, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/manual-sessions`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  finalizeManualSessionDraft: (projectName, sessionId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/manual-sessions/${encodeRouteSegment(sessionId)}/finalize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSessionUiState: (projectName, sessionId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}/ui-state`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  sessionModelState: (projectName, sessionId, projectPath = '') => {
    const params = new URLSearchParams();
    if (projectPath) {
      params.set('projectPath', projectPath);
    }
    const query = params.toString();
    return authenticatedFetch(
      `${projectApiPath(projectName)}/sessions/${encodeRouteSegment(sessionId)}/model-state${query ? `?${query}` : ''}`,
    );
  },
  updateSessionModelState: (projectName, sessionId, payload) =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${encodeRouteSegment(sessionId)}/model-state`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  renameCodexSession: (sessionId, summary, projectPath = '') =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, projectPath }),
    }),
  usageRemaining: (provider = 'claude') =>
    authenticatedFetch(`/api/usage/remaining?provider=${encodeURIComponent(provider)}`),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`${projectApiPath(projectName)}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteCodexSession: (sessionId, projectPath = '') =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify({ projectPath }),
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`${projectApiPath(projectName)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  readFile: (projectName, filePath, options = {}) => {
    const query = new URLSearchParams({
      filePath: String(filePath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/file?${query.toString()}`);
  },
  saveFile: (projectName, filePath, content, options = {}) =>
    authenticatedFetch(`${projectApiPath(projectName)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content, projectPath: options.projectPath }),
    }),
  getFiles: (projectName, options = {}) => {
    const {
      path: targetPath,
      depth,
      showHidden,
      projectPath,
      ...fetchOptions
    } = options;

    const query = new URLSearchParams();

    if (typeof targetPath === 'string' && targetPath.length > 0) {
      query.set('path', targetPath);
    }

    if (Number.isInteger(depth)) {
      query.set('depth', String(depth));
    }

    if (typeof showHidden === 'boolean') {
      query.set('showHidden', String(showHidden));
    }

    if (typeof projectPath === 'string' && projectPath.length > 0) {
      query.set('projectPath', projectPath);
    }

    const queryString = query.toString();
    const url = `${projectApiPath(projectName)}/files${queryString ? `?${queryString}` : ''}`;
    return authenticatedFetch(url, fetchOptions);
  },
  createProjectEntry: (projectName, payload, options = {}) =>
    authenticatedFetch(`${projectApiPath(projectName)}/files`, {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        projectPath: options.projectPath ?? payload?.projectPath,
      }),
    }),
  renameProjectEntry: (projectName, payload, options = {}) =>
    authenticatedFetch(`${projectApiPath(projectName)}/files/rename`, {
      method: 'PUT',
      body: JSON.stringify({
        ...payload,
        projectPath: options.projectPath ?? payload?.projectPath,
      }),
    }),
  deleteProjectEntry: (projectName, payload, options = {}) =>
    authenticatedFetch(`${projectApiPath(projectName)}/files`, {
      method: 'DELETE',
      body: JSON.stringify({
        ...payload,
        projectPath: options.projectPath ?? payload?.projectPath,
      }),
    }),
  uploadProjectEntries: (projectName, formData, options = {}) => {
    const hintedProjectPath = options.projectPath ?? formData.get('projectPath');
    if (typeof hintedProjectPath === 'string' && hintedProjectPath.length > 0) {
      formData.set('projectPath', hintedProjectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/files/upload`, {
      method: 'POST',
      body: formData,
      headers: {},
    });
  },
  downloadProjectFile: (projectName, filePath, options = {}) => {
    const query = new URLSearchParams({
      path: String(filePath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/files/download?${query.toString()}`);
  },
  downloadProjectFolder: (projectName, folderPath, options = {}) => {
    const query = new URLSearchParams({
      path: String(folderPath),
    });

    if (typeof options.projectPath === 'string' && options.projectPath.length > 0) {
      query.set('projectPath', options.projectPath);
    }

    return authenticatedFetch(`${projectApiPath(projectName)}/folders/download?${query.toString()}`);
  },
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${encodeRouteSegment(projectName)}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${encodeRouteSegment(projectName)}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${encodeRouteSegment(projectName)}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${encodeRouteSegment(projectName)}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${encodeRouteSegment(projectName)}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),
  },

  // Browse filesystem for project suggestions
  browseFilesystem: (dirPath = null) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath) =>
    authenticatedFetch('/api/create-folder', {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    }),

  // User endpoints
  user: {
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Generic GET method for any endpoint
  get: (endpoint) => authenticatedFetch(`/api${endpoint}`),
};
