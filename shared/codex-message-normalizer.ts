/**
 * PURPOSE: Normalize Codex JSONL and WebSocket item payloads into one chat tool/message contract.
 */

/**
 * Parse JSON strings when Codex encodes tool arguments or results as text.
 */
export function parseCodexJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || !['{', '[', '"'].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Convert mixed Codex tool output values to a stable text payload.
 */
export function normalizeCodexToolOutput(value: unknown): string {
  const parsed = parseCodexJsonMaybe(value);
  if (parsed === null || parsed === undefined) {
    return '';
  }

  if (typeof parsed === 'string') {
    return parsed;
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => normalizeCodexToolOutput(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof parsed === 'object') {
    const nested = (parsed as Record<string, unknown>).content ?? (parsed as Record<string, unknown>).output ?? (parsed as Record<string, unknown>).text ?? (parsed as Record<string, unknown>).result ?? (parsed as Record<string, unknown>).stdout ?? (parsed as Record<string, unknown>).stderr;
    if (nested !== undefined && nested !== parsed) {
      return normalizeCodexToolOutput(nested);
    }
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(parsed);
    }
  }

  return String(parsed);
}

export interface FileChange {
  kind: string;
  path: string;
}

/**
 * Extract the first changed path from an apply_patch text block.
 */
function extractPatchPath(patch: string): string {
  const match = patch.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/m);
  return match?.[1]?.trim() || 'unknown';
}

/**
 * Convert apply_patch arguments into the FileChanges renderer payload.
 */
export function normalizeCodexFileChangesInput(argumentsValue: unknown): {
  status: string;
  changes: FileChange[];
} {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String((parsed as Record<string, unknown>).patch ?? (parsed as Record<string, unknown>).input ?? '')
    : String(parsed ?? '');
  const changes = patch
    .split('\n')
    .map((line) => {
      const match = line.match(/^\*\*\* (Update|Add|Delete) File:\s*(.+)$/);
      if (!match) {
        return null;
      }
      const kind = match[1] === 'Add' ? 'added' : match[1] === 'Delete' ? 'deleted' : 'edit';
      return { kind, path: match[2].trim() };
    })
    .filter((c): c is FileChange => c !== null);

  return {
    status: 'Edit file',
    changes: changes.length > 0 ? changes : [{ kind: 'edit', path: extractPatchPath(patch) }],
  };
}

export interface ApplyPatchInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

/**
 * Convert apply_patch arguments into the existing edit renderer input shape.
 */
export function normalizeCodexApplyPatchInput(argumentsValue: unknown): ApplyPatchInput {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String((parsed as Record<string, unknown>).patch ?? (parsed as Record<string, unknown>).input ?? '')
    : String(parsed ?? '');
  const oldLines: string[] = [];
  const newLines: string[] = [];

  patch.split('\n').forEach((line) => {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('***')) {
      return;
    }
    if (line.startsWith('-')) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  });

  return {
    file_path: extractPatchPath(patch),
    old_string: oldLines.join('\n'),
    new_string: newLines.join('\n') || patch,
  };
}

export interface NormalizedFunctionCall {
  toolName: string;
  toolInput: unknown;
  toolCallId: unknown;
}

/**
 * Normalize a Codex function_call payload into an existing ChatMessage tool shape.
 */
export function normalizeCodexFunctionCall(payload: Record<string, unknown>): NormalizedFunctionCall {
  const rawName = String(payload?.name || 'UnknownTool');

  if (rawName === 'shell_command') {
    const parsed = parseCodexJsonMaybe(payload.arguments);
    const command = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).command : payload.arguments;
    return {
      toolName: 'Bash',
      toolInput: JSON.stringify({ command: command || '' }),
      toolCallId: payload.call_id,
    };
  }

  if (rawName === 'apply_patch') {
    return {
      toolName: 'FileChanges',
      toolInput: normalizeCodexFileChangesInput(payload.arguments),
      toolCallId: payload.call_id,
    };
  }

  return {
    toolName: rawName,
    toolInput: payload?.arguments ?? '',
    toolCallId: payload?.call_id,
  };
}

/**
 * Normalize realtime Codex item events into the same UI fragment as JSONL replay.
 */
export function normalizeCodexRealtimeItem(item: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  if (item.itemType === 'command_execution') {
    const command = String(item.command || '');
    if (!command) {
      return null;
    }
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName: command,
      toolInput: item.arguments ?? {},
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: item.output == null ? null : {
        content: normalizeCodexToolOutput(item.output),
        isError: item.exitCode != null && Number(item.exitCode) !== 0,
        status: item.exitCode == null ? 'running' : 'completed',
      },
      exitCode: item.exitCode,
    };
  }

  if (item.itemType === 'file_change') {
    const filePath = String(item.path || item.filePath || item.file_path || '');
    if (!filePath) {
      return null;
    }
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName: 'FileChanges',
      toolInput: {
        status: 'Edit file',
        changes: [{ kind: String(item.changeType || 'edit'), path: filePath }],
      },
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: {
        content: '',
        isError: false,
        status: 'completed',
      },
      exitCode: item.exitCode,
    };
  }

  if (item.itemType === 'mcp_tool_call') {
    const toolName = item.tool
      ? String(item.tool)
      : `${item.server || 'mcp'}:${item.name || 'tool'}`;
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName,
      toolInput: item.arguments ?? {},
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: item.result || item.error
        ? {
            content: normalizeCodexToolOutput(item.result ?? (item.error as Record<string, unknown>)?.message),
            isError: Boolean(item.error),
          }
        : null,
      exitCode: item.error ? 1 : item.exitCode,
    };
  }

  return null;
}
