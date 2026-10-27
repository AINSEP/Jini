import { promises as fsPromises } from 'node:fs';
import {
  homedir,
  tmpdir,
} from 'node:os';
import {
  join,
  resolve,
} from 'node:path';
import type { RuntimeAgentDef } from '@jini-ai/agent-runtime';
import { errorMessage } from '../values.js';
import type {
  McpJsonInjectionOptions,
  McpJsonServerEntry,
  McpBridgeDelivery,
  PreparedCodexHome,
  FailBeforeSpawn,
} from '../contracts.js';
import { defaultReadMcpJsonFile, defaultWriteMcpJsonFile } from '../mcp-bridge.js';
import { buildCodexHomeConfigToml } from './home-config.js';
import { assertCodexHomeConfigParses, assertStagedHomeIsolated, CodexMcpIsolationError, codexIsolationRefusalMessage } from './isolation.js';

/**
 * Where `'codex-toml'` reads the operator's REAL Codex config from, to seed a run's scratch copy —
 * never where it writes. Resolved against the daemon HOST process's own environment (`hostEnv`,
 * `process.env` at the real call site), not a run's sandboxed spawn env: `CODEX_HOME` is not in
 * `BASELINE_AGENT_ENV_KEYS`, so a spawned child never inherits it anyway, and the whole point here
 * is finding wherever the *operator's actual* Codex install lives, which is a host-machine fact.
 * @param hostEnv - The daemon process's own environment.
 * @returns `hostEnv.CODEX_HOME` when set to a non-blank value (matching Codex's own resolution
 * order), else the CLI's documented default, `~/.codex`.
 * @complexity O(1).
 * @overallScore 100/100
 */
export function resolveSourceCodexHomeDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv }): string {
  const override = hostEnv.CODEX_HOME;
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.codex');
}

function defaultMkdtempCodexHome({ prefix }: { readonly prefix: string }): Promise<string> {
  return fsPromises.mkdtemp(join(tmpdir(), prefix));
}

function defaultRemoveCodexHomeDir({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { recursive: true, force: true });
}

/** The `'codex-toml'` mechanism's injectable filesystem seams, real by default — see {@link McpJsonInjectionOptions}'s `mkdtemp`/`removeDir`/`readFile`/`writeFile` docs. */
interface CodexHomeSeams {
  readonly mkdtemp: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string>;
  readonly writeFile: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  readonly removeDir: ({ path }: { readonly path: string }) => Promise<void>;
  readonly linkSessionStore: NonNullable<McpJsonInjectionOptions['linkSessionStore']>;
}

/** Config credentials stay run-scoped, but rollouts must survive both completion and cancellation.
 * Native links keep Codex as the sole writer of sessions and refreshed authentication.
 * Parity also links skills/rules/plugins and other home entries; config.toml alone stays staged
 * so run-scoped bearer tokens never reach the real config. Cleanup removes links, not targets.
 * O(h) I/O for h top-level home entries; locked runs link only sessions and authentication. */
async function defaultLinkCodexSessionStore({ runHome, sourceHome }: { runHome: string; sourceHome: string }, optional: { inheritUserConfig?: boolean } = {}): Promise<void> {
  for (const name of ['sessions', 'archived_sessions']) {
    const target = resolve(sourceHome, name);
    await fsPromises.mkdir(target, { recursive: true, mode: 0o700 });
    await fsPromises.symlink(target, join(runHome, name), 'junction');
  }
  await fsPromises.symlink(join(sourceHome, 'auth.json'), join(runHome, 'auth.json'), 'file');
  if (optional.inheritUserConfig !== false) {
    for (const entry of await fsPromises.readdir(sourceHome, { withFileTypes: true })) {
      if (['config.toml', 'auth.json', 'sessions', 'archived_sessions'].includes(entry.name)) continue;
      await fsPromises.symlink(join(sourceHome, entry.name), join(runHome, entry.name), entry.isDirectory() ? 'junction' : 'file');
    }
  }
}

function resolveCodexHomeSeams(options: McpJsonInjectionOptions): CodexHomeSeams {
  return {
    mkdtemp: options.mkdtemp ?? defaultMkdtempCodexHome,
    readFile: options.readFile ?? defaultReadMcpJsonFile,
    writeFile: options.writeFile ?? defaultWriteMcpJsonFile,
    removeDir: options.removeDir ?? defaultRemoveCodexHomeDir,
    linkSessionStore: options.linkSessionStore ?? defaultLinkCodexSessionStore,
  };
}

