import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { ForbiddenError } from "../../../core/index.js";
import type { KernelOutboxAdapterDeps } from "../../../core/kernel-outbox.js";
import {
  createPostBackedContentLookup,
  toTaxonomyOutbox,
  type ContentRecordLookupPort,
  type EntryTermRepoPort,
  type TaxonomyRepoPort,
  type TaxonomyRevisionRepoPort,
  type TermRepoPort,
  type WriteServiceDeps,
} from "../../../taxonomy/index.js";

/** @file Helpers shared by the taxonomy admin route specs (Categories & Tags, ADR-044). */

/** The session principal these routes read. */
export interface TaxonomyRoutePrincipal { id: string }

/** ADR-044 registers exactly one permission for this whole domain (no `.read`/`.write` split).
 * @complexity O(1) beyond the injected authorizer. */
export async function authorizeTaxonomyManage(
  { authorize, entityType }: { authorize: JsonRouteAuthorize | undefined; entityType: "taxonomy" | "term" },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("taxonomy admin route has no authorizer");
  const required = { permission: "admin.taxonomy.manage", entityType };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal; the host's authenticate port always supplies one.
 * @complexity O(1). */
export function taxonomyPrincipal({ context }: { context: TaxonomyRoutePrincipal | undefined }, _optional: Record<string, never> = {}): TaxonomyRoutePrincipal {
  if (!context) throw new Error("taxonomy admin route has no authenticated principal");
  return context;
}

/** The deps the taxonomy write routes read: the host's workspace-scoped RBAC authorizer plus the
 *  repos and ports the taxonomy write service runs against. These routes authorize inside the
 *  service (its `ForbiddenError` answers the flat 403), never through the host's authorize port. */
export interface TaxonomyWriteRouteDeps extends KernelOutboxAdapterDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  taxonomyRepo: TaxonomyRepoPort;
  termRepo: TermRepoPort;
  entryTermRepo: EntryTermRepoPort;
  taxonomyRevisionRepo: TaxonomyRevisionRepoPort;
  stampWatermark: WriteServiceDeps["stampWatermark"];
  postRepo: ContentRecordLookupPort;
}

/** The write service's deps for one call; `contentTargets` is the content lookup (and, for
 *  tagging, the entry policy) the caller resolves content through.
 * @complexity O(1) — builds adapters, no I/O. */
export function taxonomyWriteServiceDeps(
  { deps, contentTargets }: { deps: TaxonomyWriteRouteDeps; contentTargets: Pick<WriteServiceDeps, "contentLookup" | "contentTypeTaxonomyPolicy"> },
  _optional: Record<string, never> = {},
): WriteServiceDeps {
  return {
    authorize: (params) => deps.authorize({ ...params, workspaceId: deps.workspaceId }),
    clock: deps.clock,
    idGen: deps.idGen,
    taxonomies: deps.taxonomyRepo,
    terms: deps.termRepo,
    entryTerms: deps.entryTermRepo,
    revisions: deps.taxonomyRevisionRepo,
    stampWatermark: deps.stampWatermark,
    outbox: toTaxonomyOutbox(deps),
    workspaceId: deps.workspaceId,
    ...contentTargets,
  };
}

/** Posts/pages only: the content lookup every non-tagging write passes.
 * @complexity O(1). */
export function postContentTargets({ deps }: { deps: TaxonomyWriteRouteDeps }, _optional: Record<string, never> = {}): Pick<WriteServiceDeps, "contentLookup"> {
  return { contentLookup: createPostBackedContentLookup({ postRepo: deps.postRepo, workspaceId: deps.workspaceId }) };
}

type ErrorClass = abstract new (...args: never[]) => Error;

/** One group of recognized error classes and the refusal they answer with; `code` omitted means
 *  the error's own `code` (an `EntityNotLiveError` carries its own). */
export interface TaxonomyErrorRefusal { classes: readonly ErrorClass[]; status: number; code?: string }

/** Every taxonomy write answers a denied `admin.taxonomy.manage` with this flat 403 (no details). */
export const FORBIDDEN_REFUSAL: TaxonomyErrorRefusal = { classes: [ForbiddenError], status: 403, code: "FORBIDDEN" };

/** Refuses a recognized error with `{ error: <message>, code }`; anything else is rethrown so the
 *  host's error port answers it as an unexpected failure.
 * @complexity O(n) in the refusal table. */
export function rejectTaxonomyError({ err, refusals }: { err: unknown; refusals: readonly TaxonomyErrorRefusal[] }, _optional: Record<string, never> = {}): never {
  const match = err instanceof Error ? refusals.find((refusal) => refusal.classes.some((cls) => err instanceof cls)) : undefined;
  if (!match) throw err;
  const error = err as Error & { code?: unknown };
  rejectRoute({ status: match.status, error: error.message, code: match.code ?? String(error.code) });
}
