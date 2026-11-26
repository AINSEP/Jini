import { redactSecrets } from "@jini-ai/core";
import type { UUID } from "@jini-ai/core/primitives";

import type { SecretSealerPort } from "@jini-ai/core/contracts/vault";
import type { describeCredential, PublishCredentialReadDeps } from '../publish-credentials/store.js';
import type { hasDefaultForPublish, resolveDefaultForPublish, resolveForPublish } from '../publish-credentials/store-resolution.js';
import type { PublishConnectionInput } from "@jini-ai/devops/deploy/site/publish-credentials/types";
type VendorCredentialSetRepoPort = PublishCredentialReadDeps['repo'];
import type { PublishExecutionMode } from "@jini-ai/devops/deploy/site/publish-credentials/execution-mode";
import type { DeployTargetCredentialSpec, DeployTargetEnvFallback, DeployTargetRegistry, LoadedDeployTarget  } from "@jini-ai/devops/deploy/site/deploy-targets/types";
import type { DeployTargetCredential } from "@jini-ai/core/contracts/site/devops-deploy";
import type { PublishCredentialSource, ResolvedPublishCredentialSuccess, StaticPublishTargetId } from "@jini-ai/devops/deploy/site/static-publish/types";

/** Readiness accepts the same optional saved-connection choice as resolution, without opening it. */
interface PublishCredentialSourceWithChoice extends PublishCredentialSource {
  isConfigured(input: Parameters<PublishCredentialSource["resolve"]>[0], options?: object): ReturnType<PublishCredentialSource["isConfigured"]>;
}

/** Keep provider explanations useful without exposing any declared credential secret.
 * Uses Jini's redactor for both publish and preview responses; does not mutate the credential.
 * @complexity O(fields + message bytes × secrets), delegated to the shared redactor. */
export function redactDeployTargetMessage({ message, credential, target }: {
  message: string; credential: ResolvedPublishCredentialSuccess; target: LoadedDeployTarget;
}, _options = {}): string {
  // A plugin can echo secondary secrets as well as its primary token in an error.
  const exactSecrets = [credential.token, ...(target.descriptor.credential?.fields ?? [])
    .filter(field => field.secret)
    .map(field => {
      const value = credential[field.name];
      return typeof value === "string" ? value : undefined;
    })];
  return redactSecrets({ input: message }, { exactSecrets });
}

/**
 * @file `PublishCredentialSource` implementations + composition — env-var (self-hosted operator
 * fallback), DB-backed (the encrypted publish-credential store, 2026-08-15; `vendor_credential_sets` since 2026-09-29), and the function
 * that combines them per the install's `PublishExecutionMode`.
 *
 * Purpose:
 * `createEnvPublishCredentialSource` was, until 2026-08-15, the ONLY credential source this feature
 * wired up — see this file's git history for the original single-workspace-process reasoning
 * (`GITHUB_TOKEN`/`VERCEL_TOKEN` are plain operator-supplied env vars, the same category as
 * the host’s export directory and admin-password settings). `createDbPublishCredentialSource` is the follow-up that
 * header predicted: backed by `publish-credentials/store.ts`'s `resolveDefaultForPublish` (the
 * provider-scoped decrypting read — see its own header), honouring `workspaceId` for real instead of
 * ignoring it.
 *
 * `createEnvPublishCredentialSource` now ALSO honours `workspaceId` for real (2026-08-15 fix,
 * Terra's finding — it used to accept the parameter per the port's shape but never consult it, which
 * meant a hosted multi-tenant process would silently hand every workspace the same process-wide
 * token). It is constructed BOUND to one workspace at call time — matching every other per-request
 * source this file builds — and `resolve()`/`isConfigured()` refuse (`ok:false`/`configured:false`)
 * any call for a different workspace, rather than silently answering for it.
 *
 * `createDbPublishCredentialSource` resolves a provider's DEFAULT saved connection (Contract v2
 * Correction B) instead of the earlier "reject with 'ambiguous' when 2+ credentials are saved for one
 * provider" design — that design broke the whole point of named connections (saving a second one for
 * a provider) the first time someone actually used the feature as built. `is_default` is a real
 * server-owned invariant maintained by `publish-credentials/store.ts`'s write path. Project keys may
 * explicitly opt out: readiness must honor a chosen id even when implicit selection is ambiguous.
 *
 * `composePublishCredentialSource` is what `publish-site.ts`'s route and `publish-agent-tools.ts`'s
 * tool wiring actually construct: DB-backed always tried first (a workspace's own saved connection
 * wins), env-var fallback ONLY in `"self-hosted-cli"` mode — in `"hosted-api-only"` mode the env
 * source is never even constructed, per this dispatch's brief ("must never be a hosted fallback").
 */

