import { planStaticPublish, publishOutputDir, resolvePublishPlan, type StaticPublishPlan } from './adapter-plan.js';
import { runExportForPublish, buildDeployFilesForPublish } from './adapter-export.js';
export { planStaticPublish, missingRequiredFieldMessage, unknownTargetMessage, readStaticPublishConfig, publishOutputDir } from './adapter-plan.js';
export { toDeployFile } from './adapter-export.js';
export type { StaticPublishPlan } from './adapter-plan.js';
import type { ToolFailureDiagnostic } from "@jini-ai/core/contracts/site/daemon-tool-recovery";
import { describeErrorForLog } from "@jini-ai/core/model-facing-tool-errors";
import type { rmSync } from "node:fs";
import { createHash } from "node:crypto";

import { DeployError, type DeployFile, type DeployPublishInput, type DeployPublishResult, type DeployPublishProgress, type DeployTarget, type UnknownRecord } from "@jini-ai/devops/deploy";


import { withDeclaredHosts } from "@jini-ai/core/contracts/server/security-headers";

import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";
import type { Tracker } from "@jini-ai/core/contracts/site/diagnostics-observability";
import type { DeployTargetRegistry, HostDeployTarget, LoadedDeployTarget  } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { PluginDeployHostKit as DeployHostKit } from "@jini-ai/devops/deploy";
import type { DeployTargetCredential } from "@jini-ai/core/contracts/site/devops-deploy";
// Leaf modules, not the category barrel: this file is on an eagerly loaded graph (see below), and
// the barrel would add the plugin loader and the credential vault to it.

import type { FormDestinationPublishInput, FormReceiverPlan, FormReceiverPort } from "@jini-ai/core/contracts/site/cms-forms";

import type { ExportReport as BaseExportReport } from '../../../static-export/contracts.js';
type ExportReport = BaseExportReport & { consentWarning?: string };
/**
 * Imported from the LEAF `export-failure-summary.ts`, not from `#src/features/site-export/index`.
 *
 * This is a runtime import, and that is the point: it adds exactly ONE module to this file's eager
 * graph. Importing the same function through the barrel would add 65 (`express`, better-sqlite3,
 * drizzle, handlebars, liquidjs and the whole theme/post/db graph, via `site-exporter.ts`), on a
 * module reached from `assistant/tool-registrations.ts`. Avoiding that cost — not a cycle — is why
 * this function was previously resolved by a call-time `require("#src/features/site-export/index")`.
 *
 * The `require()` is gone because it was corrupting coverage: under `tsx` it loaded the barrel and
 * its whole graph a second time through the CJS hook, and the two images merged into one broken
 * lcov block per file. Measured 2026-09-05 at 45 contaminated first-party blocks, 28 SEVERE, from
 * this one call site. Pinned by `features/source-control/__tests__/commit-site-export-resolution.unit.test.ts`.
 *
 * On the cycle the old comment here described (`adapter.ts -> export/index.ts ->
 * site-exporter.ts -> server/app.ts -> ... -> src/assistant`): that back-edge no longer exists.
 * `site-exporter.ts` dropped its `server/app.ts` import in the 2026-08-16 rework, and its current
 * runtime imports are `node:*`, an `express` TYPE, `#src/contracts/core/index` and
 * `#src/features/theme/index` — nothing under `server/` or `assistant/`. The leaf module imports
 * nothing at runtime at all, so it cannot participate in a cycle regardless.
 */
import type { firstExportFailure } from "../../../core/export-failure-summary.js";

import { redactDeployTargetMessage, toDeployTargetCredential } from "./credentials.js";
import type { PublishCredentialSource, StaticPublishConfig, StaticPublishOutcome, StaticPublishTargetId } from "@jini-ai/devops/deploy/site/static-publish/types";

