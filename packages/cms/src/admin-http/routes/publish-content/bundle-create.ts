import { defineJsonRoute, ok, type JsonRouteAuthorize } from "@jini-ai/core/contracts/server";
import { rejectRoute, RouteRefusalError } from "@jini-ai/core/errors/route-refusal";

import { PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION } from "../../../publish/transfer/artifact-format.js";
import { stageBundle, type StageBundleDeps } from "../../../publish/transfer/bundle-staging.js";
import type { PublishRoutePrincipal } from "./transport-shared.js";

/**
 * @file Task 6 of the publish-content (Publish Content) feature —
 * `ADS-memory/reports/2026-09-18-publish-feature-implementation-plan.md` §4 task 6.
 *
 * `POST /api/admin/v1/workspaces/:workspaceId/publish-content/bundles` — stages a received bundle
 * (Task 4's export envelope: `{hashVersion, sourceLabel, entities, blobManifest}`, whether pushed by
 * a peer or fetched by this instance's own pull) in `publish_content_bundles`, so Task 7's gated
 * `plan()`/`execute()` has a stable, already-persisted input to hash and re-hash. Never writes any
 * OTHER table — see `bundle-staging.ts`'s `stageBundle` for what "staging" means.
 *
 * `expiresAt` is never read from the request body — `stageBundle` always computes it server-side
 * from `receivedAt` + a fixed TTL (`bundle-staging.ts`'s own header). `sourcePrincipalId` is always
 * this request's AUTHENTICATED principal, never a bundle-declared identity (plan §1.6 / §5 risk #9).
 *
 * The body cap stays the host's own binding (its 413 body predates the kit's envelope), and the
 * request `Host` arrives through the `requestFacts` opt-in the host spreads on at the mount.
 */

/** An entity that passed {@link validateBundleBody}: an object with a non-empty string
 *  `entityType` and an integer `schemaVersion`. Every other field stays opaque. */
export type ValidatedBundleEntity = Record<string, unknown> & { entityType: string; schemaVersion: number };

/** A bundle envelope that passed {@link validateBundleBody}. */
export interface ValidatedBundle {
  artifactFormatVersion: number;
  hashVersion: number;
  sourceLabel: string | undefined;
  entities: ValidatedBundleEntity[];
  blobManifest: string[];
}

/** The publishing grant fields the door check reads; the host's grant passes through whole. */
export interface BundleCreateGrant { readonly entityTypes: readonly string[] }

/** The deps this route reads. Functions are methods so a host may bind ones typed against its full grant. */
export interface BundleCreateRouteDeps {
  workspaceId: string;
  bundleRepo: StageBundleDeps["repo"];
  clock: StageBundleDeps["clock"];
  idGen: StageBundleDeps["idGen"];
  /** Every registered handler's `schemaVersion`, by entity type (read once per request). */
  schemaVersions(): ReadonlyMap<string, number>;
  /** This request's publishing grant, or `null` (no publishing credential — an explicitly configured peer key). */
  publishTrust(required: { context: PublishRoutePrincipal | undefined }): BundleCreateGrant | null;
  isBackstopEntityType(required: { entityType: string }): boolean;
  backstopGrantAllows(required: { grant: BundleCreateGrant | null; entityType: string }): boolean;
  /** The manual-send metadata, `null` for a bundle with no raw entity. @throws An `Error` whose message is the 400. */
  readBackstopMetadata(required: { entities: readonly ValidatedBundleEntity[] }): { readonly destinationHost: string } | null;
  /** Whether the manual-send audit storage is installed. */
  backstopAuditReady(): Promise<boolean>;
}

/** The status-and-body pair a door check refuses with. */
interface BundleRefusal { status: number; body: Record<string, unknown> }