/**
 * Env var names come from each target's deploy-plugin descriptor (`DeployTargetDescriptor.env`):
 * `tokenVars` in preference order (the first set, non-blank one wins; several because hosts' own CLIs
 * and CI docs have used more than one name, and an operator should not have to rename one they
 * already set), plus `fields`, one env var per extra credential field, all required. A target whose
 * descriptor declares no `env` has no env fallback at all.
 */
function noEnvFallbackReason(target: StaticPublishTargetId): string {
  return `${target} has no server-environment-variable fallback — its credential can only be configured through a saved connection, never through env vars`;
}

/** Refusal text for a target this workspace's deploy registry does not know. */
function unknownTargetReason(target: StaticPublishTargetId): string {
  return `'${target}' is not a deploy target this workspace knows — turn on a hosting plugin under Agent Plugins`;
}

/**
 * The ONE refusal text every "the chosen connection cannot be used" path shares (terra review
 * 2026-09-20, finding 1). Deliberately IDENTICAL for a credential id that does not exist and for one
 * that belongs to another workspace: `VendorCredentialSetRepoPort.findById` is workspace-scoped, so
 * both are the same `null` here, and keeping one message means a caller cannot use this endpoint to
 * learn whether some other workspace's id exists. Never echoes the caller-supplied id back — the
 * operator's next step is to reload and pick again, not to read their own input.
 */
const CHOSEN_CREDENTIAL_UNAVAILABLE_REASON =
  "the selected publish credential is not available in this workspace — reload the Static Site tab and choose a connection again";

/** Refusal text for a saved connection that exists in this workspace but is saved for a DIFFERENT
 *  provider than the publish target. Both values are safe to name: `providerId` comes from the row
 *  itself and `target` from an already-validated closed union, and neither is a secret. */
function chosenCredentialWrongProviderReason(providerId: StaticPublishTargetId, target: StaticPublishTargetId): string {
  return `the selected publish credential is saved for '${providerId}', not '${target}' — choose a '${target}' connection`;
}

/** Refusal text for an id-bound resolve against the env-var source — see `readCredential`'s own
 *  branch for why an env var can never be the connection the operator picked. */
function chosenConnectionUnavailableFromEnvReason(target: StaticPublishTargetId): string {
  return `a saved connection was chosen for this publish, but this install resolves '${target}' credentials from server environment variables, which have no saved connections to choose from`;
}

type EnvCredentialResult = { readonly token: string; readonly fields: Readonly<Record<string, string>> } | { readonly reason: string };
  /** The first set, non-blank var of `tokenVars` (blank counts as unset). The failure reason names
   *  every var the operator could have set, not just the first. */
  function readToken(env: NodeJS.ProcessEnv, target: StaticPublishTargetId, tokenVars: readonly string[]): { token: string } | { reason: string } {
    for (const envVar of tokenVars) {
      const token = env[envVar]?.trim();
      if (token) return { token };
    }
    const reason =
      tokenVars.length === 1
        ? `${tokenVars[0]} is not set — publishing to ${target} requires a token with write access configured in the server environment`
        : `none of ${tokenVars.join(", ")} is set — publishing to ${target} requires a token with write access configured in the server environment (any one of these env vars)`;
    return { reason };
  }


  /** Every declared extra field's env var, or the first one missing. */
  function readFields(env: NodeJS.ProcessEnv, target: StaticPublishTargetId, fallback: DeployTargetEnvFallback): { fields: Record<string, string> } | { reason: string } {
    const fields: Record<string, string> = {};
    for (const [field, envVar] of Object.entries(fallback.fields ?? {})) {
      const value = env[envVar]?.trim();
      if (!value) return { reason: `${envVar} is not set — publishing to ${target} requires both a token (${fallback.tokenVars.join(" or ")}) and ${envVar}` };
      fields[field] = value;
    }
    return { fields };
  }


