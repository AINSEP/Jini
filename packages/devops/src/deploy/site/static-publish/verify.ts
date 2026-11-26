import type { assertCredentialToken } from '@jini-ai/platform/secrets/credential-token';
import type { UUID } from "@jini-ai/core/primitives";
import type { ObservabilityPort } from "@jini-ai/core/contracts/observability";

import type { SecretSealerPort } from "@jini-ai/integrations/secrets";
import { DEPLOY_FETCH_TIMEOUTS } from "@jini-ai/devops/deploy/site/deploy-targets/host-kit";
import type { DeployCredentialCheck, DeployTargetCredentialSpec, DeployTargetRegistry  } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { PluginDeployHostKit as DeployHostKit } from "@jini-ai/devops/deploy";
import type { DeployTargetCredential } from "@jini-ai/core/contracts/site/devops-deploy";
import type { resolveForPublish } from "../publish-credentials/store-resolution.js";
import type { DbPublishCredentialSourceDeps } from "./credentials.js";
type VendorCredentialSetRepoPort = DbPublishCredentialSourceDeps['repo'];
import { projectConnectionForPublish, toDeployTargetCredential } from "./credentials.js";
import type { PublishCredentialSource, StaticPublishTargetId } from "@jini-ai/devops/deploy/site/static-publish/types";

/**
 * @file Verifies a static-publish credential against its REAL host — the fix for "ready means a
 * row exists, not a working credential" (2026-08-16, live-publish finding: a saved token the host
 * rejected outright with 401 still reported `ready: true`/`credentialsConfigured: true`).
 *
 * Purpose:
 * `PublishCredentialSource.isConfigured()` (`./types.ts`) only ever answers "does a row/env-var
 * exist" — deliberately, since it must never decrypt (see that interface's own header). This module
 * is the SECOND legitimate caller of `PublishCredentialSource.resolve()` (which DOES decrypt),
 * alongside a real publish attempt — never the agent-facing capabilities/preview tools
 * (`publish-agent-tools.ts`), which only ever read this module's CACHED, already-non-secret result.
 * See `ADS-memory/reports/2026-08-16-publish-correctness-findings.md`'s Defect B section for the
 * full design reasoning, including why this caches in-memory rather than adding a DB column/migration.
 *
 * The request itself belongs to the host: each deploy module (shipped in the `deploy` Agent Plugin,
 * loaded through the workspace's deploy registry) exports `verifyCredential`, which makes ONE
 * lightweight, read-only, authenticated request against its own API and returns a
 * {@link DeployCredentialCheck}. This module resolves whichever credential a REAL publish would use,
 * hands it to that check, and caches only the outcome (`status`/`message`/`checkedAt`, plus a public
 * `accountLabel`) — never the credential itself, and never the host's raw response body.
 *
 * `PublishCredentialVerificationResult.status` is a closed THREE-way enum
 * (`"valid" | "invalid" | "unreachable"`), never a plain boolean — a hard requirement from code
 * review: `"unreachable"` (a network failure, timeout, or host 5xx) must never collapse into the same
 * shape as `"invalid"` (the host affirmatively rejected the credential), because the two demand
 * opposite guidance: try again later vs. replace the credential.
 *
 * `accountLabel` (2026-08-16, Defect 1: "the assistant has to guess the owner") is the ONE body field
 * a check may read back, and only a host whose descriptor sets `yieldsAccountLabel`: the account's
 * public handle, which a real publish is about to print in a public URL anyway. Never an email,
 * plan, billing or org membership.
 *
 * Architectural role:
 * `features/deployments/static-publish` domain logic. `publish-agent-tools.ts`'s capabilities
 * handler reads `PublishCredentialVerificationCache.get()` directly (a plain in-memory lookup, no
 * decrypt, no network call) — it must NEVER call `verifyPublishCredential` itself. Only human-gated
 * callers (the admin credential-CRUD route) may call `verifyPublishCredential`.
 */

/** One bounded probe per host. Short because a human is waiting on a form submit or an explicit
 *  "Verify" click, not a background job. Handed to modules as their kit's `QUICK` timeout. */
const VERIFY_TIMEOUT_MS = 10_000;

/**
 * Whether a saved credential for `target` can ever produce an `accountLabel`, per the host's declared
 * `yieldsAccountLabel`. Lets `publish-credentials/account-label-heal-scheduler.ts`'s background
 * backfill skip a host that never can, instead of probing it on every list.
 *
 * @complexity O(1) — one registry lookup.
 */
