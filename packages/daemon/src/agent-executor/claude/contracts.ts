/**
 * Finding 1 of SEC-assistant-env-isolation-2026-09-07 — a staged, run-scoped `claude` CLI config
 * directory, the `CLAUDE_CONFIG_DIR`-isolation analogue of {@link PreparedCodexHome} above.
 *
 * **The bug this closes:** `BASELINE_AGENT_ENV_KEYS` forwards `HOME` verbatim and neither this
 * package nor `@jini-ai/agent-runtime` ever set `CLAUDE_CONFIG_DIR`, so a spawned `claude` child
 * resolved its config (skills, plugins, agents, memory-path index, settings) from the OPERATOR's
 * own real `$HOME/.claude` — a personal grant (including `Task`/`Edit`/`Write`/`Cron*`/worktree
 * tools on this host) the host process never intended to hand the model.
 */
export type PreparedClaudeConfigDir = {
  /** Absolute path to hand to the spawned child as its `CLAUDE_CONFIG_DIR` env var. */
  readonly path: string;
  /** Recursively removes the staged directory — it may hold a copied login credential (see {@link prepareClaudeConfigDirForRun}'s doc), the same confidentiality-cleanup duty as {@link PreparedCodexHome.cleanup}. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

/** The Claude-config-dir mechanism's injectable filesystem seams, real by default — the directory-staging analogue of {@link CodexHomeSeams}, kept as its own small options bag (see {@link CreateAgentExecutorOptions.claudeConfigDirIsolation}) rather than folded into {@link McpJsonInjectionOptions}: isolating the operator's personal config is an env-hygiene concern independent of whether this host configured MCP federation at all, and must not be gated on that unrelated flag. */
export interface ClaudeConfigDirSeams {
  readonly mkdtemp: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string>;
  readonly writeFile: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  readonly removeDir: ({ path }: { readonly path: string }) => Promise<void>;
}

/**
 * `CreateAgentExecutorOptions.claudeConfigDirIsolation` — every field optional and real-filesystem
 * by default, matching the executor's standing "no real disk I/O by default in tests" convention (see
 * `preparePromptFileForAgent`/`prepareAgentLogFile`'s identical shape). Unlike
 * {@link McpJsonInjectionOptions}, this bag is never itself a gate: {@link
 * prepareClaudeConfigDirIfNeeded} stages a scratch directory for every `claude`-def run regardless
 * of whether a host supplies overrides here — this options bag only lets a test observe/replace the
 * filesystem calls, the same way `preparePromptFileForAgent`'s own default does.
 */
export interface ClaudeConfigDirIsolationOptions {
  /** @default the real `fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))` */
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  /** Reads the operator's real `.credentials.json`, if any — see {@link prepareClaudeConfigDirForRun}'s own doc. @default the real `fs.promises.readFile` (utf8) */
  readonly readFile?: ({ path }: { readonly path: string }) => Promise<string>;
  /** Writes the copied `.credentials.json` into the scratch directory. @default the real `fs.promises.writeFile` (utf8) */
  readonly writeFile?: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  /** @default `fs.promises.rm(path, { recursive: true, force: true })` — already-gone is success, not an error. */
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
}

export interface ClaudeExecutorOptions {
  /**
   * Finding 1 of SEC-assistant-env-isolation-2026-09-07's injectable filesystem seams — see
   * {@link ClaudeConfigDirIsolationOptions}'s own doc. This bag itself is still NOT a gate (supplying
   * it only lets a test observe/replace the real filesystem calls); whether staging happens AT ALL is
   * now {@link claudeConfigDirIsolationEnabled}'s job — see that field's doc for why the two were
   * split apart instead of overloading this one's presence as the switch.
   * @default the real `fs.promises.mkdtemp`/`readFile`/`rm` — no real disk I/O for every def other
   * than `claude`, matching this factory's "no real filesystem by default in tests" convention.
   */
  readonly claudeConfigDirIsolation?: ClaudeConfigDirIsolationOptions;
  /**
   * The actual on/off switch for Finding 1's `CLAUDE_CONFIG_DIR` isolation (see
   * {@link prepareClaudeConfigDirIfNeeded}'s doc for the staging behavior this gates). Split out as
   * its own boolean rather than reusing {@link claudeConfigDirIsolation}'s presence, because that bag
   * is a test-seam-injection convention shared with every other `*IsolationOptions`/`*Seams` field in
   * this file (see `mcpJsonInjection`'s own "NOT a gate" precedent) — overloading it here would mean a
   * host that only wants to override `mkdtemp` for a test silently also flips production behavior.
   *
   * @default `false`. This DEFAULTS OFF, which reopens the leak Finding 1 closed (the spawned
   * `claude` child again reads the operator's real `~/.claude` — skills, plugins, memory index, and
   * whatever tool grant that directory carries) — **not a regression discovered later, a deliberate
   * rollback landed the same day as the isolation fix itself.** Reason: on macOS the Keychain login
   * `claude auth status` reports is keyed to `CLAUDE_CONFIG_DIR` (see {@link
   * prepareClaudeConfigDirForRun}'s doc), and no caller of this factory was passing a credential of
   * its own (`AgentExecutorRunInput.credentialEnv`) when Finding 1 landed unconditionally — so every
   * isolated child ran unauthenticated and the assistant reported "Not logged in" on its default
   * runtime. A host that provisions a real `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` via
   * `credentialEnv` (both outrank Keychain login in Claude Code's own auth precedence, so an isolated,
   * still-logged-in child needs no access to the operator's personal Keychain entry at all) should
   * flip this back on — the mechanism itself is unchanged and was already proven live
   * (2026-09-07); only the default changed.
   */
  readonly claudeConfigDirIsolationEnabled?: boolean;
}