/**
 * Builds a `PublishCredentialSource` that resolves a target's token (and any extra credential fields)
 * from the env vars its deploy-plugin descriptor names, bound to exactly one workspace at construction
 * time.
 *
 * @param required.workspaceId - The ONLY workspace this instance will ever answer for. A `resolve()`/
 *   `isConfigured()` call for any other `workspaceId` is refused, not silently served — see this
 *   file's header for why this changed from "accepted but ignored".
 * @param required.loadDeployTargets - This workspace's deploy registry (which env vars each target reads).
 * @param options.env - Defaults to `process.env`; overridable for tests so no test needs to mutate real
 *   process env vars (which would leak across parallel test files in the same process).
 * @complexity One registry load per call, then O(v) env reads for the target's declared vars.
 */
export function createEnvPublishCredentialSource(
  { workspaceId, loadDeployTargets, env }: {
    env: NodeJS.ProcessEnv;
    workspaceId: UUID;
    loadDeployTargets: ({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>) => Promise<DeployTargetRegistry>;
  },
  _optional = {},
): PublishCredentialSourceWithChoice {

  async function readCredential({ target, requestedWorkspaceId }: { target: StaticPublishTargetId; requestedWorkspaceId: UUID }, { credentialId }: { credentialId?: UUID } = {}): Promise<EnvCredentialResult> {
    // An env var is never "the saved connection the operator chose" — a chosen id must resolve to
    // THAT row or refuse (see `PublishCredentialSource.resolve`'s `credentialId` doc).
    if (credentialId !== undefined) {
      return { reason: chosenConnectionUnavailableFromEnvReason(target) };
    }
    if (requestedWorkspaceId !== workspaceId) {
      return {
        reason: `this credential source is bound to workspace '${workspaceId}' and refuses to resolve a token for workspace '${requestedWorkspaceId}'`,
      };
    }
    const descriptor = (await loadDeployTargets({ workspaceId })).get(target)?.descriptor;
    if (descriptor === undefined) return { reason: unknownTargetReason(target) };
    if (descriptor.env === undefined) return { reason: noEnvFallbackReason(target) };

    const tokenResult = readToken(env, target, descriptor.env.tokenVars);
    if ("reason" in tokenResult) return tokenResult;
    const fieldsResult = readFields(env, target, descriptor.env);
    if ("reason" in fieldsResult) return fieldsResult;
    return { token: tokenResult.token, fields: fieldsResult.fields };
  }

  return {
    async resolve(input) {
      const result = await readCredential({ target: input.target, requestedWorkspaceId: input.workspaceId }, input.credentialId === undefined ? {} : { credentialId: input.credentialId });
      return "token" in result ? { ok: true, token: result.token, ...result.fields } : { ok: false, reason: result.reason };
    },
    async isConfigured(input: Parameters<PublishCredentialSource["resolve"]>[0], _options = {}) {
      const result = await readCredential({ target: input.target, requestedWorkspaceId: input.workspaceId }, input.credentialId === undefined ? {} : { credentialId: input.credentialId });
      return "token" in result ? { configured: true } : { configured: false, reason: result.reason };
    },
  };
}

/**
 * The credential a deploy module is handed: string fields without the `ok` discriminant or saved
 * row identity. Identity is bookkeeping metadata, never a provider credential field.
 *
 * @complexity O(f) fields, no I/O.
 */
export function toDeployTargetCredential(resolved: ResolvedPublishCredentialSuccess): DeployTargetCredential {
  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(resolved)) if (name !== "credentialId" && typeof value === "string") fields[name] = value;
  return { ...fields, token: resolved.token };
}

/**
 * Projects a decrypted connection onto {@link PublishCredentialSource.resolve}'s success shape — the
 * one place that mapping lives, shared by the default-row lookup and the operator's chosen-row
 * lookup so the two can never drift into projecting a credential differently. The field the host's
 * descriptor names as `tokenField` becomes `token` (for an access-key pair, the secret half); every
 * other declared field passes through under its own name.
 *
 * @complexity O(f) declared credential fields, no I/O.
 */