export function canYieldAccountLabel({ registry, target }: { registry: DeployTargetRegistry; target: StaticPublishTargetId }, _optional: Record<string, never> = {}): boolean {
  return registry.get(target)?.descriptor.credential?.yieldsAccountLabel === true;
}

/** The optional `(HTTP <code>)` suffix shared by both failure messages in {@link buildVerificationMessage}. */
function statusCodeSuffix({ statusCode }: { statusCode: number | undefined }, _options = {}): string {
  return statusCode ? ` (HTTP ${statusCode})` : "";
}

/** Human-facing text for one check outcome — built centrally (not per module) so every host's
 *  wording stays consistent. Never includes the credential, a raw response body, or any
 *  request/account detail beyond a bare HTTP status. */
function buildVerificationMessage({ label, check, credentialText }: { credentialText: VerifyPublishCredentialDeps["credentialText"]; label: string; check: DeployCredentialCheck }, _options = {}): string {
  if (check.ok) return `${label} accepted this credential.`;
  if (check.statusCode === 401 || check.statusCode === 403) return credentialText({ id: "auth" });
  if (check.statusCode === 408 || check.statusCode === 504) return credentialText({ id: "timeout" });
  if (check.reason === "rejected") {
    return `${label} rejected this credential${statusCodeSuffix({ statusCode: check.statusCode })} — it is invalid, expired, or missing the required permissions.`;
  }
  return `Could not reach ${label} to verify this credential${statusCodeSuffix({ statusCode: check.statusCode })} — this does not necessarily mean the credential is bad.`;
}

/** One cached verification outcome. Never carries the credential, its ciphertext, or any raw
 *  provider response — see this file's header. `status` is the enforced three-way boundary contract
 *  (never a boolean) — `"unreachable"` must stay distinguishable from `"invalid"` at every layer that
 *  reads this, all the way out to the agent-facing capabilities tool. */
export interface PublishCredentialVerificationResult {
  readonly status: "valid" | "invalid" | "unreachable";
  readonly message: string;
  readonly checkedAt: string;
  /** The verified account's public login/username (the host's own account-name field) — present only
   *  on a `"valid"` result for a provider whose success response carries one (see this file's header
   *  for exactly which, and why). Never an email, plan, or org — the ONE field this module's
   *  otherwise-total "never reads the response body" rule makes a deliberate, scoped exception for.
   *  `publish-agent-tools.ts`'s capabilities handler surfaces this so the agent can default a
   *  repository-backed publish's `owner` to it instead of guessing (2026-08-16, Defect 1). */
  readonly accountLabel?: string;
}

/**
 * Read/write surface for cached verification results, keyed by `(workspaceId, target)` — the SAME
 * granularity `PublishCredentialSource.isConfigured()` already uses, deliberately NOT by credential
 * row id (see this feature's design doc for why: it unifies the DB-backed and env-var-fallback
 * paths under one mechanism, since an env-sourced credential has no row to key by id but does have a
 * `target`). `publish-agent-tools.ts`'s capabilities handler only ever calls {@link get} — never
 * {@link set}, which only {@link verifyPublishCredential} (and its human-gated callers) may reach.
 */
export interface PublishCredentialVerificationCache {
  get(input: { workspaceId: UUID; target: StaticPublishTargetId }): PublishCredentialVerificationResult | undefined;
  set(input: { workspaceId: UUID; target: StaticPublishTargetId }, result: PublishCredentialVerificationResult): void;
  /** Clears a cached result — called when `resolve()` reports no credential at all, so a STALE
   *  verification from a since-deleted/replaced credential can never keep reporting `ready: true`
   *  for a target that currently has nothing configured. */
  delete(input: { workspaceId: UUID; target: StaticPublishTargetId }): void;
}

/**
 * The real, in-process implementation — a plain `Map`, no TTL/expiry (see this feature's design doc
 * for why: an auto-expiring cache would make `ready` flip back to `false` from time alone, which
 * reads as flakiness; `checkedAt` lets a caller judge staleness itself instead). Lost on process
 * restart — an accepted trade-off, see the same doc.
 *
 * @complexity O(1) per operation — a single `Map` key lookup/write.
 * @overallScore 100
 */
export class InMemoryPublishCredentialVerificationCache implements PublishCredentialVerificationCache {
  private readonly entries = new Map<string, PublishCredentialVerificationResult>();

  private static key(input: { workspaceId: UUID; target: StaticPublishTargetId }): string {
    return `${input.workspaceId}::${input.target}`;
  }

  get(input: { workspaceId: UUID; target: StaticPublishTargetId }): PublishCredentialVerificationResult | undefined {
    return this.entries.get(InMemoryPublishCredentialVerificationCache.key(input));
  }