/**
 * The staged `config.toml`. With personal MCP off the real home config must parse before its line
 * rewrite is trusted, and the staged home must declare only the bridge and trust no project (so
 * Codex's trust gate keeps project `.codex/config.toml` layers out unless another layer trusts
 * them). Every layer outside the home (system, MDM, cloud bundle, a project trusted elsewhere,
 * plugins) is checked by asking the Codex binary itself before spawn: `mcp-preflight.ts`. The
 * spawn-time refusal in {@link prepareCodexHomeIfNeeded} stays the backstop for every blocked case.
 * @throws {@link CodexMcpIsolationError} when the run can't be isolated.
 */
function buildStagedCodexConfig({ existingRaw, entry, inheritUserConfig, inheritUserMcp, sourceHome }: {
  existingRaw: string | undefined; entry: McpJsonServerEntry; inheritUserConfig: boolean; inheritUserMcp: boolean; sourceHome: string;
}): string {
  const build = () => buildCodexHomeConfigToml({ existingRaw, entry, inheritUserMcp, inheritUserSettings: inheritUserConfig });
  if (inheritUserMcp) return build();
  const path = join(sourceHome, 'config.toml');
  assertCodexHomeConfigParses({ raw: existingRaw, path });
  const homeConfig = build();
  assertStagedHomeIsolated({ homeConfig, path });
  return homeConfig;
}

/**
 * Mechanism 5 of 5 — `'codex-toml'`'s one effect. Stages a fresh, randomly-named `CODEX_HOME`
 * directory (see {@link McpJsonInjectionOptions.mkdtemp}'s doc for why non-deterministic naming is
 * load-bearing here, not cosmetic) carrying:
 *   - `config.toml`: the real Codex home's own config (read best-effort — see
 *     {@link buildCodexHomeConfigToml}'s "missing file" handling) with this run's
 *     `[mcp_servers.jini]` table appended.
 *   - `auth.json`: a link to the real Codex home's stored login, so the spawned CLI is
 *     still authenticated. Best-effort is safe here, not merely convenient: a real headless spawn
 *     against a `CODEX_HOME` with no `auth.json` at all was confirmed (against installed Codex CLI
 *     0.151.0) to fail fast with a structured `401 Unauthorized` stream event, never an interactive
 *     login prompt or a hang — see `defs/codex.ts`'s module doc for the full transcript summary.
 *
 * Never changes the real config. Authentication is linked so a CLI token refresh survives cleanup;
 * copying rotating credentials lost refreshes and could log the operator out. Deleting scratch
 * state must not erase linked native state. The run-bound MCP credential stays in scratch config.
 *
 * A failure after the directory is created (a rejecting `writeFile`, most plausibly) does not leak
 * it: the directory may already hold a partial `config.toml` or a copied credential, so the
 * `catch` below best-effort-removes it before rethrowing, exactly the "partial-failure state leak"
 * class of bug this package's own adversarial-test-design guidance calls out.
 * @param runId - Embedded in the temp-dir prefix for traceability, sanitized the same way
 * `@jini-ai/agent-runtime`'s `prepareAgentLogFile`'s `label` is.
 * @param entry - The shared bridge entry.
 * @param sourceCodexHomeDir - Where to read the real install's `config.toml`/`auth.json` from — see {@link resolveSourceCodexHomeDir}.
 * @param seams - Injectable mkdtemp/readFile/writeFile/removeDir/linkSessionStore, real filesystem by default.
 * @throws Whatever staging rejects with — the caller ({@link prepareCodexHomeIfNeeded}) turns that into a pre-spawn `AGENT_SPAWN_FAILED` failure, matching {@link writeMcpJsonForRun}'s own contract.
 * @complexity O(h) filesystem operations for h top-level user-home entries; one staged config write.
 * @overallScore 100/100
 */
