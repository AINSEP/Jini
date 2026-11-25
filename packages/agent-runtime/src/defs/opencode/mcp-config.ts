import { isRecord } from '../../json-event-stream-shared.js';

/** The bridge entry the daemon hands over, structurally its `McpJsonServerEntry`: the daemon owns that shape, this file only reads it. */
type StdioBridgeEntry = { readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> };
type RemoteBridgeEntry = { readonly type: 'remote'; readonly url: string; readonly headers: Readonly<Record<string, string>> };
type HttpEndpoint = { readonly url: string; readonly token: string };

/** Merge the run-scoped HTTP endpoint into OpenCode's existing inline configuration. `envVar` is the variable the
 * runtime bound for this def's config document; `serverName` is the key the daemon registers its bridge under. */
export function withOpenCodeHttpMcp(
  { env, endpoint, envVar, serverName }: { env: NodeJS.ProcessEnv; endpoint: HttpEndpoint; envVar: string; serverName: string },
): NodeJS.ProcessEnv {
  return { ...env, [envVar]: mergeOpenCodeHttpMcpConfig({ existingRaw: env[envVar], endpoint, serverName }) };
}

/** Keep OpenCode's run-local inline carrier and its existing settings/instruction merge owner.
 * @returns Remote entry replacing stale stdio fields; only the endpoint token is delivered.
 * @complexity O(config bytes) time/space, without I/O.
 */
export function mergeOpenCodeHttpMcpConfig({ existingRaw, endpoint, serverName }: {
  existingRaw: string | undefined; endpoint: HttpEndpoint; serverName: string;
}, _options = {}): string {
  return mergeEnvContentMcpConfig({ existingRaw, serverName, entry: {
    type: 'remote', url: endpoint.url, headers: { Authorization: `Bearer ${endpoint.token}` },
  } });
}

/**
 * Serialises the bridge entry into the OpenCode-schema config JSON that `OPENCODE_CONFIG_CONTENT`
 * / `MIMOCODE_CONFIG_CONTENT` carries, merging into whatever the host already put in that variable
 * rather than replacing it — the same "merge, never clobber" discipline
 * `mergeMcpJsonContent` (daemon `.mcp.json` merge) applies to `.mcp.json`, and for the same reason: a host may already
 * be handing the CLI the *user's* configured MCP servers through this exact variable, and
 * overwriting it would silently delete them.
 *
 * A missing, empty, or unparseable-as-a-JSON-object existing value degrades to "start from an empty
 * document". Overwriting an unparseable value is deliberate and matches `mergeMcpJsonContent`: this
 * driver did not create it, cannot safely repair it, and must not block the run on it.
 *
 * Emitted per server: `{type: 'local', command: [<command>, ...<args>], environment: {...},
 * enabled: true}` — the shape `@jini-ai/mcp`'s own `buildOpenCodeMcpConfigContent` emits for a
 * stdio server, so both producers stay schema-compatible.
 *
 * **The credential lands in `environment`, i.e. the MCP child's env — never in `command`.** OpenCode
 * spawns the bridge from `command`, so a token placed there would be visible in `ps` output to
 * every other local user. This is the same constraint that keeps `JINI_DAEMON_TOKEN` out of argv on
 * the `.mcp.json` and ACP paths.
 *
 * @param existingRaw - Whatever the spawn env already held for this variable, or `undefined`.
 * @param entry - The shared bridge entry from `buildMcpJsonServerEntry` (daemon).
 * @param serverName - The `mcp` key the entry is registered under (the daemon's bridge key).
 * @returns The full JSON string to set as the env var's value.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify` over a small config document.
 * @overallScore 100/100
 */
export function mergeEnvContentMcpConfig({ existingRaw, entry, serverName }: { readonly existingRaw: string | undefined; readonly entry: StdioBridgeEntry | RemoteBridgeEntry; readonly serverName: string }): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined && existingRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingMcp = isRecord(doc.mcp) ? doc.mcp : {};
  const mcp = {
    ...existingMcp,
    [serverName]: 'command' in entry ? {
      type: 'local',
      command: [entry.command, ...entry.args],
      environment: { ...entry.env },
      enabled: true,
    } : entry,
  };
  return JSON.stringify({ ...doc, mcp });
}

/**
 * Merges a staged system-prompt overlay file's path into the `instructions` array of the same
 * OpenCode-schema config document {@link mergeEnvContentMcpConfig} writes `mcp` into — for a
 * `systemPromptDelivery: { strategy: 'config-instructions-file' }` def (`opencode` today).
 *
 * Confirmed live (2026-09-01, opencode-cli 1.17.10), not inferred from docs alone:
 *   1. `instructions` is honored — a run configured with it visibly followed the file's directive
 *      (a required exact-token prefix), while an identical run without it did not.
 *   2. It appends, never replaces: the same run that followed the custom instruction ALSO still
 *      answered correctly using opencode's own baked-in environment-context system prompt (asked
 *      for its cwd, with nothing about cwd anywhere in the custom instructions file) — proof
 *      opencode's own defaults survive alongside a custom `instructions` entry, not just proof the
 *      file was read at all.
 *   3. Adding this key alongside `mcp` in the same `OPENCODE_CONFIG_CONTENT` document disturbs
 *      neither: in one combined run, the MCP bridge still got its connection attempt (logged
 *      `key=jini type=local`) AND the custom instruction was still followed — same as running each
 *      key alone.
 *   4. `instructions` is re-read fresh from the env on every spawn, including a `-s <id>`-resumed
 *      turn (proved by swapping in a second instructions file between two turns of one resumed
 *      session and seeing the second turn immediately reflect it while still recalling
 *      conversation memory from turn one) — so this mechanism is safe to redeliver every turn like
 *      `'append-flag'`/`'env-var'`, exempt from the prompt-prefix fallback's create-only gating
 *      (see `resolveSystemPromptOverlayDelivery`'s doc (daemon)): nothing here is ever baked into
 *      opencode's own persisted session state the way re-injecting fallback prompt text would be.
 *
 * @param existingRaw - Whatever the spawn env already held for this variable (already possibly
 * carrying `mcp`, if `mergeEnvContentMcpConfig` ran first on the same value — order between the two
 * doesn't matter, each only touches its own top-level key), or `undefined`.
 * @param instructionsFilePath - The staged overlay file's absolute path (see
 * `prepareSystemPromptOverlayFileIfNeeded` (daemon)).
 * @returns The full JSON string to set as the env var's value. Appends to, never clobbers, any
 * `instructions` entries already present — the same "merge, never clobber" discipline
 * {@link mergeEnvContentMcpConfig} applies to `mcp`, in case a host is already using this same
 * config-content variable to carry the operator's own instruction files.
 * @complexity O(1) plus `JSON.parse`/`JSON.stringify` over a small config document.
 * @overallScore 100/100
 */
export function mergeEnvContentInstructions({ existingRaw, instructionsFilePath }: { readonly existingRaw: string | undefined; readonly instructionsFilePath: string }): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw !== undefined && existingRaw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (isRecord(parsed)) doc = parsed;
    } catch {
      doc = {};
    }
  }
  const existingInstructions = Array.isArray(doc.instructions)
    ? doc.instructions.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return JSON.stringify({ ...doc, instructions: [...existingInstructions, instructionsFilePath] });
}
