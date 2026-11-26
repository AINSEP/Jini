type LoadPluginCredentialCards = NonNullable<SourceControlCredentialSetupDeps["loadPluginCredentialCards"]>;
import { toolMetadata } from '@jini-ai/core/tool-metadata/source-control';
import { normalizeRepositoryFolder, prefixRepositoryPath } from "../repository-path.js";
import { type Clock } from "@jini-ai/core/primitives";
import { adaptLegacyAuthorize } from "@jini-ai/core";
import { buildDomainRegistrations, optionalBoolean, requireInputRecord, requireNoInput, requireString, type AgentToolDefinition, type AgentToolSideEffect, type ToolHandler, type ToolRegistration } from "@jini-ai/core";
import { requireToolPermission } from "@jini-ai/core";
// `ToolInputError` specifically — see `features/post/tool-registrations.ts`'s identical import
// for why: the marker `@jini-ai/daemon`'s `ToolExecutor` reads to classify a rejection 400 rather
// than redacting it into a message-stripped 500.
import { ToolInputError } from "@jini-ai/core";

import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { KeyringPort } from "@jini-ai/core/contracts/vault";
import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";

import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { ToolContributor } from "@jini-ai/core";
import type { SourceControlCommitOutcome as BaseCommitOutcome, PreviewCommitExportResult } from "../contracts.js";
import type { SourceControlCredentialSetupDeps } from "./credential-setup.js";
import type { StaticSitePackagerPort, StaticSiteIdentity } from "./static-site-packager-port.js";
import type { ExportReport } from "../../static-export/contracts.js";
import type { SourceControlProvider } from "./provider-module.js";
import type { LoadSourceControlProviders, SourceControlProviderDescriptor, SourceControlProviderRegistry } from "./store.js";
import { validateCommitTarget } from "@jini-ai/devops/source-control/site/commit-target";
import type { RepositoryTargetValidator } from "@jini-ai/devops/source-control/site/provider-module";
import { sourceControlSavedApiKeyLabels } from "@jini-ai/devops/source-control/site/saved-key-bindings";
import { proposeSourceControlCredential } from "./credential-setup.js";
import { findDefaultSourceControlCredential, listSourceControlCredentials } from "./store.js";
import type { SourceControlCredentialSetRepoPort } from "@jini-ai/core/contracts/site/source-control-credentials";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { SourceControlKitHttpClient as HttpClientPort } from "./provider-module.js";


export interface SourceControlCommitAdapter { commit: SourceControlProvider["commitSite"] }
export type SourceControlCommitOutcome = Extract<BaseCommitOutcome, { ok: false }> | (Extract<BaseCommitOutcome, { ok: true }> & { folder: string; entryPath: string });
export interface CommitSiteInput {
  readonly folder?: string;
  readonly staticSiteContext: () => Promise<StaticSiteIdentity>;
  readonly workspaceId: string;
  readonly sourceControlExportRootDir: string;
  readonly idGen: { newId(): string };
  readonly exportSiteBound: (options: { outputDir: string; clean?: boolean; basePath?: string; includeThemePreviews?: boolean; themeId?: string }) => Promise<ExportReport>;
  readonly packager: StaticSitePackagerPort;
  readonly owner: string; readonly repo: string; readonly branch?: string; readonly commitMessage: string;
}

/**
 * @file This domain's agent-tool catalog + wiring — mirrors `features/deployments/
 * publish-agent-tools.ts`'s shape closely (that file's own header explains the MCP-UI held-open
 * exchange gate this reuses; not re-derived here).
 *
 * Three tools:
 * - `credential_save with kind source-control` — opens a provider-defined human form and creates a sealed connection; no secret crosses the model boundary.
 * - `source_control_get_capabilities` — read-only, risk `"none"`: reports which providers (github,
 *   gitlab, bitbucket) have a saved credential, by id/label/isDefault/timestamps only — never a
 *   token. Deliberately does NOT report a verified/ready tri-state the way
 *   `deployment_get_static_publish_capabilities` does for its own five providers — there is no
 *   `verify.ts` equivalent for `source_control_credential_sets` yet, and fabricating one would
 *   reproduce the exact false-positive defect that file's own header describes fixing (`configured:
 *   true` here means only "a credential row exists," including a provider-declared saved API key).
 *   Also reports `commitSupported` per provider — `true` when an enabled Agent Plugin provides that
 *   host (`provider-registry.ts`; the bundled `github` plugin today) — so a workspace that saved a
 *   credential for a host no plugin serves learns from THIS tool that committing isn't available,
 *   never from a failed commit attempt (2026-08-16 review requirement).
 * - `source_control_execute_commit` performs an authorized Git commit after the shared approval gate. Provider,
 *   credential, target and branch checks still apply; existing Git history preserves overwritten
 *   files. Credentials remain server-side and are never included in the model's call or result.
 */