  set(input: { workspaceId: UUID; target: StaticPublishTargetId }, result: PublishCredentialVerificationResult): void {
    this.entries.set(InMemoryPublishCredentialVerificationCache.key(input), result);
  }

  delete(input: { workspaceId: UUID; target: StaticPublishTargetId }): void {
    this.entries.delete(InMemoryPublishCredentialVerificationCache.key(input));
  }
}

/** What {@link computeVerificationResult} needs to run one host's check. */
interface VerificationContext {
  readonly assertCredentialToken: typeof assertCredentialToken;
  readonly CredentialInputError: VerifyPublishCredentialDeps['CredentialInputError'];
  readonly credentialText: VerifyPublishCredentialDeps['credentialText'];
  readonly registry: DeployTargetRegistry;
  readonly kit: DeployHostKit;
  readonly clock: { nowIso(): string };
}

/** The kit a check runs with: `fetchFn` (tests), the observability port, and a `QUICK` timeout sized for a waiting human. */
function verificationKit(deps: { readonly createDeployHostKit: VerifyPublishCredentialDeps["createDeployHostKit"]; readonly fetchFn?: typeof fetch; readonly hostKit?: DeployHostKit; readonly observability?: ObservabilityPort }): DeployHostKit {
  return deps.hostKit ?? deps.createDeployHostKit({
    ...(deps.fetchFn !== undefined ? { fetchFn: deps.fetchFn } : {}),
    observability: deps.observability,
    timeouts: { ...DEPLOY_FETCH_TIMEOUTS, QUICK: VERIFY_TIMEOUT_MS },
  });
}

function noCheckReason(target: StaticPublishTargetId): string {
  return `no turned-on hosting plugin can check '${target}' credentials`;
}

/** An `unreachable` result for a credential nothing here could check (no module, no check, or a saved
 *  row missing its token field): not `invalid`, since no host said so. */
function cannotVerify({ reason, clock }: { reason: string; clock: { nowIso(): string } }, _options = {}): PublishCredentialVerificationResult {
  return { status: "unreachable", message: `Could not verify this credential: ${reason}.`, checkedAt: clock.nowIso() };
}

/** Apply the existing token policy to the primary token and present, descriptor-declared secrets. */
function assertVerificationCredential({ credential, spec, assertCredentialToken }: {
  assertCredentialToken: typeof import("@jini-ai/platform/secrets/credential-token").assertCredentialToken;
  credential: DeployTargetCredential;
  spec: DeployTargetCredentialSpec | undefined;
}, _options: Record<string, never> = {}): void {
  assertCredentialToken({ value: credential.token });
  for (const field of spec?.fields ?? []) {
    if (field.secret && field.name !== spec?.tokenField && credential[field.name] !== undefined) {
      assertCredentialToken({ value: credential[field.name], field: field.name });
    }
  }
}

/** Authentication HTTP statuses override an unreachable reason, while acceptance wins first. */
function verificationStatus({ check }: { check: DeployCredentialCheck }, _options: Record<string, never> = {}): PublishCredentialVerificationResult["status"] {
  if (check.ok) return "valid";
  return check.reason === "rejected" || check.statusCode === 401 || check.statusCode === 403 ? "invalid" : "unreachable";
}

/**
 * Shared tail of both entry points below: runs the host's own check and stamps `checkedAt` — kept as
 * one function so a THIRD entry point can never build this result shape differently. A target with
 * no loaded module (its plugin is off or missing) or a module with no `verifyCredential` is
 * `unreachable` with a hint, since nothing here can say whether the credential is good. A check that
 * throws is `unreachable` too: a check never propagates an error.
 *
 * @complexity O(1) — one registry lookup plus the module's one bounded request.
 */
async function computeVerificationResult(
  { context, target, credential }: {
    context: VerificationContext;
    target: StaticPublishTargetId;
    credential: DeployTargetCredential;
  },
  _options = {},
): Promise<PublishCredentialVerificationResult> {
  const loaded = context.registry.get(target);
  if (loaded?.module.verifyCredential === undefined) return cannotVerify({ reason: noCheckReason(target), clock: context.clock });
  try {
    assertVerificationCredential({ credential, spec: loaded.descriptor.credential, assertCredentialToken: context.assertCredentialToken });
  } catch (error) {
    return { status: "invalid", message: error instanceof context.CredentialInputError ? error.message : context.credentialText({ id: "unreachable" }), checkedAt: context.clock.nowIso() };
  }
  let check: DeployCredentialCheck;
  try {
    check = await loaded.module.verifyCredential({ credential, kit: context.kit });
  } catch {
    check = { ok: false, reason: "unreachable" };
  }
  return checkedVerificationResult({ context, loaded, check });
}