export function projectConnectionForPublish(
  connection: PublishConnectionInput,
  spec: DeployTargetCredentialSpec
): Awaited<ReturnType<PublishCredentialSource["resolve"]>> {
  const token = connection[spec.tokenField];
  if (token === undefined) return { ok: false, reason: `the saved '${connection.providerId}' credential has no ${spec.tokenField} — save the connection again` };
  const fields: Record<string, string> = {};
  for (const field of spec.fields) {
    const value = connection[field.name];
    if (field.name !== spec.tokenField && value !== undefined) fields[field.name] = value;
  }
  return { ok: true, token, ...fields };
}

export interface DbPublishCredentialSourceDeps {
  describeCredential(deps: Pick<DbPublishCredentialSourceDeps, "repo" | "sealer" | "loadDeployTargets">, input: Parameters<typeof describeCredential>[1]): ReturnType<typeof describeCredential>;
  hasDefaultForPublish(deps: Pick<DbPublishCredentialSourceDeps, "repo" | "sealer" | "loadDeployTargets">, input: Parameters<typeof hasDefaultForPublish>[1]): ReturnType<typeof hasDefaultForPublish>;
  resolveForPublish(deps: Pick<DbPublishCredentialSourceDeps, "repo" | "sealer" | "loadDeployTargets">, input: Parameters<typeof resolveForPublish>[1]): ReturnType<typeof resolveForPublish>;
  resolveDefaultForPublish(deps: Pick<DbPublishCredentialSourceDeps, "repo" | "sealer" | "loadDeployTargets">, input: Parameters<typeof resolveDefaultForPublish>[1]): ReturnType<typeof resolveDefaultForPublish>;
  /** `vendor_credential_sets`, where saved publish credentials live (`publish-credentials/store.ts`). */
  repo: VendorCredentialSetRepoPort;
  sealer: SecretSealerPort;
  /** This workspace's deploy registry: which field of a saved connection is the token. */
  loadDeployTargets({ workspaceId }: { workspaceId: string }, optional?: Record<string, never>): Promise<DeployTargetRegistry>;
}

/**
 * Builds a `PublishCredentialSource` backed by the encrypted publish-credential store,
 * resolving each `(workspaceId, target)`'s DEFAULT saved connection (Contract v2 Correction B — see
 * this file's header), or the explicitly chosen compatible connection. `resolve()` decrypts via
 * the store; `isConfigured()` uses the same metadata-only selection policy and never decrypts.
 *
 * @complexity Metadata selection scans rows and host compatibility; `resolve` additionally opens
 *   and parses one selected payload. Readiness never opens a secret.
 */
export function createDbPublishCredentialSource(deps: DbPublishCredentialSourceDeps): PublishCredentialSourceWithChoice {
  const notConfiguredReason = (target: StaticPublishTargetId) =>
    `no default '${target}' credential is saved for this workspace yet — add one in the Static Site tab`;

  /** Projects through the target's declared credential spec, refusing a target the registry cannot describe. */
  async function project(workspaceId: UUID, connection: PublishConnectionInput): Promise<Awaited<ReturnType<PublishCredentialSource["resolve"]>>> {
    const spec = (await deps.loadDeployTargets({ workspaceId })).get(connection.providerId)?.descriptor.credential;
    return spec === undefined ? { ok: false, reason: unknownTargetReason(connection.providerId) } : projectConnectionForPublish(connection, spec);
  }

  /**
   * Resolves the ONE saved connection the operator chose, or refuses — never the provider's default
   * (terra review 2026-09-20, finding 1). `credentialId` is UNTRUSTED (an HTTP body field), so both
   * checks below are load-bearing: `resolveForPublish` reads through the workspace-scoped
   * `findById`, so another workspace's id is a `null` here and can never decrypt, and the row's own
   * explicit compatibility must include the target this publish is actually going to.
   *
   * @complexity O(1) — one repo read plus, only on a full match, one decrypt (`resolveForPublish`).
   */
  async function resolveChosenCredential(
    input: { workspaceId: UUID; target: StaticPublishTargetId; credentialId: UUID }
  ): Promise<Awaited<ReturnType<PublishCredentialSource["resolve"]>>> {
    const summary = await deps.describeCredential(deps, { workspaceId: input.workspaceId, id: input.credentialId });
    if (summary && !summary.publishHosts.includes(input.target)) {
      return { ok: false, reason: chosenCredentialWrongProviderReason(summary.providerId, input.target) };
    }
    const resolved = await deps.resolveForPublish(deps, { workspaceId: input.workspaceId, id: input.credentialId, providerId: input.target });
    if (!resolved) {
      return { ok: false, reason: CHOSEN_CREDENTIAL_UNAVAILABLE_REASON };
    }
    const projected = await project(input.workspaceId, { ...resolved.connection, providerId: input.target });
    return projected.ok ? { ...projected, credentialId: input.credentialId } : projected;
  }

  return {
    async resolve(input) {
      // The chosen-connection path and the default path produce the SAME success shape (both end in
      // `projectConnectionForPublish`) — only WHICH row is read differs.
      if (input.credentialId !== undefined) {
        return resolveChosenCredential({ workspaceId: input.workspaceId, target: input.target, credentialId: input.credentialId });
      }
      const resolved = await deps.resolveDefaultForPublish(deps, { workspaceId: input.workspaceId, providerId: input.target });
      if (!resolved) {
        return { ok: false, reason: notConfiguredReason(input.target) };
      }
      const projected = await project(input.workspaceId, resolved.connection);
      return projected.ok ? { ...projected, credentialId: resolved.id } : projected;
    },
    async isConfigured(input: Parameters<PublishCredentialSource["resolve"]>[0], _options = {}) {
      const configured = await deps.hasDefaultForPublish(deps, { workspaceId: input.workspaceId, providerId: input.target, ...(input.credentialId === undefined ? {} : { id: input.credentialId }) });
      const reason = input.credentialId === undefined ? notConfiguredReason(input.target) : CHOSEN_CREDENTIAL_UNAVAILABLE_REASON;
      return configured ? { configured: true } : { configured: false, reason };
    },
  };
}

