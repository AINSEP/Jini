import type { JsonRouteAuthorize, JsonRouteAuthorizeScope } from "@jini-ai/core/contracts/server";
import type { ListPage } from "@jini-ai/core/list-page";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { AdminMemberSource } from "../../http/members.js";

/**
 * @file Shared guards and error mapping for the `members` admin route specs.
 *
 * Each hand-written members route had its own `if (err instanceof X) res.status(...)` ladder over the
 * members library's error classes. Those classes live with the library, which this package cannot
 * import, so the host injects one classifier (`MemberErrorClassifier`) and each route keeps its exact
 * ladder as a small status table keyed by the classified kind. The host's `onError` port writes the
 * thrown refusal flat, so every body stays byte-identical to what the admin client reads.
 */

/** The principal fields these routes read: only the id, as the trash move's actor. */
export interface MemberRoutePrincipal { id: string }

/**
 * The member reads the admin routes make. The members library's `MemberRepoPort` satisfies it
 * structurally; each route Picks only the methods it calls. Method syntax keeps the host's
 * branded-id parameter types assignable.
 */
export interface MemberReadPort {
  findById(required: { workspaceId: string; id: string }): Promise<AdminMemberSource | null>;
  /** Members ordered by id, one keyset page; a cursor the list did not issue is refused (`ToolInputError`). */
  list(required: { workspaceId: string }, optional?: { limit?: number; cursor?: string | null }): Promise<ListPage<AdminMemberSource>>;
}

/**
 * What a members-library failure means on the wire: the kinds the admin routes ever mapped. The last two
 * are request-magic-link's: the site cannot send sign-in mail (`sign-in-unavailable`, answered with the
 * library's own message) or the mailer has no sender identity (`sender-not-configured`, answered with the
 * host's copy, since the mailer's message names internal setup).
 */
export type MemberErrorKind = "not-found" | "validation" | "conflict" | "sign-in-unavailable" | "sender-not-configured";

/**
 * Names the kind of a members-library failure, or `undefined` for anything else (an unexpected
 * failure the host answers as a redacted 500). Injected because the error classes belong to the host's
 * members library; the classes are plain siblings, so the order a host tests them in does not matter.
 */
export type MemberErrorClassifier = (required: { err: unknown }, optional?: Record<string, never>) => MemberErrorKind | undefined;

/** One route's ladder: the status each classified kind answers with. A kind a route does not list is unmapped. */
export type MemberErrorStatuses = Readonly<Partial<Record<MemberErrorKind, number>>>;

/**
 * Refuses with the route's status for the classified kind and the error's own message (never a code,
 * as the host never sent one); anything unclassified or unlisted is rethrown unchanged so the host's
 * error port answers it as an unexpected (redacted) failure.
 * @complexity O(1) plus the injected classifier.
 */
export function rejectMemberError(
  { err, classify, statuses }: { err: unknown; classify: MemberErrorClassifier; statuses: MemberErrorStatuses },
  _optional: Record<string, never> = {},
): never {
  const kind = classify({ err });
  const status = kind === undefined ? undefined : statuses[kind];
  if (status === undefined) throw err;
  rejectRoute({ status, error: err instanceof Error ? err.message : String(err) });
}

/**
 * Asks the host for `member.manage` on the `member` entity type. By-id routes pass the requested
 * `entityId` so the host decides for that member; list acts on no single member. A mount without an
 * authorizer is a wiring bug, not a caller error, so it fails closed.
 * @complexity O(1) plus the injected authorizer.
 */
export async function authorizeMemberManage(
  { authorize }: { authorize: JsonRouteAuthorize | undefined },
  optional: JsonRouteAuthorizeScope = {},
): Promise<void> {
  if (!authorize) throw new Error("members admin route has no authorizer");
  const required = { permission: "member.manage", entityType: "member" };
  await (optional.entityId === undefined ? authorize(required) : authorize(required, { entityId: optional.entityId }));
}

/** The authenticated principal's id, recorded as the actor of a trash move. @complexity O(1). */
export function memberActorId({ context }: { context: MemberRoutePrincipal | undefined }, _optional: Record<string, never> = {}): string {
  if (!context) throw new Error("members admin route has no authenticated principal");
  return context.id;
}

/** The `:memberId` path segment; Express always fills it, the `?? ""` mirrors the host's own guard. @complexity O(1). */
export function memberIdParam(params: Record<string, string | undefined>): string {
  return String(params.memberId ?? "");
}
