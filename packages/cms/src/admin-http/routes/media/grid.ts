import { Buffer } from "node:buffer";

import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";
import type { MediaGridOrder, MediaGridPage, MediaGridTab } from "@jini-ai/core/contracts/site/cms-admin-media";

import type { MediaRecord } from "../../../media/types.js";
import { toAdminMediaListResponse } from "../../http/media.js";
import { daysRemaining } from "../../../core/days-remaining.js";
import { authorizeMedia, type MediaRoutePrincipal } from "./shared.js";

/**
 * @file The bounded media grid route: one page of a tab in a stable order, or one exact asset, with
 * workspace-wide counts. The host owns the storage query (filters before its `limit + 1` read) and the
 * per-row enrichment lookups; this spec owns the request bounds, the cursor and the page trimming.
 */

/** A position in one grid order: the last returned row's sort value (created time or title) and id. */
export interface MediaGridPosition { sortValue: string; id: string }

/** Workspace-wide facts the grid answers beside every page, counted over all matching rows. */
export interface MediaGridSummary { counts: Record<MediaGridTab, number>; hasUntypedActive: boolean }

/** The batch lookups that turn stored rows into admin DTOs, keyed exactly as `toAdminMediaListResponse` reads them. */
export interface MediaGridEnrichment {
  contentTypesBySha256: ReadonlyMap<string, string>;
  publicUrlsById: ReadonlyMap<string, string | null>;
  byteSizesBySha256: ReadonlyMap<string, number | null>;
}

/** The trusted workspace, the bounded page and exact lookups, and the DTO enrichment the host binds. */
export interface MediaGridRouteDeps {
  workspaceId: string;
  clock: { nowIso(): string };
  retentionDays: number;
  readTrashDeadlines: (required: { workspaceId: string; ids: readonly string[] }, _optional?: Record<string, never>) => Promise<ReadonlyMap<string, string>>;
  /** Up to `limit + 1` rows after `after` in the tab and order; the extra row only says another page follows. */
  readPage: (
    required: { workspaceId: string; tab: MediaGridTab; orderBy: MediaGridOrder; limit: number },
    optional?: { after?: MediaGridPosition },
  ) => Promise<MediaGridSummary & { rows: readonly MediaRecord[] }>;
  /** The one asset with this id in the tab, or `null`; never a page scan. */
  findItem: (required: { workspaceId: string; tab: MediaGridTab; id: string }) => Promise<MediaGridSummary & { row: MediaRecord | null }>;
  enrichMedia: (required: { workspaceId: string; media: readonly MediaRecord[] }) => Promise<MediaGridEnrichment>;
}

/** A decoded cursor: the view it was issued for plus the position after its page. */
export interface MediaGridCursor extends MediaGridPosition { workspaceId: string; tab: MediaGridTab; orderBy: MediaGridOrder }

/** The validated query: a page request (optionally after a cursor) or an exact lookup. */
export interface MediaGridInput { tab: MediaGridTab; orderBy: MediaGridOrder; limit: number; cursor?: MediaGridCursor; itemId?: string }

/** The route input: the validated query plus the `:workspaceId` the caller addressed. */
export interface MediaGridRouteInput extends MediaGridInput { workspaceId: string }

const TABS: readonly MediaGridTab[] = ["all", "images", "videos", "trash"];
const ORDERS: readonly MediaGridOrder[] = ["created", "alphabetical"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 1024;
const CURSOR_VERSION = 1;

/** One query value as a single string; repeated or non-string values are `undefined`. @complexity O(1). */
function single({ value }: { value: unknown }, _optional: Record<string, never> = {}): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A member of `allowed`, or a plain 400 with `error`. @complexity O(k) in the small allowed list. */
function oneOf<T extends string>({ value, allowed, error }: { value: unknown; allowed: readonly T[]; error: string }, _optional: Record<string, never> = {}): T {
  const text = single({ value });
  const match = allowed.find((candidate) => candidate === text);
  return match ?? rejectRoute({ status: 400, error });
}

/** The page size: absent is the default, out-of-range whole numbers are clamped to 1..100. @complexity O(1). */
function readLimit({ value }: { value: unknown }, _optional: Record<string, never> = {}): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const text = single({ value });
  if (text === undefined || !/^\d{1,6}$/.test(text)) return rejectRoute({ status: 400, error: "limit must be a whole number" });
  return Math.min(MAX_LIMIT, Math.max(1, Number(text)));
}