/** A declared host's facts as `source_control_get_capabilities` reports them. @complexity O(1). */
function hostFacts(descriptor: SourceControlProviderDescriptor): { label: string; apiOrigin: string; maxFileBytes?: number } {
  return { label: descriptor.label, apiOrigin: descriptor.apiOrigin, ...(descriptor.maxFileBytes !== undefined ? { maxFileBytes: descriptor.maxFileBytes } : {}) };
}

/**
 * The hosts `source_control_get_capabilities` reports, in order: the ones an enabled plugin provides
 * (registry order), then ones a switched-off plugin declares, then any other host a credential is
 * saved for. No host id is hard-coded here; the registry and the saved rows are the whole list.
 *
 * @complexity O(p + s) providers plus saved credentials.
 */
function reportedProviderIds(registry: SourceControlProviderRegistry, savedProviderIds: readonly string[]): readonly string[] {
  const ids = [...registry.list().map((loaded) => loaded.descriptor.id), ...(registry.switchedOff?.keys() ?? []), ...savedProviderIds];
  return [...new Set(ids)];
}

/** The loader for the workspace's plugin-provided hosts ({@link SourceControlToolDeps.loadSourceControlProviders}),
 *  resolved once here so `credential-setup.ts` takes it as a required port. */
function providerLoader(deps: SourceControlToolDeps): LoadSourceControlProviders {
  return deps.loadSourceControlProviders;
}

/** The injected adapter, or the plugin provider's for `providerId`; a caller-safe refusal otherwise. */
async function resolveCommitAdapter({ deps, providerId }: { deps: SourceControlToolDeps; providerId: string }, _optional = {}): Promise<{ ok: true; adapter: SourceControlCommitAdapter } | { ok: false; message: string }> {
  if (deps.gitAdapter) return { ok: true, adapter: deps.gitAdapter };
  const built = await deps.buildSourceControlProvider({ load: deps.loadSourceControlProviders, ...(deps.observability === undefined ? {} : { observability: deps.observability }), workspaceId: deps.workspaceId, providerId });
  return built.ok ? { ok: true, adapter: { commit: built.provider.commitSite } } : { ok: false, message: built.message };
}

/**
 * The host's display name for `providerId` and its plugin's own owner/repo check, refusing an id no
 * plugin declares and no credential can be saved for (a typo, or a host that does not exist) before
 * anything else runs. A switched-off or saved-only host has no check of its own; the generic rule in
 * `validateCommitTarget` still applies.
 *
 * @throws {ToolInputError} naming the hosts that do exist.
 * @complexity One registry load and, for a saved-only id, one authorized metadata lookup.
 */
async function requireKnownHost({ deps, providerId, authorizeSavedLookup }: {
  deps: SourceControlToolDeps; providerId: string; authorizeSavedLookup: () => Promise<void>;
}, _options = {}): Promise<{ label: string; supportsFolder?: boolean; validateTarget?: RepositoryTargetValidator }> {
  const registry = await providerLoader(deps)({ workspaceId: deps.workspaceId });
  const loaded = registry.get({ providerId });
  if (loaded !== undefined) return { label: loaded.descriptor.label, supportsFolder: loaded.module.supportsFolder === true, ...(loaded.module.validateTarget ? { validateTarget: loaded.module.validateTarget } : {}) };
  if (registry.switchedOff?.has(providerId)) return { label: providerId };
  // Saved-only ids are opaque. Authorize before inspecting their existence (registry metadata is public).
  await authorizeSavedLookup();
  if (await findConfiguredCredential({ deps, providerId })) return { label: providerId };
  const hosts = registry.list().map((loaded) => `'${loaded.descriptor.id}'`);
  throw new ToolInputError({ message: `source_control_execute_commit: '${providerId}' is not a source control host. ${hosts.length > 0 ? "Hosts: " + hosts.join(", ") : "No turned-on Agent Plugin provides one"} (see source_control_get_capabilities).` });
}

