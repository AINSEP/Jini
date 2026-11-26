import type { SiteBackupSources } from "./sources.js";


import type { CredentialSetConnectionInput as CustomProviderConnectionInput } from "@jini-ai/core/contracts/credentials";

import type { CredentialedRepositoryTarget, SourceControlProvider } from "../../source-control/site/provider-module.js";

import type { resolveDefaultForSourceControl } from "../../source-control/site/store.js";
import type { SourceControlProviderId } from "@jini-ai/core/contracts/site/source-control-credentials";


import type { SiteBackupRequestDeps, SiteBackupRepositoryPlanContent, SiteBackupToolDeps, Refusal } from "./backup-service.js";
import { failureLog } from "./backup-service.shared.js";

// ---------------------------------------------------------------------------
// Credential
// ---------------------------------------------------------------------------

interface ResolvedBackupCredential {
  readonly ok: true;
  readonly label: string;
  readonly baseUrl: string;
  readonly connection: CustomProviderConnectionInput;
  /** The plugin provider for the credential's host. */
  readonly provider: SourceControlProvider;
}

/** A resolved credential's repository target: its API plus the `Authorization` header built from it. */
export function backupTarget({ deps, credential, owner, repo }: { deps: SiteBackupToolDeps["deps"]; credential: ResolvedBackupCredential; owner: string; repo: string }, _optional: Record<string, never> = {}): CredentialedRepositoryTarget {
  return { baseUrl: credential.baseUrl, authorization: deps.buildAuthorizationHeader({ connection: credential.connection, schemes: [] }), owner, repo };
}

/** Every git-host provider an enabled plugin ships, or the refusal when there is none. */
async function loadBackupProviders<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>(deps: SiteBackupToolDeps<TSource, TContent, TRequest>): Promise<{ ok: true; providers: readonly SourceControlProvider[]; noProviderMessage: string } | Refusal> {
  const built = await deps.buildSourceControlProviders({ deps: deps.request }, {});
  for (const refusal of built.refusals) failureLog(deps)(`[site-backup] ${refusal}`);
  if (built.providers.length === 0) {
    return { ok: false, code: "NO_PROVIDER", message: built.noProviderMessage };
  }
  return { ok: true, providers: built.providers, noProviderMessage: built.noProviderMessage };
}

function originOf({ url }: { url: string }, _optional: Record<string, never> = {}): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function labelList(labels: readonly string[]): string {
  return labels.length === 0 ? "none are saved" : `saved labels: ${labels.map((label) => "'" + label + "'").join(", ")}`;
}

/**
 * Picks the credential's label: the one named, or — when none is — the single saved credential
 * pointing at a provider's API origin. A pure list read; nothing is decrypted here.
 *
 * @complexity O(saved credentials).
 */
async function pickCredentialLabel<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>({ deps, providers, requested }: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; providers: readonly SourceControlProvider[]; requested: string | undefined }, _optional: Record<string, never> = {}): Promise<{ ok: true; label: string } | Refusal> {
  const saved = await deps.listCustomCredentials({ deps: deps.request }, { workspaceId: deps.request.workspaceId });
  const labels = saved.map((credential) => credential.label);
  if (requested !== undefined) {
    if (labels.includes(requested)) return { ok: true, label: requested };
    return { ok: false, code: "CREDENTIAL_NOT_FOUND", message: `no saved credential is labeled '${requested}' (${labelList(labels)})` };
  }
  const apiOrigins = providers.map((provider) => provider.apiOrigin);
  const where = apiOrigins.join(" or ");
  const matching = saved.filter((credential) => apiOrigins.includes(originOf({ url: credential.baseUrl }) ?? "")).map((credential) => credential.label);
  if (matching.length === 1) {
    const label = matching[0];
    if (label === undefined) throw new Error("Backup credential match has no label");
    return { ok: true, label };
  }
  if (matching.length === 0) {
    return {
      ok: false,
      code: "CREDENTIAL_NOT_FOUND",
      message: `no saved credential points at ${where} (${labelList(labels)}). Connect ${providers.map((provider) => provider.label).join(" or ")} with credential_save with kind source-control (a form in this chat), or save a token on the Access Tokens page ('Add custom provider', base URL ${where}), or name one with 'credential'.`,
    };
  }
  return { ok: false, code: "CREDENTIAL_AMBIGUOUS", message: `${matching.length} saved credentials point at ${where} (${labelList(matching)}); name one with 'credential'.` };
}

/**
 * This site's own site key status ({@link inspectSiteKeyMaterial}), resolved over THIS site's
 * site-aware source ordering ({@link siteKeySourcesForSiteDir} — site-key plan §A3b, the same
 * composed helper the admin site key route's `resolveSiteKeySources` reuses) rather than the
 * module-wide env-then-legacy-file default `inspectSiteKeyMaterial()` falls back to when called
 * bare. That default cannot see a per-site key file at all (the per-site key folder), so a site
 * whose OWN key is active but has no env var and no legacy shared file would be reported `active:
 * false` — the exact gap {@link unreadableCredentialMessage} used to surface as "this server has no
 * site key" for a site that in fact has one.
 *
 * Falls back to the bare, non-site-aware status only when this runtime has no site folder at all
 * (`deps.siteBackupSources` absent — the in-memory `app.ts` runtime; in practice the plan tool's own
 * `UNAVAILABLE` check already refuses before this is ever reached for that case, but the push path
 * re-resolves the credential independently and must not throw if it ever is).
 *
 * @complexity O(1) — one `.site-meta.json` read plus a fixed-size source list, matching
 *   {@link inspectSiteKeyMaterial}'s own cost.
 */
