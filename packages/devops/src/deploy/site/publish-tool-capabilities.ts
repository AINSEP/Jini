import { deployTargetsLoader } from './publish-tool-execution.js';
import { requireNoInput, type ToolHandler } from '@jini-ai/core';
import { adaptLegacyAuthorize } from '@jini-ai/core';
import type { StaticPublishToolDeps } from './publish-tool-deps.js';
import type { InstalledDeployTarget, DeployTargetDescriptor, DeployTargetRegistry, LoadedDeployTarget } from './deploy-targets/types.js';
import { listPublishCredentials, type PublishCredentialReadDeps } from './publish-credentials/store.js';
import { type PublishCredentialVerificationCache } from './static-publish/verify.js';
import type { PublishHistoryStore } from './static-publish/publish-history.js';
import type { PublishCredentialSource } from './static-publish/types.js';

const DEPLOYMENTS_READ_PERMISSION = "deployments.read";
const SITE_PUBLISH_ENTITY = "site-publish";

/**
 * Builds `deployment_get_static_publish_capabilities`'s per-provider `guidance` string — extracted
 * from that handler's own `providers.map()` purely for readability (the four cases read as one flat
 * decision this way rather than a nested ternary inline). `undefined` means "nothing to tell the
 * human" (the provider is fully ready).
 *
 * The `"invalid"` and `"unreachable"` branches are deliberately worded differently, per code review:
 * an `"invalid"` credential (the provider affirmatively rejected it) tells the human to fix it;
 * an `"unreachable"` one (a network failure/timeout/5xx during the last check — says NOTHING about
 * whether the credential itself is good) must never suggest replacing a possibly-fine credential
 * over what may have been a transient blip. Collapsing the two into one "update it" message would
 * risk sending someone to regenerate a working token — the same false-negative shape Defect A (this
 * same finding session) was filed for, one layer up.
 *
 * @complexity O(1) — fixed string interpolation, no iteration.
 * @overallScore 100
 */
function buildCapabilityGuidance({ providerId, readiness, verification, credentialOrigin }: {
  providerId: string;
  readiness: { configured: true } | { configured: false; reason: string };
  verification: { status: "valid" | "invalid" | "unreachable"; checkedAt: string; message: string } | undefined;
  credentialOrigin: "saved" | "environment" | null;
}, _options = {}): string | undefined {
  if (!readiness.configured) return readiness.reason;
  if (credentialOrigin === "environment") {
    return `A ${providerId} key is configured on this server (environment). Publish with it; don't ask for or save another key.`;
  }
  if (verification === undefined) {
    return `This ${providerId} credential is saved but has not been verified against ${providerId} yet — verify it in the Static Site tab before relying on it.`;
  }
  if (verification.status === "invalid") {
    return `The saved ${providerId} credential was rejected by ${providerId} (checked ${verification.checkedAt}): ${verification.message} Update it in the Static Site tab.`;
  }
  if (verification.status === "unreachable") {
    return `The last check of this ${providerId} credential could not reach ${providerId} (checked ${verification.checkedAt}): ${verification.message} This does not mean the credential is bad — try verifying again in the Static Site tab.`;
  }
  return undefined;
}

/** Per-provider dependencies {@link buildProviderCapability} needs — the already-fetched credential
 *  summaries plus every port it reads, so the capabilities handler's `registry.list().map()` callback
 *  stays a single call per provider rather than a long inline closure. */
interface ProviderCapabilityContext {
  readonly deps: StaticPublishToolDeps;
  readonly credentialSource: PublishCredentialSource;
  readonly historyStore: PublishHistoryStore;
  readonly saved: Awaited<ReturnType<typeof listPublishCredentials>>;
}

/** {@link buildProviderCapability}'s `savedCredentials` entries: no secret, only the token's last 4. */
function mapSavedCredentials(saved: Awaited<ReturnType<typeof listPublishCredentials>>) {
  return saved.map(({ id, label, isDefault, createdAt, updatedAt, tokenTail, tokenHint, credentialType, worksFor }) => ({ id, label, isDefault, createdAt, updatedAt, tokenTail, tokenHint, credentialType, worksFor }));
}

/**
 * {@link buildProviderCapability}'s result-object assembly, split out from the value computation so
 * neither half alone carries every branch in the original 100-line closure. `verifiedAt`/`accountLabel`
 * are the two fields this handler still needs beyond what {@link buildCapabilityGuidance} itself reads.
 *
 * accountLabel prefers the default credential's stored column, healed by post-save verification,
 * and falls back to cached verification only when that column is null (an unhealed or env-only row).
 * Stored identity survives restart while the cache does not, and prevents guessing a GitHub account
 * from the human's email instead of using the verified token's actual account.
 */
