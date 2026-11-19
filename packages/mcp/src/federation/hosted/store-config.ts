import { SUPPORTED_EXTERNAL_MCP_TRANSPORTS } from "./vocabulary.js";
import { resolveExternalMcpAuthMode } from "./auth.js";
import { externalMcpAdmissionRevision, parseExternalMcpJsonArray, readExternalMcpToolGrants } from "./access.js";
import { openExternalMcpEnv } from "./vault.js";
import type { OpenDeps } from "./vault.js";
import { openExternalMcpStaticAccessToken, resolveExternalMcpAccessToken } from "./store-credentials.js";
import { FEDERATED_CONNECTION_DEFAULTS } from "../config.js";
import type { ResolvedFederatedConnection } from "../config.js";
import type { McpLaunchSpec } from "../ports.js";
import type { ExternalMcpAuthMode, ExternalMcpConfigFailure, ExternalMcpOAuthTokenResolverPort, ExternalMcpServerConfig, ExternalMcpServerRecord, ExternalMcpServerTarget, ExternalMcpStoreDeps, ExternalMcpTransport } from "@jini-ai/core/contracts/hosted-mcp";
import type { UUID } from "@jini-ai/core/primitives";
import type { HostedMcpStorePorts } from "./store-ports.js";

/** A failure entry for one record, in the shape {@link readEnabledExternalMcpConfigs} collects. */
function externalMcpFailure({ record, reason }: { record: ExternalMcpServerRecord; reason: string }, { category }: { category?: ExternalMcpConfigFailure["category"] } = {}): { readonly ok: false; readonly failure: ExternalMcpConfigFailure } {
  return { ok: false, failure: { serverId: record.serverId, reason, ...(category === undefined ? {} : { category }) } };
}

/**
 * Builds a `stdio` row's target: its pasted environment, plus the access token under the operator's
 * chosen variable name when the row is OAuth-authenticated.
 *
 * The two credential sources compose rather than exclude: a server can need a pasted `BASE_URL` AND
 * an OAuth bearer token. The OAuth-derived variable is applied LAST so it cannot be shadowed by a
 * stale hand-typed copy of the same name in the pasted block.
 */
async function resolveStdioTarget(
  record: ExternalMcpServerRecord,
  env: Record<string, string>,
  authMode: ExternalMcpAuthMode,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
  staticAccessToken: string | null,
  ports: HostedMcpStorePorts,
): Promise<{ readonly ok: true; readonly target: ExternalMcpServerTarget } | { readonly ok: false; readonly failure: ExternalMcpConfigFailure }> {
  if (!record.command) return externalMcpFailure({ record, reason: "no command is configured to launch it" });

  const withStaticToken = withStaticAccessToken(record, env, authMode, staticAccessToken);
  if (withStaticToken === null) {
    return externalMcpFailure({ record, reason: "no environment variable name is configured to receive its access token" });
  }
  let resolvedEnv = withStaticToken;
  if (authMode === "oauth") {
    if (!record.oauthTokenEnvName) {
      return externalMcpFailure({ record, reason: "no environment variable name is configured to receive its OAuth access token" });
    }
    const token = await resolveExternalMcpAccessToken(record, oauth, ports);
    if (!token.ok) return externalMcpFailure({ record, reason: token.reason }, { category: token.category });
    resolvedEnv = { ...resolvedEnv, [record.oauthTokenEnvName]: token.token };
  }

  return { ok: true, target: { kind: "stdio", command: record.command, args: parseExternalMcpJsonArray({ raw: record.args }), env: resolvedEnv } };
}

/**
 * Builds a hosted row's target: its endpoint, plus the bearer header when the row is
 * OAuth-authenticated.
 *
 * A hosted row's pasted `env` block is deliberately NOT turned into headers. An operator typing
 * `FOO=bar` means an environment variable, and silently promoting it to a request header would send
 * a value they scoped to a local process to a third party over the network. A hosted server's static
 * credential is the dedicated `static_env` access token instead: typed for THIS endpoint, and sent as
 * `Authorization: Bearer`.
 */