/** Reads only metadata through the existing custom-credential owner and injected repo port.
 * An undeclared provider never consults custom keys. @complexity One bounded credential inventory. */
async function findSavedApiKey({ deps, providerId }: { deps: SourceControlToolDeps; providerId: string }, _options = {}) {
  const label = sourceControlSavedApiKeyLabels.get(providerId);
  if (!label || !deps.sourceControlSavedKeys) return null;
  return deps.sourceControlSavedKeys.describeByLabel({ workspaceId: deps.workspaceId, label });
}

/** Presence only: explicit identity first, then the provider's saved API key. Never opens a secret.
 * An explicit but ambiguous inventory must not silently choose a different store.
 * @complexity Source-control selection/inventory and, only with no rows, one custom-key inventory. */
async function findConfiguredCredential({ deps, providerId }: { deps: SourceControlToolDeps; providerId: string }, _options = {}) {
  if (deps.sourceControlCredentialSetRepo.canonical?.supports({ providerId })) {
    const saved = await findSavedApiKey({ deps, providerId });
    return saved ? { providerId, credentialSource: "saved-api-key" } : null;
  }
  const explicit = await findDefaultSourceControlCredential({ deps: deps.deps, repo: deps.sourceControlCredentialSetRepo }, { workspaceId: deps.workspaceId, providerId });
  if (explicit) return { providerId, credentialSource: "source-control" };
  const identities = await listSourceControlCredentials({ deps: deps.deps, repo: deps.sourceControlCredentialSetRepo }, { workspaceId: deps.workspaceId });
  if (identities.some(identity => identity.providerId === providerId)) return null;
  const saved = await findSavedApiKey({ deps, providerId });
  return saved ? { providerId, credentialSource: "saved-api-key" } : null;
}

/** Opens only the declared saved key through its existing reader; never logs or returns metadata.
 * Errors go to commit-site's fixed, secret-free failure outcome.
 * @complexity Credential presence reads plus one custom-key inventory and selected secret open. */
async function resolveSavedApiKey({ deps, workspaceId, providerId }: {
  deps: SourceControlToolDeps; workspaceId: string; providerId: string;
}, _options = {}): Promise<{ token: string } | null> {
  const label = sourceControlSavedApiKeyLabels.get(providerId);
  if (!label || !deps.sourceControlSavedKeys) return null;
  const configured = await findConfiguredCredential({ deps: { ...deps, workspaceId }, providerId });
  if (configured?.credentialSource !== "saved-api-key") return null;
  const saved = await deps.sourceControlSavedKeys.resolveByLabel({ workspaceId, label });
  return saved ? { token: saved.connection.token } : null;
}



/**
 * This wiring layer's OWN risk classification, independent of the catalog's `sideEffects` declaration
 * (`@jini-ai/cms/core`'s `assertToolIsWirable` cross-checks the two).
 */
export const sourceControlDerivedRisk: ReadonlyMap<string, AgentToolSideEffect> = new Map<string, AgentToolSideEffect>([
  // -> source-control inventory plus declared saved API-key metadata. No decrypt, no network call.
  ["source_control_get_capabilities", "none"],
  // -> proposeSourceControlCredential -> createSourceControlCredential: seals and inserts a saved connection after human submit.

  // -> calls `commitSiteToSourceControl`: a real `exportSite` pass plus a real GitHub Git
  // Data API commit using a write-scoped credential — genuinely mutates external durable state.
  ["source_control_execute_commit", "mutates-durable-state"],
]);

