import { nowIso as readNowIso } from "@jini-ai/core/primitives";
import type { OAuthTokenSet } from "@jini-ai/core/contracts/oauth";
import type { ExternalMcpOAuthStatus, ExternalMcpServerRecord } from "@jini-ai/core/contracts/hosted-mcp";
import type { HostedMcpSignInPorts } from "./contracts.js";
import { runtimePatchOf, updateRowOnce, writeOAuthRuntime } from "./oauth-row-writes.js";
import { readStoredEndpoints, isSelfRegisteredClient, withoutSelfRegisteredClient, type SignInDeps } from "./sign-in-provider.js";

/**
 * Attempts `setOAuthStatus`'s clear-token re-seal is given before it gives up.
 *
 * Small and fixed, no backoff: a keyring write that fails because its active key briefly could not
 * be resolved usually succeeds on the very next try, so this exists to smooth over that blip rather
 * than to ride out a sustained outage — a re-seal still failing after this many immediate retries is
 * treated as a real, reportable failure, not something to keep retrying indefinitely.
 */
const CLEAR_TOKEN_RESEAL_ATTEMPTS = 3;

/** Writes a token set into the row: sealed blob (preserving the client secret) plus the PLAINTEXT
 *  status and expiry beside it. One place, so the plaintext metadata cannot drift from the blob.
 *  @complexity O(1) — one unseal, one seal, one runtime write. */
export async function persistTokens(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  tokens: OAuthTokenSet,
): Promise<void> {
  const existing = await deps.ports.store.openPayload(deps.sealer, record);
  const { sealedOAuth, oauthAadVersion } = await deps.ports.store.sealPayload(deps, record, {
    // Read-modify-write: sealing `{ tokens }` alone would silently delete the operator's client
    // secret, and the next refresh would fail with a message about the provider rather than about us.
    ...(existing.clientSecret === undefined ? {} : { clientSecret: existing.clientSecret }),
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: tokens.tokenType,
      scopes: [...tokens.scopes],
      expiresAt: tokens.expiresAt,
    },
  });

  // Runtime write: only the token columns, fenced on the credential read above (see oauth-row-writes.ts).
  // `oauthAadVersion` is carried from the seal, never from `record` — it holds the row's OLD version.
  await writeOAuthRuntime({ repo: deps.repo, ports: deps.ports, record, patch: { oauthStatus: "connected" satisfies ExternalMcpOAuthStatus,
    oauthExpiresAt: tokens.expiresAt, oauthRefreshLeaseUntil: null, sealedOAuth, oauthAadVersion, updatedAt: readNowIso({ clock: deps.clock }) } });
}

/** The row-patch fields {@link setOAuthStatus} merges on top of `status`/`oauthRefreshLeaseUntil`
 *  when clearing a token. Empty when `clearToken` was not requested. */
type ClearedTokenPatch = Partial<Pick<ExternalMcpServerRecord, "sealedOAuth" | "oauthExpiresAt" | "oauthAadVersion">>;

/** {@link setOAuthStatus}'s options. `forgetSelfRegisteredClient` also drops a client the host minted by
 *  dynamic registration — its id and its sealed secret — so the next connect registers afresh. It
 *  leaves an operator-typed client alone (see {@link isSelfRegisteredClient}). */
interface SetOAuthStatusOptions {
  readonly clearToken?: boolean;
  readonly forgetSelfRegisteredClient?: boolean;
}

/**
 * Resolves {@link setOAuthStatus}'s token-clear patch. Split out purely to keep that function's
 * complexity under the shop ceiling — behavior is unchanged.
 *
 * Read-modify-write, the same rule `persistTokens` follows: `sealedOAuth` holds
 * `{ clientSecret?, tokens? }` TOGETHER, so nulling it wholesale on a token clear would delete an
 * operator's client secret along with the dead token. For a dynamically-registered (RFC 7591)
 * client the operator never saw that secret, so losing it here means the row can never be
 * re-authorized — only deleted and recreated.
 *
 * The open and the re-seal below are kept in SEPARATE try/catches on purpose, even though both can
 * throw the same `ExternalMcpSecretStoreUnconfiguredError`
 * (`openExternalMcpOAuthPayload`/`sealExternalMcpOAuthPayload`'s own `@throws`): they mean different
 * things about whether the secret is actually lost. If OPEN fails, the blob could not be decrypted
 * at all — a rotated site key or a corrupt row — so whatever it held is already unrecoverable, and
 * falling back to the pre-existing wholesale-null behavior loses nothing that was not lost already
 * (this is what keeps `markNeedsReauth`, `disconnect()`, and the device-poll terminal path from
 * wedging on a blob that is already dead). If OPEN succeeds but the RE-SEAL fails, the secret was
 * just read successfully — it is NOT lost, only the write-back (a transient keyring/active-key
 * problem, say) failed, so it is retried a few times — bounded, no backoff — before giving up.
 * Wholesale-nulling would destroy a secret this call proves is still recoverable, so it is never the
 * outcome here; but silently leaving `sealedOAuth` untouched and reporting success would leave the
 * row's `oauthStatus` claiming a state (e.g. `disconnected`) the stored blob does not actually match,
 * with nothing to say so. So once the retry budget is exhausted, this rethrows instead: each of this
 * function's callers already has a place that reacts to `ExternalMcpSecretStoreUnconfiguredError`
 * without inventing a new one — `disconnect()`'s admin route already maps it to a 503
 * `SECRET_STORE_UNCONFIGURED`, `reportAuthFailure` already carries an unexpected `setOAuthStatus`
 * failure as `cause` on its terminal error, and `markNeedsReauth`'s two call sites in
 * `packages/oauth/src/refresh.ts`'s `performRefresh` treat this write as best-effort the same way — its failure
 * is carried as `cause` on the `OAUTH_INVALID_GRANT` error they throw next, never left to propagate
 * in that error's place. (An earlier version of this comment claimed that path "already folds" a
 * write failure into the boot report; it did not — the failure escaped unguarded and displaced the
 * reauth signal every downstream caller branches on. Both call sites now guard it explicitly.) Any
 * OTHER error (a genuine bug, not an unopenable or unsealable blob) still propagates from either
 * step — this is a documented, targeted degrade, not a blanket swallow.
 *
 * @throws {ExternalMcpSecretStoreUnconfiguredError} If the re-seal never recovers within
 *   {@link CLEAR_TOKEN_RESEAL_ATTEMPTS} attempts.
 */
