/**
 * @file The admin `publish-content` wire DTOs: the JSON bodies the publish-content admin routes
 * (peers, destination, and the import/export report) answer with and an admin client reads. Declared
 * here, once, so the server serializers (`@jini-ai/cms/admin-http/http/publish-content`, the
 * `@jini-ai/cms/admin-http/routes/publish-content/*` specs) and any client mirror read the same
 * shapes without the client depending on CMS.
 *
 * This module is deliberately neutral: it imports no planner, repository, Node builtin, or UI
 * code. Server HTTP boundaries and the admin client share these DTOs without either depending on
 * the other's implementation graph.
 */

export type PublishContentOutcomeKindDto =
  | 'created'
  | 'unchanged'
  | 'applied'
  | 'conflict'
  | 'blocked'
  | 'forced';

/** Wire twin of `planner.ts`'s `RetireTarget` — this module imports no planner code (this file's
 *  header), so the shape is repeated here rather than shared by import. */
export interface PublishContentRetireTargetDto {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly hash: string;
}

/** Wire twin of `type-registry.ts`'s `ReferenceHolder` — this module imports no planner or
 *  type-registry code (this file's header), so the shape is repeated here rather than shared by
 *  import. `plan-publish-repoint-menus-2026-09-24.md` §2.2/R6. */
export interface PublishContentReferenceHolderDto {
  readonly entityType: string;
  readonly entityId: string;
  readonly entityLabel: string | null;
  readonly referencedId: string;
}

export interface PublishContentOutcomeRowDto {
  readonly entityType: string;
  readonly entityId: string;
  /**
   * The entity's human identifier (`planner.ts`'s `entityDisplayLabel`) — a slug, a title — so a
   * client can name the row instead of printing a uuid at the operator.
   *
   * OPTIONAL on the wire, unlike on the planner's own row, precisely because this report can arrive
   * from ANOTHER instance: a peer built before this field existed answers a plan without it, and
   * that response must still render. A reader treats absent exactly like `null` (show a short id),
   * never as a reason to reject the report.
   */
  readonly entityLabel?: string | null;
  readonly outcome: PublishContentOutcomeKindDto;
  readonly writes: boolean;
  readonly reason: string | null;
  /**
   * publish-overwrite-live-plan §4/S6 — whitelisted straight off `planner.ts`'s own `canOverwrite`.
   * OPTIONAL on the wire, the same reasoning as `entityLabel` above: a peer built before S2 answers a
   * plan without it, and a reader must treat absent exactly like `false` (nothing offered), never as
   * a reason to reject the report.
   */
  readonly canOverwrite?: boolean;
  /** publish-overwrite-live-plan §4/S6 — whitelisted straight off `planner.ts`'s own `retires`.
   *  OPTIONAL/absent for the same pre-S2-peer reason as {@link canOverwrite}; a reader treats absent
   *  exactly like `null`. */
  readonly retires?: PublishContentRetireTargetDto | null;
  /**
   * `plan-publish-repoint-menus-2026-09-24.md` §2.2/R6 — live entities that still link to this row's
   * {@link retires} holder by id, echoed from `planner.ts`'s own `referencedBy`. Present ONLY when
   * non-empty, matching the planner's own row — absent for every row with no retire target and for a
   * retire target with no live references at all — so an operator sees what still points at a holder
   * before choosing to overwrite it.
   */
  readonly referencedBy?: readonly PublishContentReferenceHolderDto[];
  /**
   * Owner decision 2026-09-25 (generalized by plan G3) — present ONLY on a row a scoped run carried
   * along because its in-scope rows use it (an image, an embedded widget, an entry's collection, ...)
   * AND live would write it (created/applied/forced) —
   * `report-labels.ts`'s `keepChangingIncludedEntities`, added by the SOURCE after the peer plans, never
   * by the planner itself: the referrers' `entityKey`s. The dialog renders such a row pre-ticked and
   * untickable. Absent on every other row, including a conflicting/blocked carried row, which stays
   * an ordinary row so the operator sees it.
   */
  readonly includedFor?: readonly string[];
  /**
   * 2026-09-26 — `true` on an update/overwrite row whose item is trashed on the SOURCE: live plans it
   * as an ordinary update, but what it writes is the trash. Added by the source after the peer plans
   * (`report-labels.ts`'s `tagTrashingRows`), never by the planner. Absent on every other row.
   */
  readonly trashes?: boolean;
}

/** The only report shape serialized for publish-content clients. */
export interface PublishContentReportDto {
  readonly refused: boolean;
  readonly refusalReason: string | null;
  readonly applyOrder: readonly string[];
  readonly rows: readonly PublishContentOutcomeRowDto[];
}

/**
 * One configured publish target, as `GET .../publish-content/peers` returns it.
 *
 * `masked` and `hasCredential` are the ONLY credential-shaped fields that exist on the client at
 * all. The sealed material behind them never leaves the server — nothing in this folder, in the
 * admin dialog, or in any error path may request, render, log or store it.
 *
 * A publishing destination as it may leave the server: no sealed material can ride on a value of this
 * type, which is how the frozen peers contract keeps secrets out of every response body by construction.
 */
export interface PublishContentPeerView {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly remoteWorkspaceId: string;
  /** A display hint derived from the key, never the key. `null` when the peer holds no credential. */
  readonly masked: string | null;
  readonly hasCredential: boolean;
}

/** What the zero-setup destination routes (`GET`, `POST /connect`, `POST /disconnect`) answer. */
export interface PublishDestinationView {
  /** `true` once this computer's grant has been written for a site. */
  readonly connected: boolean;
  /** The connected site, as the publish list already models it. `null` when there is none. */
  readonly site: PublishContentPeerView | null;
  /** Read out of the repo's deploy config — what to offer when nothing is connected yet. */
  readonly candidateUrl: string | null;
  /** One sentence describing where things stand. */
  readonly message: string;
  /** One sentence naming what the owner does next, or `null` when nothing is pending. */
  readonly nextStep: string | null;
}

/** `GET .../publish-content/peers`. */
export interface PublishContentPeerListDto {
  readonly peers: readonly PublishContentPeerView[];
}

/** `POST .../peers` and `PATCH .../peers/:peerId`. */
export interface PublishContentPeerResponseDto {
  readonly peer: PublishContentPeerView;
}