function buildProviderCapabilityResult(spec: {
  readonly descriptor: DeployTargetDescriptor;
  readonly ready: boolean;
  readonly readiness: { configured: true } | { configured: false; reason: string };
  readonly verified: "valid" | "invalid" | "unreachable" | null;
  readonly verification: ReturnType<PublishCredentialVerificationCache["get"]>;
  readonly defaultCredential: { readonly accountLabel: string | null } | undefined;
  readonly lastPublish: Awaited<ReturnType<PublishHistoryStore["getLast"]>>;
  readonly savedCredentials: ReturnType<typeof mapSavedCredentials>;
  readonly credentialOrigin: "saved" | "environment" | null;
  readonly guidance: string | undefined;
}, _options = {}) {
  const { descriptor, ready, readiness, verified, verification, defaultCredential, lastPublish, savedCredentials, credentialOrigin, guidance } = spec;
  return {
    providerId: descriptor.id,
    label: descriptor.label,
    // What a publish to this host takes, besides `target` and `projectName`: pass each as a
    // top-level string property of the same name.
    configFields: descriptor.configFields.map(({ name, label, required, help }) => ({ name, label, required, ...(help !== undefined ? { help } : {}) })),
    ready,
    credentialConfigured: readiness.configured,
    credentialOrigin,
    verified,
    verifiedAt: verification?.checkedAt ?? null,
    // The verified credential's own public account login/username, when the host's verifier
    // reports one — `null` when not yet verified, or for a provider whose verifier has no reviewed
    // account field to read (see `verify.ts`'s header).
    accountLabel: defaultCredential?.accountLabel ?? verification?.accountLabel ?? null,
    lastPublish,
    savedCredentials,
    ...(guidance !== undefined ? { guidance } : {}),
  };
}

/**
 * Computes one provider's `deployment_get_static_publish_capabilities` entry — extracted from that
 * handler's own `PROVIDER_IDS.map()` callback purely to keep this domain's complexity gates: this was
 * previously a single ~100-line inline async arrow.
 *
 * `savedCredentials` include only this host's explicitly compatible keys, with defaults selected
 * after compatibility and token-only shape filtering. `credentialConfigured` comes from
 * `credentialSource.isConfigured` (a saved default, or in self-hosted mode an env var).
 *
 * `ready` means "will actually work," not merely "a credential is saved" (2026-08-16 fix: a saved
 * GitHub token GitHub rejected outright with 401 used to still report `ready: true`) — a credential
 * that is configured but never verified, that failed its last verification, or whose last check could
 * not reach the provider is NOT ready.
 *
 * `verification` is a cached, non-decrypting read only — NEVER `verifyPublishCredential` from here
 * (that decrypts and makes a real provider call; see `static-publish/verify.ts`'s own header for why
 * this handler must never be its caller).
 */
async function buildProviderCapability(loaded: LoadedDeployTarget, ctx: ProviderCapabilityContext) {
  const providerId = loaded.descriptor.id;
  const savedForVendor = ctx.saved.filter(credential => credential.publishHosts.includes(providerId))
    .map(credential => ({ ...credential, isDefault: credential.defaultFor.includes(providerId) }));
  const savedCredentials = mapSavedCredentials(savedForVendor);
  const defaultCredential = savedForVendor.find((credential) => credential.isDefault);
  const readiness = await ctx.credentialSource.isConfigured({ workspaceId: ctx.deps.workspaceId, target: providerId });
  // 2026-08-16, Defect 2: the last successful publish to this provider, if any — see
  // `publish-history.ts`'s own header for the storage design. `null` means never published (from
  // this server, in this history store) rather than an absent key, so an agent-facing JSON result
  // always carries the field.
  const lastPublish = await ctx.historyStore.getLast({ workspaceId: ctx.deps.workspaceId, target: providerId });
  const verification = readiness.configured ? ctx.deps.publishCredentialVerificationCache.get({ workspaceId: ctx.deps.workspaceId, target: providerId, basis: readiness.basis }) : undefined;
  const verified = verification ? verification.status : null;
  const ready = readiness.configured && verified === "valid";
  const fallbackOrigin = readiness.configured ? "environment" : null;
  const credentialOrigin = savedCredentials.length ? "saved" : fallbackOrigin;
  const guidance = buildCapabilityGuidance({ providerId, readiness, verification, credentialOrigin });

  return { ...buildProviderCapabilityResult({ descriptor: loaded.descriptor, ready, readiness, verified, verification, defaultCredential, lastPublish, savedCredentials, credentialOrigin, guidance }),
    defaultForNewDestination: loaded.module.defaultForNewDestination === true,
    authenticatedPreview: loaded.module.preview !== undefined };
}

/** Preserve enabled-host readiness while exposing disabled/unknown hosts without claiming their
 * credentials were inspected. Only activation permits executable use; loader refusals remain visible.
 * @returns One host choice with explicit installation, activation and readiness states.
 * @complexity O(1) metadata; enabled hosts delegate to the existing credential/history read model.
 */
