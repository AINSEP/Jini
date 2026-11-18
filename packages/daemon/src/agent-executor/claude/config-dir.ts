import { promises as fsPromises } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import type { ClaudeConfigDirIsolationOptions, ClaudeConfigDirSeams, FailBeforeSpawn, PreparedClaudeConfigDir } from '../contracts.js';
import { defaultReadMcpJsonFile, defaultWriteMcpJsonFile } from '../mcp-json-file.js';
import { errorMessage } from '../values.js';

export const CLAUDE_CONFIG_DIR_ENV = 'CLAUDE_CONFIG_DIR';

export function withStagedClaudeConfigDir({ env, configDir }: { env: NodeJS.ProcessEnv; configDir: string }): NodeJS.ProcessEnv {
  return { ...env, [CLAUDE_CONFIG_DIR_ENV]: configDir };
}

function defaultMkdtempClaudeConfigDir({ prefix }: { readonly prefix: string }): Promise<string> {
  return fsPromises.mkdtemp(join(tmpdir(), prefix));
}

function defaultRemoveClaudeConfigDir({ path }: { readonly path: string }): Promise<void> {
  return fsPromises.rm(path, { recursive: true, force: true });
}

function resolveClaudeConfigDirSeams(options: ClaudeConfigDirIsolationOptions | undefined): ClaudeConfigDirSeams {
  return {
    mkdtemp: options?.mkdtemp ?? defaultMkdtempClaudeConfigDir,
    readFile: options?.readFile ?? defaultReadMcpJsonFile,
    writeFile: options?.writeFile ?? defaultWriteMcpJsonFile,
    removeDir: options?.removeDir ?? defaultRemoveClaudeConfigDir,
  };
}

/**
 * Where `claude`'s own config resolution reads the operator's REAL config from, to seed a run's
 * scratch copy — never where it writes. Mirrors {@link resolveSourceCodexHomeDir}'s exact reasoning
 * and resolution order: `CLAUDE_CONFIG_DIR` is not in `BASELINE_AGENT_ENV_KEYS`, so a spawned child
 * never inherits it anyway — the whole point is finding wherever the *operator's actual* Claude Code
 * install lives, a host-machine fact resolved against the daemon HOST process's own environment.
 * @param hostEnv - The daemon process's own environment.
 * @returns `hostEnv.CLAUDE_CONFIG_DIR` when set to a non-blank value (matching Claude Code's own
 * resolution order, confirmed against installed Claude Code 2.1.263), else the CLI's documented
 * default, `~/.claude`.
 * @complexity O(1).
 */
export function resolveSourceClaudeConfigDir({ hostEnv }: { readonly hostEnv: NodeJS.ProcessEnv }): string {
  const override = hostEnv.CLAUDE_CONFIG_DIR;
  return override !== undefined && override.trim().length > 0 ? override : join(homedir(), '.claude');
}

/**
 * Stages a fresh, randomly-named `CLAUDE_CONFIG_DIR` directory (same non-determinism requirement as
 * {@link McpJsonInjectionOptions.mkdtemp}'s own doc — `os.tmpdir()` is a shared location on a
 * multi-user host, so a guessable name is a real pre-plant/symlink target).
 *
 * **Deliberately empty by default** — unlike {@link prepareCodexHomeForRun}, which copies the real
 * `config.toml` wholesale (Codex has no personal-data problem in that file), this directory gets
 * NOTHING written into it beyond a best-effort copy of `.credentials.json` (see below). That is the
 * fix: the operator's real `skills`/`plugins`/`agents`/`memory-path index`/`settings.json` must NOT
 * carry over implicitly. `claude` runs correctly against a config directory holding nothing at all —
 * it falls back to its own built-in defaults, not an error.
 *
 * **Login preservation, verified rather than assumed** (per this task's own instruction — "prove
 * login still resolves; do not assume"): confirmed live (2026-09-07, installed Claude Code 2.1.263,
 * macOS) that `claude auth status` reports `loggedIn: false` against ANY `CLAUDE_CONFIG_DIR` other
 * than the operator's real one — including the real `HOME` with only `CLAUDE_CONFIG_DIR` swapped —
 * and confirmed against Claude Code's own docs (code.claude.com/docs/en/authentication) why: "If
 * you've set the CLAUDE_CONFIG_DIR environment variable, Claude Code keeps the .credentials.json
 * file under that directory instead, including the file the macOS fallback writes, and keys the
 * macOS Keychain entry to that directory too, so a session with a different CLAUDE_CONFIG_DIR reads
 * a different entry." So a scratch directory is never logged in by default on ANY platform, not just
 * the ones with no Keychain at all. This function only closes the *portable* case: when the source
 * directory holds a file-based `.credentials.json` (Linux, Windows, or a Keychain-locked macOS
 * fallback — none of which this function can distinguish, and does not need to), it is copied
 * best-effort into the scratch directory, exactly `prepareCodexHomeForRun`'s `auth.json` copy. When
 * it does not (a normal macOS Keychain-only install, confirmed the common case on this codebase's
 * own dev machine), this function does NOT attempt to read the macOS Keychain itself — that would
 * mean this daemon process extracting a live OAuth secret out of an OS-managed credential store into
 * a plaintext file, a materially different and larger security surface than forwarding an
 * already-resolved credential the host handed it (which `credentialEnv`/`ANTHROPIC_API_KEY` already
 * does, safely, today — see `AgentExecutorRunInput.credentialEnv`'s own doc). In that case this
 * mirrors `prepareCodexHomeForRun`'s own accepted outcome for a missing credential file verbatim:
 * "the spawned CLI runs unauthenticated" is documented, existing, precedented behavior in this file,
 * not a new failure mode invented here. A host that needs the isolated child to stay logged in on
 * such an install must supply a credential explicitly via `AgentExecutorRunInput.credentialEnv`
 * (`ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — both outrank Keychain-based subscription login
 * in Claude Code's own auth precedence, so the isolated child authenticates without ever needing the
 * operator's personal Keychain entry at all) — see this fix's own handoff report for the operational
 * consequence on a host with no such credential configured yet.
 *
 * **Never touches the real config directory.** `sourceConfigDir` is read-only throughout.
 * @param runId - Embedded in the temp-dir prefix for traceability, same sanitization discipline as {@link prepareCodexHomeForRun}'s `safeRunId`.
 * @param sourceConfigDir - Where to read a possible real `.credentials.json` from — see {@link resolveSourceClaudeConfigDir}.
 * @param seams - Injectable mkdtemp/readFile/writeFile/removeDir, real filesystem by default.
 * @throws Whatever `mkdtemp` rejects with — the caller ({@link prepareClaudeConfigDirIfNeeded}) turns that into a pre-spawn `AGENT_SPAWN_FAILED` failure, matching {@link prepareCodexHomeForRun}'s own contract.
 * @complexity O(1) plus one directory creation and up to one best-effort file read/write round trip.
 */