/** Encodes a cursor as opaque base64url JSON. @complexity O(1) in the bounded fields. */
function encodeCursor({ cursor }: { cursor: MediaGridCursor }, _optional: Record<string, never> = {}): string {
  const { workspaceId, tab, orderBy, sortValue, id } = cursor;
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, w: workspaceId, t: tab, o: orderBy, s: sortValue, i: id }), "utf8").toString("base64url");
}

/** True when the decoded JSON has exactly the cursor's field types. @complexity O(1). */
function isCursorShape(value: unknown): value is { v: number; w: string; t: MediaGridTab; o: MediaGridOrder; s: string; i: string } {
  if (typeof value !== "object" || value === null) return false;
  const shape = value as Record<string, unknown>;
  return shape.v === CURSOR_VERSION && typeof shape.w === "string" && TABS.includes(shape.t as MediaGridTab)
    && ORDERS.includes(shape.o as MediaGridOrder) && typeof shape.s === "string" && typeof shape.i === "string" && shape.i !== "";
}

/** Decodes a cursor, or a plain 400 that never echoes the submitted text. @complexity O(n) in the bounded cursor length. */
function decodeCursor({ text }: { text: string }, _optional: Record<string, never> = {}): MediaGridCursor {
  const refuse = (): never => rejectRoute({ status: 400, error: "the cursor is not valid" });
  if (text.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text)) return refuse();
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return refuse();
  }
  if (!isCursorShape(decoded)) return refuse();
  return { workspaceId: decoded.w, tab: decoded.t, orderBy: decoded.o, sortValue: decoded.s, id: decoded.i };
}

/** The optional cursor/itemId pair: an exact lookup is its own mode and takes no cursor. @complexity O(n) in the cursor length. */
function readMode({ query }: { query: Record<string, unknown> }, _optional: Record<string, never> = {}): Pick<MediaGridInput, "cursor" | "itemId"> {
  const cursorText = query.cursor === undefined ? undefined : single({ value: query.cursor }) ?? "";
  const cursor = cursorText === undefined ? undefined : decodeCursor({ text: cursorText });
  if (query.itemId === undefined) return cursor ? { cursor } : {};
  const itemId = single({ value: query.itemId }) ?? "";
  if (itemId === "") return rejectRoute({ status: 400, error: "itemId must not be empty" });
  if (cursor) return rejectRoute({ status: 400, error: "itemId cannot be combined with a cursor" });
  return { itemId };
}

/**
 * Validates the grid query: tab, order, a page size bounded to 1..100 (default 50), and either a
 * decoded cursor or an exact `itemId`. Anything malformed is a plain 400 before any storage call.
 * @complexity O(n) in the bounded cursor length.
 */
export function parseMediaGridInput({ query }: { query: Record<string, unknown> }, _optional: Record<string, never> = {}): MediaGridInput {
  const tab = oneOf({ value: query.tab, allowed: TABS, error: "tab must be all, images, videos or trash" });
  const orderBy = oneOf({ value: query.orderBy, allowed: ORDERS, error: "orderBy must be created or alphabetical" });
  return { tab, orderBy, limit: readLimit({ value: query.limit }), ...readMode({ query }) };
}

/** The value a row sorts by in `orderBy`; the host derives its comparison key from it. @complexity O(1). */
function sortValueOf({ row, orderBy }: { row: MediaRecord; orderBy: MediaGridOrder }, _optional: Record<string, never> = {}): string {
  return orderBy === "created" ? row.createdAt : row.title;
}

/** Enriches exactly `rows` and answers them as admin DTOs. @complexity O(n) in `rows.length` plus the host lookups. */
async function describeRows({ deps, rows }: { deps: MediaGridRouteDeps; rows: MediaRecord[] }, _optional: Record<string, never> = {}): Promise<MediaGridPage["media"]> {
  const enrichment = await deps.enrichMedia({ workspaceId: deps.workspaceId, media: rows });
  return toAdminMediaListResponse({ media: rows, ...enrichment }).media;
}

