import { malformedKey } from "../../publish/content/precheck-reasons.js";
import type { PackedEntity } from "../../publish/transfer/packed-entity.js";
import type { RedirectRepoPort } from "../ports.js";
import { checkRedirectFieldsWouldWrite, createRedirect, updateRedirect, type RedirectsWriteDeps } from "../redirects.js";
import { RedirectConflictError, RedirectLoopError, RedirectTargetNotAllowedError, RedirectValidationError } from "../types.js";
import type { RedirectMatchType, RedirectRecord, RedirectStatus, RedirectStatusCode } from "../types.js";

/**
 * @file `redirect`'s publish-content contribution, built on the host's repo-backed publish-handler
 * factory (injected as `createRepoPublishHandler`; M-RED of the publish-all-types plan). A DATA
 * config: the factory, the table it covers and the handler shape it returns all belong to the host.
 *
 * ## The natural key
 *
 * Redirect ids are minted per-install (`idGen.newId()` inside `createRedirect`), so two instances
 * holding "the same" rule never share a row id the way `post`/`page`/`media` do. `PackedEntity.id` is
 * `${matchType}:${fromPattern}` instead (behavior.spec.md §5.1's exact-match dedup key), reversed by
 * splitting on the FIRST `:` only: `matchType` has no colon, `fromPattern` may.
 *
 * No `RedirectRepoPort` method finds a row (active OR disabled) by natural key — `lookupExact` and
 * friends filter to `status === "active"` — so {@link findByNaturalKey} lists by `matchType` (both
 * statuses) and matches `fromPattern` client-side: O(n) over tens of rows.
 *
 * ## What is not a factory default
 *
 * - Pack keeps `status === "active"` rows only (`include`, not `isTrashed`): a manually-disabled rule and
 *   a Trash-tombstoned one are both `status: "disabled"` and `RedirectsWriteDeps` cannot tell them
 *   apart, so neither travels — publishing can never resurrect a trashed rule.
 * - No `undo`: `createRedirect`/`updateRedirect` write their own `redirect_revisions` ledger in the same
 *   transaction, so the command gateway would add a redundant second audit trail. The row id is
 *   returned as the report's `changeSetId`.
 * - `permission` is redirects' own `"admin.redirects.manage"`, per `PublishContentHandler.permission`.
 */

/** A row as this transport sees it: the record plus the synthetic `title` label. */
export type RedirectPublishRow = RedirectRecord & { readonly title: string };

/** `"transferred"` is packed and hashed; `"provenance"` is packed but not hashed; `"local"` never leaves the row. */
type FieldDisposition = "transferred" | "provenance" | "local";

/** A domain error class the host factory maps to a `blocked` row outcome. */
type ErrorClass = abstract new (...args: never[]) => Error;

/** The slice of the host's publish deps this config reads: `ports.redirect` is absent until wired. */
export interface RedirectPublishDeps {
  readonly ports: { readonly redirect?: RedirectsWriteDeps | undefined };
}

/** The repo-backed publish-handler config this contribution fills (the slice of the host's config type it uses). */
export interface RedirectRepoPublishConfig {
  readonly entityType: string;
  readonly coversTables: readonly string[];
  readonly permission: string;
  readonly ports: (required: { deps: RedirectPublishDeps }, optional?: Record<string, never>) => RedirectsWriteDeps | undefined;
  readonly list: (required: { ports: RedirectsWriteDeps; workspaceId: string }, optional?: Record<string, never>) => Promise<readonly RedirectPublishRow[]>;
  readonly find: (required: { ports: RedirectsWriteDeps; workspaceId: string; id: string }, optional?: Record<string, never>) => Promise<RedirectPublishRow | null>;
  readonly idOf: (required: { row: RedirectPublishRow }, optional?: Record<string, never>) => string;
  readonly include: (required: { row: RedirectPublishRow }, optional?: Record<string, never>) => boolean;
  readonly fields: Record<Extract<keyof RedirectPublishRow, string>, FieldDisposition>;
  readonly validate: (input: { ports: RedirectsWriteDeps; workspaceId: string; entity: PackedEntity; existing: RedirectPublishRow | null }, optional?: {}) => Promise<string | null>;
  readonly write: (
    ctx: { ports: RedirectsWriteDeps; workspaceId: string; id: string; state: Record<string, unknown>; existing: RedirectPublishRow | null; principalId: string },
    optional?: {},
  ) => Promise<{ changeSetId: string }>;
  readonly errors: { readonly blocked: readonly ErrorClass[] };
}

