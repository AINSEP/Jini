/**
 * @module defs/crush
 *
 * Charm's Crush (`crush`). Checked against upstream source (`internal/cmd/run.go` / `root.go`):
 * `crush run [prompt...]` runs one prompt non-interactively and exits; with no prompt args, piped
 * stdin becomes the whole prompt ("no prompt provided" only when both are empty). The answer is
 * plain text on stdout, the spinner goes to stderr and `--quiet` hides it. `--yolo` (root flag)
 * skips permission requests; `--model` takes `model` or `provider/model`.
 *
 * No `externalMcpInjection`: Crush reads MCP servers from its `crush.json` config, with no
 * per-run flag to point it elsewhere.
 */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const crushAgentDef = {
    id: 'crush',
    name: 'Crush',
    bin: 'crush',
    versionArgs: ['--version'],
    // Models come from the providers the user configured in Crush; there is no stable default
    // list to ship, so the picker offers the CLI default and accepts any typed id.
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: ({ prompt: _prompt, imagePaths: _imagePaths }, { extraAllowedDirs: _extra, options = {} } = {}) => {
      const args = ['run', '--quiet'];
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