/** The custom-credentials owner's by-label reads, bound at the composition root over its repo and sealer.
 * Workspace scoping, grant checks and redaction stay with that owner; this feature never sees its repo. */
export interface SourceControlSavedKeyReader {
  /** Metadata only (label, hint, hosts): never opens a secret. Null when this workspace has no such label. */
  describeByLabel(input: { workspaceId: string; label: string }): Promise<object | null>;
  /** Opens the one selected key through the owner's context-checked reader. Null when absent. */
  resolveByLabel(input: { workspaceId: string; label: string }): Promise<{ connection: { token: string } } | null>;
}

/**
 * The exact slice of the route-deps bag this domain's tool handlers read. Declared structurally
 * (rather than importing `server/routes/types`'s `RouteDeps`) so this module carries no back-edge
 * into the composition root — same discipline `comments/tool-registrations.ts`'s `CommentsToolDeps`
 * documents for its own narrowing.
 *
 * exportSiteBound is closed over the full application dependencies at the composition root.
 * Passing that one pre-bound operation lets the tool run a real export without importing the
 * composition root's wide RouteDeps type; route callers satisfy the narrower shape structurally.
 */
export interface SourceControlToolDeps extends SourceControlCredentialSetupDeps {
  readonly staticSiteContext: () => Promise<StaticSiteIdentity>;
  readonly staticSitePackager: StaticSitePackagerPort;
  readonly catalog: ReadonlyMap<string, AgentToolDefinition>;
  readonly switchedOffPluginSentence: (required: { pluginIds: readonly string[] }) => string;
  readonly buildSourceControlProvider: (required: { load: LoadSourceControlProviders; observability?: ObservabilityPort; httpClient?: HttpClientPort; workspaceId: string; providerId: string }) => Promise<{ ok: true; provider: SourceControlProvider } | { ok: false; message: string }>;
  readonly previewCommitExport: (input: CommitSiteInput, optional: { providerId: string; validateTarget?: RepositoryTargetValidator }) => Promise<PreviewCommitExportResult>;
  readonly commitSiteToSourceControl: (deps: { providerId: string; supportsFolder: boolean; credentialDeps: { deps: SourceControlCredentialSetupDeps["deps"]; repo: SourceControlCredentialSetRepoPort; sealer: SecretSealerPort; resolveSavedApiKey: (input: { workspaceId: string; providerId: string }, options?: Record<string, never>) => Promise<{ token: string } | null> }; gitAdapter: SourceControlCommitAdapter; validateTarget?: RepositoryTargetValidator }, input: CommitSiteInput) => Promise<SourceControlCommitOutcome>;
  readonly loadPluginCredentialCards?: LoadPluginCredentialCards;
  readonly authorize: AuthorizeFn;
  readonly workspaceId: string;
  readonly sourceControlCredentialSetRepo: SourceControlCredentialSetRepoPort;
  /** Existing custom-key repo port, supplied by composition; optional for source-control-only hosts. */
  // A04: the port is now the custom-key owner's label lookups (describe/resolve), bound over its repo and sealer.
  readonly sourceControlSavedKeys?: SourceControlSavedKeyReader;
  readonly siteAssistantSecretSealer: SecretSealerPort;
  readonly siteAssistantSecretKeyring: KeyringPort;
  readonly clock: Clock;
  /** The guarded client for the save-time provider identity probe, which carries the saved token
   *  (`RouteDeps.customCredentialsHttpClient`). Absent, the probe is not attempted. */
  readonly customCredentialsHttpClient?: HttpClientPort;
  /** `RouteDeps.observability`: a commit's git-host calls are outbound spans. */
  readonly observability?: ObservabilityPort;
  readonly sourceControlExportRootDir: string;
  readonly idGen: { newId(): string };
  /** See `commit-site.ts`'s `ExportSiteBoundFn` doc for what this is and why it replaces the
   *  `routeDeps: RouteDeps` field `commitSiteToSourceControl`'s input used to carry. */
  readonly exportSiteBound: CommitSiteInput["exportSiteBound"];
  /** Overrides the plugin provider's commit adapter, which is the default when this is omitted.
   *  Tests inject a fake here. */
  readonly gitAdapter?: SourceControlCommitAdapter;
  /** This workspace's git-host providers; the installed, enabled Agent Plugins supplied by composition. */
  readonly loadSourceControlProviders: LoadSourceControlProviders;
}