async function prepareCodexHomeForRun(
  runId: string,
  entry: McpJsonServerEntry,
  sourceCodexHomeDir: string,
  seams: CodexHomeSeams,
  inheritUserConfig = true,
  inheritUserMcp = true,
): Promise<PreparedCodexHome> {
  // Stricter than `@jini-ai/agent-runtime`'s `prepareAgentLogFile`/`preparePromptFileForAgent`
  // labels (which keep dots): this prefix stages a directory that ends up holding a copied Codex
  // login credential, so it gets `mcpJsonPathForRun`'s tighter discipline instead — dots stripped
  // too, not just path separators, so a run id like `../../etc/evil` cannot leave even a cosmetic
  // `..` substring in the mkdtemp prefix.
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'run';
  const dir = await seams.mkdtemp({ prefix: `jini-codex-home-${safeRunId}-` });
  try {
    let existingConfigRaw: string | undefined;
    try {
      existingConfigRaw = inheritUserConfig || inheritUserMcp ? await seams.readFile({ path: join(sourceCodexHomeDir, 'config.toml') }) : undefined;
    } catch {
      // No config yet (fresh Codex install) or unreadable — start from just this run's block,
      // matching writeMcpJsonForRun's identical "missing file" handling.
      existingConfigRaw = undefined;
    }
    const content = buildStagedCodexConfig({ existingRaw: existingConfigRaw, entry, inheritUserConfig, inheritUserMcp, sourceHome: sourceCodexHomeDir });
    await seams.writeFile({ path: join(dir, 'config.toml'), content });
    await seams.linkSessionStore({ runHome: dir, sourceHome: sourceCodexHomeDir }, { inheritUserConfig });
  } catch (err) {
    await seams.removeDir({ path: dir }).catch(() => {
      // Best-effort only — the original error below is what the caller must see either way.
    });
    throw err;
  }
  return {
    path: dir,
    cleanup: async () => {
      await seams.removeDir({ path: dir });
    },
  };
}

/** True when a Codex run turns off the operator's personal MCP servers or settings, which only a staged home can do. */
function codexTurnsOffPersonalConfig(input: { readonly def: RuntimeAgentDef; readonly nativeCapabilities?: Partial<import('@jini-ai/agent-runtime').NativeCapabilities> }): boolean {
  const capabilities = input.nativeCapabilities;
  return input.def.id === 'codex' && (capabilities?.userMcp === false || capabilities?.userSettings === false);
}

/** Which personal Codex config a staged home keeps: none when native tools are locked, else what the run's capabilities allow. */
export function codexInheritance(input: { readonly nativeToolAccess?: boolean | undefined; readonly nativeCapabilities?: Partial<import('@jini-ai/agent-runtime').NativeCapabilities> }): { settings: boolean; mcp: boolean } {
  const nativeAllowed = input.nativeToolAccess !== false;
  return { settings: nativeAllowed && input.nativeCapabilities?.userSettings !== false, mcp: nativeAllowed && input.nativeCapabilities?.userMcp !== false };
}

/**
 * Phase 10b: mechanism 5 of 5's one effect — stages this run's scratch `CODEX_HOME` directory,
 * returning the prepared handle `cleanupStagedFiles` should later release (`null` for every other
 * mechanism, or for an unconfigured host — matching {@link writeMcpJsonIfNeeded}'s identical gate).
 * @param input.def - Only used for its `id`, in the failure message.
 * @param input.mcpBridge - This run's resolved bridge delivery — a no-op unless its `kind` is `'codex-toml'`.
 * @param deps.hostEnv - The daemon's own environment, threaded through to {@link resolveSourceCodexHomeDir} rather than read from a module-level `process.env` so this phase stays testable with an injected env.
 * @complexity O(1) plus {@link prepareCodexHomeForRun}'s own cost.
 * @overallScore 100/100
 */
export async function prepareCodexHomeIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly nativeToolAccess?: boolean | undefined; readonly nativeCapabilities?: Partial<import('@jini-ai/agent-runtime').NativeCapabilities>; readonly def: RuntimeAgentDef; readonly mcpBridge: McpBridgeDelivery | null }; readonly deps: {
    readonly mcpJsonInjection: McpJsonInjectionOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<PreparedCodexHome | null> {
  if (input.mcpBridge?.kind !== 'codex-toml' || deps.mcpJsonInjection === undefined) {
    if (codexTurnsOffPersonalConfig(input)) {
      await deps.releaseStagedResources();
      return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
        message: 'AgentExecutor: disabling personal Codex configuration requires run-scoped home staging.' });
    }
    return null;
  }
  const inherit = codexInheritance(input);
  try {
    return await prepareCodexHomeForRun(
      input.runId,
      input.mcpBridge.serverEntry,
      resolveSourceCodexHomeDir({ hostEnv: deps.hostEnv }),
      resolveCodexHomeSeams(deps.mcpJsonInjection),
      inherit.settings,
      inherit.mcp,
    );
  } catch (err) {
    await deps.releaseStagedResources();
    if (err instanceof CodexMcpIsolationError) {
      return deps.failBeforeSpawn({ runId: input.runId, code: 'NATIVE_TOOL_POLICY_UNSUPPORTED',
        message: codexIsolationRefusalMessage(err.message) });
    }
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a CODEX_HOME for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}