/**
 * @file Publishes the host's own static export through a deploy target that an Agent Plugin contributes
 * (`deploy-targets/registry.ts`). Core names no hosting vendor: which targets exist, which config
 * fields each takes, how each validates them, which base path each serves from, and what extra files
 * each host needs all come from the plugin's descriptor and module (deploy plan T7).
 *
 * Purpose:
 * "Wrap it, do not reimplement" — this module does no host HTTP itself. It (a) resolves the target
 * and checks its config ({@link planStaticPublish}), (b) runs the host's real static exporter with the
 * base path the target's module computes, (c) maps the resulting `ExportReport` into `DeployFile[]`,
 * and (d) hands the file set, plus the live security headers as data (`responseHeaders`), to the
 * `DeployTarget` the module builds.
 *
 * Base-path/target mismatch, made structurally impossible rather than merely documented:
 * `StaticPublishConfig` has NO `basePath` field — a caller can never supply one. The target module
 * derives it from the config, and {@link publishStaticSite} always runs a FRESH `exportSite` with
 * that exact value immediately before publishing, so no previously-produced export (built with some
 * other or no base path) can reach a target. The cost is a full re-export per publish, accepted
 * deliberately: a stale base path silently 404ing every asset on a live site is strictly worse.
 *
 * A refused export (any route or asset failed) never reaches a target at all — this module will not
 * publish a known-incomplete site, mirroring `cli/commands/export.ts`'s own honesty contract.
 *
 * Architectural role:
 * `features/deployments/static-publish` domain logic. Depends on `deploy-targets/` for the target
 * registry and host kit. No dependency on `../ports.ts`/`@jini-ai/agent-plugins/github/deployments/github.mjs` (the sibling
 * continuous-deployment feature) — see `./types.ts`'s header for why these stay separate.
 */

const MAX_PROJECT_NAME_LENGTH = 200;

/** The resolved credential a `DeployTarget` is built from: `token` plus the host's other declared
 *  credential fields (see `types.ts`'s `PublishCredentialSource.resolve()` doc). */
export type ResolvedPublishCredential = DeployTargetCredential;