/** One page after the (already scope-checked) cursor, trimmed to `limit` before enrichment. @complexity O(limit). */
async function readGridPage({ deps, input }: { deps: MediaGridRouteDeps; input: MediaGridInput }, _optional: Record<string, never> = {}): Promise<MediaGridPage> {
  const { tab, orderBy, limit, cursor } = input;
  const required = { workspaceId: deps.workspaceId, tab, orderBy, limit };
  const result = await (cursor ? deps.readPage(required, { after: { sortValue: cursor.sortValue, id: cursor.id } }) : deps.readPage(required));
  // The lookahead row only proves another page exists; it is never enriched or answered.
  const rows = result.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  const nextCursor = result.rows.length > limit && last
    ? encodeCursor({ cursor: { workspaceId: deps.workspaceId, tab, orderBy, sortValue: sortValueOf({ row: last, orderBy }), id: last.id } })
    : null;
  return { media: await describeRows({ deps, rows }), nextCursor, counts: result.counts, hasUntypedActive: result.hasUntypedActive };
}

/** The one exact asset in the tab, or a plain 404; no cursor and no page scan. @complexity O(1) plus the host lookups. */
async function readGridItem({ deps, input, itemId }: { deps: MediaGridRouteDeps; input: MediaGridInput; itemId: string }, _optional: Record<string, never> = {}): Promise<MediaGridPage> {
  const result = await deps.findItem({ workspaceId: deps.workspaceId, tab: input.tab, id: itemId });
  if (!result.row) return rejectRoute({ status: 404, error: "media was not found" });
  return { media: await describeRows({ deps, rows: [result.row] }), nextCursor: null, counts: result.counts, hasUntypedActive: result.hasUntypedActive };
}

/** Refuses a cursor issued for another workspace, tab or order. @complexity O(1). */
function assertCursorScope({ deps, input }: { deps: MediaGridRouteDeps; input: MediaGridInput }, _optional: Record<string, never> = {}): void {
  const { cursor } = input;
  // A cursor is a position, never authorization, and it must survive deletion of the row that supplied it.
  if (cursor && (cursor.workspaceId !== deps.workspaceId || cursor.tab !== input.tab || cursor.orderBy !== input.orderBy)) {
    rejectRoute({ status: 400, error: "the cursor does not belong to this media view" });
  }
}

/**
 * GET one bounded page of the media grid, or one exact asset by `itemId`. Like the media list, the
 * addressed workspace must be the host's trusted one (404 otherwise) and `media.read` is asked before
 * anything is read; the cursor's view is checked before storage. Counts span every matching row.
 */
export const mediaGridRoute = defineJsonRoute<MediaGridRouteInput, MediaGridPage, MediaGridRouteDeps, MediaRoutePrincipal>({
  method: "get",
  path: "/api/admin/v1/workspaces/:workspaceId/media/grid",
  parse: (raw) => ok({ value: { workspaceId: String(raw.params.workspaceId ?? ""), ...parseMediaGridInput({ query: raw.query }) } }),
  handle: async ({ input, deps, authorize }) => {
    if (input.workspaceId !== deps.workspaceId) return rejectRoute({ status: 404, error: "workspace was not found" });
    await authorizeMedia({ authorize, permission: "media.read" });
    assertCursorScope({ deps, input });
    const page = input.itemId === undefined ? await readGridPage({ deps, input }) : await readGridItem({ deps, input, itemId: input.itemId });
    if (input.tab !== "trash") return ok({ value: page });
    const deadlines = await deps.readTrashDeadlines({ workspaceId: deps.workspaceId, ids: page.media.map(row => row.id) });
    const now = deps.clock.nowIso();
    return ok({ value: {
      ...page,
      retentionDays: deps.retentionDays,
      media: page.media.map(row => {
        const until = deadlines.get(row.id);
        return until === undefined ? row : { ...row, trashDaysRemaining: daysRemaining({ now, until }) };
      }),
    } });
  },
});
