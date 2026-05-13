/**
 * Type declarations for shared/modelConstants.js
 */

export interface ReasoningEffort {
  value: string;
  label: string;
  description: string;
}

export declare const CODEX_MODELS: {
  OPTIONS: string[];
  DEFAULT: string;
};

export declare const CODEX_REASONING_EFFORTS: {
  OPTIONS: ReasoningEffort[];
  DEFAULT: string;
};