const EXECUTE_COMMIT_TOOL_ID = "source_control_execute_commit";

/** The validated, typed shape of `source_control_execute_commit`'s input, once parsed. */
interface ParsedCommitCommand {
  provider: string;
  owner: string;
  repo: string;
  commitMessage: string;
  branch: string | undefined;
  folder: string;
  dryRun: boolean;
}

/** Reads `source_control_execute_commit`'s raw input; {@link requireValidTarget} checks it once the
 *  host is known. @throws {ToolInputError} on a missing or non-string required field, or a present
 *  non-string `branch` (dropping it would commit to the default branch the model did not name). */
function parseCommitCommand(raw: Record<string, unknown>): ParsedCommitCommand {
  const provider = requireString({ input: raw, key: "provider" });
  const owner = requireString({ input: raw, key: "owner" });
  const repo = requireString({ input: raw, key: "repo" });
  const commitMessage = requireString({ input: raw, key: "commitMessage" });
  if (raw.branch !== undefined && typeof raw.branch !== "string") {
    throw new ToolInputError({ message: `${EXECUTE_COMMIT_TOOL_ID}: 'branch' must be a string when provided` });
  }
  const branch = raw.branch;
  let folder: string;
  try { folder = normalizeRepositoryFolder({ folder: raw.folder }); }
  catch (error) { throw new ToolInputError({ message: `${EXECUTE_COMMIT_TOOL_ID}: ${(error as Error).message}` }); }
  const dryRun = optionalBoolean({ input: raw, key: "dryRun" }) ?? false;
  return { provider, owner, repo, commitMessage, branch, folder, dryRun };
}

/**
 * The owner/repo/branch/commitMessage shape via `validateCommitTarget`, with the host plugin's own
 * owner/repo rules first. Runs before any permission check or dialog.
 *
 * @throws {ToolInputError} on any invalid field.
 * @complexity O(1).
 */
function requireValidTarget({ command, validateTarget }: { command: ParsedCommitCommand; validateTarget: RepositoryTargetValidator | undefined }, _optional = {}): void {
  const { owner, repo, branch, commitMessage } = command;
  const configError = validateCommitTarget({ owner, repo, ...(branch !== undefined ? { branch } : {}), commitMessage }, validateTarget === undefined ? {} : { validateTarget });
  if (configError !== null) {
    throw new ToolInputError({ message: `source_control_execute_commit: ${configError}` });
  }
}

/** The preview and confirmed commit consume the same destination and packaging context.
 * @complexity O(1), no effects.
 */
function commitInput({ deps, command }: { deps: SourceControlToolDeps; command: ParsedCommitCommand }, _options = {}): CommitSiteInput {
  return { workspaceId: deps.workspaceId, sourceControlExportRootDir: deps.sourceControlExportRootDir,
    idGen: deps.idGen, exportSiteBound: deps.exportSiteBound, staticSiteContext: deps.staticSiteContext, packager: deps.staticSitePackager,
    owner: command.owner, repo: command.repo, folder: command.folder, commitMessage: command.commitMessage,
    ...(command.branch !== undefined ? { branch: command.branch } : {}) };
}

/**
 * Maps `commitSiteToSourceControl`'s outcome to the tool's result shape — the failure branch stays
 * a typed `{code, message}` pass-through, the success branch reports every field a human or a
 * follow-up call might need, including `divergedPaths` (see the field's own doc at the call site).
 */
