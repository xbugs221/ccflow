/**
 * PURPOSE: Normalize Codex JSONL and WebSocket item payloads into one chat tool/message contract.
 */

/**
 * Parse JSON strings when Codex encodes tool arguments or results as text.
 * @param {unknown} value - Candidate JSON string or structured value.
 * @returns {unknown} Parsed value when possible.
 */
export function parseCodexJsonMaybe(value) {
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
 * @param {unknown} value - Tool output envelope, array, object, or string.
 * @returns {string} Renderable output text.
 */
export function normalizeCodexToolOutput(value) {
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
    const nested = parsed.content ?? parsed.output ?? parsed.text ?? parsed.result ?? parsed.stdout ?? parsed.stderr;
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

/**
 * Extract the first changed path from an apply_patch text block.
 * @param {string} patch - Raw apply_patch content.
 * @returns {string} Changed path or fallback.
 */
function extractPatchPath(patch) {
  const match = patch.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/m);
  return match?.[1]?.trim() || 'unknown';
}

/**
 * Convert apply_patch arguments into the FileChanges renderer payload.
 * @param {unknown} argumentsValue - Codex function_call arguments.
 * @returns {{status: string, changes: Array<{kind: string, path: string}>}} File change rows.
 */
export function normalizeCodexFileChangesInput(argumentsValue) {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String(parsed.patch ?? parsed.input ?? '')
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
    .filter(Boolean);

  return {
    status: 'Edit file',
    changes: changes.length > 0 ? changes : [{ kind: 'edit', path: extractPatchPath(patch) }],
  };
}

/**
 * Convert apply_patch arguments into the existing edit renderer input shape.
 * @param {unknown} argumentsValue - Codex function_call arguments.
 * @returns {{file_path: string, old_string: string, new_string: string}} Edit renderer payload.
 */
export function normalizeCodexApplyPatchInput(argumentsValue) {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String(parsed.patch ?? parsed.input ?? '')
    : String(parsed ?? '');
  const oldLines = [];
  const newLines = [];

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

/**
 * Normalize a Codex function_call payload into an existing ChatMessage tool shape.
 * @param {Record<string, unknown>} payload - Codex response_item function_call payload.
 * @returns {{toolName: string, toolInput: unknown, toolCallId: unknown}} Tool message data.
 */
export function normalizeCodexFunctionCall(payload) {
  const rawName = String(payload?.name || 'UnknownTool');

  if (rawName === 'shell_command') {
    const parsed = parseCodexJsonMaybe(payload.arguments);
    const command = parsed && typeof parsed === 'object' ? parsed.command : payload.arguments;
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
 * @param {Record<string, unknown>} item - WebSocket codex-response item data.
 * @returns {Record<string, unknown> | null} ChatMessage-compatible fragment.
 */
export function normalizeCodexRealtimeItem(item) {
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
            content: normalizeCodexToolOutput(item.result ?? item.error?.message),
            isError: Boolean(item.error),
          }
        : null,
      exitCode: item.error ? 1 : item.exitCode,
    };
  }

  return null;
}
