import { createAgentModelDiscovery } from '../model-discovery.js';
/**
 * @module defs/droid
 *
 * Factory's Droid CLI (`droid`). Uses the documented headless mode, `droid exec`
 * (<https://docs.factory.ai/reference/cli-reference>, <https://docs.factory.ai/droid-exec/overview>):
 * the prompt can be piped on stdin (`cat file | droid exec`), `--output-format text` prints the
 * final answer, and `-m/--model` picks the model. `droid exec` is read-only unless given an
 * autonomy level; `--skip-permissions-unsafe` lifts every permission check (it cannot be combined
 * with `--auto`). Auth is `FACTORY_API_KEY` or a prior `droid` login.
 *
 * Not ACP: the ACP registry launches Droid with `droid exec --output-format acp-daemon`, but that
 * value is not in the CLI reference, newer builds were reported to switch to `acp`, and the daemon
 * variant was reported to fail with stdio MCP servers. The documented text mode is the stable one.
 * No `externalMcpInjection` for the same reason.
 */
import { DEFAULT_MODEL_OPTION } from './shared.js';
import type { RuntimeAgentDef } from '../types.js';

export const droidAgentDef = {
  // UNVERIFIED live integration locally; source/category and limits are documented in model-discovery-adapters.ts.
  ...createAgentModelDiscovery('droid', { fallbackModels: (): readonly import('../types.js').RuntimeModelOption[] => droidAgentDef.fallbackModels }),
    id: 'droid',
    name: 'Factory Droid',
    bin: 'droid',
    versionArgs: ['--version'],
    fallbackModels: [DEFAULT_MODEL_OPTION],
    buildArgs: ({ prompt: _prompt, imagePaths: _imagePaths }, { extraAllowedDirs: _extra, options = {} } = {}) => {
      const args = ['exec', '--output-format', 'text'];
      // See `RuntimeBuildOptions.permissionMode`'s doc: bypass is the default (unchanged
      // behavior); a restricted run keeps `droid exec`'s own read-only default.
      if (options.permissionMode !== 'restricted') {
        args.push('--skip-permissions-unsafe');
      }
      if (options.model && options.model !== 'default') {
        args.push('--model', options.model);
      }
      return args;
    },
    promptViaStdin: true,
    streamFormat: 'plain',
} satisfies RuntimeAgentDef;
