/** A staged, run-scoped Codex `CODEX_HOME` — the directory-holding analogue of {@link PreparedPromptFile}/{@link PreparedAgentLogFile} from `@jini-ai/agent-runtime`. */
export type PreparedCodexHome = {
  /** Absolute path to hand to the spawned child as its `CODEX_HOME` env var. */
  readonly path: string;
  /** Recursively removes the staged directory — the live `auth.json` copy it may hold makes this a confidentiality cleanup, not just tidiness. Safe to call more than once. */
  readonly cleanup: () => Promise<void>;
};

/**
 * The bridge server's name in the staged `config.toml`. It must equal the host's own bridge key (the daemon's
 * `JINI_MCP_SERVER_KEY`, passed to the slot as `serverName`); the daemon seam test pins that the two agree.
 */
export const JINI_MCP_SERVER_KEY = 'jini';

/** The stdio bridge entry the host built, as the staged config needs it. */
export interface CodexBridgeEntry {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

/** A private per-run HTTP listener: its URL and the bearer token that authorizes it. */
export type CodexHttpEndpoint = { readonly url: string; readonly token: string };

export type CodexToolApprovalOwner = 'host';

/** The run-scoped filesystem seams staging uses: read/write are always supplied by the host, the rest default to the real filesystem. */
export interface CodexHomeIo {
  readonly readFile: ({ path }: { readonly path: string }) => Promise<string>;
  readonly writeFile: ({ path, content }: { readonly path: string; readonly content: string }) => Promise<void>;
  readonly mkdtemp?: ({ prefix }: { readonly prefix: string }) => Promise<string>;
  readonly removeDir?: ({ path }: { readonly path: string }) => Promise<void>;
  readonly linkSessionStore?: (required: { runHome: string; sourceHome: string }, optional?: { inheritUserConfig?: boolean }) => Promise<void>;
}