function buildCommitOutcomeResult(outcome: SourceControlCommitOutcome): unknown {
  if (!outcome.ok) {
    return { committed: false, cancelled: false, code: outcome.code, message: outcome.message };
  }
  return {
    committed: true,
    owner: outcome.owner,
    repo: outcome.repo,
    folder: outcome.folder,
    entryPath: outcome.entryPath,
    branch: outcome.branch,
    branchCreated: outcome.branchCreated,
    commitSha: outcome.commitSha,
    commitUrl: outcome.commitUrl,
    filesChanged: outcome.filesChanged,
    filesDeleted: outcome.filesDeleted,
    // Paths this tool previously committed that the current export dropped, but did NOT delete —
    // their live content no longer matches what this tool itself last wrote (or pre-dates this
    // tool's ability to verify that at all). See `commit-site.ts`'s `SourceControlCommitOutcome`
    // doc. Surfaced so the human is told exactly what survived and why, not just a bare count.
    divergedPaths: outcome.divergedPaths,
  };
}

/**
 * Builds this domain's `guidance` string for `source_control_get_capabilities` — extracted purely for
 * readability, same reasoning `publish-agent-tools.ts`'s own `buildCapabilityGuidance` gives.
 * `undefined` means "nothing to tell the human" (configured AND commit-supported).
 *
 * @complexity O(1) — fixed string interpolation, no iteration.
 */
function buildCapabilityGuidance({ providerId, configured, commitReady, switchedOffPluginId, switchedOffPluginSentence }: { switchedOffPluginSentence: SourceControlToolDeps["switchedOffPluginSentence"]; providerId: string; configured: boolean; commitReady: boolean; switchedOffPluginId: string | undefined }, _optional = {}): string | undefined {
  const switchOn = switchedOffPluginId === undefined ? "" : `: ${switchedOffPluginSentence({ pluginIds: [switchedOffPluginId] })}`;
  if (!configured && !commitReady) {
    return `No ${providerId} credential is saved, and no enabled Agent Plugin supports committing to ${providerId}${switchOn || "."}`;
  }
  if (!configured) {
    // Demo dry run 2026-10-05: the token form opened before the person had heard any of this.
    return `No ${providerId} credential is saved yet. First tell the person what is needed and ask which repository (owner/name) to use: ` +
      "for a site backup it must be private and already have at least one commit (for example a README), and the token needs " +
      "Contents read and write on it. Then call credential_save with kind source-control to open the human credential form.";
  }
  if (!commitReady) {
    return `A ${providerId} credential is saved, but no enabled Agent Plugin supports committing to ${providerId}${switchOn || "."}`;
  }
  return undefined;
}

/**
 * Builds this domain's `ToolRegistration[]` — same shape every other domain's
 * `build<Domain>Registrations` produces.
 *
 * @param deps - `SourceControlToolDeps` (the narrow slice of `RouteDeps` this domain reads, plus
 *   this file's own test-only `gitAdapter` override).
 * @param surfaces - The surface exchange store used by the credential setup forms; commits run
 *   on — required, matching `buildStaticPublishRegistrations`' own shape.
 * @complexity O(1) registration-time cost; each wired handler's own cost is documented at its call
 *   site above.
 */
/** Bind the source-control credential owner with the same installed-provider loader as other tools.
 * @param required - Existing domain dependencies and shared surface exchanges.
 * @returns Internal save adapter; permissions and errors remain domain-owned.
 * @example buildSourceControlCredentialHandler({ deps, surfaces });
 * @complexity O(1) binding; provider/save costs are documented by proposeSourceControlCredential.
 */
export function buildSourceControlCredentialHandler({ deps, surfaces }: { deps: SourceControlToolDeps; surfaces: AssistantSurfaceDeps }, _optional = {}): ToolHandler {
  return (ctx, optional = {}) => proposeSourceControlCredential({ ctx, deps: { ...deps, loadSourceControlProviders: providerLoader(deps) }, surfaces }, optional);
}

