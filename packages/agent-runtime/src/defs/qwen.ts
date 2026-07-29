/** Ported verbatim from OD's `apps/daemon/src/runtimes/defs/qwen.ts` (import path adjusted only). See `source-map.md`. */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const qwenAgentDef = {
    id: 'qwen',
    name: 'Qwen Code',
    bin: 'qwen',
    versionArgs: ['--version'],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: 'qwen3-coder-plus', label: 'qwen3-coder-plus' },
      { id: 'qwen3-coder-flash', label: 'qwen3-coder-flash' },
    ],
    // Prompt delivered via stdin (gated by `promptViaStdin: true`) to avoid Windows
    // `spawn ENAMETOOLONG` for large composed prompts. Qwen Code is a
    // Gemini-CLI fork and supports the same `--yolo` non-interactive mode.
    // Qwen Code reads from piped stdin when no positional prompt is supplied.
    // Current Qwen treats/rejects a bare `-` rather than needing it as a stdin sentinel.
    buildArgs: (_prompt, _imagePaths, _extra, options = {}) => {
      const args = [];
      // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
      // behavior) unless a caller explicitly opts into a restricted run.
      if (options.permissionMode !== 'restricted') {
        args.push('--yolo');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }

      return args;
    },
    promptViaStdin: true,
    streamFormat: 'plain',
} satisfies RuntimeAgentDef;