/** The host's repo-backed publish-handler factory, narrowed to this config; returns the host's contributor. */
export type CreateRedirectRepoPublishHandler<TContributor> = (config: RedirectRepoPublishConfig, optional?: {}) => TContributor;

/** The short word an operator reads for a non-`"exact"` `matchType` in {@link withTitle}'s label. */
const MATCH_TYPE_PREFIX: Readonly<Record<RedirectMatchType, string>> = {
  exact: "",
  prefix: "starts with ",
  wildcard: "matches ",
  regex: "matches pattern ",
};

/** `PackedEntity.id` for a redirect — see this file's header.
 *  @complexity O(1). */
export function redirectNaturalKey(
  { matchType, fromPattern }: { matchType: RedirectMatchType; fromPattern: string },
  _optional = {}
): string {
  return `${matchType}:${fromPattern}`;
}

/** Reverses {@link redirectNaturalKey}; `null` for a key with no `:` (a hand-crafted or corrupted id).
 *  @complexity O(n) in the key's length. */
function parseRedirectNaturalKey({ key }: { key: string }, _optional = {}): { matchType: RedirectMatchType; fromPattern: string } | null {
  const sep = key.indexOf(":");
  if (sep < 0) return null;
  return { matchType: key.slice(0, sep) as RedirectMatchType, fromPattern: key.slice(sep + 1) };
}

/**
 * Adds what a human calls this redirect on screen. No `RedirectRecord` field is a
 * `slug`/`title`/`name`/`filename` (what `planner.ts`'s `entityDisplayLabel` reads), and a short prefix of
 * the natural key (`"exact:/o"`) is unreadable, so `title` is packed as provenance: shown, never hashed.
 * @complexity O(1).
 */
function withTitle(row: RedirectRecord): RedirectPublishRow {
  return { ...row, title: `${MATCH_TYPE_PREFIX[row.matchType]}${row.fromPattern} → ${row.toTarget}` };
}

/** The row (active OR disabled) holding this natural key, or `null`.
 *  @complexity O(n) in this workspace's row count for `matchType`. */
async function findByNaturalKey(
  { repo, workspaceId, id }: { repo: RedirectRepoPort; workspaceId: string; id: string },
  _optional = {}
): Promise<RedirectPublishRow | null> {
  const key = parseRedirectNaturalKey({ key: id });
  if (!key) return null;
  const rows = await repo.list({ workspaceId, matchType: key.matchType });
  const row = rows.find((r) => r.fromPattern === key.fromPattern);
  return row ? withTitle(row) : null;
}

/** The fields `createRedirect`/`updateRedirect` take, read off packed state. */
function redirectFields({ workspaceId, state }: { workspaceId: string; state: Record<string, unknown> }, _optional = {}) {
  return {
    workspaceId,
    matchType: state.matchType as RedirectMatchType,
    fromPattern: state.fromPattern as string,
    toTarget: state.toTarget as string,
    statusCode: state.statusCode as RedirectStatusCode,
    override: state.override as boolean,
    priority: state.priority as number,
  };
}

/** `transferred` = what `CreateRedirectInput`/`UpdateRedirectInput` accept, plus `status` (always
 * "active" on a packed row). `provenance` fields cannot round-trip: `createdAt` comes from the
 * destination clock, `source` is always "import" on write, and the `auto_slug_change` capture fields
 * are written only by `capture.ts`. Hashing them would be a permanent false conflict. */