async function resolveHttpTarget(
  record: ExternalMcpServerRecord,
  authMode: ExternalMcpAuthMode,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
  staticAccessToken: string | null,
  ports: HostedMcpStorePorts,
): Promise<{ readonly ok: true; readonly target: ExternalMcpServerTarget } | { readonly ok: false; readonly failure: ExternalMcpConfigFailure }> {
  if (!record.url) return externalMcpFailure({ record, reason: "no URL is configured to reach it" });

  const headers: Record<string, string> = {};
  let shared = false;
  if (authMode === "static_env" && staticAccessToken !== null) headers.authorization = `Bearer ${staticAccessToken}`;
  if (authMode === "oauth") {
    const token = await resolveExternalMcpAccessToken(record, oauth, ports);
    if (!token.ok) return externalMcpFailure({ record, reason: token.reason }, { category: token.category });
    headers.authorization = `Bearer ${token.token}`;
    shared = token.shared === true;
  }

  if (headers.authorization !== undefined) {
    const failure = hostedTokenFailure({ authorization: headers.authorization, credential: ports.credential });
    if (failure !== null) return externalMcpFailure({ record, reason: failure });
  }
  return { ok: true, target: { kind: "streamable_http", url: record.url, headers,
    ...(shared ? { bearerToken: async () => {
      const token = await oauth!.resolveSharedAccessToken!({ serverId: record.serverId });
      if (token === undefined) throw new Error(`This shared connection was removed from this site. Choose a saved connection again in ${ports.settingsLink}.`);
      return token;
    } } : {}),
  } };
}

function hostedTokenFailure({ authorization, credential }: { authorization: string; credential: HostedMcpStorePorts["credential"] }, _options = {}): string | null {
  try { credential.assert({ value: authorization.slice('Bearer '.length), hosted: true }); }
  catch (err) { return err instanceof credential.InputError ? err.message : credential.messages.ascii; }
  return null;
}

/**
 * `env` with a `static_env` row's access token applied under its variable name — LAST, as the OAuth
 * token is in {@link resolveStdioTarget}, so a stale pasted copy of the same variable cannot shadow it.
 *
 * @returns `env` unchanged when the row holds no static token; `null` when it holds one but names no
 *   variable to put it in (the save path refuses that, so reaching it means another writer).
 * @complexity O(n) in the env variable count.
 */
function withStaticAccessToken(
  record: Pick<ExternalMcpServerRecord, "oauthTokenEnvName">,
  env: Record<string, string>,
  authMode: ExternalMcpAuthMode,
  staticAccessToken: string | null,
): Record<string, string> | null {
  if (authMode !== "static_env" || staticAccessToken === null) return env;
  if (!record.oauthTokenEnvName) return null;
  return { ...env, [record.oauthTokenEnvName]: staticAccessToken };
}

/** Resolves one ENABLED record into either a usable config or a failure entry, for
 *  {@link readEnabledExternalMcpConfigs}'s loop. */
async function resolveExternalMcpConfig(
  record: ExternalMcpServerRecord,
  deps: OpenDeps,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
): Promise<
  | { readonly ok: true; readonly config: ExternalMcpServerConfig }
  | { readonly ok: false; readonly failure: ExternalMcpConfigFailure }
> {
  const transport = record.transport as ExternalMcpTransport;
  if (!SUPPORTED_EXTERNAL_MCP_TRANSPORTS.includes(transport)) {
    return externalMcpFailure({ record, reason: `unsupported transport '${record.transport}'` });
  }
  const opened = await openExternalMcpEnv(record, deps);
  if (!opened.ok) return externalMcpFailure({ record, reason: opened.reason });

  const authMode = resolveExternalMcpAuthMode(record);
  const staticToken = await openExternalMcpStaticAccessToken(record, deps);
  if (!staticToken.ok) return externalMcpFailure({ record, reason: staticToken.reason });
  const resolved =
    transport === "stdio"
      ? await resolveStdioTarget(record, opened.env, authMode, oauth, staticToken.token, deps)
      : await resolveHttpTarget(record, authMode, oauth, staticToken.token, deps);
  if (!resolved.ok) return resolved;

  const grants = readExternalMcpToolGrants(record);
  return {
    ok: true,
    config: {
      serverId: record.serverId,
      ...(record.provisionedByPluginId ? { provisionedByPluginId: record.provisionedByPluginId } : {}),
      label: record.label ?? record.serverId,
      transport,
      authMode,
      enabled: true,
      allowedToolNames: grants.allowedToolNames,
      writeAllowedToolNames: grants.writeAllowedToolNames,
      target: resolved.target,
      admissionRevision: externalMcpAdmissionRevision(record),
    },
  };
}

