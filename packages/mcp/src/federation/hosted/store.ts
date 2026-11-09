import { ExternalMcpValidationError } from "./validation-error.js";
import { externalMcpAdmissionRevision, readExternalMcpToolGrants, validateExternalMcpToolNames, parseExternalMcpJsonArray } from "./access.js";
import type { ExternalMcpApprovedAccess } from "@jini-ai/core/contracts/hosted-mcp";
import { ToolInputError } from "@jini-ai/core";
import { resolveExternalMcpOAuthStatus } from "./auth.js";
/**
 * @file The operator-editable roster of external MCP servers — what Settings → External MCP writes,
 * and what the agent daemon reads at boot to decide which third-party servers to federate.
 *
 * This is the SECOND config source for `mcp-federation/`. The first is `presets.ts`, whose
 * resolvers read the host's `<VENDOR>_MCP_*` environment variables; it stays exactly as it was. The two
 * differ in kind, which is why this is not written as a preset: a preset resolver is synchronous and
 * returns at most one connection, while this store is async (sealing is promise-based) and returns
 * N. `bootstrap.ts`'s `extraConnections` parameter is the seam that carries them.
 *
 * ## Secrets
 *
 * An MCP server's `env` block routinely carries live credentials, so it is sealed through ADR-058's
 * Jini vault service using the same keyring instance the BYOK/media-provider stores share
 * — `src/webhooks/ports.ts` states the rule this follows: keep secret material out of the
 * portable `content.db`.
 *
 * The block is sealed WHOLE rather than per-variable. Every read path wants all of it at once (it
 * becomes one child process's environment), so per-variable sealing would buy nothing and cost N
 * round-trips. Variable NAMES are stored separately in plaintext so the tab can show which
 * variables are set without unsealing anything.
 *
 * ## What this file does NOT do
 *
 * It does not decide whether a remote tool may be called. That is `mcp-federation/trust.ts`'s
 * default-deny admission tier, applied at connect time to whatever this store produced.
 * `allowedToolNames` is carried here and enforced there, on purpose: a config store that also
 * adjudicated trust would be two mechanisms with one owner.
 *
 * It does not run the OAuth flow either. That is `features/external-mcp/external-mcp-oauth.ts` over the generic
 * client in `src/platform/oauth/`; this store owns only the ROW — which auth mode a server uses, its
 * plaintext OAuth metadata, and the sealed blob. Same split as `allowedToolNames`, same reason.
 *
 * ## Transport and auth mode are ORTHOGONAL
 *
 * {@link ExternalMcpTransport} and {@link ExternalMcpAuthMode} are two independent fields and must
 * stay that way. Encoding OAuth as a transport (`transport: "oauth"`) would be the wrong
 * abstraction immediately, not eventually: a hosted server may be HTTP + OAuth, and a LOCAL stdio
 * server may also require OAuth — the host obtains the token and hands it to the child process in its
 * environment. Both combinations are real, so neither field can be derived from the other.
 */
import { SUPPORTED_EXTERNAL_MCP_TRANSPORTS, EXTERNAL_MCP_OAUTH_GRANTS } from "./vocabulary.js";
import type { ExternalMcpTransport, ExternalMcpOAuthGrant, ExternalMcpServerRepoPort, ExternalMcpServerRecord, ExternalMcpServerTarget, ExternalMcpServerConfig, ExternalMcpServerView, ExternalMcpStoreDeps, ExternalMcpOAuthTokenResolverPort, SaveExternalMcpOAuthInput, SaveExternalMcpServerInput, ExternalMcpSealedOAuthPayload, SealedExternalMcpOAuth } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpStorePorts, HostedMcpTokenHint } from "./store-ports.js";

import { nowIso, type ISODateTime, type UUID } from "@jini-ai/core/primitives";

import type { SealedSecret, SecretSealerPort } from "@jini-ai/core/contracts/vault";
import { FEDERATED_CONNECTION_DEFAULTS, type ResolvedFederatedConnection } from "../config.js";
import type { McpLaunchSpec } from "../ports.js";
import { assertValidConnectionId } from "../trust.js";
import { EXTERNAL_MCP_AUTH_MODES, externalMcpRecordHasStaticAccessToken, resolveExternalMcpAuthMode } from "./auth.js";
import type { ExternalMcpAuthMode } from "@jini-ai/core/contracts/hosted-mcp";

/** `EXTERNAL_MCP_AUTH_MODES`/`ExternalMcpAuthMode` (how a server's credentials are obtained) and
 *  their two readers live in the shared contract leaf `contracts/core/external-mcp-auth.ts`
 *  (owner decision C — see that file's header). Imported from the shared contract leaf so every
 *  consumer reads the same mode vocabulary. */


import { ExternalMcpSecretStoreUnconfiguredError } from "./unconfigured-error.js";

/** One stored row. `sealedEnv` is null when the server needs no credentials, which is normal. */
/** Compatibility DTO version for normalized vault envelopes; historical formats live in recovery. */
export const EXTERNAL_MCP_VAULT_VERSION = 1;
type ExternalMcpIdentity = { workspaceId: string; serverId: string };
import { openExternalMcpVaultPayload, sealExternalMcpVaultPayload } from "./vault.js";
/** Per-call deps plus the host-bound store ports. */
/** @agent-note `repo/sealer/keyring/clock` are per call; every other member is bound once by the host. `repo` must be the same repository object whose envelopes `./vault.js` built. */
export type HostedMcpStoreDeps = ExternalMcpStoreDeps & HostedMcpStorePorts;
type SealDeps = Pick<ExternalMcpStoreDeps, "sealer" | "keyring"> & HostedMcpStorePorts;
type OpenDeps = { sealer: Pick<SecretSealerPort, "open"> } & HostedMcpStorePorts;
type CredentialPorts = Pick<HostedMcpStorePorts, "assertFreeField" | "credential">;

const MAX_SERVERS_PER_WORKSPACE = 32;
const MAX_ENV_VARS = 64;
const MAX_ARGS = 64;
/** POSIX-ish environment variable name. Deliberately stricter than what a shell tolerates: a name
 *  outside this set is far more likely a mis-pasted line than an intentional variable. */
const ENV_NAME_PATTERN = /^[A-Za-z_]\w*$/;
/** Generous — a provider asking for more distinct scopes than this is misconfigured, not ambitious. */
const MAX_OAUTH_SCOPES = 64;
/** Bounds the single-line OAuth identity fields (client id, secret). A real one is far shorter; the
 *  cap exists so a pasted file cannot become a database row. */
const MAX_OAUTH_FIELD_LENGTH = 1024;
/** Matches `src/platform/oauth/providers.ts`'s own rule. Restated rather than imported for the reason this
 *  file's header gives: the row shape must not depend on the flow module. */
const OAUTH_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Parses a stored JSON object column, tolerating a null/absent/corrupt value as `{}` — the same
 *  posture {@link parseJsonArray} takes, and for the same reason: one unreadable column must not
 *  make a whole row unreadable. */
function parseJsonObject(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

/** Validate exact approved access, then conditionally replace only the access columns.
 * @throws ExternalMcpValidationError for invalid names/subsets; ToolInputError if the source changed.
 * @complexity O(a+w) in at most 64 tool names per list, one conditional repository operation.
 */
export async function applyExternalMcpAccess(
  { repo, clock, workspaceId, serverId, expected, access, principalId }: ExternalMcpApprovedAccess & {
    repo: Pick<ExternalMcpServerRepoPort, 'updateAccessIfCurrent'>; clock: ExternalMcpStoreDeps['clock'];
  }, _options = {},
): Promise<void> {
  const allowedToolNames = validateExternalMcpToolNames({ names: access.allowedToolNames, field: 'allowedToolNames' });
  const writeAllowedToolNames = validateExternalMcpToolNames({ names: access.writeAllowedToolNames, field: 'writeAllowedToolNames' });
  assertWriteAllowlistSubset(writeAllowedToolNames, allowedToolNames);
  const applied = await repo.updateAccessIfCurrent({ workspaceId, serverId, expected,
    access: { enabled: access.enabled, allowedToolNames: JSON.stringify(allowedToolNames), writeAllowedToolNames: JSON.stringify(writeAllowedToolNames) },
    principalId, nowIso: nowIso({ clock }) });
  if (!applied) throw new ToolInputError({ message: `The '${serverId}' connection or its access changed while awaiting approval. Nothing was changed by this approval. Request its access change again to review the current proposal.` });
}

/**
 * Parses an operator's `KEY=VALUE`-per-line environment block into a map.
 *
 * Blank lines and `#` comments are skipped so an operator can annotate the block. Everything else
 * must parse: a line without `=` is rejected rather than ignored, because silently dropping what
 * looks like a credential is how a server ends up launching without the token the operator believes
 * they supplied. Only the FIRST `=` splits, so values may contain `=` (base64 padding, connection
 * strings).
 *
 * @param text - Raw textarea content.
 * @returns The parsed variables, in first-seen order.
 * @throws {ExternalMcpValidationError} On a malformed line, an invalid name, a duplicate, or more
 * than {@link MAX_ENV_VARS} variables.
 * @complexity O(n) in the number of lines.
 * @overallScore 100
 */
/** One line of {@link parseEnvBlock}'s input, parsed and name-validated but not yet checked against
 *  the running `env` map (dedup/cap are the loop's own job, since they need cross-line state). Split
 *  out purely to keep `parseEnvBlock`'s cognitive complexity under the shop ceiling — `null` means
 *  "skip this line" (blank or `#` comment), matching the original inline `continue`. */
function parseEnvLine(rawLine: string, index: number): { readonly name: string; readonly value: string } | null {
  const line = rawLine;
  if (line.trim() === "" || line.trimStart().startsWith("#")) return null;

  const separator = line.indexOf("=");
  // Validation reaches the model through the human form; never echo the credential block.
  if (separator <= 0) {
    throw new ExternalMcpValidationError(
      `line ${index + 1} of the environment block is not \`NAME=VALUE\` — correct it in the connection form`,
      "env",
    );
  }

  const name = line.slice(0, separator).trim();
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new ExternalMcpValidationError(
      `line ${index + 1} of the environment block has an invalid variable name (letters, digits and underscore, not starting with a digit)`,
      "env",
    );
  }
  return { name, value: line.slice(separator + 1).trim() };
}

