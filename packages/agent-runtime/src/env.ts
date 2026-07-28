/**
 * @module env
 *
 * Builds the environment passed to `spawn()` for a given agent adapter:
 * proxy-aware merge of the inherited launch env with per-agent configured
 * overrides, plus a couple of per-CLI housekeeping tweaks (OpenCode/MiMo
 * project-config-discovery, which would otherwise walk up from cwd and run
 * an install step that can corrupt a pnpm workspace it's spawned inside).
 *
 * Heavily de-branded from OD's `apps/daemon/src/runtimes/env/env.ts`. The
 * origin file was far more coupled than r1b's "supporting generic file"
 * classification anticipated — it read OD's own app-config subsystem, OD's
 * sandbox-mode subsystem, and vela/AMR-specific env forwarding including a
 * literal product-name identity value and two product-prefixed env var
 * names (see `source-map.md` for the exact originals). None of that is
 * ported:
 *
 * - `mergeProxyAwareEnv` / `resolveSystemProxyEnv` now come from
 *   `@injini/platform` (the same functions, already verbatim-lifted there).
 * - AMR/vela-specific env injection and OD's app-config-driven analytics
 *   identity env are replaced by an optional `perAgentEnv` hook — a plain
 *   `(agentId, env) => NodeJS.ProcessEnv | void` the host can supply to add
 *   its own per-agent env logic (vela profile forwarding, analytics ids,
 *   …) without this package needing to know about vela or app-config.
 * - Sandbox-mode env application is replaced by an optional
 *   `sandboxOverlay` hook with the same shape, for the same reason.
 * - OD's AMR trace-env helper (emitting a product-prefixed run-id/attempt/
 *   session-id triad) is dropped entirely — it is OD/vela-adapter-owned
 *   trace-correlation env, not a generic runtime concern, and its own name
 *   was itself product-branded. A host that needs equivalent trace
 *   correlation can build it as a `perAgentEnv` hook.
 *
 * See `source-map.md` for the full accounting.
 */
import os from 'node:os';
import { mergeProxyAwareEnv, resolveSystemProxyEnv } from '@injini/platform';
import { expandConfiguredEnv } from './paths.js';
import { resolveAmrOpenCodeExecutable } from './executables.js';

type RuntimeEnvMap = NodeJS.ProcessEnv | Record<string, string>;

export interface SpawnEnvHooks {
  /**
   * Per-agent env customization (e.g. vela/AMR profile forwarding,
   * analytics identity, a routed model's endpoint override). Called after
   * the proxy-aware merge, before the built-in OpenCode/MiMo housekeeping.
   * Return a partial env to merge in, or nothing to leave `env` as-is
   * (mutating `env` directly is also fine — it's a live object).
   */
  perAgentEnv?: (agentId: string, env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv | void;
  /**
   * Applied last, after all other env composition. A host with a
   * sandboxed/jailed spawn mode plugs its own env constraints in here.
   */
  sandboxOverlay?: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
}

function stripKeysCaseInsensitive(env: NodeJS.ProcessEnv, keysToStrip: readonly string[]): void {
  const keysUpper = new Set(keysToStrip.map((key) => key.toUpperCase()));
  for (const key of Object.keys(env)) {
    if (keysUpper.has(key.toUpperCase())) delete env[key];
  }
}

export function spawnEnvForAgent(
  agentId: string,
  baseEnv: RuntimeEnvMap,
  configuredEnv: unknown = {},
  systemProxyEnv: RuntimeEnvMap = resolveSystemProxyEnv(),
  hooks: SpawnEnvHooks = {},
): NodeJS.ProcessEnv {
  const expandedConfiguredEnv = expandConfiguredEnv(configuredEnv);
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
      const opencodeBin = resolveAmrOpenCodeExecutable(env);
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

  const perAgentOverrides = hooks.perAgentEnv?.(agentId, env);
  if (perAgentOverrides) Object.assign(env, perAgentOverrides);

  return hooks.sandboxOverlay ? hooks.sandboxOverlay(env) : env;
}