async function prepareClaudeConfigDirForRun(
  runId: string,
  sourceConfigDir: string,
  seams: ClaudeConfigDirSeams,
): Promise<PreparedClaudeConfigDir> {
  const safeRunId = runId.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'run';
  const dir = await seams.mkdtemp({ prefix: `jini-claude-config-${safeRunId}-` });
  try {
    const credentialsPath = join(sourceConfigDir, '.credentials.json');
    let credentialsRaw: string | undefined;
    try {
      credentialsRaw = await seams.readFile({ path: credentialsPath });
    } catch {
      // No file-based credential to copy (the common macOS-Keychain-only case) — see this
      // function's own doc for why that is an accepted, documented outcome, not a failure here.
      credentialsRaw = undefined;
    }
    if (credentialsRaw !== undefined) {
      await seams.writeFile({ path: join(dir, '.credentials.json'), content: credentialsRaw });
    }
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

/**
 * Finding 1 of SEC-assistant-env-isolation-2026-09-07's one effect — stages this run's scratch
 * `CLAUDE_CONFIG_DIR` directory, returning the prepared handle `cleanupStagedFiles` should later
 * release (`null` for every def other than `claude` — see {@link prepareClaudeConfigDirForRun}'s
 * own doc for why this is unconditional for `claude` runs, unlike {@link prepareCodexHomeIfNeeded}'s
 * gate on a host-configured MCP bridge strategy).
 *
 * Gated on `def.id === 'claude'` directly rather than on `externalMcpInjection === 'claude-mcp-json'`
 * (which `codebuddy` also declares): isolating the operator's personal `~/.claude` is specific to
 * the real `claude` CLI's own config resolution, not to every def that happens to share its `.mcp.
 * json` delivery shape. Matches the existing `USER`-for-claude-login special case already singled
 * out by id in `BASELINE_AGENT_ENV_KEYS`'s own doc in `launch.ts`.
 *
 * ALSO gated on `deps.enabled` (`CreateAgentExecutorOptions.claudeConfigDirIsolationEnabled`, default
 * `false`) since this task's own fix — see that field's doc for why it defaults off (Keychain login
 * is `CLAUDE_CONFIG_DIR`-keyed and no caller was supplying a credential when this was unconditional).
 * `def.id === 'claude'` is still checked first and independently: a host that flips this flag on
 * should not suddenly stage a directory for `codebuddy` or any other def.
 * @param input.def - Used for both the `id` gate and the failure message.
 * @param deps.enabled - The isolation on/off switch — see this function's own doc above.
 * @param deps.hostEnv - The daemon's own environment, threaded through to {@link resolveSourceClaudeConfigDir} rather than read from a module-level `process.env`, matching {@link prepareCodexHomeIfNeeded}'s identical testability reasoning.
 * @complexity O(1) plus {@link prepareClaudeConfigDirForRun}'s own cost.
 */
export async function prepareClaudeConfigDirIfNeeded({ input, deps }: { readonly input: { readonly runId: string; readonly def: RuntimeAgentDef }; readonly deps: {
    readonly enabled: boolean;
    readonly claudeConfigDirIsolation: ClaudeConfigDirIsolationOptions | undefined;
    readonly hostEnv: NodeJS.ProcessEnv;
    readonly releaseStagedResources: () => Promise<void>;
    readonly failBeforeSpawn: FailBeforeSpawn;
  } }
): Promise<PreparedClaudeConfigDir | null> {
  if (input.def.id !== 'claude' || !deps.enabled) {
    return null;
  }
  try {
    return await prepareClaudeConfigDirForRun(
      input.runId,
      resolveSourceClaudeConfigDir({ hostEnv: deps.hostEnv }),
      resolveClaudeConfigDirSeams(deps.claudeConfigDirIsolation),
    );
  } catch (err) {
    await deps.releaseStagedResources();
    return deps.failBeforeSpawn(
      { runId: input.runId, code: 'AGENT_SPAWN_FAILED', message: `AgentExecutor: could not stage a CLAUDE_CONFIG_DIR for agent "${input.def.id}": ${errorMessage(err)}` },
    );
  }
}
