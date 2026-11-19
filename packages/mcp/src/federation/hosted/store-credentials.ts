import { ExternalMcpValidationError } from "./validation-error.js";
import { ExternalMcpSecretStoreUnconfiguredError } from "./unconfigured-error.js";
import { externalMcpRecordHasStaticAccessToken, resolveExternalMcpOAuthStatus } from "./auth.js";
import { parseExternalMcpJsonArray } from "./access.js";
import { ENV_NAME_PATTERN, parseEnvBlock } from "./store-input.js";
import { firstTrimmed } from "./store-oauth-fields.js";
import type { ResolvedOAuthFields } from "./store-oauth-fields.js";
import { EXTERNAL_MCP_VAULT_VERSION, openExternalMcpOAuthPayload, sealExternalMcpOAuthPayload, sealExternalMcpVaultPayload } from "./vault.js";
import type { ExternalMcpIdentity, OpenDeps, SealDeps } from "./vault.js";
import type { ExternalMcpAuthMode, ExternalMcpConfigFailure, ExternalMcpOAuthTokenResolverPort, ExternalMcpSealedOAuthPayload, ExternalMcpServerRecord, ExternalMcpTransport, SaveExternalMcpServerInput, SealedExternalMcpOAuth } from "@jini-ai/core/contracts/hosted-mcp";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { HostedMcpStorePorts } from "./store-ports.js";

/**
 * A `needs_reauth`/`disconnected`/`pending` row is reported rather than connected.
 *
 * Reported, not silently skipped: an operator whose token expired needs to see WHY the server's
 * tools vanished, and the reason string is the only thing carrying that at boot. The admin tab's
 * `needs_reauth` badge is the out-of-band half of the same signal.
 */
function oauthStatusFailure({ record, settingsLink }: { record: ExternalMcpServerRecord; settingsLink: string }): Omit<ExternalMcpConfigFailure, "serverId"> | null {
  const status = resolveExternalMcpOAuthStatus(record);
  if (status === "connected") return null;
  if (status === "needs_reauth") {
    return { reason: `its authorization expired or was revoked — reconnect it in ${settingsLink}`, category: "reauth_required" };
  }
  return { reason: `it has not been authorized yet (status '${status}') — connect it in ${settingsLink}` };
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
export async function resolveExternalMcpAccessToken(
  record: ExternalMcpServerRecord,
  oauth: ExternalMcpOAuthTokenResolverPort | undefined,
  { settingsLink, reauthRequiredCode }: Pick<HostedMcpStorePorts, "settingsLink" | "reauthRequiredCode">,
): Promise<{ readonly ok: true; readonly token: string; readonly shared?: true } | ({ readonly ok: false } & Omit<ExternalMcpConfigFailure, "serverId">)> {
  try {
    const shared = await oauth?.resolveSharedAccessToken?.({ serverId: record.serverId });
    if (shared !== undefined) return { ok: true, token: shared, shared: true };
  } catch { return { ok: false, reason: `This shared connection is no longer granted to this site. Choose it again or sign in from ${settingsLink}.` }; }
  const statusFailure = oauthStatusFailure({ record, settingsLink });
  if (statusFailure !== null) return { ok: false, ...statusFailure };
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
): Promise<{ readonly ok: true; readonly token: string } | ({ readonly ok: false } & Omit<ExternalMcpConfigFailure, "serverId">)> {
  try {
    return { ok: true, token: await oauth.resolveAccessToken({ serverId: record.serverId }) };
  } catch (err) {
    // Preserve reauthorization as a typed outcome, without echoing raw provider error messages.
    const needsReauth = err instanceof Error && "code" in err && err.code === reauthRequiredCode;
    return needsReauth
      ? { ok: false, reason: `its authorization expired or was revoked — reconnect it in ${settingsLink}`, category: "reauth_required" }
      : { ok: false, reason: `its OAuth access token could not be obtained: OAuth token resolution failed — reconnect this server in ${settingsLink}` };
  }
}

/**
 * Opens a `static_env` row's sealed access token, or resolves `null` when it holds none — without
 * touching the sealer for any other row. A blob that will not open is a per-row failure, the same
 * posture {@link openExternalMcpEnv} takes for the env block.
 *
 * @complexity O(1) — at most one unseal.
 */
export async function openExternalMcpStaticAccessToken(
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
  const env = parseEnvBlock({ text: rawEnv, ports: deps });
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

export async function resolveExternalMcpSealedEnv(
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
  return sealExternalMcpOAuthPayload({ deps, identity, payload: next });
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
  return sealExternalMcpOAuthPayload({ deps, identity, payload: { staticAccessToken: token } });
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
export async function resolveSavedCredentialColumns(
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