async function previewSourceControlCommit({ deps, command, host }: { deps: SourceControlToolDeps; command: ParsedCommitCommand; host: Awaited<ReturnType<typeof requireKnownHost>> }) {
  // Same "presence only" read `source_control_get_capabilities` and the real-commit path
  // below both rely on — never decrypts. No dialog: a dry run only previews what a real
  // commit would export, so it never opens the confirmation surface or touches `emitSurface`.
  const existing = await findConfiguredCredential({ deps, providerId: command.provider });
  const preview = await deps.previewCommitExport(commitInput({ deps, command }), { providerId: command.provider, ...(host.validateTarget === undefined ? {} : { validateTarget: host.validateTarget }) });
  if (!preview.ok) {
    return {
      dryRun: true,
      committed: false,
      owner: command.owner,
      repo: command.repo,
      branch: command.branch,
      credentialConfigured: existing !== null,
      code: preview.code,
      message: preview.message,
    };
  }
  return {
    dryRun: true,
    committed: false,
    owner: command.owner,
    repo: command.repo,
    branch: command.branch,
    credentialConfigured: existing !== null,
    fileCount: preview.fileCount,
    totalBytes: preview.totalBytes,
    paths: preview.paths,
    folder: command.folder,
    entryPath: prefixRepositoryPath({ folder: command.folder, path: deps.staticSitePackager.entryFile }),
    note: "Nothing was sent. Call again without dryRun to commit.",
  };
}

async function executeSourceControlCommit({ deps, ctx }: { deps: SourceControlToolDeps; ctx: Parameters<ToolHandler>[0] }) {
  const raw = requireInputRecord({ input: ctx.input });
  const command = parseCommitCommand(raw);

  const authorizeCommit = () => requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "source-control.commit" }, { entityType: "source-control" });
  const host = await requireKnownHost({ deps, providerId: command.provider, authorizeSavedLookup: authorizeCommit });
  const hostLabel = host.label;
  requireValidTarget({ command, validateTarget: host.validateTarget });
  await authorizeCommit();
  if (command.folder && host.supportsFolder !== true) return { committed: false, reason: "folder-unsupported", message: `${hostLabel} does not support folder commits. Update its provider before selecting a folder.` };

  if (command.dryRun) {
    return previewSourceControlCommit({ deps, command, host });
  }

  // Never decrypts — a plain repo read, same "presence only" contract `source_control_get_capabilities`
  // relies on. Checked before raising any dialog so a guaranteed-fail call never wastes a human's
  // attention.
  const existing = await findConfiguredCredential({ deps, providerId: command.provider });
  if (!existing) {
    return {
      committed: false,
      reason: "no-credential",
      message: `No ${hostLabel} source control credential is configured for this workspace. Call credential_save with kind source-control to open a human credential form before committing.`,
    };
  }
  const commitAdapter = await resolveCommitAdapter({ deps, providerId: command.provider });
  if (!commitAdapter.ok) return { committed: false, reason: "no-provider", message: commitAdapter.message };

  // The run ended during the pre-dialog reads: no dialog, and no call left waiting on an abort already past.
  if (ctx.signal.aborted) return { committed: false, cancelled: false, reason: "abandoned" };
  const outcome = await deps.commitSiteToSourceControl(
    { providerId: existing.providerId, supportsFolder: host.supportsFolder === true, credentialDeps: { deps: deps.deps, repo: deps.sourceControlCredentialSetRepo, sealer: deps.siteAssistantSecretSealer,
      resolveSavedApiKey: (input, options = {}) => resolveSavedApiKey({ deps, ...input }, options),
    }, gitAdapter: commitAdapter.adapter, ...(host.validateTarget ? { validateTarget: host.validateTarget } : {}) },
    commitInput({ deps, command })
  );

  return buildCommitOutcomeResult(outcome);
}