function redirectPublishFields(_optional = {}): RedirectRepoPublishConfig["fields"] {
  return {
    matchType: "transferred",
    fromPattern: "transferred",
    toTarget: "transferred",
    statusCode: "transferred",
    status: "transferred",
    override: "transferred",
    priority: "transferred",
    createdAt: "provenance",
    source: "provenance",
    sourceEntryId: "provenance",
    fromPathAtCapture: "provenance",
    toPathAtCapture: "provenance",
    title: "provenance",
    id: "local",
    workspaceId: "local",
    createdByPrincipal: "local",
    createdByPluginId: "local",
    updatedAt: "local",
    version: "local",
  };
}

/** The same ruleset `createRedirect`/`updateRedirect` run, so preview and apply cannot drift. */
async function validateRedirectEntity(
  { ports, workspaceId, entity, existing }: Parameters<RedirectRepoPublishConfig["validate"]>[0],
  _optional = {},
): Promise<string | null> {
  return parseRedirectNaturalKey({ key: entity.id })
    ? checkRedirectFieldsWouldWrite({ deps: ports, fields: redirectFields({ workspaceId, state: entity.state }) }, existing ? { excludeId: existing.id } : {})
    : malformedKey({ entityType: "redirect", id: entity.id, expectedShape: "matchType:fromPattern" });
}

/** Creates or updates through the redirects chokepoint; the row id is the report's `changeSetId`. */
async function applyRedirectEntity(
  { ports, workspaceId, id, state, existing, principalId }: Parameters<RedirectRepoPublishConfig["write"]>[0],
  _optional = {},
): Promise<{ changeSetId: string }> {
  if (!parseRedirectNaturalKey({ key: id })) throw new Error(`publish-content: redirect.apply() received a malformed natural key '${id}'`);
  const fields = { ...redirectFields({ workspaceId, state }), actorId: principalId };
  const { record } = existing
    ? await updateRedirect({
        deps: ports,
        input: { ...fields, id: existing.id, status: (state.status as RedirectStatus | undefined) ?? "active" },
      })
    : await createRedirect({ deps: ports, input: fields, source: "import" });
  return { changeSetId: record.id };
}

/**
 * Called from a host composition root (its publish-content manifest).
 * @param required.createRepoPublishHandler The host's repo-backed publish-handler factory.
 * @param required.redirectsTable The host's physical `redirects` table name (the coverage claim).
 * @complexity O(1) to build.
 * @example contributeRedirectPublish({ createRepoPublishHandler, redirectsTable: "redirects" })
 */
export function contributeRedirectPublish<TContributor>(
  { createRepoPublishHandler, redirectsTable }: { createRepoPublishHandler: CreateRedirectRepoPublishHandler<TContributor>; redirectsTable: string },
  _optional: Record<string, never> = {},
): TContributor {
  return createRepoPublishHandler({
    entityType: "redirect",
    coversTables: [redirectsTable],
    permission: "admin.redirects.manage",
    ports: ({ deps }, _optional = {}) => deps.ports.redirect,
    list: async ({ ports: p, workspaceId }) => (await p.repo.list({ workspaceId })).map(withTitle),
    find: ({ ports: p, workspaceId, id }) => findByNaturalKey({ repo: p.repo, workspaceId, id }),
    idOf: ({ row }, _optional = {}) => redirectNaturalKey({ matchType: row.matchType, fromPattern: row.fromPattern }),
    include: ({ row }, _optional = {}) => row.status === "active",
    fields: redirectPublishFields(),
    validate: validateRedirectEntity,
    write: applyRedirectEntity,
    errors: { blocked: [RedirectValidationError, RedirectTargetNotAllowedError, RedirectLoopError, RedirectConflictError] },
  });
}