/**
 * Reads and decrypts every ENABLED server, for the daemon's boot-time federation pass.
 *
 * A row whose sealed env cannot be opened is SKIPPED rather than thrown on, and the reason is
 * returned in `failures`. This mirrors `bootstrap.ts`'s fail-open posture for the same reason: a
 * rotated site key or a corrupt row must not stop the daemon booting, and one unusable server must
 * not take out a second working one. Disabled rows never reach the sealer at all.
 *
 * @returns The usable configs plus a per-server accounting of what could not be read.
 * @complexity O(n) in the enabled server count, one unseal each.
 * @overallScore 100
 */

export async function readEnabledExternalMcpConfigs(
  { deps, workspaceId }: { deps: Pick<ExternalMcpStoreDeps, "repo" | "sealer"> & { oauth?: ExternalMcpOAuthTokenResolverPort } & HostedMcpStorePorts; workspaceId: UUID },
  _optional: Record<string, never> = {},
): Promise<{ configs: ExternalMcpServerConfig[]; failures: ExternalMcpConfigFailure[] }> {
  const records = await deps.repo.listByWorkspaceId(workspaceId);
  const configs: ExternalMcpServerConfig[] = [];
  const failures: ExternalMcpConfigFailure[] = [];

  for (const record of records) {
    if (!record.enabled) continue;
    const resolved = await resolveExternalMcpConfig(record, deps, deps.oauth);
    if (resolved.ok) configs.push(resolved.config);
    else failures.push(resolved.failure);
  }

  return { configs, failures };
}

/**
 * Maps stored configs onto the shape `../bootstrap.ts` consumes.
 *
 * Timeouts and caps come from core's shared `FEDERATED_CONNECTION_DEFAULTS` rather than being
 * stored per server: they are policy about how much a third party may cost this process, which is
 * the host's call and not an operator preference. `allowedToolNames` is the one field that IS the
 * operator's, and it is passed through untouched for `trust.ts` to enforce.
 *
 * @param readOnlyRemoteNamesByServer - Reviewed manifest lists matched by the roster source;
 * never inferred from remote annotations or the tool admission allowlist.
 * @complexity O(n) time and output space in the config count.
 */
export function toResolvedFederatedConnections(
  { configs }: { configs: readonly ExternalMcpServerConfig[] },
  { readOnlyRemoteNamesByServer = new Map() }: { readOnlyRemoteNamesByServer?: ReadonlyMap<string, ReadonlySet<string>> } = {},
): ResolvedFederatedConnection[] {
  return configs.map((config) => ({
    ...(config.target.kind === "streamable_http" && config.target.bearerToken ? { bearerToken: config.target.bearerToken } : {}),
    config: {
      connectionId: config.serverId,
      ...(config.provisionedByPluginId ? { provisionedByPluginId: config.provisionedByPluginId } : {}),
      label: config.label,
      allowedToolNames: config.allowedToolNames,
      writeAllowedToolNames: config.writeAllowedToolNames,
      ...(readOnlyRemoteNamesByServer.has(config.serverId) ? { readOnlyRemoteNames: readOnlyRemoteNamesByServer.get(config.serverId)! } : {}),
      connectTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.connectTimeoutMs,
      callTimeoutMs: FEDERATED_CONNECTION_DEFAULTS.callTimeoutMs,
      maxResultBytes: FEDERATED_CONNECTION_DEFAULTS.maxResultBytes,
      maxTools: FEDERATED_CONNECTION_DEFAULTS.maxTools,
      origin: { kind: "roster", admissionRevision: config.admissionRevision },
    },
    launch: toFederatedLaunchSpec(config.target),
  }));
}

/** Maps a resolved target onto the federation layer's launch spec. The two shapes are deliberately
 *  separate — this one is the store's, that one is federation's — so neither domain has to widen
 *  when the other gains a field. */
function toFederatedLaunchSpec(target: ExternalMcpServerTarget): McpLaunchSpec {
  if (target.kind === "streamable_http") return { url: target.url, headers: target.headers };
  return {
    command: target.command,
    args: target.args,
    // The child's environment REPLACES the daemon's rather than extending it, matching the
    // Supabase preset. `PATH`/`HOME`/`TMPDIR` are added by the launcher, not here; anything else
    // a server needs is an explicit, written-down grant in its own env block.
    env: target.env,
  };
}
