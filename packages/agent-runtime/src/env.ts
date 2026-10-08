/**
 * @module env
 * Build proxy-aware spawn environment from inherited and per-agent configured values. Disable
 * OpenCode/MiMo project-config discovery so an automatic install cannot corrupt the host workspace.
 * The shared platform helpers own proxy merging. Host-specific profile forwarding, analytics
 * identity and trace correlation enter through perAgentEnv; sandbox wiring enters through
 * sandboxOverlay. The engine must not import a product's config/sandbox subsystems or env names.
 */
import os from 'node:os';
import { mergeProxyAwareEnv, resolveSystemProxyEnv } from '@jini-ai/platform';
import { expandConfiguredEnv } from './paths.js';
import { resolveAmrOpenCodeExecutable } from './executables.js';

type RuntimeEnvMap = NodeJS.ProcessEnv | Record<string, string>;

export interface SpawnEnvHooks {
  /**
   * Per-agent env customization (e.g. vela/AMR profile forwarding,
   * analytics identity, a routed model's endpoint override). Called after
   * the proxy-aware merge and built-in housekeeping, before `sandboxOverlay`.
   * Return a partial env to merge in, or nothing to leave `env` as-is
   * (mutating `env` directly is also fine — it's a live object).
   */
  perAgentEnv?: (requiredArgs: { agentId: string; env: NodeJS.ProcessEnv }) => NodeJS.ProcessEnv | void;
  /**
   * Applied last, after all other env composition. A host with a
   * sandboxed/jailed spawn mode plugs its own env constraints in here.
   */
  sandboxOverlay?: (requiredArgs: { env: NodeJS.ProcessEnv }) => NodeJS.ProcessEnv;
}

function stripKeysCaseInsensitive(env: NodeJS.ProcessEnv, keysToStrip: readonly string[]): void {
  const keysUpper = new Set(keysToStrip.map((key) => key.toUpperCase()));
  for (const key of Object.keys(env)) {
    if (keysUpper.has(key.toUpperCase())) delete env[key];
  }
}

export function spawnEnvForAgent({ agentId, baseEnv }: { agentId: string; baseEnv: RuntimeEnvMap }, { configuredEnv = {}, systemProxyEnv = resolveSystemProxyEnv(), hooks = {} }: { configuredEnv?: unknown; systemProxyEnv?: RuntimeEnvMap; hooks?: SpawnEnvHooks } = {}
): NodeJS.ProcessEnv {
  const expandedConfiguredEnv = expandConfiguredEnv({ configuredEnv: configuredEnv });
  const env = mergeProxyAwareEnv(process.platform, systemProxyEnv, baseEnv, expandedConfiguredEnv);

  if (agentId === 'amr') {
    // `execAgentFile` REPLACES the child environment (execFile with `env`
    // set), so anything missing here is genuinely absent for the AMR CLI.
    // `vela model list` resolves its config home up front and exits
    // non-zero with "$HOME is not defined" when HOME is unset. Backfill
    // HOME from the OS so the authoritative catalog call is never silently
    // decapitated by a missing home dir.
    if (!env.HOME?.trim()) {
      const home = os.homedir();
      if (home) env.HOME = home;
    }
    if (!env.VELA_OPENCODE_BIN?.trim()) {
      const opencodeBin = resolveAmrOpenCodeExecutable({  }, { env: env });
      if (opencodeBin) env.VELA_OPENCODE_BIN = opencodeBin;
    }
  }

  if (agentId === 'opencode') {
    stripKeysCaseInsensitive(env, ['OPENCODE', 'OPENCODE_PID', 'OPENCODE_RUN_ID', 'OPENCODE_SERVER_PASSWORD']);
    // OpenCode is bun-based and, left to its defaults, walks up from its
    // cwd to the nearest project root and runs `bun install` there at
    // startup to set up local plugins. When that root is a pnpm workspace
    // (the host's own repo, or a project nested inside it), the install
    // replaces the pnpm `.pnpm` store with a bun `node_modules/.bun` +
    // `bun.lock` and breaks the workspace. Disable project-config
    // discovery (and its install) so OpenCode only honors the config
    // injected via `OPENCODE_CONFIG_CONTENT`.
    if (!env.OPENCODE_DISABLE_PROJECT_CONFIG?.trim()) {
      env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
    }
  }

  if (agentId === 'mimo') {
    stripKeysCaseInsensitive(env, ['MIMOCODE', 'MIMOCODE_PID', 'MIMOCODE_RUN_ID', 'MIMOCODE_SERVER_PASSWORD']);
    // MiMo builds on the same toolchain as OpenCode and has the same
    // workspace-corruption risk. Disable project-config discovery so MiMo
    // only honors the config injected through `MIMOCODE_CONFIG_CONTENT`.
    if (!env.MIMOCODE_DISABLE_PROJECT_CONFIG?.trim()) {
      env.MIMOCODE_DISABLE_PROJECT_CONFIG = 'true';
    }
  }

  const perAgentOverrides = hooks.perAgentEnv?.({ agentId: agentId, env: env });
  if (perAgentOverrides) Object.assign(env, perAgentOverrides);

  return hooks.sandboxOverlay ? hooks.sandboxOverlay({ env: env }) : env;
}