function unreadableCredentialMessage<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>({ deps, label }: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; label: string }, _optional: Record<string, never> = {}): string {
  const status = (deps.request.siteBackupSiteKeyStatus ?? (() => {
    const siteDir = deps.request.siteBackupSources?.siteDir;
    return siteDir === undefined ? deps.serverSiteKeyStatus() : deps.siteBackupSiteKeyStatus({ siteDir });
  }))();
  if (status.active) return deps.credentialMessages.active({ label });
  if (status.invalid) return deps.credentialMessages.invalid({ label });
  return deps.credentialMessages.missing({ label });
}

/**
 * The host's default connection saved through chat's "Connect <host>" form, when no custom
 * credential points at the host. Demo dry run 2026-10-05: that form saves into the source-control
 * store, which this tool never read, so a person who had just filled it in was still told
 * CREDENTIAL_NOT_FOUND. A named `credential` matches the connection's label, which is also how the
 * push re-resolves the plan's credential.
 *
 * @complexity O(providers) repo reads, at most one decrypt each.
 */
async function resolveHostConnection<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>({ deps, providers, requested }: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; providers: readonly SourceControlProvider[]; requested: string | undefined }, _optional: Record<string, never> = {}): Promise<ResolvedBackupCredential | Refusal | null> {
  const repo = deps.request.sourceControlCredentialSetRepo;
  if (!repo) return null;
  for (const provider of providers) {
    const lookup = await findHostConnection({ deps, provider, providerId: provider.id });
    if (!lookup.ok) return lookup;
    if (lookup.found && (requested === undefined || requested === lookup.found.label)) return hostCredential({ found: lookup.found, provider });
  }
  return null;
}

type HostConnection = NonNullable<Awaited<ReturnType<typeof resolveDefaultForSourceControl>>>;

/** One host's default saved connection (or null); an unconfigured store is the safe CREDENTIAL_UNREADABLE diagnosis. */
async function findHostConnection<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>(required: {
  deps: SiteBackupToolDeps<TSource, TContent, TRequest>;
  provider: SourceControlProvider;
  providerId: SourceControlProviderId;
}): Promise<{ ok: true; found: HostConnection | null } | Refusal> {
  const { deps, provider } = required;
  try {
    return { ok: true, found: await deps.resolveDefaultForSourceControl({ deps: deps.request }, { workspaceId: deps.request.workspaceId, providerId: required.providerId }) };
  } catch (err) {
    if (deps.isSourceControlCredentialSecretStoreUnconfiguredError(err)) return { ok: false, code: "CREDENTIAL_UNREADABLE", message: unreadableCredentialMessage({ deps, label: `${provider.label} connection` }) };
    throw err;
  }
}

/** A saved host connection as the backup's credential: its token, plus the username when one was saved. */
function hostCredential(required: { found: HostConnection; provider: SourceControlProvider }): ResolvedBackupCredential {
  const { found, provider } = required;
  const { token } = found.connection;
  const connection: CustomProviderConnectionInput = "username" in found.connection ? { token, username: found.connection.username } : { token };
  return { ok: true, label: found.label, baseUrl: provider.apiOrigin, connection, provider };
}

/**
 * Resolves the credential the backup pushes with. A missing row and an undecryptable one are
 * different codes; the decrypt error's own text is never used (it can quote plaintext).
 *
 * @complexity O(saved credentials) plus one decrypt.
 */
export async function resolveBackupCredential<TSource extends SiteBackupSources, TContent extends SiteBackupRepositoryPlanContent, TRequest extends SiteBackupRequestDeps<TSource, TContent>>({ deps, requested }: { deps: SiteBackupToolDeps<TSource, TContent, TRequest>; requested: string | undefined }, _optional: Record<string, never> = {}): Promise<ResolvedBackupCredential | Refusal> {
  const providers = await loadBackupProviders(deps);
  if (!providers.ok) return providers;
  const picked = await pickCredentialLabel({ deps, providers: providers.providers, requested });
  if (!picked.ok) {
    if (picked.code !== "CREDENTIAL_NOT_FOUND") return picked;
    return (await resolveHostConnection({ deps, providers: providers.providers, requested })) ?? picked;
  }
  let resolved;
  try {
    resolved = await deps.resolveCustomCredentialByLabel({ deps: deps.request }, { workspaceId: deps.request.workspaceId, label: picked.label });
  } catch (err) {
    if (deps.isCustomCredentialSecretStoreUnconfiguredError(err)) return { ok: false, code: "CREDENTIAL_UNREADABLE", message: unreadableCredentialMessage({ deps, label: picked.label }) };
    throw err;
  }
  if (!resolved) return { ok: false, code: "CREDENTIAL_NOT_FOUND", message: `the credential '${picked.label}' was deleted while the backup was being prepared` };
  const provider = deps.pickSourceControlProviderForApi({ providers: providers.providers, baseUrl: resolved.baseUrl, noProviderMessage: providers.noProviderMessage });
  if (!provider.ok) return { ok: false, code: "NO_PROVIDER", message: provider.message };
  return { ok: true, label: picked.label, baseUrl: resolved.baseUrl, connection: resolved.connection, provider: provider.provider };
}