function checkedVerificationResult({ context, loaded, check }: {
  context: VerificationContext; loaded: NonNullable<ReturnType<DeployTargetRegistry["get"]>>; check: DeployCredentialCheck;
}): PublishCredentialVerificationResult {
  const status = verificationStatus({ check });
  return {
    status,
    message: buildVerificationMessage({ label: loaded.descriptor.credential?.vendorLabel ?? loaded.descriptor.label, check, credentialText: context.credentialText }),
    checkedAt: context.clock.nowIso(),
    ...(check.ok && check.accountLabel !== undefined ? { accountLabel: check.accountLabel } : {}),
  };
}

export interface VerifyPublishCredentialDeps {
  readonly assertCredentialToken: typeof assertCredentialToken;
  readonly CredentialInputError: abstract new (...args: never[]) => Error;
  readonly credentialText: (required: { id: "auth" | "timeout" | "unreachable" }) => string;
  readonly createDeployHostKit: (required: { fetchFn?: typeof fetch; observability?: ObservabilityPort; timeouts: typeof DEPLOY_FETCH_TIMEOUTS }) => DeployHostKit;
  /** The COMPOSED source (DB-first, env-fallback) — the same one a real publish resolves against, so
   *  this verifies whichever credential would actually be used. Decrypts; see this file's header for
   *  why only THIS module and a real publish may call its `resolve()`. */
  readonly credentialSource: PublishCredentialSource;
  readonly cache: PublishCredentialVerificationCache;
  readonly clock: { nowIso(): string };
  /** This workspace's deploy registry: whose module checks the credential. */
  loadDeployTargets({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>): Promise<DeployTargetRegistry>;
  /** Injected by tests; defaults to global `fetch`. Never the DB-scoped `fetchFn` itself. */
  readonly fetchFn?: typeof fetch;
  /** Replaces the whole kit (tests); `fetchFn` is ignored when set. */
  readonly hostKit?: DeployHostKit;
  /** `RouteDeps.observability`: the check's request is one outbound span. */
  readonly observability?: ObservabilityPort;
}

/**
 * Resolves whichever credential a real publish to `input.target` would use, has that host's module
 * check it with one bounded, read-only authenticated request, and caches the outcome under
 * `(workspaceId, target)` — this is what `deployment_get_static_publish_capabilities`'s
 * `ready`/`verified` fields read. The ONE non-test caller of this module allowed to trigger it is a
 * human action (the admin credential-CRUD route, after a save, or via an explicit "Verify" trigger)
 * — never an agent tool.
 *
 * @returns The freshly-computed result (also now cached). `null` when no credential is configured at
 *   all — clears any stale cached entry and makes NO network call, matching
 *   {@link verifyPublishCredentialById}'s own "nothing to verify" contract for a missing row.
 *   Deliberately not folded into `status: "invalid"`/`"unreachable"`: neither word honestly describes
 *   "there was nothing here to check".
 * @complexity O(1) — one `resolve()` call (one repo read plus, for a DB-backed credential, one
 *   decrypt), one registry load, plus one bounded outbound HTTP request.
 */
export async function verifyPublishCredential(
  deps: VerifyPublishCredentialDeps,
  input: { workspaceId: UUID; target: StaticPublishTargetId }
): Promise<PublishCredentialVerificationResult | null> {
  const resolved = await deps.credentialSource.resolve(input);
  if (!resolved.ok) {
    deps.cache.delete(input);
    return null;
  }

  const context = { assertCredentialToken: deps.assertCredentialToken, CredentialInputError: deps.CredentialInputError, credentialText: deps.credentialText, registry: await deps.loadDeployTargets({ workspaceId: input.workspaceId }), kit: verificationKit(deps), clock: deps.clock };
  const result = await computeVerificationResult({ context, target: input.target, credential: toDeployTargetCredential(resolved) });
  deps.cache.set(input, result);
  return result;
}

export interface VerifyPublishCredentialByIdDeps {
  readonly assertCredentialToken: typeof assertCredentialToken;
  readonly CredentialInputError: abstract new (...args: never[]) => Error;
  readonly credentialText: (required: { id: "auth" | "timeout" | "unreachable" }) => string;
  readonly createDeployHostKit: (required: { fetchFn?: typeof fetch; observability?: ObservabilityPort; timeouts: typeof DEPLOY_FETCH_TIMEOUTS }) => DeployHostKit;
  readonly resolveForPublish: DbPublishCredentialSourceDeps['resolveForPublish'];
  /** `vendor_credential_sets`, where saved publish credentials live. */
  readonly repo: VendorCredentialSetRepoPort;
  readonly sealer: SecretSealerPort;
  readonly cache: PublishCredentialVerificationCache;
  readonly clock: { nowIso(): string };
  /** This workspace's deploy registry: which saved field is the token, and whose module checks it. */
  loadDeployTargets({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>): Promise<DeployTargetRegistry>;
  readonly fetchFn?: typeof fetch;
  readonly hostKit?: DeployHostKit;
  readonly observability?: ObservabilityPort;
}

/**
 * Verifies ONE specific saved connection by id — what the admin's per-row "Verify" action and the
 * post-save check both actually mean ("check the thing I just clicked/saved"), distinct from
 * {@link verifyPublishCredential}'s "check whichever credential is currently active for this target"
 * (which always resolves the group's DEFAULT — Contract v2 Correction B — regardless of which row a
 * caller has in mind).
 *
 * Only updates the `(workspaceId, target)` cache — the one `deployment_get_static_publish_
 * capabilities` reads — when `id` IS its provider's current default. A non-default row's result is
 * still computed and returned (so the human sees an honest answer for the row they actually asked
 * about), but never overwrites the `ready` signal for a DIFFERENT, unrelated row sharing the same
 * provider.
 *
 * The decrypted connection is projected through the host's declared credential spec, the same
 * projection a real publish uses (`credentials.ts`'s `projectConnectionForPublish`), so the check sees
 * exactly what the module's `create` would.
 *
 * @returns `null` if no row exists for `(workspaceId, id)` — the caller (the admin route) is
 *   expected to have already checked existence and map this to its own 404, matching
 *   `resolveForPublish`'s own "no such row is `null`, not thrown" contract.
 * @complexity O(1) — one decrypting read (`resolveForPublish`), one registry load, plus one bounded
 *   outbound HTTP request.
 */
export async function verifyPublishCredentialById(
  deps: VerifyPublishCredentialByIdDeps,
  input: { workspaceId: UUID; id: UUID }
): Promise<PublishCredentialVerificationResult | null> {
  const resolved = await deps.resolveForPublish(deps, input);
  if (!resolved) return null;

  const context = { assertCredentialToken: deps.assertCredentialToken, CredentialInputError: deps.CredentialInputError, credentialText: deps.credentialText, registry: await deps.loadDeployTargets({ workspaceId: input.workspaceId }), kit: verificationKit(deps), clock: deps.clock };
  const spec = context.registry.get(resolved.providerId)?.descriptor.credential;
  const projected = spec === undefined ? undefined : projectConnectionForPublish(resolved.connection, spec);
  const result = projected?.ok
    ? await computeVerificationResult({ context, target: resolved.providerId, credential: toDeployTargetCredential(projected) })
    : cannotVerify({ reason: projected?.reason ?? noCheckReason(resolved.providerId), clock: deps.clock });
  if (resolved.isDefault) {
    deps.cache.set({ workspaceId: input.workspaceId, target: resolved.providerId }, result);
  }
  return result;
}

/** Check a human-submitted replacement through the existing host verifier before overwriting.
 * @returns The normal safe verification result; does not write credentials or cache results.
 * @complexity One registry load and one bounded host check.
 * @example verifySubmittedPublishCredential({ deps, workspaceId, target, connection, spec });
 */
export async function verifySubmittedPublishCredential({ deps, workspaceId, target, connection, spec }: {
  deps: Pick<VerifyPublishCredentialDeps, 'loadDeployTargets' | 'clock' | 'fetchFn' | 'observability' | 'assertCredentialToken' | 'CredentialInputError' | 'credentialText' | 'createDeployHostKit'>;
  workspaceId: string; target: string; connection: Parameters<typeof projectConnectionForPublish>[0]; spec: DeployTargetCredentialSpec;
}, _options = {}): Promise<PublishCredentialVerificationResult> {
  const projected = projectConnectionForPublish(connection, spec);
  if (!projected.ok) return cannotVerify({ reason: 'the submitted connection is incomplete', clock: deps.clock });
  const registry = await deps.loadDeployTargets({ workspaceId });
  return computeVerificationResult({ context: { assertCredentialToken: deps.assertCredentialToken, CredentialInputError: deps.CredentialInputError, credentialText: deps.credentialText, registry, kit: verificationKit(deps), clock: deps.clock }, target, credential: toDeployTargetCredential(projected) });
}