/** @agent-note `ports` are the host-bound credential rules (length cap, messages, secret-in-plain-field check). */
export function parseEnvBlock(text: string, ports: CredentialPorts): Record<string, string> {
  // JSON is the lossless representation for multiline values; NAME=VALUE remains compatible.
  if (text.trimStart().startsWith('{')) {
    return parseJsonEnvBlock({ text, ports });
  }
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const parsed = parseEnvLine(rawLine, index);
    if (!parsed) continue;
    // Rejected rather than last-write-wins: two lines setting the same variable means the operator
    // believes both are in effect, and picking one silently is the failure mode this guards.
    if (Object.hasOwn(env, parsed.name)) {
      throw new ExternalMcpValidationError(`environment variable '${parsed.name}' is set more than once`, "env");
    }
    if (Object.keys(env).length >= MAX_ENV_VARS) {
      throw new ExternalMcpValidationError(`at most ${MAX_ENV_VARS} environment variables are supported`, "env");
    }
    if (parsed.value.length > ports.credential.limit) throw new ExternalMcpValidationError("The token exceeds the 8192-character limit. Copy only the token.", "env");
    assertExternalMcpPlainField({ value: parsed.name, field: "env" }, ports);
    env[parsed.name] = parsed.value;
  }

  return env;
}

function assertJsonEnvEntry({ name, value, ports }: { name: string; value: unknown; ports: CredentialPorts }, _options = {}): void {
  if (!ENV_NAME_PATTERN.test(name) || typeof value !== 'string' || value.includes('\0')) throw new ExternalMcpValidationError(ports.credential.messages.env, 'env');
  assertExternalMcpPlainField({ value: name, field: 'env' }, ports);
  if (value.length > ports.credential.limit) throw new ExternalMcpValidationError('The token exceeds the 8192-character limit. Copy only the token.', 'env');
}

function parseJsonEnvBlock({ text, ports }: { text: string; ports: CredentialPorts }, _options = {}): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ExternalMcpValidationError(ports.credential.messages.env, 'env'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ExternalMcpValidationError(ports.credential.messages.env, 'env');
  const entries = Object.entries(parsed);
  if (entries.length > MAX_ENV_VARS) throw new ExternalMcpValidationError(`at most ${MAX_ENV_VARS} environment variables are supported`, 'env');
  for (const [name, value] of entries) assertJsonEnvEntry({ name, value, ports });
  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Splits an operator's space-separated argv string.
 *
 * One quoting rule, and only one: a token that STARTS with `"` runs to the next `"`, which must end
 * the token (whitespace or end of string after it), and both quotes are dropped. That is what lets a
 * path with a space in it — `"C:\\Users\\John Smith\\..."`, the desktop shell's win32
 * registration — arrive as one argument. There are no escapes (a backslash is always literal, since
 * Windows paths are full of them), and a `"` anywhere else in a token stays literal exactly as it did
 * before this rule existed, so `--name="x"` still reaches the child unchanged. This is NOT shell
 * quoting: the command is spawned WITHOUT a shell (`adapter.stdio.ts` uses `spawn` with an argv
 * array), and nothing else a shell would do happens here.
 *
 * @throws {ExternalMcpValidationError} On an unterminated quoted token, a closing quote followed by
 *   more characters, or more than `MAX_ARGS` arguments.
 * @complexity O(n) in the string length.
 */
export function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < raw.length) {
    if (/\s/.test(raw[index]!)) {
      index += 1;
      continue;
    }
    const token = raw[index] === '"' ? readQuotedArg(raw, index) : readBareArg(raw, index);
    args.push(token.value);
    index = token.end;
  }
  if (args.length > MAX_ARGS) {
    throw new ExternalMcpValidationError(`at most ${MAX_ARGS} arguments are supported`, "args");
  }
  return args;
}

/** {@link parseArgs}'s unquoted token: everything up to the next whitespace, quotes included. */
function readBareArg(raw: string, start: number): { readonly value: string; readonly end: number } {
  const match = /\s/.exec(raw.slice(start));
  const end = match === null ? raw.length : start + match.index;
  return { value: raw.slice(start, end), end };
}

/** {@link parseArgs}'s quoted token, `start` pointing at its opening `"`.
 *  @throws {ExternalMcpValidationError} When the quote never closes, or does not end the token. */
function readQuotedArg(raw: string, start: number): { readonly value: string; readonly end: number } {
  const close = raw.indexOf('"', start + 1);
  if (close === -1) {
    throw new ExternalMcpValidationError("an argument opens a double quote that never closes", "args");
  }
  const end = close + 1;
  if (end < raw.length && !/\s/.test(raw[end]!)) {
    throw new ExternalMcpValidationError("a closing double quote must be followed by a space or the end of the arguments", "args");
  }
  return { value: raw.slice(start + 1, close), end };
}

/**
 * Splits an operator's comma-separated list of remote tool names, shared by {@link
 * parseAllowedToolNames} and {@link parseWriteAllowedToolNames} — the two lists use the identical
 * charset, cap and dedup rule, and differ only in which field a rejection names.
 *
 * An empty result is a legitimate, meaningful value on either list — it yields a server that
 * contributes (or write-authorizes) zero tools — so it is returned rather than rejected. That is the
 * safe direction and matches `trust.ts` R2's default-deny posture.
 *
 * @throws {ExternalMcpValidationError} On a name the trust tier would refuse anyway, so the operator
 * learns at save time instead of discovering an unexplained absence after a restart.
 * @complexity O(n) in the number of names.
 */
function parseToolNameList(raw: string, field: string): string[] {
  const names = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return validateExternalMcpToolNames({ names, field });
}

/**
 * Splits an operator's comma-separated allowlist of remote tool names.
 *
 * @throws {ExternalMcpValidationError} See {@link parseToolNameList}. `field` is `"allowedToolNames"`.
 * @complexity O(n) in the number of names.
 * @overallScore 100
 */
export function parseAllowedToolNames(raw: string): string[] {
  return parseToolNameList(raw, "allowedToolNames");
}

/**
 * Splits an operator's comma-separated list of remote tool names separately authorized to write —
 * `trust.ts` R3's override, checked only after {@link parseAllowedToolNames}'s allowlist passes (see
 * {@link assertWriteAllowlistSubset}).
 *
 * @throws {ExternalMcpValidationError} See {@link parseToolNameList}. `field` is
 * `"writeAllowedToolNames"`.
 * @complexity O(n) in the number of names.
 * @overallScore 100
 */
export function parseWriteAllowedToolNames(raw: string): string[] {
  return parseToolNameList(raw, "writeAllowedToolNames");
}

/**
 * C-006: a tool may be write-authorized only if it is ALSO allowlisted. Enforced at save time so an
 * operator learns of the mistake immediately rather than the entry sitting inert (or, worse, being
 * misread as intentional) until a boot-time report surfaces it.
 *
 * @throws {ExternalMcpValidationError} Naming the first write-authorized tool absent from the
 * allowlist, with `field === "writeAllowedToolNames"`.
 * @complexity O(n) in the number of write-authorized names.
 */
function assertWriteAllowlistSubset(writeAllowedToolNames: readonly string[], allowedToolNames: readonly string[]): void {
  const allowed = new Set(allowedToolNames);
  for (const name of writeAllowedToolNames) {
    if (!allowed.has(name)) {
      throw new ExternalMcpValidationError(
        `'${name}' is authorized to write but is not in the allowlist — a tool must be allowlisted before it can be write-authorized`,
        "writeAllowedToolNames",
      );
    }
  }
}

/** Whether two tool-name lists name the same SET of tools, ignoring order — the write list is a set
 *  of operator decisions, not an ordered sequence, so a save that re-sends the same names in a
 *  different order must not read as a change. Used only to decide whether {@link
 *  resolveWriteGrantAttribution} owes a new attribution.
 *  @complexity O(n) in the longer list. */
function toolNameSetsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((name) => setB.has(name));
}

