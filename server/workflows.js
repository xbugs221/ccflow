/**
 * PURPOSE: Build project workflow read models from wo runner state.
 * ccflow keeps the Web control plane thin: automatic workflow facts come from
 * wo's user-state run path, not from a local workflow mirror.
 */
import { listOpenSpecChanges } from './domains/openspec/oz-client.js';
import {
  abortGoWorkflowRun,
  resumeGoWorkflowRun,
  startGoWorkflowRun,
} from './domains/workflows/go-runner-client.js';
import { listWoWorkflowReadModels } from './domains/workflows/wo-read-model.js';

/**
 * Read active OpenSpec changes through the CLI so ccflow follows OpenSpec's own discovery rules.
 */
async function listOpenSpecCliChanges(projectPath) {
  /**
   * PURPOSE: Use OpenSpec as the source of truth for active proposal discovery
   * instead of duplicating its root/config resolution in ccflow.
   */
  if (!projectPath) {
    return [];
  }

  try {
    return await listOpenSpecChanges(projectPath);
  } catch (error) {
    return [];
  }
}

/**
 * Enumerate active OpenSpec changes that can still be adopted by a workflow.
 */
async function listAdoptableOpenSpecChanges(projectPath) {
  if (!projectPath) {
    return [];
  }

  const workflows = await listProjectWorkflows(projectPath);
  const claimedChangeNames = new Set(
    workflows
      .map((workflow) => String(workflow.openspecChangeName || '').trim())
      .filter(Boolean),
  );

  return (await listOpenSpecCliChanges(projectPath))
    .filter((changeName) => !claimedChangeNames.has(changeName))
    .sort((left, right) => right.localeCompare(left));
}

/**
 * Ensure a workflow only adopts a real, currently-unclaimed OpenSpec change.
 */
async function validateWorkflowOpenSpecChange(projectPath, changeName) {
  const normalizedChangeName = String(changeName || '').trim();
  if (!normalizedChangeName) {
    return '';
  }

  const adoptableChanges = await listAdoptableOpenSpecChanges(projectPath);
  if (!adoptableChanges.includes(normalizedChangeName)) {
    throw new Error(`OpenSpec change is unavailable: ${normalizedChangeName}`);
  }

  return normalizedChangeName;
}

export async function listProjectWorkflows(projectPath) {
  if (!projectPath) {
    return [];
  }
  return listWoWorkflowReadModels(projectPath);
}

export async function attachWorkflowMetadata(projects) {
  /**
   * Add workflow read models without letting one corrupt project-local config
   * break the global project list used by the WebUI sidebar.
   */
  return Promise.all(
    projects.map(async (project) => {
      const projectPath = project.fullPath || project.path || '';
      let workflows = [];
      try {
        workflows = await listProjectWorkflows(projectPath);
      } catch (error) {
        console.error(
          `Failed to load workflows for project ${project.name || projectPath}:`,
          error,
        );
      }
      return {
        ...project,
        workflows,
        hasUnreadActivity: workflows.some((workflow) => workflow.hasUnreadActivity === true),
      };
    }),
  );
}

export function findProjectByName(projects, projectName) {
  return projects.find((project) => project.name === projectName) || null;
}

export async function createProjectWorkflow(project, payload = {}) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    throw new Error('Project path is required to create a workflow');
  }

  const providedChangeName = await validateWorkflowOpenSpecChange(projectPath, payload.openspecChangeName);
  if (!providedChangeName) {
    throw new Error('Go-backed workflows require an active OpenSpec change. Create or select one from docs/changes first.');
  }
  const runResult = await startGoWorkflowRun(projectPath, providedChangeName);
  const runId = String(runResult?.run_id || '').trim();
  if (!runId) {
    throw new Error('Go runner did not return runId for the new workflow run.');
  }
  const workflow = await getProjectWorkflow(project, runId);
  if (!workflow) {
    throw new Error(`Go runner state not found for new workflow run ${runId}`);
  }
  return {
    ...workflow,
    runnerPid: Number.isInteger(runResult?.pid) ? runResult.pid : undefined,
  };
}

export async function listProjectAdoptableOpenSpecChanges(project) {
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return [];
  }

  return listAdoptableOpenSpecChanges(projectPath);
}

export async function getProjectWorkflow(project, workflowId) {
  const workflows = await listProjectWorkflows(project?.fullPath || project?.path || '');
  return workflows.find((workflow) => (
    workflow.id === workflowId
    || workflow.runId === workflowId
    || workflow.legacyId === workflowId
  )) || null;
}

export async function resumeWorkflowRun(project, workflowId) {
  /**
   * PURPOSE: Resume a Go-backed workflow through the runner contract while
   * keeping sealed state.json as the read-model source after the command exits.
   */
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    return null;
  }
  if (workflow.runner !== 'go' || !workflow.runId) {
    const error = new Error('Workflow is not bound to a Go runner run.');
    error.statusCode = 409;
    throw error;
  }

  await resumeGoWorkflowRun(projectPath, workflow.runId);
  return getProjectWorkflow(project, workflowId);
}

export async function abortWorkflowRun(project, workflowId) {
  /**
   * PURPOSE: Abort a Go-backed workflow through the runner contract so the
   * runner updates state.json and ccflow only refreshes the read model.
   */
  const projectPath = project?.fullPath || project?.path || '';
  if (!projectPath) {
    return null;
  }

  const workflow = await getProjectWorkflow(project, workflowId);
  if (!workflow) {
    return null;
  }
  if (workflow.runner !== 'go' || !workflow.runId) {
    const error = new Error('Workflow is not bound to a Go runner run.');
    error.statusCode = 409;
    throw error;
  }

  await abortGoWorkflowRun(projectPath, workflow.runId);
  return getProjectWorkflow(project, workflowId);
}