export interface StaticPublishDeps {
  readonly publishJobs: ReturnType<typeof import('../../index.js').createPublishJobStore<StaticPublishOutcome>>;
  readonly redactSecretShapes: (required: { text: string }) => { text: string };
  readonly createNoopTracker: (required: Record<string, never>) => Tracker;
  readonly createDeployHostKit: (required: { observability?: ObservabilityPort }) => DeployHostKit;
  readonly defaultPublicPageSecurityHeaders: () => import("@jini-ai/core/contracts/server/security-headers").SecurityHeaderSet;
  readonly firstExportFailure: (report: ExportReport) => ReturnType<typeof firstExportFailure>;
  readonly rmSync: typeof rmSync;
  readonly warn: typeof console.warn;
  readonly rewriteFormActions: (required: { files: DeployFile[]; submitUrl: string }) => DeployFile[];
  readonly issueCredentialSetup: (required: { setupToolId: string; prefill: Readonly<Record<string, string | number | boolean | null>> }, optional: Record<string, never>) => ToolFailureDiagnostic;
  readonly credentialSource: PublishCredentialSource;
  /** Current public policy supplied by the host; publishing carries it to the target as data. */
  readonly publicPageSecurityHeaders?: () => import("@jini-ai/core/contracts/server/security-headers").SecurityHeaderSet;
  /** External hosts of enabled plugin exports, added to the site-wide header set a static host applies. */
  readonly pluginExportHosts?: () => Promise<import("@jini-ai/core/contracts/server/security-headers").DeclaredPageHosts>;
  /** This workspace's plugin-contributed deploy targets (`deploy-targets/registry.ts`): the only
   *  place a target id, its config fields and its host behavior come from. */
  readonly loadDeployTargets: ({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>) => Promise<DeployTargetRegistry>;
  /** Test seam: builds the `DeployTarget` in place of the resolved module's `create()`. Config
   *  checks and the base path still come from the registry. */
  readonly buildTarget?: (config: StaticPublishConfig, credential: ResolvedPublishCredential) => DeployTarget;
  /** The kit handed to a plugin module. Defaults to {@link createDeployHostKit}; tests inject one. */
  readonly hostKit?: DeployHostKit;
  /** `RouteDeps.observability`: the default kit traces the plugin's egress through it. */
  readonly observability?: ObservabilityPort;
  readonly tracker?: Tracker;
  /** The site's form submissions destination. Absent: publishing carries no forms (the old behavior). */
  readonly formDestination?: StaticPublishFormDestinationPort;
}

/** What a publish does with the site's forms (`features/form-destinations/port.ts`): selection,
 *  receiver keys and an external receiver's `prepare` all live behind it. The receiver key is
 *  created on the first publish with active forms and saved only after that publish reaches the host. */
export type StaticPublishFormDestinationPort = FormReceiverPort;

/**
 * The composition-root-bound export call this domain takes instead of `RouteDeps` itself (2026-08-20
 * RouteDeps-narrowing fix, continuing `src/features/source-control/commit-site.ts`'s own
 * `ExportSiteBoundFn` fix onto this sibling domain — see that file's doc for the fuller design
 * rationale, and `server/routes/types.ts`'s `RouteDeps.exportSiteBound` doc for why this shape is
 * deliberately NOT the same as `RouteDeps.runExportSite`/`ExportEngine<RouteDeps>`).
 *
 * Declared locally, never imported from `RouteDeps` or from `commit-site.ts`'s identical copy — same
 * "duplicate the tiny type, never share across features" convention that file's own doc documents,
 * and the same one this file already followed for `OWNER_PATTERN`/`REPO_PATTERN`/`BRANCH_PATTERN`.
 */
export type ExportSiteBoundFn = (options: { outputDir: string; clean?: boolean; basePath?: string; publicUrl?: string }) => Promise<ExportReport>;

export interface StaticPublishInput {
  /** Initiating tool execution, for scoped recovery after a lost response. */
  readonly requestId?: string;
  /** Job-owned progress, independent of a delegated call lifetime. */
  readonly onProgress?: (required: { progress: DeployPublishProgress }, options?: object) => void;
  /** Authenticated caller attribution, supplied by the HTTP/tool adapter, never publish config. */
  readonly productEvent?: { readonly userId: string; readonly source: "admin" | "assistant" };
  /** Server-held approval from the existing human exchange/gateway; never read from JSON input. */
  readonly domainApproval?: {
    readonly credentialBinding: string;
    readonly plan: NonNullable<import("@jini-ai/devops/deploy/site/deploy-targets/types").DeployTargetInspection["domains"]>;
    readonly authorize: (required: { readonly fingerprint: string; readonly accountId: string }) => Promise<boolean>;
  };
  readonly workspaceId: string;
  /** `RouteDeps.publishOutputRootDir`, threaded down rather than the whole `RouteDeps` bag — see
   *  {@link ExportSiteBoundFn}'s own doc immediately above for why. */
  readonly publishOutputRootDir: string;
  readonly idGen: { newId(): string };
  /** The pre-bound export call — see {@link ExportSiteBoundFn}'s own doc for what it is and why it
   *  replaces the `routeDeps: RouteDeps` field this input used to carry. */
  readonly exportSiteBound: ExportSiteBoundFn;
  readonly config: StaticPublishConfig;
  /** Human-facing label — becomes e.g. a commit message subject or a host project-name seed.
   *  Sanitized further by the host's deploy target; validated here only
   *  for length and non-blankness. */
  readonly projectName: string;
  /** The saved connection the OPERATOR chose for this publish, when the caller has one (terra review
   *  2026-09-20, finding 1 — Critical). Passed through to `credentialSource.resolve()` VERBATIM and
   *  validated there, never here: this module has no repo/sealer and no way to judge an id. Absent
   *  means the caller genuinely has no chosen connection (`deployment_execute_static_publish`, and
   *  any install whose credentials come from server env vars) and the established default lookup
   *  applies — see `./types.ts`'s `PublishCredentialSource.resolve` doc for that contract. */
  readonly credentialId?: string;
}

/** The `{ok:true, ...}` member of `PublishCredentialSource["resolve"]`'s return union — the shape
 *  {@link resolvePublishCredentialForSite} hands back once it has already ruled out both a thrown
 *  decrypt failure and an `{ok:false}` "not configured" result. */
type ResolvedCredentialSourceSuccess = Extract<Awaited<ReturnType<PublishCredentialSource["resolve"]>>, { ok: true }>;

/**
 * Resolves `input.config.target`'s credential via `deps.credentialSource.resolve()`, translating
 * both a thrown decrypt failure and an `{ok:false}` "not configured" result into
 * {@link publishStaticSite}'s own `{ok:false, code, message}` channel — see that function's own
 * header doc for the full "never throws" contract this step upholds.
 *
 * `PublishCredentialSource.resolve()`'s own doc documents a throw as a real, DELIBERATE possibility
 * for the DB-backed source (`publish-credentials/store.ts`'s `resolveForPublish`/
 * `resolveDefaultForPublish`: "a decrypt failure here should surface, not degrade" — a corrupted row
 * or a missing site key throws rather than resolving a silent `null`). `publishStaticSite`'s own
 * contract is that IT never throws regardless — so a genuine decrypt failure still needs to
 * "surface", just through the established `{ok:false, code, message}` channel instead of an uncaught
 * exception, exactly like every other failure mode in that function. `err.message` only, same
 * boundary {@link publishAndMapOutcome}'s own catch documents — a decrypt failure's message names the
 * mechanism (bad AAD, tampered ciphertext, missing key), never the ciphertext or a derived secret
 * itself.
 */
async function resolvePublishCredentialForSite(
  deps: StaticPublishDeps,
  input: StaticPublishInput
): Promise<{ ok: true; credential: ResolvedCredentialSourceSuccess } | { ok: false; outcome: StaticPublishOutcome }> {
  let credential: Awaited<ReturnType<PublishCredentialSource["resolve"]>>;
  try {
    credential = await deps.credentialSource.resolve({
      workspaceId: input.workspaceId,
      target: input.config.target,
      // Conditional spread, never `credentialId: input.credentialId` — an absent choice must not
      // travel as an explicit `undefined` key, which a source could read as "a choice was made".
      ...(input.credentialId !== undefined ? { credentialId: input.credentialId } : {}),
    });
  } catch (err) {
    return {
      ok: false,
      outcome: {
        ok: false,
        code: "NO_CREDENTIALS_CONFIGURED",
        credentialSetup: deps.issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "publish-host", target: input.config.target } }, {}),
        message: `credential could not be resolved: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (!credential.ok) {
    return { ok: false, outcome: { ok: false, code: "NO_CREDENTIALS_CONFIGURED", credentialSetup: deps.issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "publish-host", target: input.config.target } }, {}), message: credential.reason } };
  }
  return { ok: true, credential };
}

/**
 * `result.status` is EVERY target's own honest terminal state (`DeployLinkStatus`) — not merely "did
 * the API call succeed". A status other than 'ready' means the provider accepted the publish but the
 * site is not (yet, or ever, without a further step outside this call) reachable — spec
 * `custom-publish-provider-contract.md` §3a's "uploaded, but not yet reachable" requirement, required
 * regardless of provider once `StaticPublishOutcome` carries a real third branch for it (see that
 * type's own header). Applied uniformly here rather than special-cased per target: every target
 * already resolves its own `status` internally before returning (verified directly against
 * `VercelDeployTarget.publish()`'s own `waitForReachableDeploymentUrl` call), so this is the one
 * place that turns an already-honest `status` into an equally-honest `StaticPublishOutcome`.
 */
function buildPartialPublishOutcome({ targetId, result, basePath }: { targetId: StaticPublishTargetId; result: DeployPublishResult; basePath: string | undefined }, _options = {}): StaticPublishOutcome {
  return {
    ok: "partial",
    targetId,
    url: result.url,
    status: result.status,
    message: result.statusMessage ?? `Published to ${targetId}, but the public URL is not confirmed reachable yet (status: ${result.status}).`,
    ...(result.deploymentId !== undefined ? { deploymentId: result.deploymentId } : {}),
    ...(basePath !== undefined ? { basePath } : {}),
    ...(result.providerMetadata !== undefined ? { providerMetadata: result.providerMetadata } : {}),
  };
}

/** {@link buildPartialPublishOutcome}'s sibling for `result.status === "ready"` — a full success. */
function buildSuccessPublishOutcome({ targetId, result, basePath }: { targetId: StaticPublishTargetId; result: DeployPublishResult; basePath: string | undefined }, _options = {}): StaticPublishOutcome {
  return {
    ok: true,
    targetId,
    url: result.url,
    status: result.status,
    ...(result.deploymentId !== undefined ? { deploymentId: result.deploymentId } : {}),
    ...(basePath !== undefined ? { basePath } : {}),
    ...(result.providerMetadata !== undefined ? { providerMetadata: result.providerMetadata } : {}),
  };
}

/** Public header data and existing publish metadata share one provider call; no extra I/O. */
function publishOptions({ input, formDestination, readHeaders }: {
  input: StaticPublishInput; formDestination: FormDestinationPublishInput | undefined;
  readHeaders: () => import("@jini-ai/core/contracts/server/security-headers").SecurityHeaderSet;
}) {
  return { responseHeaders: readHeaders(),
    ...(input.onProgress ? { onProgress: (progress: DeployPublishProgress) => input.onProgress?.({ progress }) } : {}),
    metadata: { ...input.config, ...(input.domainApproval ? { domainApproval: input.domainApproval } : {}), ...(formDestination ? { formDestination } : {}) } };
}

/**
 * Calls `jiniTarget.publish()` and maps its result to a {@link StaticPublishOutcome}, translating a
 * rejected `publish()` call into {@link publishStaticSite}'s own `{ok:false, code:"PROVIDER_ERROR"}`
 * channel.
 *
 * `err.message` only — never `DeployError.details` (the raw upstream response body) or the error
 * object itself. This crosses an HTTP/tool-result boundary (the admin route's JSON response, the
 * agent tool's result), the same "message, never the raw error" discipline `export-site.ts`'s own
 * errored-run summary already follows. No observed host deploy target puts `credential.token`
 * into a `DeployError` message, but this boundary still holds even if one ever did.
 */
async function publishAndMapOutcome(
  { jiniTarget, publishInput, input, basePath }: {
    jiniTarget: DeployTarget;
    publishInput: DeployPublishInput;
    input: StaticPublishInput;
    basePath: string | undefined;
  },
  { formDestination, readHeaders }: {
    formDestination?: FormDestinationPublishInput | undefined;
    readHeaders: () => import("@jini-ai/core/contracts/server/security-headers").SecurityHeaderSet;
  },
): Promise<StaticPublishOutcome> {
  try {
    // Older plugins may not report progress. Once provider work starts, creation is unknown
    // until that plugin reports evidence or returns a deployment ID.
    input.onProgress?.({ progress: { phase: "uploading", deploymentCreated: "unknown" } });
    const result = await jiniTarget.publish(publishInput, publishOptions({ input, formDestination, readHeaders }));
    if (result.status === "failed") return { ok: false, code: "PROVIDER_ERROR", message: failedPublishMessage({ targetId: input.config.target, result }) };
    if (result.status !== "ready") {
      return buildPartialPublishOutcome({ targetId: input.config.target, result, basePath });
    }
    return buildSuccessPublishOutcome({ targetId: input.config.target, result, basePath });
  } catch (err) {
    const message = err instanceof DeployError || err instanceof Error ? err.message : String(err);
    return { ok: false, code: "PROVIDER_ERROR", message };
  }
}

/** The provider's own failure text, else a plain fallback naming the target and deployment. */
function failedPublishMessage({ targetId, result }: { targetId: string; result: { statusMessage?: string; deploymentId?: string } }, _options = {}): string {
  return result.statusMessage ?? `Publishing to ${targetId} failed. Check the provider dashboard before publishing again. Deployment ID: ${result.deploymentId ?? "unknown"}.`;
}

/**
 * Publishes the host's current site content to `input.config.target`. Always runs a fresh, `clean`
 * export with the target-correct base path immediately before publishing (see this file's header)
 * — never reuses a previously-produced export directory.
 *
 * Never throws: every failure (an unknown target or bad config, a registry that will not load, a
 * credential that does not resolve — including a genuine DECRYPT failure, see
 * {@link resolvePublishCredentialForSite} — a failed export, a credential unusable for the target, or
 * a rejected `publish()` call) is returned as `{ok: false, code, message}`. `message` is always built
 * from `err.message`, never a raw `DeployError.details`/response-body object. Every caller
 * (`publish-site.ts`'s HTTP route, `deployment_execute_static_publish`) relies on this.
 *
 * Orchestrates its work as a flat sequence of steps, each translating its own failure mode into this
 * function's `{ok:false, code, message}` channel and returning early: {@link resolvePublishPlan},
 * {@link resolvePublishCredentialForSite}, {@link runExportForPublish}, {@link constructTargetForPublish},
 * then {@link publishAndMapOutcome} for the terminal result.
 *
 * @complexity One registry load, one `exportSite` pass (O(routes + assets) HTTP requests against the
 *   in-process app) plus one `DeployTarget.publish()` call (bounded by that target's own poll budget).
 */
export async function publishStaticSite(deps: StaticPublishDeps, input: StaticPublishInput): Promise<StaticPublishOutcome> {
  // Publish/deploy chokepoint: one `site.publish` operation per run (target id only; the outcome
  // is `published` or the failure code), with its export and host egress as child spans.
  const tracker = deps.tracker ?? deps.createNoopTracker({});
  return tracker.trace({ name: "site.publish", run: async (span) => {
    const outcome = await publishStaticSiteSteps(deps, input);
    span.setOutcome(outcome.ok ? { outcome: "published", failed: false } : { outcome: outcome.code, failed: true });
    return outcome;
  } }, { attributes: { "publish.target": input.config.target } });
}

/** {@link publishStaticSite}'s steps, inside its operation. */
async function publishStaticSiteSteps(deps: StaticPublishDeps, input: StaticPublishInput): Promise<StaticPublishOutcome> {
  if (input.projectName.trim() === "" || input.projectName.length > MAX_PROJECT_NAME_LENGTH) {
    return { ok: false, code: "INVALID_CONFIG", message: `projectName must be 1-${MAX_PROJECT_NAME_LENGTH} characters` };
  }
  const plan = await resolvePublishPlan(deps, input);
  if (!plan.ok) return { ok: false, code: "INVALID_CONFIG", message: plan.message };

  const credentialResult = await resolvePublishCredentialForSite(deps, input);
  if (!credentialResult.ok) {
    return credentialResult.outcome;
  }
  if (credentialChangedSinceReview({ input, credential: credentialResult.credential })) {
    return { ok: false, code: "INVALID_CONFIG", message: "CREDENTIAL_CHANGED: The connection changed after domain review. Preview and confirm again before publishing." };
  }

  const resolvedCredential = toDeployTargetCredential(credentialResult.credential);
  const targetResult = constructTargetForPublish({ deps, pluginTarget: plan.target, config: input.config, credential: resolvedCredential });
  if (!targetResult.ok) {
    return targetResult.outcome;
  }

  const outputDir = publishOutputDir({ parent: input.publishOutputRootDir, target: input.config.target, runId: input.idGen.newId() });
  const exportResult = await runExportForPublish({ deps, input, outputDir, basePath: plan.basePath, target: targetResult.target });
  if (!exportResult.ok) return finishPublishOutcome({ outcome: exportResult.outcome, credential: credentialResult.credential, target: plan.target });
  const files = buildDeployFilesForPublish(exportResult.report);

  const forms = await prepareFormDestination({ deps, input });
  if (!forms.ok) return forms.outcome;
  const publishInput: DeployPublishInput = { files: filesForReceiver({ deps, files, submitUrl: forms.submitUrl }), projectName: input.projectName };
  const hosts = await readPluginExportHosts({ deps });
  const baseHeaders = deps.publicPageSecurityHeaders ?? deps.defaultPublicPageSecurityHeaders;
  const outcome = await publishAndMapOutcome({ jiniTarget: targetResult.target, publishInput, input, basePath: plan.basePath }, { formDestination: forms.hosting, readHeaders: () => hosts ? withDeclaredHosts({ headers: baseHeaders(), hosts }) : baseHeaders() });
  await saveReceiverKey({ deps, outcome, save: forms.save });
  const reported = publishConsentWarning({ outcome, warning: exportResult.report.consentWarning });
  return finishPublishOutcome({ outcome: reported, credential: credentialResult.credential, target: plan.target });
}

/** A domain review binds the credential it saw; any other credential needs a fresh review. */
function credentialChangedSinceReview({ input, credential }: { input: StaticPublishInput; credential: Parameters<typeof toDeployTargetCredential>[0] }, _options = {}): boolean {
  return Boolean(input.domainApproval) && input.domainApproval?.credentialBinding !== createHash("sha256").update(JSON.stringify(toDeployTargetCredential(credential))).digest("hex");
}

/** Hosts the site's plugin exports declare, for the published security headers. */
async function readPluginExportHosts({ deps }: { deps: StaticPublishDeps }, _options = {}) {
  // Report-only data: a catalog read failure must not stop a publish.
  return deps.pluginExportHosts?.().catch((error: unknown) => {
    deps.warn("[static-publish] Could not read plugin export hosts", describeErrorForLog({ err: { err: error } }));
    return undefined;
  });
}

/** Keep a successful publication's export warning in the result without changing its status. */
function publishConsentWarning({ outcome, warning }: { outcome: StaticPublishOutcome; warning: string | undefined }): StaticPublishOutcome {
  return outcome.ok !== false && warning ? { ...outcome, consentWarning: warning } : outcome;
}

/**
 * The site's active forms and, when there are any, its receiver key, for the receiver the site's
 * form setting selects (`features/form-destinations/port.ts`): the co-hosted add-on for this host
 * (`hosting`), or an external receiver's post address (`submitUrl`). No port: nothing is sent and
 * no key is created.
 * @complexity One forms read plus at most one key read (and an external receiver's own prepare).
 */
async function prepareFormDestination({ deps, input }: { deps: StaticPublishDeps; input: StaticPublishInput }, _options = {}): Promise<
  ({ ok: true } & FormReceiverPlan) | { ok: false; outcome: StaticPublishOutcome }> {
  if (!deps.formDestination) return { ok: true };
  try {
    const plan = await deps.formDestination.prepare({ workspaceId: input.workspaceId, hostingTargetId: input.config.target, projectName: input.projectName,
      kit: deps.hostKit ?? deps.createDeployHostKit(deps.observability === undefined ? {} : { observability: deps.observability }) });
    return { ok: true, ...plan };
  } catch (err) {
    return { ok: false, outcome: { ok: false, code: "EXPORT_FAILED", message: `form submissions could not be prepared: ${err instanceof Error ? err.message : String(err)}. Check the site's forms, then publish again.` } };
  }
}