/**
 * Whether this row holds an access TOKEN — answered from PLAINTEXT columns alone, never by unsealing.
 *
 * Token clearing preserves the client secret sharing the sealed blob (setOAuthStatus). A
 * disconnected row can therefore have a non-null blob containing a secret but no access token;
 * blob presence alone cannot answer this question.
 *
 * Not repaired by unsealing, deliberately. This is read by a plain list route that must answer
 * without a keyring round trip, and must keep answering TRUTHFULLY for a row whose blob will not
 * open at all: a rotated site key, or a legacy `aad_version 0` ciphertext. A decrypt here would turn
 * either into a failed settings tab, and would put a keyring dependency on a read path that has
 * never had one.
 *
 * The blob check leads because it is the NECESSARY condition — no blob, no token, whatever the
 * plaintext says. Each of the two disjuncts after it is independently SUFFICIENT, which is what
 * makes a false positive unreachable:
 *
 * - `connected` is written by exactly one place, `persistTokens`, and that same upsert writes the
 *   tokens. Every path that clears a token moves the row off `connected` in the same write.
 * - `oauthExpiresAt` is written beside the tokens by that same `persistTokens`, and nulled by every
 *   clear (`setOAuthStatus`'s `clearToken` branch) and by every save that invalidates the token
 *   ({@link carryOAuthRuntimeState}), so a non-null expiry cannot outlive the token it describes.
 *
 * @returns `true` only when a token is stored. The single state it can UNDER-report is a token
 * issued with no `expires_in` — RFC 6749 §5.1 makes it optional and `platform/oauth/token-endpoint
 * .ts` stores `null` rather than fabricating one — on a row that has since moved off `connected`
 * without its token being cleared: a re-connect left `pending`, or a terminal device-poll failure.
 * Under-reporting is the safe direction, and closing it exactly needs a plaintext token-presence
 * column, which is a schema change rather than a read fix.
 * @complexity O(1) — three field reads, no I/O.
 */
export function externalMcpRecordHasStoredToken(
  record: Pick<ExternalMcpServerRecord, "sealedOAuth" | "oauthStatus" | "oauthExpiresAt">,
): boolean {
  if (record.sealedOAuth === null) return false;
  return resolveExternalMcpOAuthStatus(record) === "connected" || record.oauthExpiresAt !== null;
}

async function externalMcpEnvHints({ record, sealer, ports }: { record: ExternalMcpServerRecord; sealer?: SecretSealerPort | undefined; ports: HostedMcpStorePorts }, _options = {}) {
  const envTokenHints: Record<string, HostedMcpTokenHint> = {};
  if (!sealer || !record.sealedEnv) return envTokenHints;
  const opened = await openExternalMcpEnv(record, { ...ports, sealer });
  if (!opened.ok) return envTokenHints;
  for (const [name, value] of Object.entries(opened.env)) {
    if (typeof value === 'string') envTokenHints[name] = ports.credential.hint({ token: value });
  }
  return envTokenHints;
}

async function externalMcpAccessTokenHint({ record, sealer, ports }: { record: ExternalMcpServerRecord; sealer?: SecretSealerPort | undefined; ports: HostedMcpStorePorts }, _options = {}) {
  let accessTokenHint: HostedMcpTokenHint | null = null;
  if (sealer && record.sealedOAuth) {
    try {
      const payload = await openExternalMcpOAuthPayload({ ...ports, sealer }, record);
      const token = payload.staticAccessToken ?? payload.tokens?.accessToken;
      if (token) accessTokenHint = ports.credential.hint({ token });
    } catch { /* A rotated site key must not prevent listing non-secret metadata. */ }
  }
  return accessTokenHint;
}

async function toView(record: ExternalMcpServerRecord, ports: HostedMcpStorePorts, sealer?: SecretSealerPort): Promise<ExternalMcpServerView<HostedMcpTokenHint>> {
  const envTokenHints = await externalMcpEnvHints({ record, sealer, ports });
  const accessTokenHint = await externalMcpAccessTokenHint({ record, sealer, ports });
  return {
    serverId: record.serverId,
    label: record.label ?? record.serverId,
    provisionedByPluginId: record.provisionedByPluginId,
    transport: record.transport,
    authMode: resolveExternalMcpAuthMode(record),
    enabled: record.enabled,
    command: record.command ?? "",
    url: record.url,
    args: parseExternalMcpJsonArray({ raw: record.args }),
    allowedToolNames: parseExternalMcpJsonArray({ raw: record.allowedToolNames }),
    writeAllowedToolNames: parseExternalMcpJsonArray({ raw: record.writeAllowedToolNames }),
    writeGrantsUpdatedByPrincipalId: record.writeGrantsUpdatedByPrincipalId,
    writeGrantsUpdatedAt: record.writeGrantsUpdatedAt,
    envNames: parseExternalMcpJsonArray({ raw: record.envNames }),
    hasAccessToken: externalMcpRecordHasStaticAccessToken(record),
    accessTokenHint,
    ...(Object.keys(envTokenHints).length ? { envTokenHints } : {}),
    accessTokenEnvName: resolveExternalMcpAuthMode(record) === "static_env" ? record.oauthTokenEnvName : null,
    oauth: {
      providerId: record.oauthProviderId,
      grant: record.oauthGrant,
      clientId: record.oauthClientId,
      scopes: parseExternalMcpJsonArray({ raw: record.oauthScopesJson }),
      status: resolveExternalMcpOAuthStatus(record),
      expiresAt: record.oauthExpiresAt,
      tokenEnvName: record.oauthTokenEnvName,
      hasStoredToken: externalMcpRecordHasStoredToken(record),
    },
  };
}

/**
 * Lists the workspace's servers for the admin tab. The tab has no use for env
 * values and must not be a route that decrypts them. Token hints alone are now derived by
 * server-side unsealing, per the owner decision; no secret value is returned.
 *
 * @complexity O(n) in the stored server count.
 * @overallScore 100
 */
