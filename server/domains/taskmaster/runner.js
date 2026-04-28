/**
 * PURPOSE: Centralize TaskMaster CLI runner configuration so routes build
 * commands consistently without duplicating package-manager details.
 */

export const TASKMASTER_CLI = 'task-master-ai';
export const TASKMASTER_RUNNER = 'pnpm';

/**
 * Build the pnpm dlx argument list used to execute TaskMaster CLI commands.
 *
 * @param {...string} cliArgs - Arguments forwarded to the TaskMaster CLI.
 * @returns {string[]} Runner arguments for child_process.spawn.
 */
export function buildTaskMasterRunnerArgs(...cliArgs) {
    return ['dlx', TASKMASTER_CLI, ...cliArgs];
}
