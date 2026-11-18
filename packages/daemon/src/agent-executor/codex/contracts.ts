/** A staged, run-scoped Codex `CODEX_HOME` — the directory-holding analogue of {@link PreparedPromptFile}/{@link PreparedAgentLogFile} from `@jini-ai/agent-runtime`. */
export type PreparedCodexHome = {
  /** Absolute path to hand to the spawned child as its `CODEX_HOME` env var. */
  readonly path: string;
  /** Recursively removes the staged directory — the live `auth.json` copy it may hold makes this a confidentiality cleanup, not just tidiness. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

export interface CodexMcpHomeOptions {
  /**
   * `'codex-toml'` only. Creates a fresh, randomly-named directory `prepareCodexHomeForRun` stages
   * as a run's scratch `CODEX_HOME`. **Must be non-deterministic (a real `mkdtemp`, not a
   * caller-computed path)** — unlike `mcpJsonPathForRun`'s deterministic path inside the run's own
   * `cwd`, this directory holds a copy of the operator's real Codex login credential, and
   * `os.tmpdir()` is a shared location on a multi-user host: a guessable name there is a real
   * pre-plant/symlink target for another local user. `fs.mkdtemp`'s random suffix plus its `0700`
   * directory mode is the actual confidentiality control, matching the same reasoning
   * `@jini-ai/agent-runtime`'s `log-file.ts`/`prompt-file.ts` already apply to their own staged temp
   * dirs.
   * @param prefix - A caller-composed, run-id-derived prefix (already sanitized) for the mkdtemp
   * template; the real suffix mkdtemp appends is what makes the path unpredictable.
   * @default `fs.mkdtemp(path.join(os.tmpdir(), prefix))`
   */
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  /**
   * `'codex-toml'` only. Recursively removes the scratch `CODEX_HOME` directory `mkdtemp` above
   * created — the directory-level analogue of `removeFile`, needed because this mechanism stages a
   * whole directory (`config.toml` plus a copied `auth.json`), not one file.
   * @default `fs.rm(path, { recursive: true, force: true })` — already-gone is success, not an error.
   */
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
  /** `'codex-toml'` only. Links the run home's sessions/archived_sessions to the operator's
   * persistent rollout store and authentication. Parity also links user home entries; config alone stays isolated.
   * @default Native mkdir (0700) and directory symlinks; errors fail staging before spawn. */
  readonly linkSessionStore?: (required: { runHome: string; sourceHome: string }, optional?: { inheritUserConfig?: boolean }) => Promise<void>;
}

export interface CodexExecutorOptions {
  /** Explicit host/run policy; environment defaults belong to native composition. Native executor composition resolves its env default when absent. */
  readonly codexDisablePlugins?: boolean;
}
