// PURPOSE: Show external workflow CLI diagnostics resolved by the server process.
import { useEffect, useState } from 'react';
import { api } from '../../../../utils/api';

type RuntimeCommandDiagnostics = {
  name: string;
  path: string;
  version?: { ok: boolean; output: string; error?: string };
  contract?: { ok: boolean; missing?: string[]; capabilities?: string[]; version?: string; error?: string };
};

type RuntimeDiagnostics = {
  ok: boolean;
  commands: Record<string, RuntimeCommandDiagnostics>;
  path: string;
};

function StatusPill({ ok }: { ok: boolean }) {
  /**
   * Render a compact status indicator for one runtime diagnostic row.
   */
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'}`}>
      {ok ? 'OK' : 'Failed'}
    </span>
  );
}

function RuntimeCommandRow({ command }: { command: RuntimeCommandDiagnostics }) {
  /**
   * Render path, version, and runner contract details for one external CLI.
   */
  const versionText = command.version?.output || command.version?.error || 'unknown';
  const contractText = command.contract
    ? command.contract.ok
      ? `contract: ${command.contract.capabilities?.join(', ') || 'ok'}`
      : `contract missing: ${command.contract.missing?.join(', ') || command.contract.error || 'unknown'}`
    : '';
  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-foreground">{command.name}</div>
        <StatusPill ok={Boolean(command.path) && command.version?.ok !== false && command.contract?.ok !== false} />
      </div>
      <div className="text-sm text-muted-foreground break-all">path: {command.path || 'not found'}</div>
      <div className="text-sm text-muted-foreground break-all">version: {versionText}</div>
      {contractText && <div className="text-sm text-muted-foreground break-all">{contractText}</div>}
    </div>
  );
}

export default function RuntimeDiagnosticsTab() {
  /**
   * Fetch server-side runtime dependency diagnostics when the diagnostics tab is
   * opened so operators can verify ox/mc resolution without path overrides.
   */
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.diagnostics.runtimeDependencies()
      .then(async (response) => {
        const payload = await response.json();
        if (!cancelled) {
          setDiagnostics(payload);
          setError(response.ok ? '' : payload?.error || 'Failed to load diagnostics');
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load diagnostics');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Runtime diagnostics</h3>
        <p className="text-sm text-muted-foreground">Server-visible ox and mc binaries used by workflow automation.</p>
      </div>
      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
      {diagnostics && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <span className="text-sm font-medium text-foreground">Overall</span>
            <StatusPill ok={diagnostics.ok} />
          </div>
          {Object.values(diagnostics.commands || {}).map((command) => (
            <RuntimeCommandRow key={command.name} command={command} />
          ))}
          <div className="rounded-md border border-border p-3">
            <div className="text-sm font-medium text-foreground">PATH</div>
            <div className="mt-2 max-h-24 overflow-auto text-xs text-muted-foreground break-all">{diagnostics.path || 'empty'}</div>
          </div>
        </div>
      )}
      {!diagnostics && !error && <div className="text-sm text-muted-foreground">Loading diagnostics...</div>}
    </div>
  );
}