/** The version fields, in check order. @complexity O(1). */
function envelopeVersionError({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): string | undefined {
  if (!Number.isInteger(body.artifactFormatVersion)) return "artifactFormatVersion must be an integer";
  if (body.artifactFormatVersion !== PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION) {
    return (
      `unsupported artifactFormatVersion ${String(body.artifactFormatVersion)}; ` +
      `this instance supports ${PUBLISH_CONTENT_ARTIFACT_FORMAT_VERSION}`
    );
  }
  if (!Number.isInteger(body.hashVersion)) return "hashVersion must be an integer";
  return undefined;
}

/** One entity's envelope fields. @complexity O(1). */
function entityError({ entity, index }: { entity: unknown; index: number }, _options: Record<string, never> = {}): string | undefined {
  if (typeof entity !== "object" || entity === null || Array.isArray(entity)) return `entities[${index}] must be an object`;
  const candidate = entity as Record<string, unknown>;
  if (typeof candidate.entityType !== "string" || candidate.entityType.length === 0) {
    return `entities[${index}].entityType must be a non-empty string`;
  }
  if (!Number.isInteger(candidate.schemaVersion)) return `entities[${index}].schemaVersion must be an integer`;
  return undefined;
}

/** `entities` itself, then each entry in order; the first refusal wins. @complexity O(n). */
function entitiesError({ entities }: { entities: unknown }, _options: Record<string, never> = {}): string | undefined {
  if (!Array.isArray(entities)) return "entities must be an array";
  for (const [index, entity] of entities.entries()) {
    const error = entityError({ entity, index });
    if (error) return error;
  }
  return undefined;
}

/** The fields checked after the entities. @complexity O(n) in `blobManifest.length`. */
function manifestAndLabelError({ body }: { body: Record<string, unknown> }, _optional: Record<string, never> = {}): string | undefined {
  if (!Array.isArray(body.blobManifest) || body.blobManifest.some((sha) => typeof sha !== "string")) {
    return "blobManifest must be an array of strings";
  }
  if (body.sourceLabel !== undefined && typeof body.sourceLabel !== "string") return "sourceLabel must be a string when present";
  return undefined;
}

/** Body-shape validation extracted from the handler: `hashVersion` must be a finite integer,
 *  `entities` and `blobManifest` must be arrays (`blobManifest` additionally an array of strings —
 *  it is compared against blob sha256s downstream). This module never inspects an entity's own
 *  shape — that is `planImport`'s job (Task 5, already built); duplicating it here would just be a
 *  second, driftable copy of the same rule.
 *  @complexity O(n) in `blobManifest.length` (one type check per element). */
export function validateBundleBody({ rawBody }: { rawBody: unknown }, _options: Record<string, never> = {}): ValidatedBundle | { error: string } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const error = envelopeVersionError({ body }) ?? entitiesError({ entities: body.entities }) ?? manifestAndLabelError({ body });
  if (error) return { error };
  return {
    artifactFormatVersion: body.artifactFormatVersion as number,
    hashVersion: body.hashVersion as number,
    sourceLabel: body.sourceLabel as string | undefined,
    entities: body.entities as ValidatedBundleEntity[],
    blobManifest: body.blobManifest as string[],
  };
}

/** A registered type whose handler speaks another `schemaVersion` refuses the bundle; an
 *  unregistered type passes here and is left to `planImport`. @complexity O(n). */
function schemaVersionRefusal({ deps, entities }: { deps: BundleCreateRouteDeps; entities: readonly ValidatedBundleEntity[] }, _optional: Record<string, never> = {}): BundleRefusal | null {
  const versions = deps.schemaVersions();
  for (const entity of entities) {
    const supported = versions.get(entity.entityType);
    if (supported !== undefined && entity.schemaVersion !== supported) {
      return {
        status: 400,
        body: {
          error:
            `unsupported schemaVersion ${String(entity.schemaVersion)} for entity type '${entity.entityType}'; ` +
            `this instance supports ${supported}`,
        },
      };
    }
  }
  return null;
}

/**
 * The grant's entity-type allowlist, enforced at the door a publishing credential comes
 * through. A capability says "may publish"; `entityTypes` says WHAT, and without this the
 * second half of the grant would be decorative. The WHOLE bundle is refused rather than
 * filtered down to the allowed types, matching `grant.ts`'s own refuse-never-repair stance:
 * a source that sent a type it may not send has a wrong idea of what it is allowed to do,
 * and quietly dropping part of its bundle would leave it believing the publish succeeded
 * in full. An empty `entityTypes` allows nothing, which is the correct reading of a
 * permission nobody stated.
 * @complexity O(n · t) in entities and granted types.
 */
function grantRefusal({ deps, publishTrust, entities }: { deps: BundleCreateRouteDeps; publishTrust: BundleCreateGrant | null; entities: readonly ValidatedBundleEntity[] }, _options: Record<string, never> = {}): BundleRefusal | null {
  if (entities.some(({ entityType }) => deps.isBackstopEntityType({ entityType }) && !deps.backstopGrantAllows({ grant: publishTrust, entityType }))) {
    return { status: 403, body: { error: "Send by hand requires the destination's backstop grant and raw entity type.",
      code: "FORBIDDEN", details: { permission: "publish_content.backstop", reason: "backstop_not_granted" } } };
  }
  // `validated.entities` is `unknown[]` on purpose (see `validateBundleBody`), so an entry
  // that does not declare a string `entityType` is refused rather than skipped: skipping it
  // would let `{}` walk straight past the allowlist and reach `planImport` unchecked.
  // `findIndex`, not `find`, because `find` reports a match by returning the element: a
  // matching `undefined` entry would be indistinguishable from "no match". Not reachable
  // over this route today — JSON has no `undefined`, so a parsed body cannot produce one,
  // and a deliberate break confirmed the tests below do not distinguish the two spellings.
  // Kept because it costs nothing and the next caller may not arrive through JSON.
  // Now structural instead: `validateBundleBody` types every entry as an object with a
  // non-empty string `entityType` and refuses anything else as a 400 before this runs, so an
  // entry with no declared type can no longer reach the allowlist at all, and `some` over the
  // declared types replaces the `findIndex` guard.
  if (publishTrust && entities.some(({ entityType }) => !publishTrust.entityTypes.includes(entityType))) {
    return {
      status: 403,
      body: {
        error: "this bundle carries an entity type outside the publishing grant",
        code: "FORBIDDEN",
        details: { permission: "publish_content.apply", reason: "entity_type_not_granted" },
      },
    };
  }
  return null;
}

