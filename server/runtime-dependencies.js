/**
 * PURPOSE: Resolve and validate external Go CLIs required by the ccflow
 * workflow control plane before the web server starts.
 */
import { execFileSync, spawnSync } from 'child_process';

const REQUIRED_COMMANDS = ['opsx', 'mc'];
const RUNNER_CONTRACT_COMMAND = ['contract', '--json'];
const REQUIRED_RUNNER_CAPABILITIES = ['list-changes', 'run', 'resume', 'status', 'abort'];

/**
 * Return the executable path for one command as seen by the current process.
 */
function resolveCommandPath(commandName) {
  const result = process.platform === 'win32'
    ? spawnSync('where', [commandName], { encoding: 'utf8' })
    : spawnSync('sh', ['-lc', `command -v ${commandName}`], { encoding: 'utf8' });
  if (result.status !== 0 || !String(result.stdout || '').trim()) {
    return '';
  }
  return String(result.stdout || '').split(/\r?\n/)[0].trim();
}

/**
 * Execute a lightweight version command without throwing raw child-process
 * errors into startup logs.
 */
function readCommandVersion(commandName) {
  const result = spawnSync(commandName, ['--version'], { encoding: 'utf8' });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  return {
    ok: result.status === 0,
    output,
    error: result.error ? result.error.message : '',
  };
}

/**
 * Check that the Go runner exposes the non-interactive commands required by
 * the web adapter.
 */
function checkRunnerContract() {
  const result = spawnSync('mc', RUNNER_CONTRACT_COMMAND, { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      required: [`mc ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      missing: [`mc ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      error: result.error ? result.error.message : output,
    };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      required: [`mc ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
      missing: ['valid JSON contract output'],
      error: error.message,
    };
  }
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.map((item) => String(item))
    : [];
  const missing = REQUIRED_RUNNER_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  if (payload.json !== true) {
    missing.push('json=true');
  }
  return {
    ok: missing.length === 0,
    required: [`mc ${RUNNER_CONTRACT_COMMAND.join(' ')}`],
    missing,
    capabilities,
    version: payload.version || '',
  };
}

/**
 * Resolve all required workflow binaries and fail fast with actionable context.
 */
export function checkRequiredRuntimeDependencies() {
  const diagnostics = getRuntimeDependencyDiagnostics();
  const missing = Object.entries(diagnostics.commands)
    .filter(([, command]) => !command.path)
    .map(([name]) => name);
  const incompatible = [];
  if (diagnostics.commands.opsx.path && !diagnostics.commands.opsx.version.ok) {
    incompatible.push('opsx --version');
  }
  if (diagnostics.commands.mc.path && !diagnostics.commands.mc.contract.ok) {
    incompatible.push(`mc contract: ${diagnostics.commands.mc.contract.missing.join(', ')}`);
  }
  if (missing.length > 0 || incompatible.length > 0) {
    throw new Error([
      'Missing or incompatible required workflow binaries.',
      missing.length > 0 ? `Missing from PATH: ${missing.join(', ')}` : '',
      incompatible.length > 0 ? `Incompatible: ${incompatible.join('; ')}` : '',
      'Install opsx and mc manually, then ensure the service process PATH can see them.',
      `PATH=${process.env.PATH || ''}`,
    ].filter(Boolean).join(' '));
  }
  return diagnostics;
}

/**
 * Build diagnostics for settings and startup logs without exposing path
 * override controls.
 */
export function getRuntimeDependencyDiagnostics() {
  const commands = {};
  for (const commandName of REQUIRED_COMMANDS) {
    const commandPath = resolveCommandPath(commandName);
    commands[commandName] = {
      name: commandName,
      path: commandPath,
      version: commandPath ? readCommandVersion(commandName) : { ok: false, output: '', error: 'not found in PATH' },
    };
  }
  commands.mc.contract = commands.mc.path
    ? checkRunnerContract()
    : { ok: false, required: [`mc ${RUNNER_CONTRACT_COMMAND.join(' ')}`], missing: ['mc'] };
  return {
    ok: REQUIRED_COMMANDS.every((commandName) => Boolean(commands[commandName].path))
      && commands.opsx.version.ok
      && commands.mc.contract.ok,
    commands,
    path: process.env.PATH || '',
  };
}

/**
 * Run a required binary and parse its JSON stdout contract.
 */
export function runJsonCommand(commandName, args, options = {}) {
  const stdout = execFileSync(commandName, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}