export async function listExternalMcpServerViews(
  deps: Pick<ExternalMcpStoreDeps, "repo"> & Partial<Pick<ExternalMcpStoreDeps, "sealer">> & HostedMcpStorePorts,
  workspaceId: UUID,
): Promise<ExternalMcpServerView<HostedMcpTokenHint>[]> {
  const records = await deps.repo.listByWorkspaceId(workspaceId);
  return Promise.all(records.map(record => toView(record, deps, deps.sealer)));
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
/** Opens `record`'s sealed env block, or returns `{}` when there is none to open. Split out of
 *  {@link resolveExternalMcpConfig} purely to keep that function's complexity under the shop
 *  ceiling — a decrypt failure is reported through the same ok/reason shape the caller already
 *  threads through, not thrown, since one unreadable server must not abort the whole read. */
async function openExternalMcpEnv(
  record: Pick<ExternalMcpServerRecord, "sealedEnv" | "workspaceId" | "serverId" | "aadVersion">,
  deps: OpenDeps,
): Promise<{ readonly ok: true; readonly env: Record<string, string> } | { readonly ok: false; readonly reason: string }> {
  if (record.sealedEnv === null) return { ok: true, env: {} };
  try {
    const env = await openExternalMcpVaultPayload({ sealer: deps.sealer, sealed: record.sealedEnv, identity: record, kind: "mcp-env", ports: deps }) as Record<string, string>;
    return { ok: true, env };
  } catch {
    // These reasons reach admissions and chat tools. Parser/sealer errors can contain secret plaintext.
    return { ok: false, reason: `stored credentials could not be decrypted — check the site credential store and re-enter them in ${deps.settingsLink}` };
  }
}

/**
 * A `needs_reauth`/`disconnected`/`pending` row is reported rather than connected.
 *
 * Reported, not silently skipped: an operator whose token expired needs to see WHY the server's
 * tools vanished, and the reason string is the only thing carrying that at boot. The admin tab's
 * `needs_reauth` badge is the out-of-band half of the same signal.
 */
function oauthStatusFailure(record: ExternalMcpServerRecord, settingsLink: string): string | null {
  const status = resolveExternalMcpOAuthStatus(record);
  if (status === "connected") return null;
  if (status === "needs_reauth") {
    return `its authorization expired or was revoked — reconnect it in ${settingsLink}`;
  }
  return `it has not been authorized yet (status '${status}') — connect it in ${settingsLink}`;
}

/**
 * Obtains one record's OAuth access token, or explains why it cannot be.
 *
 * Returns the raw token rather than a placement, because WHERE it goes is the transport's business:
 * a child-process variable for `stdio`, an `Authorization` header for a hosted endpoint. Splitting
 * "can we get a token" from "where does it go" is what stops the second question's answer from
 * being duplicated per transport.
 *
 * @complexity O(1) plus at most one token refresh round trip.
 */
async function resolveExternalMcpAccessToken(
  record: ExternalMcpServerRecord,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
  { settingsLink, reauthRequiredCode }: Pick<HostedMcpStorePorts, "settingsLink" | "reauthRequiredCode">,
): Promise<{ readonly ok: true; readonly token: string; readonly shared?: true } | { readonly ok: false; readonly reason: string }> {
  try {
    const shared = await oauth?.resolveSharedAccessToken?.({ serverId: record.serverId });
    if (shared !== undefined) return { ok: true, token: shared, shared: true };
  } catch { return { ok: false, reason: `This shared connection is no longer granted to this site. Choose it again or sign in from ${settingsLink}.` }; }
  const statusFailure = oauthStatusFailure(record, settingsLink);
  if (statusFailure !== null) return { ok: false, reason: statusFailure };
  if (!oauth) {
    return { ok: false, reason: "this process was not wired with an OAuth token resolver, so its access token cannot be obtained" };
  }
  return resolveOwnedAccessToken(record, oauth, { settingsLink, reauthRequiredCode });
}

/** {@link resolveExternalMcpAccessToken}'s last step, split out unchanged to keep each function under the complexity limit. */
async function resolveOwnedAccessToken(
  record: ExternalMcpServerRecord,
  oauth: ExternalMcpOAuthTokenResolverPort,
  { settingsLink, reauthRequiredCode }: Pick<HostedMcpStorePorts, "settingsLink" | "reauthRequiredCode">,
): Promise<{ readonly ok: true; readonly token: string } | { readonly ok: false; readonly reason: string }> {
  try {
    return { ok: true, token: await oauth.resolveAccessToken({ serverId: record.serverId }) };
  } catch (err) {
    // Preserve reauthorization as a typed outcome, without echoing raw provider error messages.
    const needsReauth = err instanceof Error && "code" in err && err.code === reauthRequiredCode;
    return { ok: false, reason: needsReauth
      ? `its authorization expired or was revoked — reconnect it in ${settingsLink}`
      : `its OAuth access token could not be obtained: OAuth token resolution failed — reconnect this server in ${settingsLink}` };
  }
}

/** A failure entry for one record, in the shape {@link readEnabledExternalMcpConfigs} collects. */
function externalMcpFailure(record: ExternalMcpServerRecord, reason: string): { readonly ok: false; readonly failure: { serverId: string; reason: string } } {
  return { ok: false, failure: { serverId: record.serverId, reason } };
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
): Promise<{ readonly ok: true; readonly target: ExternalMcpServerTarget } | { readonly ok: false; readonly failure: { serverId: string; reason: string } }> {
  if (!record.command) return externalMcpFailure(record, "no command is configured to launch it");

  const withStaticToken = withStaticAccessToken(record, env, authMode, staticAccessToken);
  if (withStaticToken === null) {
    return externalMcpFailure(record, "no environment variable name is configured to receive its access token");
  }
  let resolvedEnv = withStaticToken;
  if (authMode === "oauth") {
    if (!record.oauthTokenEnvName) {
      return externalMcpFailure(record, "no environment variable name is configured to receive its OAuth access token");
    }
    const token = await resolveExternalMcpAccessToken(record, oauth, ports);
    if (!token.ok) return externalMcpFailure(record, token.reason);
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
): Promise<{ readonly ok: true; readonly target: ExternalMcpServerTarget } | { readonly ok: false; readonly failure: { serverId: string; reason: string } }> {
  if (!record.url) return externalMcpFailure(record, "no URL is configured to reach it");

  const headers: Record<string, string> = {};
  let shared = false;
  if (authMode === "static_env" && staticAccessToken !== null) headers.authorization = `Bearer ${staticAccessToken}`;
  if (authMode === "oauth") {
    const token = await resolveExternalMcpAccessToken(record, oauth, ports);
    if (!token.ok) return externalMcpFailure(record, token.reason);
    headers.authorization = `Bearer ${token.token}`;
    shared = token.shared === true;
  }

  if (headers.authorization !== undefined) {
    const failure = hostedTokenFailure({ authorization: headers.authorization, credential: ports.credential });
    if (failure !== null) return externalMcpFailure(record, failure);
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

/**
 * Opens a `static_env` row's sealed access token, or resolves `null` when it holds none — without
 * touching the sealer for any other row. A blob that will not open is a per-row failure, the same
 * posture {@link openExternalMcpEnv} takes for the env block.
 *
 * @complexity O(1) — at most one unseal.
 */
async function openExternalMcpStaticAccessToken(
  record: ExternalMcpServerRecord,
  deps: OpenDeps,
): Promise<{ readonly ok: true; readonly token: string | null } | { readonly ok: false; readonly reason: string }> {
  if (!externalMcpRecordHasStaticAccessToken(record)) return { ok: true, token: null };
  try {
    const payload = await openExternalMcpOAuthPayload(deps, record);
    return { ok: true, token: payload.staticAccessToken ?? null };
  } catch {
    // Never put decrypted payloads or cryptographic exception text into an operator/model response.
    return { ok: false, reason: `its stored access token could not be decrypted — re-enter it in ${deps.settingsLink}` };
  }
}

/** Resolves one ENABLED record into either a usable config or a failure entry, for
 *  {@link readEnabledExternalMcpConfigs}'s loop. */
async function resolveExternalMcpConfig(
  record: ExternalMcpServerRecord,
  deps: OpenDeps,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
): Promise<
  | { readonly ok: true; readonly config: ExternalMcpServerConfig }
  | { readonly ok: false; readonly failure: { serverId: string; reason: string } }
> {
  const transport = record.transport as ExternalMcpTransport;
  if (!SUPPORTED_EXTERNAL_MCP_TRANSPORTS.includes(transport)) {
    return externalMcpFailure(record, `unsupported transport '${record.transport}'`);
  }
  const opened = await openExternalMcpEnv(record, deps);
  if (!opened.ok) return externalMcpFailure(record, opened.reason);

  const authMode = resolveExternalMcpAuthMode(record);
  const staticToken = await openExternalMcpStaticAccessToken(record, deps);
  if (!staticToken.ok) return externalMcpFailure(record, staticToken.reason);
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

export async function readEnabledExternalMcpConfigs(
  deps: Pick<ExternalMcpStoreDeps, "repo" | "sealer"> & { oauth?: ExternalMcpOAuthTokenResolverPort } & HostedMcpStorePorts,
  workspaceId: UUID,
): Promise<{ configs: ExternalMcpServerConfig[]; failures: { serverId: string; reason: string }[] }> {
  const records = await deps.repo.listByWorkspaceId(workspaceId);
  const configs: ExternalMcpServerConfig[] = [];
  const failures: { serverId: string; reason: string }[] = [];

  for (const record of records) {
    if (!record.enabled) continue;
    const resolved = await resolveExternalMcpConfig(record, deps, deps.oauth);
    if (resolved.ok) configs.push(resolved.config);
    else failures.push(resolved.failure);
  }

  return { configs, failures };
}

/**
 * Maps stored configs onto the shape `mcp-federation/bootstrap.ts` consumes.
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
  configs: readonly ExternalMcpServerConfig[],
  readOnlyRemoteNamesByServer: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
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

/**
 * Validates and persists one server, sealing its env block.
 *
 * `env: undefined` preserves whatever is already stored, which is what lets the tab patch `enabled`
 * or `label` without the operator re-typing credentials the UI never sent them. `env: ""` is the
 * distinct, explicit "clear the credentials" instruction — the same unset-vs-empty distinction
 * `mcp-federation/config.ts` draws for allowlists, and for the same reason.
 *
 * @throws {ExternalMcpValidationError} On any invalid operator input.
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available to seal under.
 * @complexity O(n) in the size of the env block.
 * @overallScore 100
 */
/** Validates `serverId` via the trust tier's own assertion, remapped onto this store's own error
 *  type. Split out purely to keep {@link saveExternalMcpServer}'s complexity under the shop
 *  ceiling — reuses `trust.ts`'s rule rather than restating it, since this id becomes part of every
 *  federated tool id and two copies of that rule could drift. */
function assertValidExternalMcpServerId(serverId: string): void {
  try {
    assertValidConnectionId({ connectionId: serverId });
  } catch (err) {
    throw new ExternalMcpValidationError(err instanceof Error ? err.message : String(err), "id");
  }
}

function assertSupportedExternalMcpTransport(transport: string): void {
  if (!SUPPORTED_EXTERNAL_MCP_TRANSPORTS.includes(transport as ExternalMcpTransport)) {
    throw new ExternalMcpValidationError(
      `transport '${transport}' is not supported — only ${SUPPORTED_EXTERNAL_MCP_TRANSPORTS.join(", ")} is implemented`,
      "transport",
    );
  }
}

/** Resolves the auth mode for one save: explicit input wins, then the existing row's mode, then
 *  `static_env` for a brand-new row.
 *  @throws {ExternalMcpValidationError} On a mode outside {@link EXTERNAL_MCP_AUTH_MODES}. */
function resolveSavedAuthMode(input: SaveExternalMcpServerInput, existing: ExternalMcpServerRecord | null): ExternalMcpAuthMode {
  if (input.authMode === undefined) return existing ? resolveExternalMcpAuthMode(existing) : "static_env";
  if (!EXTERNAL_MCP_AUTH_MODES.includes(input.authMode as ExternalMcpAuthMode)) {
    throw new ExternalMcpValidationError(
      `auth mode '${input.authMode}' is not supported — expected one of ${EXTERNAL_MCP_AUTH_MODES.join(", ")}`,
      "authMode",
    );
  }
  return input.authMode as ExternalMcpAuthMode;
}

/**
 * Splits an operator's comma- or space-separated OAuth scope list.
 *
 * An empty result is legitimate — several providers infer scope from the client registration — so it
 * is returned rather than rejected, the same call {@link parseAllowedToolNames} makes.
 *
 * @throws {ExternalMcpValidationError} Past {@link MAX_OAUTH_SCOPES}.
 * @complexity O(n) in the number of scopes.
 */
export function parseOAuthScopes(raw: string): string[] {
  const scopes = raw.split(/[\s,]+/).filter((part) => part.length > 0);
  if (scopes.length > MAX_OAUTH_SCOPES) {
    throw new ExternalMcpValidationError(`at most ${MAX_OAUTH_SCOPES} OAuth scopes are supported`, "oauth.scopes");
  }
  return [...new Set(scopes)];
}

/** The endpoints an operator typed for a connection that defines its own provider. Empty strings are
 *  dropped so `{}` — "this connection names a registered provider instead" — stays representable. */
function buildOAuthEndpoints(oauth: SaveExternalMcpOAuthInput): Record<string, string> {
  const entries: readonly (readonly [string, string | undefined])[] = [
    ["authorizationEndpoint", oauth.authorizationEndpoint],
    ["tokenEndpoint", oauth.tokenEndpoint],
    ["deviceAuthorizationEndpoint", oauth.deviceAuthorizationEndpoint],
  ];
  const endpoints: Record<string, string> = {};
  for (const [key, value] of entries) {
    const trimmed = value?.trim();
    if (trimmed) endpoints[key] = trimmed;
  }
  return endpoints;
}

/**
 * The identity a stored token was issued under.
 *
 * Compared before and after a save so a token cannot silently survive a change that invalidates it:
 * a new client id, a different provider, a re-pointed token endpoint or a changed scope list all mean
 * the stored access token no longer corresponds to what the row now says. Keeping it would leave a
 * connection reporting `connected` while holding a credential for something else — which then fails
 * opaquely at a tool call instead of loudly at save time.
 *
 * @complexity O(1).
 */
function oauthBindingFingerprint(
  record: Pick<ExternalMcpServerRecord, "oauthProviderId" | "oauthGrant" | "oauthClientId" | "oauthEndpointsJson" | "oauthScopesJson">,
): string {
  return JSON.stringify([
    record.oauthProviderId,
    record.oauthGrant,
    record.oauthClientId,
    record.oauthEndpointsJson,
    record.oauthScopesJson,
  ]);
}

/** The OAuth columns produced by one save, plus the operator's client-secret instruction. */
interface ResolvedOAuthFields {
  readonly oauthProviderId: string | null;
  readonly oauthGrant: string | null;
  readonly oauthClientId: string | null;
  readonly oauthEndpointsJson: string | null;
  readonly oauthScopesJson: string | null;
  readonly oauthTokenEnvName: string | null;
  /** Three-state, as `env` is: `undefined` keeps, a string replaces, `""` clears. */
  readonly clientSecret: string | undefined;
}

/**
 * Validates and resolves the OAuth columns for one save.
 *
 * @throws {ExternalMcpValidationError} On any invalid operator input, with `field` naming the
 * offending form control (`oauth.clientId`, `oauth.grant`, ...).
 * @complexity O(n) in the number of scopes.
 */
/** The OAuth columns of a row that is NOT OAuth-authenticated: all cleared.
 *
 *  Cleared rather than preserved, deliberately: a row switched to `static_env` that still carried a
 *  provider and a client id would silently re-adopt them if it were ever switched back, along with a
 *  token issued under configuration nobody has looked at since. */
const NO_OAUTH_FIELDS: ResolvedOAuthFields = {
  oauthProviderId: null,
  oauthGrant: null,
  oauthClientId: null,
  oauthEndpointsJson: null,
  oauthScopesJson: null,
  oauthTokenEnvName: null,
  clientSecret: "",
};

/**
 * The first non-empty trimmed candidate, or `""`.
 *
 * Every OAuth identity field follows the same precedence — what the operator just submitted, then
 * what the row already holds, then nothing — and writing that as a `??` chain at each field is both
 * repetitive and, measurably, most of these functions' branch count. One helper makes the precedence
 * a single named rule instead of five copies of it.
 *
 * @complexity O(n) in the number of candidates, each trimmed once.
 */
function firstTrimmed(...candidates: readonly (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Validates a sign-in method, or admits its absence on a row that can discover it for itself.
 *
 * The same exception {@link assertOAuthClientId} documents, extended to the grant: a REMOTE row can
 * run RFC 8414 discovery against its own URL at connect time and read the authorization server's own
 * `grant_types_supported` (`discovery.ts`) instead of an operator having to guess between "Browser
 * sign-in" and "Device code" before they know what the server even offers. See
 * `external-mcp-oauth.ts`'s `selfConfigureConnection`, which resolves and persists a concrete grant
 * the first time such a row connects. A stdio row has no URL to discover from, so for those the
 * requirement stands unchanged.
 *
 * @returns The validated grant, or `null` when the row will resolve one at connect.
 * @throws {ExternalMcpValidationError} On an empty grant the row cannot leave to discovery, or one
 * outside {@link EXTERNAL_MCP_OAUTH_GRANTS}.
 * @complexity O(1).
 */
function assertOAuthGrant(grant: string, selfConfigurable: boolean): ExternalMcpOAuthGrant | null {
  if (grant === "") {
    if (selfConfigurable) return null;
    throw new ExternalMcpValidationError("an OAuth connection needs a sign-in method", "oauth.grant");
  }
  if (!EXTERNAL_MCP_OAUTH_GRANTS.includes(grant as ExternalMcpOAuthGrant)) {
    throw new ExternalMcpValidationError(
      `OAuth grant '${grant}' is not supported — expected one of ${EXTERNAL_MCP_OAUTH_GRANTS.join(", ")}`,
      "oauth.grant",
    );
  }
  return grant as ExternalMcpOAuthGrant;
}

/**
 * Validates a client id, or admits its absence on a row that can obtain one for itself.
 *
 * `selfConfigurable` is what makes an empty client id legitimate rather than a validation failure.
 * A growing share of hosted authorization servers publish an RFC 7591 `registration_endpoint` and no
 * developer console at all, so for those there is no human path to a client id — demanding one here
 * would make the connection unreachable by any amount of operator effort. A row that carries a REMOTE
 * URL can run discovery against it at connect time and mint one; a stdio row has nothing to discover
 * from, so for those the requirement stands unchanged.
 *
 * @returns The validated client id, or `null` when the row will mint one at connect.
 * @throws {ExternalMcpValidationError} On an empty client id the row cannot obtain, or an oversized one.
 * @complexity O(1).
 */
function assertOAuthClientId(clientId: string, selfConfigurable: boolean): string | null {
  if (clientId === "") {
    if (selfConfigurable) return null;
    throw new ExternalMcpValidationError("an OAuth connection needs a client id", "oauth.clientId");
  }
  if (clientId.length > MAX_OAUTH_FIELD_LENGTH) {
    throw new ExternalMcpValidationError(`the OAuth client id may be at most ${MAX_OAUTH_FIELD_LENGTH} characters`, "oauth.clientId");
  }
  return clientId;
}

/**
 * Resolves the provider half of an OAuth connection: a registered provider id, its own endpoints, or
 * both.
 *
 * Endpoints are re-derived whenever the operator actually TYPED into either identity field, so
 * clearing a provider id and typing endpoints (or the reverse) cannot leave half of the old pairing
 * behind. "Actually typed" is judged by content, not key presence: the admin form sends both fields
 * on every save (it cannot round-trip a connection's own endpoints), so treating mere presence as a
 * touch made an untouched save look like an identity change on every edit — see
 * `use-external-mcp.hooks.ts`'s header for the caller-side half of this fix.
 *
 * The dynamic-registration members (`clientAuth`, `dynamicClientId`, `registeredRedirectUri`) are
 * exempted from re-derivation regardless of branch: they are server-owned, written only by dynamic
 * client registration (`external-mcp-oauth.ts`), and no operator input can express them, so even a
 * save that legitimately edits the other endpoints must not drop them.
 *
 * @throws {ExternalMcpValidationError} When neither a provider id nor a token endpoint is present,
 * or the provider id is malformed.
 * @complexity O(1).
 */
function resolveOAuthEndpoints(
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
): Record<string, string> {
  const stored = parseJsonObject(existing?.oauthEndpointsJson ?? null);
  const touchedIdentity = (oauth.providerId ?? "").trim() !== "" || (oauth.tokenEndpoint ?? "").trim() !== "";
  if (!touchedIdentity) return stored;
  const rebuilt = buildOAuthEndpoints(oauth);
  for (const key of DYNAMIC_REGISTRATION_ENDPOINT_KEYS) {
    if (stored[key] !== undefined) rebuilt[key] = stored[key];
  }
  return rebuilt;
}

/** The endpoints-blob members only dynamic client registration writes. */
const DYNAMIC_REGISTRATION_ENDPOINT_KEYS = ["clientAuth", "dynamicClientId", "registeredRedirectUri"] as const;

/**
 * @param selfConfigurable - Whether this row can discover its own endpoints — see
 *   {@link assertOAuthClientId} for the same argument applied to the client id.
 * @throws {ExternalMcpValidationError} When neither identity is present on a row that cannot
 *   discover one, or the id is malformed.
 */
function assertOAuthProviderIdentity(providerId: string, endpoints: Record<string, string>, selfConfigurable: boolean): void {
  if (providerId === "" && endpoints.tokenEndpoint === undefined && !selfConfigurable) {
    throw new ExternalMcpValidationError(
      "an OAuth connection needs either a registered provider id or its own token endpoint",
      "oauth.providerId",
    );
  }
  if (providerId !== "" && !OAUTH_PROVIDER_ID_PATTERN.test(providerId)) {
    throw new ExternalMcpValidationError(
      `'${providerId}' is not a valid provider id (lowercase letters, digits and hyphens)`,
      "oauth.providerId",
    );
  }
}

function resolveOAuthProviderIdentity(
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
  selfConfigurable: boolean,
): { readonly oauthProviderId: string | null; readonly oauthEndpointsJson: string | null } {
  const providerId = firstTrimmed(oauth.providerId, existing?.oauthProviderId);
  const endpoints = resolveOAuthEndpoints(oauth, existing);
  assertOAuthProviderIdentity(providerId, endpoints, selfConfigurable);

  return {
    oauthProviderId: providerId === "" ? null : providerId,
    oauthEndpointsJson: Object.keys(endpoints).length === 0 ? null : JSON.stringify(endpoints),
  };
}

/**
 * Resolves which child-process environment variable receives the access token.
 *
 * `null` for every non-`stdio` transport: only `stdio` hands credentials to a child process, so only
 * `stdio` needs a name for one.
 *
 * @throws {ExternalMcpValidationError} When a stdio+OAuth row names none, or names an invalid one.
 * @complexity O(n) in the name length.
 */
function resolveOAuthTokenEnvName(
  transport: ExternalMcpTransport,
  oauth: SaveExternalMcpOAuthInput,
  existing: ExternalMcpServerRecord | null,
): string | null {
  if (transport !== "stdio") return null;

  const tokenEnvName = firstTrimmed(oauth.tokenEnvName, existing?.oauthTokenEnvName);
  if (tokenEnvName === "") {
    throw new ExternalMcpValidationError(
      "a stdio server authenticated with OAuth needs the name of the environment variable that receives its access token",
      "oauth.tokenEnvName",
    );
  }
  if (!ENV_NAME_PATTERN.test(tokenEnvName)) {
    throw new ExternalMcpValidationError(
      `'${tokenEnvName}' is not a valid environment variable name (letters, digits and underscore, not starting with a digit)`,
      "oauth.tokenEnvName",
    );
  }
  return tokenEnvName;
}

/** Scopes for one save. Absent input KEEPS the stored list (the three-state rule `env` sets); an
 *  empty string clears it, since {@link parseOAuthScopes} of `""` is `[]`. */
function resolveSavedOAuthScopes(oauth: SaveExternalMcpOAuthInput, existing: ExternalMcpServerRecord | null): string[] {
  if (oauth.scopes === undefined) return parseExternalMcpJsonArray({ raw: existing?.oauthScopesJson ?? null });
  return parseOAuthScopes(oauth.scopes);
}

function resolveOAuthFields(
  authMode: ExternalMcpAuthMode,
  transport: ExternalMcpTransport,
  input: SaveExternalMcpServerInput,
  existing: ExternalMcpServerRecord | null,
  credential: HostedMcpStorePorts["credential"],
): ResolvedOAuthFields {
  if (authMode !== "oauth") return NO_OAUTH_FIELDS;

  const oauth = input.oauth ?? {};
  // Only a remote row has a URL for `external-mcp-oauth.ts` to run RFC 9728 / RFC 8414 discovery
  // against, so only a remote row may leave its provider identity, grant and client id to be filled
  // in at connect time.
  const selfConfigurable = transport !== "stdio";

  return {
    ...resolveOAuthProviderIdentity(oauth, existing, selfConfigurable),
    oauthGrant: assertOAuthGrant(firstTrimmed(oauth.grant, existing?.oauthGrant), selfConfigurable),
    oauthClientId: assertOAuthClientId(firstTrimmed(oauth.clientId, existing?.oauthClientId), selfConfigurable),
    oauthScopesJson: JSON.stringify(resolveSavedOAuthScopes(oauth, existing)),
    oauthTokenEnvName: resolveOAuthTokenEnvName(transport, oauth, existing),
    clientSecret: oauth.clientSecret === '' || oauth.clientSecret === undefined ? undefined : normalizeOAuthClientSecret({ value: oauth.clientSecret, credential }),
  };
}

/** Trims and validates `rawCommand`, returning the trimmed value. Split out purely to keep
 *  {@link saveExternalMcpServer}'s complexity under the shop ceiling. */
function assertNonEmptyExternalMcpCommand(rawCommand: string): string {
  const command = rawCommand.trim();
  if (command === "") {
    throw new ExternalMcpValidationError("a stdio server needs a command to launch", "command");
  }
  return command;
}

/** Enforces {@link MAX_SERVERS_PER_WORKSPACE} for a NEW server only — an existing row is always an
 *  update, never a new slot, so it is exempt. Split out purely to keep
 *  {@link saveExternalMcpServer}'s complexity under the shop ceiling. */
async function assertUnderExternalMcpServerCap(
  deps: Pick<ExternalMcpStoreDeps, "repo">,
  workspaceId: UUID,
  existing: ExternalMcpServerRecord | null,
): Promise<void> {
  if (existing) return;
  const count = (await deps.repo.listByWorkspaceId(workspaceId)).length;
  if (count >= MAX_SERVERS_PER_WORKSPACE) {
    throw new ExternalMcpValidationError(
      `this workspace already has the maximum of ${MAX_SERVERS_PER_WORKSPACE} external MCP servers`,
      "id",
    );
  }
}

/** Resolves the sealed env block and its plaintext variable-name index for one save. `rawEnv ===
 *  undefined` preserves whatever `existing` already has (see {@link saveExternalMcpServer}'s doc for
 *  why); an empty parsed block clears the seal to `null` rather than sealing `{}`. Split out purely
 *  to keep {@link saveExternalMcpServer}'s complexity under the shop ceiling.
 *  @throws {ExternalMcpValidationError} On a malformed env block (via {@link parseEnvBlock}).
 *  @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available to seal under. */
/** {@link resolveExternalMcpSealedEnv}'s `rawEnv === undefined` branch — carries the existing sealed
 *  env block through untouched. Split out purely to keep that function's complexity under the shop
 *  ceiling.
 *
 *  Carried through untouched, so its lineage must be carried too — bumping the version here would
 *  claim an AAD binding the stored ciphertext does not have, and brick the row. */
function carryForwardExternalMcpSealedEnv(
  existing: ExternalMcpServerRecord | null,
): { readonly sealedEnv: SealedSecret | null; readonly envNames: string[]; readonly aadVersion: number } {
  return {
    sealedEnv: existing?.sealedEnv ?? null,
    envNames: parseExternalMcpJsonArray({ raw: existing?.envNames ?? null }),
    aadVersion: existing?.aadVersion ?? EXTERNAL_MCP_VAULT_VERSION,
  };
}

/** {@link resolveExternalMcpSealedEnv}'s fresh-seal branch — parses and seals a NEW env block. Split
 *  out purely to keep that function's complexity under the shop ceiling.
 *  @throws {ExternalMcpValidationError} On a malformed env block (via {@link parseEnvBlock}).
 *  @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available to seal under. */
async function sealFreshExternalMcpEnv(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  rawEnv: string,
): Promise<{ readonly sealedEnv: SealedSecret | null; readonly envNames: string[]; readonly aadVersion: number }> {
  const env = parseEnvBlock(rawEnv, deps);
  const envNames = Object.keys(env);
  if (envNames.length === 0) return { sealedEnv: null, envNames, aadVersion: EXTERNAL_MCP_VAULT_VERSION };

  try {
    const sealedEnv = await sealExternalMcpVaultPayload({ deps, identity, kind: "mcp-env", payload: env });
    return { sealedEnv, envNames, aadVersion: EXTERNAL_MCP_VAULT_VERSION };
  } catch {
    throw new ExternalMcpSecretStoreUnconfiguredError(
      deps.credential.messages.storage,
    );
  }
}

async function resolveExternalMcpSealedEnv(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  rawEnv: string | undefined,
  existing: ExternalMcpServerRecord | null,
): Promise<{ readonly sealedEnv: SealedSecret | null; readonly envNames: string[]; readonly aadVersion: number }> {
  // Owner policy: an exact blank update keeps credentials; whitespace cannot clear them.
  if (rawEnv !== undefined && rawEnv !== '' && rawEnv.trim() === '') throw new ExternalMcpValidationError(deps.credential.messages.blank, 'env');
  return rawEnv === undefined || rawEnv === ''
    ? carryForwardExternalMcpSealedEnv(existing)
    : sealFreshExternalMcpEnv(deps, identity, rawEnv);
}

/** Hosts for which plaintext `http` is tolerated — a local development server, and nothing else. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Validates a remote MCP server URL.
 *
 * Same rule the OAuth endpoints follow (`oauth/endpoint-safety.ts`): https, or http only for
 * loopback. A remote MCP endpoint carries the bearer token this whole subsystem exists to obtain, so
 * a plaintext one to anywhere but a developer's own machine is a credential on the wire.
 *
 * @returns The normalized absolute URL.
 * @throws {ExternalMcpValidationError} On an empty, unparseable, or plaintext-non-loopback URL.
 * @complexity O(n) in the URL length.
 */
function assertSafeRemoteMcpUrl(rawUrl: string, transport: ExternalMcpTransport, ports: CredentialPorts): string {
  const url = rawUrl.trim();
  if (url === "") {
    throw new ExternalMcpValidationError(`a ${transport} server needs a URL`, "url");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExternalMcpValidationError(ports.credential.messages.url, "url");
  }
  assertExternalMcpPlainField({ value: url, field: "url" }, ports);
  const loopback = LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new ExternalMcpValidationError("a remote MCP server URL must use https (http is permitted only for loopback)", "url");
  }
  return parsed.toString();
}

/** A `stdio` row needs a command; a remote row needs a URL. Split out to keep
 *  {@link saveExternalMcpServer}'s complexity under the shop ceiling.
 *  @throws {ExternalMcpValidationError} When the transport's own required field is missing or unsafe. */
function resolveTransportTarget(
  transport: ExternalMcpTransport,
  input: SaveExternalMcpServerInput,
  ports: CredentialPorts,
): { readonly command: string | null; readonly url: string | null } {
  if (transport === "stdio") return { command: assertNonEmptyExternalMcpCommand(input.command), url: null };

  return { command: null, url: assertSafeRemoteMcpUrl(input.url ?? "", transport, ports) };
}

/**
 * The OAuth runtime columns a save carries forward.
 *
 * A save that leaves the token's binding unchanged preserves the live connection untouched — an
 * operator toggling `enabled` or renaming a server must not have to re-authorize. A save that
 * CHANGES the binding discards the token and returns the row to `disconnected`, because the stored
 * credential was issued for configuration that no longer exists.
 *
 * @complexity O(1).
 */
function carryOAuthRuntimeState(
  authMode: ExternalMcpAuthMode,
  resolved: ResolvedOAuthFields,
  existing: ExternalMcpServerRecord | null,
): Pick<ExternalMcpServerRecord, "oauthStatus" | "oauthExpiresAt" | "oauthRefreshLeaseUntil"> & { readonly keepToken: boolean } {
  const cleared = { oauthStatus: null, oauthExpiresAt: null, oauthRefreshLeaseUntil: null, keepToken: false } as const;
  if (authMode !== "oauth" || existing === null) return cleared;

  const unchanged = oauthBindingFingerprint(existing) === oauthBindingFingerprint({ ...resolved });
  if (!unchanged) return { oauthStatus: "disconnected", oauthExpiresAt: null, oauthRefreshLeaseUntil: null, keepToken: false };

  return {
    oauthStatus: existing.oauthStatus ?? "disconnected",
    oauthExpiresAt: existing.oauthExpiresAt,
    oauthRefreshLeaseUntil: existing.oauthRefreshLeaseUntil,
    keepToken: true,
  };
}

/**
 * What the OAuth sealed blob holds.
 *
 * ONE blob rather than a column per secret, for exactly the reason the env block is one blob: every
 * read path wants the whole thing at once, and per-secret sealing would buy nothing and cost N
 * keyring round trips. The consequence is a READ-MODIFY-WRITE rule that every writer must honour —
 * unseal, change one member, reseal — because a writer that seals `{ tokens }` alone silently
 * deletes the operator's client secret.
 *
 * Structurally compatible with `src/platform/oauth/`'s `OAuthTokenSet`, but declared here rather than
 * imported: this is the STORED shape, and it must be able to stay still while the flow module's
 * in-memory type moves.
 */
/**
 * Schema version of the *plaintext* inside the sealed OAuth blob.
 *
 * Distinct from `oauth_aad_version`, which versions how the blob is BOUND to its row and says
 * nothing about what is inside it. Without this, a field could be added but never renamed, changed,
 * or removed — there would be nothing to branch on at open time, and the only way out would be a
 * migration over live credentials. Stamped at seal; a blob without it predates versioning and is
 * upgraded on read.
 */
export const EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION = 1;

/**
 * The branching read for a sealed OAuth payload. A missing version is v0 (pre-versioning) and is
 * upgraded in place; a newer version is refused rather than misread, because silently
 * reinterpreting an unknown shape here means handing back a wrong or partial live credential.
 *
 * `schemaVersion` is stripped from the result: it is a wire concern, and a caller that saw it could
 * persist it back into a payload it does not own.
 *
 * The vault's open already refuses a non-object payload, so `parsed` is always an object here.
 *
 * @throws When the payload was written by a newer build than this one understands.
 * @complexity O(1).
 */
export function hydrateExternalMcpOAuthPayload(parsed: Record<string, unknown>): ExternalMcpSealedOAuthPayload {
  const { schemaVersion, ...rest } = parsed;
  const stored = typeof schemaVersion === "number" ? schemaVersion : 0;
  if (stored > EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION) {
    throw new Error(
      `external MCP OAuth payload was written at schema version ${stored}, newer than this build understands (${EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION}) — upgrade rather than risk misreading a live credential`,
    );
  }
  // v0 -> v1 added only the discriminator, so the upgrade is a stamp; a later version adds its own
  // branch here rather than a backfill over live credentials.
  return rest as ExternalMcpSealedOAuthPayload;
}

/**
 * Opens a row's sealed OAuth blob.
 *
 * @returns `{}` when the row holds none, which is the normal state before a connection is authorized.
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When the blob exists but cannot be opened — a
 * rotated site key or a corrupt row. Distinct from "no blob" on purpose: the caller must not treat a
 * decryption failure as "not connected yet" and start a fresh authorization over a token that is
 * still live at the provider.
 * @complexity O(1) — one unseal.
 */
/** @agent-note `deps` is the per-call sealer plus the host-bound ports; exactly one `sealer.open` per call. */
export async function openExternalMcpOAuthPayload(
  deps: OpenDeps,
  record: Pick<ExternalMcpServerRecord, "sealedOAuth" | "workspaceId" | "serverId" | "oauthAadVersion">,
): Promise<ExternalMcpSealedOAuthPayload> {
  if (record.sealedOAuth === null) return {};
  let parsed: Record<string, unknown>;
  try {
    parsed = await openExternalMcpVaultPayload({ sealer: deps.sealer, sealed: record.sealedOAuth, identity: record, kind: "mcp-auth", ports: deps });
  } catch {
    throw new ExternalMcpSecretStoreUnconfiguredError(
      "Stored OAuth credentials could not be decrypted.",
    );
  }
  // Deliberately OUTSIDE the catch above: a version mismatch is not a decryption failure, and must
  // not be swallowed by a caller that treats that error as "not connected yet".
  return hydrateExternalMcpOAuthPayload(parsed);
}

/** @agent-note `deps` is the per-call sealer/keyring plus the host-bound ports; exactly one seal, the envelope is staged for the host repository's transaction. */
export async function sealExternalMcpOAuthPayload(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  payload: ExternalMcpSealedOAuthPayload,
): Promise<SealedExternalMcpOAuth> {
  const hasSecret =
    (payload.clientSecret !== undefined && payload.clientSecret !== "") || payload.tokens !== undefined || Boolean(payload.staticAccessToken);
  if (!hasSecret) return { sealedOAuth: null, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  try {
    const sealedOAuth = await sealExternalMcpVaultPayload({ deps, identity, kind: "mcp-auth",
      // The discriminator remains authenticated inside the payload, never plain metadata.
      payload: JSON.parse(JSON.stringify({ ...payload, schemaVersion: EXTERNAL_MCP_OAUTH_PAYLOAD_VERSION })),
    });
    return { sealedOAuth, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  } catch {
    throw new ExternalMcpSecretStoreUnconfiguredError(
      deps.credential.messages.storage,
    );
  }
}

/**
 * Applies one save's client-secret instruction to the stored blob, preserving the token.
 *
 * `carryToken` is `null` when the save invalidated the stored token (see
 * {@link carryOAuthRuntimeState}); passing the record means "keep whatever token it holds".
 *
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When the blob cannot be opened or resealed.
 * @complexity O(1) — at most one unseal plus one seal.
 */
async function resolveSealedOAuthBlob(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  clientSecret: string | undefined,
  carryToken: ExternalMcpServerRecord | null,
): Promise<SealedExternalMcpOAuth> {
  // Nothing to preserve and nothing to write: skip the keyring entirely rather than seal an empty
  // object, which is what keeps a `none`/`static_env` row's OAuth blob genuinely absent.
  if (carryToken === null && (clientSecret === undefined || clientSecret === "")) {
    return { sealedOAuth: null, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  }

  const existingPayload = carryToken === null ? {} : await openExternalMcpOAuthPayload(deps, carryToken);
  let nextClientSecret = clientSecret;
  if (clientSecret === undefined) nextClientSecret = existingPayload.clientSecret;
  if (clientSecret === "") nextClientSecret = undefined;
  const next: ExternalMcpSealedOAuthPayload = {
    ...(nextClientSecret === undefined ? {} : { clientSecret: nextClientSecret }),
    ...(existingPayload.tokens === undefined ? {} : { tokens: existingPayload.tokens }),
  };
  return sealExternalMcpOAuthPayload(deps, identity, next);
}

/**
 * Resolves the two write-grant attribution columns for one save.
 *
 * Written ONLY when {@link writeAllowedToolNames}'s contents actually change — compared as a set
 * against whatever the row already has — so a save that merely renames a connection or flips
 * `enabled` does not stamp a new "authorized by / on" over an untouched grant. `input.principalId`
 * is read only on the changed branch, which is what lets it stay a required TYPE without becoming a
 * runtime hazard: a caller written before this field existed can only reach `undefined` here if it
 * also never sets a non-empty {@link SaveExternalMcpServerInput.writeAllowedToolNames}, in which case
 * the list never changes and this branch never runs.
 *
 * @complexity O(n) in the length of the longer list (via {@link toolNameSetsEqual}).
 */
function resolveWriteGrantAttribution(
  input: Pick<SaveExternalMcpServerInput, "principalId">,
  writeAllowedToolNames: readonly string[],
  existing: ExternalMcpServerRecord | null,
  nowIso: ISODateTime,
): Pick<ExternalMcpServerRecord, "writeGrantsUpdatedByPrincipalId" | "writeGrantsUpdatedAt"> {
  const previousWriteAllowedToolNames = parseExternalMcpJsonArray({ raw: existing?.writeAllowedToolNames ?? null });
  if (toolNameSetsEqual(previousWriteAllowedToolNames, writeAllowedToolNames)) {
    return {
      writeGrantsUpdatedByPrincipalId: existing?.writeGrantsUpdatedByPrincipalId ?? null,
      writeGrantsUpdatedAt: existing?.writeGrantsUpdatedAt ?? null,
    };
  }
  return { writeGrantsUpdatedByPrincipalId: input.principalId, writeGrantsUpdatedAt: nowIso };
}

/** Host error adapter for the shared token policy. The store alone normalizes the value. */
function normalizeOAuthClientSecret({ value, credential }: { value: string; credential: HostedMcpStorePorts["credential"] }): string {
  try { return credential.normalize({ value, field: 'oauth.clientSecret' }); }
  catch (err) {
    if (err instanceof credential.InputError) throw new ExternalMcpValidationError(err.message, err.field);
    throw err;
  }
}

/** @agent-note `credential` is the host-bound token policy; its input errors become the canonical validation error with the same message and field. */
export function normalizeExternalMcpAccessToken(
  { value, transport, credential }: { value: unknown; transport: string; credential: HostedMcpStorePorts["credential"] }, _optional = {},
): string {
  try { return credential.normalize({ value, field: 'accessToken', hosted: transport !== 'stdio' }); }
  catch (err) {
    if (err instanceof credential.InputError) throw new ExternalMcpValidationError(err.message, err.field);
    throw err;
  }
}

/**
 * The sealed blob for a `static_env` row's access token, under the `env` field's three-state rule.
 *
 * Stored in the row's existing sealed OAuth columns (and AAD lineage) rather than a new column: it is
 * the same kind of thing — a sealed connection credential beside the env block — and while a row is
 * `static_env` that blob holds nothing else. A carried token keeps its ciphertext AND its
 * `oauthAadVersion` together, for the reason {@link SealedExternalMcpOAuth} gives.
 *
 * @throws {ExternalMcpValidationError} Via {@link assertValidStaticAccessToken}.
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available to seal under.
 * @complexity O(n) in the token length; at most one seal.
 */
async function resolveSealedStaticAccessToken(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  rawToken: string | undefined,
  existing: ExternalMcpServerRecord | null,
  transport: ExternalMcpTransport,
): Promise<SealedExternalMcpOAuth> {
  const none: SealedExternalMcpOAuth = { sealedOAuth: null, oauthAadVersion: EXTERNAL_MCP_VAULT_VERSION };
  if (rawToken === undefined || rawToken === "") {
    return existing !== null && externalMcpRecordHasStaticAccessToken(existing)
      ? { sealedOAuth: existing.sealedOAuth, oauthAadVersion: existing.oauthAadVersion }
      : none;
  }
  const token = normalizeExternalMcpAccessToken({ value: rawToken, transport, credential: deps.credential });
  return sealExternalMcpOAuthPayload(deps, identity, { staticAccessToken: token });
}

/**
 * Which child env variable receives a `stdio` + `static_env` row's access token. `null` for a hosted
 * row (its token travels in a header) and for a stdio row that neither holds a token nor names one.
 *
 * @throws {ExternalMcpValidationError} When a stdio row holds a token but names no variable, or an
 *   invalid one.
 * @complexity O(n) in the name length.
 */
function resolveStaticAccessTokenEnvName(
  transport: ExternalMcpTransport,
  input: Pick<SaveExternalMcpServerInput, "accessTokenEnvName">,
  existing: ExternalMcpServerRecord | null,
  holdsToken: boolean,
): string | null {
  if (transport !== "stdio") return null;
  const name = firstTrimmed(input.accessTokenEnvName, existing?.oauthTokenEnvName);
  if (name === "") {
    if (!holdsToken) return null;
    throw new ExternalMcpValidationError(
      "a local command given an access token needs the name of the environment variable that receives it",
      "accessTokenEnvName",
    );
  }
  if (!ENV_NAME_PATTERN.test(name)) {
    throw new ExternalMcpValidationError(
      `'${name}' is not a valid environment variable name (letters, digits and underscore, not starting with a digit)`,
      "accessTokenEnvName",
    );
  }
  return name;
}

/**
 * The sealed-credential columns for one save, by auth mode: a `static_env` row's access token and its
 * variable name, or an `oauth`/`none` row's client secret and carried token set (nothing, for `none`).
 * Split out to keep {@link saveExternalMcpServer} under the shop's complexity ceiling.
 *
 * @complexity O(1) beyond at most one unseal and one seal.
 */
async function resolveSavedCredentialColumns(
  deps: SealDeps,
  identity: ExternalMcpIdentity,
  context: {
    readonly authMode: ExternalMcpAuthMode;
    readonly transport: ExternalMcpTransport;
    readonly input: SaveExternalMcpServerInput;
    readonly oauthFields: ResolvedOAuthFields;
    readonly keepToken: boolean;
    readonly existing: ExternalMcpServerRecord | null;
  },
): Promise<SealedExternalMcpOAuth & { readonly oauthTokenEnvName: string | null }> {
  const { authMode, transport, input, oauthFields, keepToken, existing } = context;
  if (authMode !== "static_env") {
    const sealed = await resolveSealedOAuthBlob(deps, identity, oauthFields.clientSecret, keepToken ? existing : null);
    return { ...sealed, oauthTokenEnvName: oauthFields.oauthTokenEnvName };
  }
  const sealed = await resolveSealedStaticAccessToken(deps, identity, input.accessToken, existing, transport);
  if (transport !== "stdio" && sealed.sealedOAuth === null) {
    throw new ExternalMcpValidationError("Enter a token. Spaces alone are not a token.", "accessToken");
  }
  return { ...sealed, oauthTokenEnvName: resolveStaticAccessTokenEnvName(transport, input, existing, sealed.sealedOAuth !== null) };
}

function assertExternalMcpPlainField(required: { value: string; field: string }, ports: CredentialPorts): void {
  try { ports.assertFreeField(required); }
  catch (err) {
    if (err instanceof ports.credential.InputError) throw new ExternalMcpValidationError(err.message, err.field);
    throw err;
  }
}

function assertExternalMcpPlainInput({ input, ports }: { input: SaveExternalMcpServerInput; ports: CredentialPorts }, _options = {}): void {
  for (const field of ["serverId", "label", "command", "args", "url", "transport", "authMode", "accessTokenEnvName"] as const) {
    assertExternalMcpPlainField({ value: input[field] ?? "", field }, ports);
  }
  for (const [field, value] of Object.entries(input.oauth ?? {})) {
    if (field !== 'clientSecret' && typeof value === 'string') assertExternalMcpPlainField({ value, field: `oauth.${field}` }, ports);
  }
}

/** @agent-note `deps.repo` is the host repository whose transaction commits the staged envelopes with the row pointers; seal order, id timing and the carried-envelope rule are unchanged. */
export async function saveExternalMcpServer(
  deps: HostedMcpStoreDeps,
  input: SaveExternalMcpServerInput,
): Promise<ExternalMcpServerView<HostedMcpTokenHint>> {
  assertExternalMcpPlainInput({ input, ports: deps });
  const serverId = input.serverId.trim().toLowerCase();
  assertValidExternalMcpServerId(serverId);
  assertSupportedExternalMcpTransport(input.transport);
  const transport = input.transport as ExternalMcpTransport;
  const { command, url } = resolveTransportTarget(transport, input, deps);
  const args = parseArgs(input.args);
  const allowedToolNames = parseAllowedToolNames(input.allowedToolNames);
  // `?? ""` is a defensive fallback, not the documented contract (the type requires the field): a
  // caller that predates this field reaches `undefined` here, and must degrade to "no write grants"
  // rather than throw on `undefined.split`. See `SaveExternalMcpServerInput.writeAllowedToolNames`'s
  // doc.
  const writeAllowedToolNames = parseWriteAllowedToolNames(input.writeAllowedToolNames ?? "");
  assertWriteAllowlistSubset(writeAllowedToolNames, allowedToolNames);

  const existing = await deps.repo.findByServerId({ workspaceId: input.workspaceId, serverId });
  await assertUnderExternalMcpServerCap(deps, input.workspaceId, existing);
  const authMode = resolveSavedAuthMode(input, existing);
  const oauthFields = resolveOAuthFields(authMode, transport, input, existing, deps.credential);
  const runtime = carryOAuthRuntimeState(authMode, oauthFields, existing);
  const aadIdentity: ExternalMcpIdentity = { workspaceId: input.workspaceId, serverId };
  const { sealedEnv, envNames, aadVersion } = await resolveExternalMcpSealedEnv(deps, aadIdentity, input.env, existing);
  const { sealedOAuth, oauthAadVersion, oauthTokenEnvName } = await resolveSavedCredentialColumns(deps, aadIdentity, {
    authMode,
    transport,
    input,
    oauthFields,
    keepToken: runtime.keepToken,
    existing,
  });

  const now = nowIso({ clock: deps.clock });
  const writeGrantAttribution = resolveWriteGrantAttribution(input, writeAllowedToolNames, existing, now);
  const record: ExternalMcpServerRecord = {
    workspaceId: input.workspaceId,
    serverId,
    label: input.label?.trim() || null,
    provisionedByPluginId: input.provisionedByPluginId ?? existing?.provisionedByPluginId ?? null,
    transport: input.transport,
    authMode,
    enabled: input.enabled,
    command,
    url,
    args: JSON.stringify(args),
    allowedToolNames: JSON.stringify(allowedToolNames),
    writeAllowedToolNames: JSON.stringify(writeAllowedToolNames),
    writeGrantsUpdatedByPrincipalId: writeGrantAttribution.writeGrantsUpdatedByPrincipalId,
    writeGrantsUpdatedAt: writeGrantAttribution.writeGrantsUpdatedAt,
    envNames: JSON.stringify(envNames),
    sealedEnv,
    oauthProviderId: oauthFields.oauthProviderId,
    oauthGrant: oauthFields.oauthGrant,
    oauthClientId: oauthFields.oauthClientId,
    oauthEndpointsJson: oauthFields.oauthEndpointsJson,
    oauthScopesJson: oauthFields.oauthScopesJson,
    oauthStatus: runtime.oauthStatus,
    oauthExpiresAt: runtime.oauthExpiresAt,
    oauthTokenEnvName,
    oauthRefreshLeaseUntil: runtime.oauthRefreshLeaseUntil,
    sealedOAuth,
    aadVersion,
    oauthAadVersion,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await deps.repo.upsert(record);
  return toView(record, deps, deps.sealer);
}

/**
 * Removes one server. Returns whether a row was actually deleted, so a route can answer 404 rather
 * than reporting success for an id that never existed.
 *
 * @complexity O(1).
 * @overallScore 100
 */
export async function deleteExternalMcpServer(
  deps: Pick<ExternalMcpStoreDeps, "repo">,
  input: { workspaceId: UUID; serverId: string },
): Promise<boolean> {
  return deps.repo.deleteByServerId(input);
}