export function buildSourceControlRegistrations(deps: SourceControlToolDeps, surfaces: AssistantSurfaceDeps): ToolRegistration[] {
  const handlers: Record<string, ToolHandler> = {
    source_control_get_capabilities: async (ctx) => {
      requireNoInput({ input: ctx.input });
      await requireToolPermission({ authorize: adaptLegacyAuthorize({ authorize: deps.authorize }), workspaceId: deps.workspaceId, principalId: ctx.principal.id, permission: "source-control.read" }, { entityType: "source-control" });

      const saved = await listSourceControlCredentials({ deps: deps.deps, repo: deps.sourceControlCredentialSetRepo }, { workspaceId: deps.workspaceId });
      const registry = await providerLoader(deps)({ workspaceId: deps.workspaceId });

      const providers = await Promise.all(reportedProviderIds(registry, saved.map((credential) => credential.providerId)).map(async (providerId) => {
        const savedCredentials = saved
          .filter((credential) => credential.providerId === providerId && !deps.sourceControlCredentialSetRepo.canonical?.supports({ providerId }))
          .map((credential) => ({ id: credential.id, label: credential.label, isDefault: credential.isDefault, createdAt: credential.createdAt, updatedAt: credential.updatedAt }));
        let hasSavedApiKey = false;
        if (savedCredentials.length === 0) hasSavedApiKey = (await findSavedApiKey({ deps, providerId })) !== null;
        const configured = savedCredentials.length > 0 || hasSavedApiKey;
        const loaded = registry.get({ providerId });
        const ready = loaded !== undefined;
        const guidance = buildCapabilityGuidance({ providerId, configured, commitReady: ready, switchedOffPluginId: registry.switchedOff?.get(providerId), switchedOffPluginSentence: deps.switchedOffPluginSentence });

        return {
          providerId,
          ...(loaded ? hostFacts(loaded.descriptor) : {}),
          configured,
          ...(hasSavedApiKey ? { credentialSource: "saved-api-key" } : {}),
          commitSupported: ready,
          supportsFolder: loaded?.module.supportsFolder === true,
          savedCredentials,
          ...(guidance !== undefined ? { guidance } : {}),
        };
      }));

      return { providers };
    },

    /** Shared approval precedes real export commits, which can remove stale paths;
     * dry-run previews stay direct. Target, credential and branch checks remain. */
    source_control_execute_commit: async (ctx) => executeSourceControlCommit({ deps, ctx }),
  };

  // No `unwiredToolIds`: this domain wires its ENTIRE catalog — a 3rd catalog entry added without a
  // handler fails the build.
  return buildDomainRegistrations({ metadata: toolMetadata,
    domain: "source-control",
    catalogModule: "features/source-control/tool-registrations.ts",
    catalog: deps.catalog,
    handlers,
    derivedRisk: sourceControlDerivedRisk,
  });
}

/**
 * Contributes Source Control's AI tools; called once by the composition root's
 * `installFirstPartyToolContributors()`, never as an import side effect.
 * Credential resolution is injected with structural signatures; importing this feature from
 * credential discovery would close a runtime cycle back through the assistant.
 */
export function contributeSourceControlTools(): ToolContributor<SourceControlToolDeps, AssistantSurfaceDeps> {
  return { domain: "source-control", build: buildSourceControlRegistrations, risk: sourceControlDerivedRisk };
}
export function bindSourceControlTools(required: Pick<SourceControlToolDeps, "deps" | "catalog" | "switchedOffPluginSentence" | "buildSourceControlProvider" | "previewCommitExport" | "commitSiteToSourceControl" | "defineSecretCardTool" | "applyPluginCredentialCard" | "findPluginCredentialCard" | "askThenReport" | "credentialSaveToolId" | "credentialFormUriHost" | "backupRepositoryRules" | "credentialText" | "formatCredentialHint" | "reportCredentialFailure" | "assertCredentialFreeField" | "isProjectKeyCreateConflictError">, _optional: Record<string, never> = {}) {
  return { buildSourceControlCredentialHandler: ({ deps, surfaces }: { deps: Omit<SourceControlToolDeps, keyof typeof required>; surfaces: AssistantSurfaceDeps }, optional: Record<string, never> = {}) => buildSourceControlCredentialHandler({ deps: { ...deps, ...required }, surfaces }, optional), buildSourceControlRegistrations: (deps: Omit<SourceControlToolDeps, keyof typeof required>, surfaces: AssistantSurfaceDeps) => buildSourceControlRegistrations({ ...deps, ...required }, surfaces), contributeSourceControlTools: (): ToolContributor<Omit<SourceControlToolDeps, keyof typeof required>, AssistantSurfaceDeps> => ({ domain: "source-control", build: (deps, surfaces) => buildSourceControlRegistrations({ ...deps, ...required }, surfaces), risk: sourceControlDerivedRisk }) };
}
