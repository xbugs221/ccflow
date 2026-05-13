/**
 * Type declarations for shared/codex-message-normalizer.js
 */

export declare function parseCodexJsonMaybe(value: unknown): unknown;
export declare function normalizeCodexToolOutput(value: unknown): string;

export interface FileChange {
  kind: string;
  path: string;
}

export declare function normalizeCodexFileChangesInput(argumentsValue: unknown): {
  status: string;
  changes: FileChange[];
};

export interface ApplyPatchInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

export declare function normalizeCodexApplyPatchInput(argumentsValue: unknown): ApplyPatchInput;

export interface NormalizedFunctionCall {
  toolName: string;
  toolInput: unknown;
  toolCallId: unknown;
}

export declare function normalizeCodexFunctionCall(payload: Record<string, unknown>): NormalizedFunctionCall;
export declare function normalizeCodexRealtimeItem(item: Record<string, unknown> | null | undefined): Record<string, unknown> | null;
