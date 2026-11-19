import path from 'node:path';
import type { AgentSlug, CliInstallPlan, JsonInstallPlan, McpLaunchSpec, PlanContext } from './install.js';

// RESIDUAL RISK (CR-006 / SEC-RB-002): `-e`/`--env KEY=VALUE` is claude's,
// codex's, and kimi's own documented `mcp add` CLI contract for passing
// server env vars — a fixed, external interface this package does not
// control and cannot change unilaterally. Because these values land in
// `addArgv` (argv), they are visible to any other local process that can
// list this process's command line (e.g. `ps -ww`) for the — typically very
// brief — window while the daemon's executor shells out to `claude`/`codex`/
// `kimi mcp add`. This package only builds the plan (`planAgentInstall`
// itself performs no fs/spawn, per this file's header comment); there is no
// executor here yet to redact `addArgv` before logging it, so there is
// nothing left in this package's own code to redact. Whichever executor
// eventually drives these plans MUST NOT log/echo `addArgv` verbatim
// (redact anything that looks like an env value from `-e`/`--env` pairs
// before writing it to any log/error surface), and should prefer a
// less-exposed handoff (e.g. piping `env` via stdin, or setting it directly
// in the spawned child's environment) for any future agent whose CLI
// supports that instead of argv-only `KEY=VALUE`.
export function envFlags({ env, flag }: { env: Record<string, string>; flag: string }, _optional: Record<string, never> = {}): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    out.push(flag, `${k}=${v}`);
  }
  return out;
}

// Attaches the env map under `key` only when non-empty, so configs stay clean.
export function withEnv({ entry, env, key }: { entry: Record<string, unknown>; env: Record<string, string>; key: 'env' | 'environment' }, _optional: Record<string, never> = {}): Record<string, unknown> {
  if (Object.keys(env).length > 0) entry[key] = env;
  return entry;
}

/** JSON server entry shared by the `env`-style agents (cursor /
 *  cline / openclaw / antigravity / trae). `extra` carries per-agent
 *  fields; env is only attached when non-empty so configs stay clean. */
export function jsonEntry(spec: McpLaunchSpec, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return withEnv({ entry: { command: spec.command, args: spec.args, ...extra }, env: spec.env, key: 'env' });
}

/** Inputs every per-agent planner receives; `appData` is the resolved `APPDATA` (win32 only). */
export interface PlannerArgs {
  spec: McpLaunchSpec;
  ctx: PlanContext;
  appData: string | undefined;
}

export function cliPlan({ slug, bin, argv, serverName }: { slug: AgentSlug; bin: string; argv: Pick<CliInstallPlan, 'addArgv' | 'removeArgv'>; serverName: string }, _optional: Record<string, never> = {}): CliInstallPlan {
  return { kind: 'cli', slug, bin, ...argv, getArgv: ['mcp', 'get', serverName] };
}

export function jsonPlan({ slug, configPath, keyPath, serverKey, entry }: { slug: AgentSlug; configPath: string; keyPath: string[]; serverKey: string; entry: unknown }, _optional: Record<string, never> = {}): JsonInstallPlan {
  return { kind: 'json', slug, configPath, keyPath, serverKey, entry };
}

// VS Code-family editors keep per-user state under one platform-specific root.
export function editorUserDir({ app, home, platform, suppliedAppData }: { app: string; home: string; platform: NodeJS.Platform; suppliedAppData: string | undefined }, _optional: Record<string, never> = {}): string {
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', app, 'User');
  if (platform === 'win32') return path.join(suppliedAppData ?? path.join(home, 'AppData', 'Roaming'), app, 'User');
  return path.join(home, '.config', app, 'User');
}