export interface ComposePublishCredentialSourceInput {
  workspaceId: UUID;
  executionMode: PublishExecutionMode;
  dbDeps: DbPublishCredentialSourceDeps;
  /** Overridable for tests; defaults to `process.env` — same reasoning
   *  `createEnvPublishCredentialSource`'s own `env` parameter documents. Only read when
   *  `executionMode` is `"self-hosted-cli"` — see this function's own doc for why. */
  env: NodeJS.ProcessEnv;
}

/**
 * The ONE place this feature decides which `PublishCredentialSource`(s) a real publish attempt may
 * draw from, per this dispatch's brief: DB-backed always tried first (a saved connection always wins
 * over an operator env var when both exist), env-var fallback ONLY when `executionMode` is
 * `"self-hosted-cli"`. In `"hosted-api-only"` mode, `createEnvPublishCredentialSource` is never even
 * CALLED, not merely consulted-and-ignored — the brief's explicit instruction: it must never be a
 * hosted fallback, so a hosted process is structurally unable to hand out a process-wide operator
 * token no matter what is set in its environment.
 *
 * @complexity O(1) composition; the returned source's own cost is `createDbPublishCredentialSource`'s
 *   (plus, in self-hosted mode, one more O(1) env read on a DB miss).
 * @overallScore 100
 */
export function composePublishCredentialSource(input: ComposePublishCredentialSourceInput): PublishCredentialSourceWithChoice {
  const dbSource = createDbPublishCredentialSource(input.dbDeps);
  if (input.executionMode === "hosted-api-only") {
    return dbSource;
  }

  const envSource = createEnvPublishCredentialSource({ workspaceId: input.workspaceId, loadDeployTargets: input.dbDeps.loadDeployTargets, env: input.env });
  return {
    async resolve(req) {
      const fromDb = await dbSource.resolve(req);
      if (fromDb.ok) return fromDb;
      // A publish BOUND to a chosen saved connection never falls through to the env var (terra
      // review 2026-09-20, finding 1): the operator picked a specific account, and quietly
      // publishing with a different credential because that one did not resolve is the exact
      // failure this binding exists to prevent. The DB source's own refusal is the answer.
      if (req.credentialId !== undefined) return fromDb;
      return envSource.resolve(req);
    },
    async isConfigured(req: Parameters<PublishCredentialSource["resolve"]>[0], _options = {}) {
      const fromDb = await dbSource.isConfigured(req);
      if (fromDb.configured) return fromDb;
      // Readiness preserves the same chosen-account binding as resolve: env vars have no saved id.
      if (req.credentialId !== undefined) return fromDb;
      return envSource.isConfigured(req);
    },
  };
}