async function resolveClearedTokenPatch(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  options: { readonly clearToken?: boolean; readonly dropClientSecret: boolean },
): Promise<ClearedTokenPatch> {
  if (options.clearToken !== true) return {};

  const opened = await openExistingOAuthPayloadForClear(deps, record);
  if ("wholesale" in opened) return { sealedOAuth: null, oauthExpiresAt: null };

  const kept = options.dropClientSecret ? undefined : opened.existing.clientSecret;
  const clientSecret = kept === undefined ? {} : { clientSecret: kept };
  return resealClearedOAuthToken(deps, record, clientSecret);
}

/** {@link resolveClearedTokenPatch}'s OPEN step — reads the existing payload, or signals the
 *  wholesale-null fallback when the blob cannot be opened at all (see that function's doc for why
 *  this branch is safe). Split out purely to keep that function's cognitive complexity under the
 *  shop ceiling. */
async function openExistingOAuthPayloadForClear(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
): Promise<{ readonly existing: Awaited<ReturnType<HostedMcpSignInPorts["store"]["openPayload"]>> } | { readonly wholesale: true }> {
  try {
    return { existing: await deps.ports.store.openPayload(deps.sealer, record) };
  } catch (error) {
    if (!deps.ports.errors.isUnconfigured(error)) throw error;
    return { wholesale: true };
  }
}

/** {@link resolveClearedTokenPatch}'s RE-SEAL step — retries a bounded number of times before giving
 *  up (see that function's doc for why). Split out purely to keep that function's cognitive
 *  complexity under the shop ceiling.
 *  @throws {ExternalMcpSecretStoreUnconfiguredError} If the re-seal never recovers within
 *  {@link CLEAR_TOKEN_RESEAL_ATTEMPTS} attempts. */
async function resealClearedOAuthToken(
  deps: SignInDeps,
  record: ExternalMcpServerRecord,
  clientSecret: { readonly clientSecret?: string },
): Promise<ClearedTokenPatch> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const cleared = await deps.ports.store.sealPayload(deps, record, clientSecret);
      return { sealedOAuth: cleared.sealedOAuth, oauthExpiresAt: null, oauthAadVersion: cleared.oauthAadVersion };
    } catch (error) {
      if (!deps.ports.errors.isUnconfigured(error)) throw error;
      if (attempt >= CLEAR_TOKEN_RESEAL_ATTEMPTS) throw error;
    }
  }
}

/** Moves a row into a terminal or reset OAuth state without touching anything else on it. See
 *  {@link resolveClearedTokenPatch} for the `clearToken` decision tree. */
export async function setOAuthStatus(
  deps: SignInDeps,
  serverId: string,
  status: ExternalMcpOAuthStatus,
  options: SetOAuthStatusOptions = {},
): Promise<void> {
  const key = { workspaceId: deps.workspaceId, serverId };
  const record = await deps.repo.findByServerId(key);
  if (!record) return;
  const forgetClient = options.forgetSelfRegisteredClient === true && isSelfRegisteredClient(record, readStoredEndpoints(record));
  const nextRow = async (current: ExternalMcpServerRecord): Promise<ExternalMcpServerRecord> => {
    // The secret is only ever dropped together with the token (`clearToken`), never on its own.
    const clearedTokenPatch = await resolveClearedTokenPatch(deps, current, { ...options, dropClientSecret: forgetClient });
    return {
      ...current,
      oauthStatus: status,
      ...clearedTokenPatch,
      ...(forgetClient ? { oauthClientId: null, oauthEndpointsJson: JSON.stringify(withoutSelfRegisteredClient(readStoredEndpoints(current))) } : {}),
      oauthRefreshLeaseUntil: null,
      updatedAt: readNowIso({ clock: deps.clock }),
    };
  };
  // Forgetting the client is an edit (version-compared, M4); every other state change is a runtime write (S1).
  if (forgetClient) await updateRowOnce({ repo: deps.repo, key, build: nextRow });
  else await writeOAuthRuntime({ repo: deps.repo, ports: deps.ports, record, patch: runtimePatchOf(await nextRow(record)) });
}