async function buildInstalledProviderCapability({ installed, registry, context }: {
  installed: InstalledDeployTarget; registry: DeployTargetRegistry; context: ProviderCapabilityContext;
}, _optional: Record<string, never> = {}) {
  const loaded = registry.get(installed.descriptor.id);
  const identity = { pluginId: installed.pluginId, enabled: installed.enabled };
  if (installed.enabled === true && loaded?.pluginId === installed.pluginId) {
    return { ...await buildProviderCapability(loaded, context), ...identity, executable: true };
  }
  return { providerId: installed.descriptor.id, label: installed.descriptor.label, ...identity,
    executable: false, ready: false, credentialConfigured: null, savedCredentials: null,
    guidance: installed.enabled === true
      ? "The hosting plugin is enabled but its target could not be loaded. Inspect refusals before publishing."
      : `Turn on Agent Plugin '${installed.pluginId}' under Admin → Agent Plugins, then call deployment_get_static_publish_capabilities again. Credentials and readiness have not been inspected for this host.` };
}

/** A host lacking a saved key on this site. `worksForIds` is non-empty only for a host that is not
 *  loaded (its plugin is off): the copy inventory derives `publishHosts` from this site's LOADED
 *  hosts, so an off host never appears there (2026-11-02 owner bug: with a hosting plugin off, the chat said
 *  "no site has a key for that host" while 8 sites held one). For such a host a key's saved worksFor (the
 *  host id or its vendor id, the ids the Jini matcher reads) declares compatibility. Presence only:
 *  the copy card and the publish itself still re-check the key. */
interface MissingHost { readonly id: string; readonly worksForIds: readonly string[] }

function hostsMissingSavedKey({ providers, installed }: {
  providers: readonly { providerId: string; executable: boolean; savedCredentials: readonly unknown[] | null }[];
  installed: readonly InstalledDeployTarget[];
}, _options = {}): MissingHost[] {
  return providers.filter(provider => !provider.savedCredentials?.length).map(provider => {
    if (provider.executable) return { id: provider.providerId, worksForIds: [] };
    const vendorId = installed.find(item => item.descriptor.id === provider.providerId)?.descriptor.credential?.vendorId;
    return { id: provider.providerId, worksForIds: [provider.providerId, vendorId].filter((id): id is string => !!id).map(id => id.toLowerCase()) };
  });
}

    /**
     * Never decrypts — reads through `listPublishCredentials` (a pure DB read of
     * `vendor_credential_sets`; see its own "read model only" doc) and `credentialSource.isConfigured`
     * (this file's own preview handler already relies on the identical never-decrypting contract).
     * Structurally cannot reach `resolveForPublish`/`resolveDefaultForPublish`: this handler never
     * hands them a `SecretSealerPort`. `tokenTail` is the stored last 4 characters, never derived by
     * decrypting.
     */
export async function getStaticPublishCapabilities({ deps, credentialSource, historyStore, ctx }: { deps: StaticPublishToolDeps; credentialSource: PublishCredentialSource; historyStore: PublishHistoryStore; ctx: Parameters<ToolHandler>[0] }) {
      requireNoInput({ input: ctx.input });
      await deps.requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: DEPLOYMENTS_READ_PERMISSION }, { entityType: SITE_PUBLISH_ENTITY });

      const loadDeployTargets = deployTargetsLoader(deps);
      // Owner policy: unseal only server-side to derive the safe hint.
      // Readiness still uses isConfigured(); no usable credential or provider probe reaches this result.
      const saved = await listPublishCredentials({ ...deps.credentialStorePorts, repo: deps.vendorCredentialSetRepo, sealer: deps.siteAssistantSecretSealer, loadDeployTargets } satisfies PublishCredentialReadDeps, {
        workspaceId: deps.workspaceId,
      });

      const registry = await loadDeployTargets({ workspaceId: deps.workspaceId });
      const providerCapabilityContext: ProviderCapabilityContext = { deps, credentialSource, historyStore, saved };
      const inventory = deps.loadInstalledDeployTargets
        ? await deps.loadInstalledDeployTargets({ workspaceId: deps.workspaceId })
        : { items: registry.list().map(({ descriptor, pluginId }) => ({ descriptor, pluginId, enabled: true })), refusals: [] };
      const providers = await Promise.all(inventory.items.map(installed => buildInstalledProviderCapability({ installed, registry, context: providerCapabilityContext })));
      const refusals = [...new Set([...inventory.refusals, ...registry.refusals])];

      const missing = hostsMissingSavedKey({ providers, installed: inventory.items });
      if (missing.length) return { executionMode: deps.publishExecutionMode, providers, refusals,
        credentialSetup: deps.vendorCredentialSetRepo.project
          ? { toolId: "credential_copy_from_project", message: "Use a saved key to choose from Shared Keys, or enter a new key in the secure card." }
          : { toolId: "credential_save", kind: "publish-host", message: "Open the secure key card to save a publishing key for this site." } };
      return { executionMode: deps.publishExecutionMode, providers, refusals };
}

