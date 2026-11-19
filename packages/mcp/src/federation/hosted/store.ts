/**
 * @file The operator-editable roster of external MCP servers — what the host's connection settings write,
 * and what the agent daemon reads at boot to decide which third-party servers to federate.
 *
 * This is a second config source alongside the host's preset resolution. The two
 * differ in kind, which is why this is not written as a preset: a preset resolver is synchronous and
 * returns at most one connection, while this store is async (sealing is promise-based) and returns
 * N. `bootstrap.ts`'s `extraConnections` parameter is the seam that carries them.
 *
 * ## Secrets
 *
 * An MCP server's `env` block routinely carries live credentials, so the host's vault service
 * seals it using the injected sealer/keyring. Plaintext secrets never enter the host's database.
 *
 * The block is sealed WHOLE rather than per-variable. Every read path wants all of it at once (it
 * becomes one child process's environment), so per-variable sealing would buy nothing and cost N
 * round-trips. Variable NAMES are stored separately in plaintext so the tab can show which
 * variables are set without unsealing anything.
 *
 * ## What this file does NOT do
 *
 * It does not decide whether a remote tool may be called. That is `../trust.ts`'s
 * default-deny admission tier, applied at connect time to whatever this store produced.
 * `allowedToolNames` is carried here and enforced there, on purpose: a config store that also
 * adjudicated trust would be two mechanisms with one owner.
 *
 * It does not run the OAuth flow either. The host wires a sign-in service over its OAuth client;
 * this store owns only the ROW — which auth mode a server uses, its
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
import { ExternalMcpValidationError } from "./validation-error.js";
import { assertExternalMcpPlainInput, commitExternalMcpSave } from "./store.save.js";
import { assertWriteAllowlistSubset, parseAllowedToolNames, parseWriteAllowedToolNames, resolveWriteGrantAttribution, validateExternalMcpToolNames } from "./access.js";
import { ToolInputError } from "@jini-ai/core";
import { nowIso } from "@jini-ai/core/primitives";
import type { UUID } from "@jini-ai/core/primitives";
import type { ExternalMcpApprovedAccess, ExternalMcpAuthMode, ExternalMcpServerRepoPort, ExternalMcpServerRecord, ExternalMcpServerView, ExternalMcpStoreDeps, ExternalMcpTransport, SaveExternalMcpServerInput } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpStorePorts, HostedMcpTokenHint } from "./store-ports.js";
import { EXTERNAL_MCP_AUTH_MODES, resolveExternalMcpAuthMode } from "./auth.js";
import { assertSupportedExternalMcpTransport, assertValidExternalMcpServerId, parseArgs, resolveTransportTarget } from "./store-input.js";
import { resolveOAuthFields } from "./store-oauth-fields.js";
import type { ResolvedOAuthFields } from "./store-oauth-fields.js";
import { resolveExternalMcpSealedEnv, resolveSavedCredentialColumns } from "./store-credentials.js";
import { toView } from "./store-view.js";
import type { ExternalMcpIdentity } from "./vault.js";

/** `EXTERNAL_MCP_AUTH_MODES`/`ExternalMcpAuthMode` (how a server's credentials are obtained) and
 *  their two readers live in the shared `auth.ts` leaf, so every
 *  consumer reads the same mode vocabulary. */

/** Per-call deps plus the host-bound store ports. */
/** @agent-note `repo/sealer/keyring/clock` are per call; every other member is bound once by the host. `repo` must be the same repository object whose envelopes `./vault.js` built. */
export type HostedMcpStoreDeps = ExternalMcpStoreDeps & HostedMcpStorePorts;

const MAX_SERVERS_PER_WORKSPACE = 32;

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
 * Validates and persists one server, sealing its env block.
 *
 * `env: undefined` preserves whatever is already stored, which is what lets the tab patch `enabled`
 * or `label` without the operator re-typing credentials the UI never sent them. `env: ""` is the
 * distinct, explicit "clear the credentials" instruction — the same unset-vs-empty distinction
 * `../config.ts` draws for allowlists, and for the same reason.
 *
 * @throws {ExternalMcpValidationError} On any invalid operator input.
 * @throws {ExternalMcpSecretStoreUnconfiguredError} When no site key is available to seal under.
 * @complexity O(n) in the size of the env block.
 * @overallScore 100
 */

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
  const args = parseArgs({ raw: input.args });
  const allowedToolNames = parseAllowedToolNames({ raw: input.allowedToolNames });
  // `?? ""` is a defensive fallback, not the documented contract (the type requires the field): a
  // caller that predates this field reaches `undefined` here, and must degrade to "no write grants"
  // rather than throw on `undefined.split`. See `SaveExternalMcpServerInput.writeAllowedToolNames`'s
  // doc.
  const writeAllowedToolNames = parseWriteAllowedToolNames({ raw: input.writeAllowedToolNames ?? "" });
  assertWriteAllowlistSubset(writeAllowedToolNames, allowedToolNames);
  const parsed: ParsedSaveTarget = { serverId, transport, command, url, args, allowedToolNames, writeAllowedToolNames };
  const key = { workspaceId: input.workspaceId, serverId };
  const record = await commitExternalMcpSave({ repo: deps.repo, key, expectedVersion: input.expectedVersion, build: existing => buildSavedRecord(deps, input, parsed, existing) });
  return toView(record, deps, deps.sealer);
}

/** The target fields {@link saveExternalMcpServer} parses and validates before it reads the stored row. */
type ParsedSaveTarget = { serverId: string; transport: ExternalMcpTransport; command: string | null; url: string | null; args: string[]; allowedToolNames: string[]; writeAllowedToolNames: string[] };

/** Builds the row a save will write from the stored row it read (`null` for a create); re-run on the
 *  fresh row when a runtime write moved a credential between that read and the write (M4). */
async function buildSavedRecord(deps: HostedMcpStoreDeps, input: SaveExternalMcpServerInput, parsed: ParsedSaveTarget, existing: ExternalMcpServerRecord | null): Promise<ExternalMcpServerRecord> {
  const { serverId, transport, command, url, args, allowedToolNames, writeAllowedToolNames } = parsed;
  await assertUnderExternalMcpServerCap(deps, input.workspaceId, existing);
  const authMode = resolveSavedAuthMode(input, existing);
  const oauthFields = resolveOAuthFields(authMode, transport, input, existing, deps.credential);
  const runtime = carryOAuthRuntimeState(authMode, oauthFields, existing);
  const aadIdentity: ExternalMcpIdentity = { workspaceId: input.workspaceId, serverId };
  const { sealedEnv, envNames, aadVersion } = await resolveExternalMcpSealedEnv(deps, aadIdentity, input.env, existing);
  const { sealedOAuth, oauthAadVersion, oauthTokenEnvName } = await resolveSavedCredentialColumns(deps, aadIdentity, { authMode, transport, input, oauthFields, keepToken: runtime.keepToken, existing });
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
    version: existing?.version ?? 1,
  };
  return record;
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