/**
 * A manual send (raw rows/files): its send details must read, its confirmed address must be this
 * destination, and the audit storage must be installed. `null` for a bundle with no raw entity.
 * @complexity O(n) in entities, plus one audit-table probe.
 */
async function backstopRefusal({ host, deps, entities }: { host: string | undefined; deps: BundleCreateRouteDeps; entities: readonly ValidatedBundleEntity[] }, _options: Record<string, never> = {}): Promise<BundleRefusal | null> {
  let metadata: { readonly destinationHost: string } | null;
  try {
    // Envelope validation leaves entity fields opaque; the planner checks their full
    // shape before any writes. This read validates only the manual-send metadata.
    metadata = deps.readBackstopMetadata({ entities });
  } catch (error) {
    return { status: 400, body: { error: (error as Error).message } };
  }
  if (metadata === null) return null;
  if (metadata.destinationHost !== host) return { status: 400, body: { error: "The confirmed live address does not match this destination." } };
  if (!(await deps.backstopAuditReady())) {
    return { status: 503, body: { error: "Send by hand needs its audit storage installed before it can send anything.", code: "BACKSTOP_NOT_INSTALLED" } };
  }
  return null;
}

/** The door checks in order (schema, grant, manual send); the grant is read only once reached. @complexity O(n · t). */
async function refuseBundle(
  { deps, context, host, entities }: { deps: BundleCreateRouteDeps; context: PublishRoutePrincipal | undefined; host: string | undefined; entities: readonly ValidatedBundleEntity[] },
  _optional: Record<string, never> = {},
): Promise<void> {
  const refusal =
    schemaVersionRefusal({ deps, entities }) ??
    grantRefusal({ deps, publishTrust: deps.publishTrust({ context }), entities }) ??
    (await backstopRefusal({ host, deps, entities }));
  if (refusal) throw new RouteRefusalError(refusal);
}

/** `publish_content.apply` (no entity type: the hand-written check named none), then the principal id.
 * A mount without an authorizer or a principal is a wiring bug: fail closed. @complexity O(1). */
async function authorizedPrincipalId(
  { authorize, context }: { authorize: JsonRouteAuthorize | undefined; context: PublishRoutePrincipal | undefined },
  _optional: Record<string, never> = {},
): Promise<string> {
  if (!authorize) throw new Error("publish-content admin route has no authorizer");
  await authorize({ permission: "publish_content.apply" });
  if (!context) throw new Error("publish-content admin route has no authenticated principal");
  return context.id;
}

/** `POST .../publish-content/bundles` — authorize, validate, the door checks, then stage (201). */
export const bundleCreateRoute = defineJsonRoute<{ body: unknown; host: string | undefined }, { bundleId: string; expiresAt: string }, BundleCreateRouteDeps, PublishRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/publish-content/bundles",
  parse: (raw) => ok({ value: { body: raw.body, host: raw.facts?.host } }),
  handle: async ({ input, deps, context, authorize }) => {
    const principalId = await authorizedPrincipalId({ authorize, context });
    const validated = validateBundleBody({ rawBody: input.body });
    if ("error" in validated) rejectRoute({ status: 400, error: validated.error });
    await refuseBundle({ deps, context, host: input.host, entities: validated.entities });
    const { bundleId, expiresAt } = await stageBundle({
      input: {
        workspaceId: deps.workspaceId, sourcePrincipalId: principalId, artifactFormatVersion: validated.artifactFormatVersion,
        hashVersion: validated.hashVersion, ...(validated.sourceLabel === undefined ? {} : { sourceLabel: validated.sourceLabel }), entities: validated.entities, blobManifest: validated.blobManifest,
      },
      deps: { repo: deps.bundleRepo, clock: deps.clock, idGen: deps.idGen },
    });
    return ok({ value: { bundleId, expiresAt } });
  },
}, { successStatus: 201 });