/** An external receiver: exported pages post to its address instead of the site's own path. @complexity O(HTML bytes). */
function filesForReceiver({ deps, files, submitUrl }: { deps: StaticPublishDeps; files: DeployFile[]; submitUrl?: string | undefined }, _options = {}): DeployFile[] {
  return submitUrl ? deps.rewriteFormActions({ files, submitUrl }) : files;
}

/** Saves the receiver key (new, or moved after a rename) once the host has it. A failed save is logged, not fatal: the
 *  next publish creates and installs a fresh key, and rows still waiting at the host stay pullable. */
async function saveReceiverKey({ deps, outcome, save }: { deps: StaticPublishDeps; outcome: StaticPublishOutcome; save?: ((required: { readonly url: string }) => Promise<void>) | undefined }, _options = {}): Promise<void> {
  if (!save || outcome.ok === false) return;
  try { await save({ url: outcome.url }); }
  catch (error) { deps.warn("[static-publish] the form receiver key could not be saved; the next publish will replace it", describeErrorForLog({ err: error })); }
}

/** Redact declared secrets from full/partial provider failures and retain the saved credential id.
 * @complexity O(fields + message bytes × secrets), delegated to the shared redactor. */
function finishPublishOutcome({ outcome, credential, target }: {
  outcome: StaticPublishOutcome; credential: ResolvedCredentialSourceSuccess; target: LoadedDeployTarget;
}, _options = {}): StaticPublishOutcome {
  // A plugin can include its credential in an error message. Keep the useful provider explanation
  // while removing every declared secret before this site-publish response reaches HTTP or a tool.
  const safe = "message" in outcome
    ? { ...outcome, message: redactDeployTargetMessage({ message: outcome.message, credential, target }) } : outcome;
  // Bind history to the row opened for this run, never a later default lookup.
  return safe.ok && credential.credentialId !== undefined ? { ...safe, credentialId: credential.credentialId } : safe;
}

/**
 * Adapts an installed module's target to devops' {@link DeployTarget} port. Installed
 * content-addressed modules keep their ABI: security headers still reach the first object, and
 * `checkReachability` takes the bare URL string, so the port's `{ url }` is unwrapped here.
 * @param installedTarget What the plugin module's `create` returned.
 * @returns The same target behind the devops port.
 * @complexity O(1); each call forwards once.
 */
export function adaptInstalledTarget(installedTarget: HostDeployTarget): DeployTarget {
  const resolvePublicUrl = installedTarget.resolvePublicUrl?.bind(installedTarget);
  return {
    id: installedTarget.id,
    ...(resolvePublicUrl ? { resolvePublicUrl: (required: { projectName: string }) => resolvePublicUrl(required, {}) } : {}),
    publish: (required, optional) => installedTarget.publish({ ...required, ...optional }),
    checkReachability: ({ url }) => installedTarget.checkReachability(url),
  };
}

/**
 * Constructs the `DeployTarget` `publishAndMapOutcome` will call `publish()` on, translating a throw
 * (typically a credential missing a field the host requires) into {@link publishStaticSite}'s own
 * `{ok:false, code}` channel — the message, never the raw error object, since it crosses an
 * HTTP/tool-result boundary.
 * @complexity O(1) plus the module's own construction.
 */
function constructTargetForPublish(
  { deps, pluginTarget, config, credential }: {
    deps: StaticPublishDeps;
    pluginTarget: LoadedDeployTarget;
    config: StaticPublishConfig;
    credential: ResolvedPublishCredential;
  },
  _options = {},
): { ok: true; target: DeployTarget } | { ok: false; outcome: StaticPublishOutcome } {
  try {
    if (deps.buildTarget !== undefined) return { ok: true, target: deps.buildTarget(config, credential) };
    const kit = deps.hostKit ?? deps.createDeployHostKit(deps.observability === undefined ? {} : { observability: deps.observability });
    return { ok: true, target: adaptInstalledTarget(pluginTarget.module.create({ credential, config: config as unknown as UnknownRecord, kit })) };
  } catch {
    // Adapter exceptions may include a credential field; the card needs only the target identifier.
    return { ok: false, outcome: { ok: false, code: "NO_CREDENTIALS_CONFIGURED", message: `credential is not usable for ${config.target}`,
      credentialSetup: deps.issueCredentialSetup({ setupToolId: "credential_save", prefill: { kind: "publish-host", target: config.target } }, {}) } };
  }
}
