/**
 * @file The one mail activity operation behind a host's list/get tools and admin routes: input
 * parsing, the two-tier access rule, masking, opaque ids and cursors over a {@link MailActivityRepo}.
 *
 * Access: the activity-read permission sees full recipients, ids and message ids; a holder of only
 * the status permission sees the same outcomes with masked recipients and no id, so they can read
 * the health of sending without learning who was mailed. A recipient filter is a lookup by address,
 * so it needs full access too. Neither tier ever sees a body, subject or sign-in link: the ledger
 * stores none. The permission ids are the host's ({@link MailPermissionIds}); nothing here names one.
 *
 * Cursors carry only a timestamp and a skip count, never a key or an address, so a masked page's
 * cursor discloses nothing its rows did not.
 */
import { ToolInputError } from "@jini-ai/core";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { MailActivityFilter, MailActivityPosition, MailActivityRecord, MailActivityRepo, MailFeedbackRecord } from "./ports.js";
import { MAIL_ACTIVITY_OUTCOMES, MAIL_ACTIVITY_USES } from "./vocabulary.js";

export const DEFAULT_MAIL_ACTIVITY_LIMIT = 25;
export const MAX_MAIL_ACTIVITY_LIMIT = 100;

export type MailActivityAccess = "full" | "masked";

/** The ids the host grants the three roles of the mail operations; the operations never spell one. */
export interface MailPermissionIds {
  /** Full recipient details of the send history, and reading the suppression list. */
  activityRead: string;
  /** The host's status permission: the masked tier of the history. */
  status: string;
  /** Removing an address from the do-not-send list (a holder must also be the owner). */
  suppressionsManage: string;
}

export interface MailActivityDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  permissions: MailPermissionIds;
  /** Absent in hermetic roots: every read refuses with {@link MailActivityUnavailableError}. */
  mailActivity?: MailActivityRepo;
}

export interface MailActivityQuery {
  limit: number;
  before?: MailActivityPosition;
  filter: MailActivityFilter;
}

export interface MailActivityItem {
  /** Opaque; present only with full access. Pass it back to read one send (see {@link readMailActivityId}). */
  id?: string;
  recipient: string;
  originalRecipient?: string;
  deliveryMode?: "redirect" | "capture";
  use: MailActivityRecord["use"];
  outcome: MailActivityRecord["outcome"];
  lane: MailActivityRecord["lane"];
  providerId: string;
  providerMessageId?: string | null;
  errorCode: string | null;
  /** Full access only: provider diagnostics can contain recipient addresses. */
  message?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailActivityPage {
  access: MailActivityAccess;
  items: MailActivityItem[];
  nextCursor: string | null;
  /** First page with no rows: nothing was ever recorded, or nothing matches the filters. */
  empty: "none_recorded" | "no_matches" | null;
}

/** The permission refusal both adapters translate (403 / the model-facing forbidden rule). */
export class MailActivityForbiddenError extends Error {
  readonly permission: string;
  constructor(required: { permission: string; message: string }) {
    super(required.message);
    this.name = "MailActivityForbiddenError";
    this.permission = required.permission;
  }
}

export class MailActivityUnavailableError extends Error {
  constructor() {
    super("Email activity is unavailable on this server.");
    this.name = "MailActivityUnavailableError";
  }
}

const encode = ({ value }: { value: unknown }, _optional = {}): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
function decode({ value }: { value: string }, _options: Record<string, never> = {}): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

/** `a***@example.com`: enough to tell two addresses apart at a glance, not to recover one. */
export function maskRecipient({ address }: { address: string }, _options: Record<string, never> = {}): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

function oneOf<T extends string>(required: { value: unknown; allowed: readonly T[]; field: string }, _options: Record<string, never> = {}): T | undefined {
  if (required.value === undefined || required.value === "") return undefined;
  if (typeof required.value === "string" && (required.allowed as readonly string[]).includes(required.value)) return required.value as T;
  throw new ToolInputError({ message: `${required.field} must be one of ${required.allowed.join(", ")}.` });
}

/** A page size from a tool argument or a query string; shared with the suppression list. */
export function readMailPageLimit({ value }: { value: unknown }, _options = {}): number {
  if (value === undefined || value === "") return DEFAULT_MAIL_ACTIVITY_LIMIT;
  const limit = typeof value === "string" ? Number(value) : value;
  if (typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= MAX_MAIL_ACTIVITY_LIMIT) return limit;
  throw new ToolInputError({ message: `limit must be a whole number from 1 to ${MAX_MAIL_ACTIVITY_LIMIT}.` });
}

/** A keyset position from a `nextCursor` this server returned; shared with the suppression list. */
export function readMailCursor({ value }: { value: unknown }, _options = {}): MailActivityPosition | undefined {
  if (value === undefined || value === "") return undefined;
  const decoded = typeof value === "string" ? (decode({ value: value }) as { c?: unknown; k?: unknown } | undefined) : undefined;
  if (decoded && typeof decoded.c === "string" && typeof decoded.k === "string" && decoded.k.length > 0) return { createdAt: decoded.c, key: decoded.k };
  throw new ToolInputError({ message: "cursor is not a nextCursor this server returned." });
}

function readRecipient({ value }: { value: unknown }, _options: Record<string, never> = {}): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "string" && value.length <= 254 && value.includes("@")) return value.trim().toLowerCase();
  throw new ToolInputError({ message: "recipient must be one email address." });
}

/**
 * Parses list input from a tool's arguments or a route's query string (same field names).
 * @throws {ToolInputError} For any malformed field; nothing is read.
 */
export function readMailActivityQuery({ input }: { input: Record<string, unknown> }, _options: Record<string, never> = {}): MailActivityQuery {
  const outcome = oneOf({ value: input.outcome, allowed: MAIL_ACTIVITY_OUTCOMES, field: "outcome" });
  const use = oneOf({ value: input.use, allowed: MAIL_ACTIVITY_USES, field: "use" });
  const recipient = readRecipient({ value: input.recipient });
  const before = readMailCursor({ value: input.cursor });
  return {
    limit: readMailPageLimit({ value: input.limit }),
    ...(before ? { before } : {}),
    filter: { ...(outcome ? { outcome } : {}), ...(use ? { use } : {}), ...(recipient ? { recipient } : {}) },
  };
}

/**
 * Full with the activity-read permission, masked with only the status permission, else refused.
 * @throws {MailActivityForbiddenError} Holding neither (or, with `requireFull`, lacking the first).
 */
export async function resolveMailActivityAccess(
  required: { deps: Pick<MailActivityDeps, "authorize" | "workspaceId" | "permissions">; principalId: string },
  optional: { requireFull?: boolean } = {},
): Promise<MailActivityAccess> {
  const ask = ({ permission }: { permission: string }, _optional = {}) => required.deps.authorize({ principalId: required.principalId, permission, workspaceId: required.deps.workspaceId, entityType: "mail" });
  const { activityRead, status } = required.deps.permissions;
  if ((await ask({ permission: activityRead })).allowed) return "full";
  if (!optional.requireFull && (await ask({ permission: status })).allowed) return "masked";
  const permission = optional.requireFull ? activityRead : `${activityRead} or ${status}`;
  throw new MailActivityForbiddenError({ permission, message: `principal '${required.principalId}' is not authorized for '${permission}'` });
}

function toItem({ record, access }: { record: MailActivityRecord; access: MailActivityAccess }, _options = {}): MailActivityItem {
  const base = { use: record.use, outcome: record.outcome, lane: record.lane, providerId: record.providerId, errorCode: record.errorCode, createdAt: record.createdAt, updatedAt: record.updatedAt };
  if (access === "masked") return { recipient: maskRecipient({ address: record.recipient }), ...base };
  return { id: encode({ value: [record.idempotencyKey, record.recipient] }), recipient: record.recipient, ...(record.deliveryMode ? { deliveryMode: record.deliveryMode, originalRecipient: record.originalRecipient } : {}), providerMessageId: record.providerMessageId, message: record.message, ...base };
}

/** The next page's opaque cursor: the page's last timestamp, skipping every row already shown at it.
 *  Shared with the suppression list, whose rows page the same way. */
export function nextMailCursor({ page }: { page: readonly { createdAt: string; cursorKey?: string; revision?: string }[] }, _options = {}): string {
  const last = page.at(-1);
  if (last === undefined) throw new Error('Mail activity page has no last row for its cursor');
  return encode({ value: { c: last.createdAt, k: last.cursorKey ?? last.revision } });
}

function repo(deps: MailActivityDeps, _options: Record<string, never> = {}): MailActivityRepo {
  if (!deps.mailActivity) throw new MailActivityUnavailableError();
  return deps.mailActivity;
}

/**
 * One page, newest first. Reads `limit + 1` rows to know whether a next page exists.
 * @throws {MailActivityForbiddenError} Without access, or a recipient filter without full access.
 * @complexity One ledger page read.
 * @example listMailActivity({ principalId, query: readMailActivityQuery({ input: {} }) }, deps)
 */
export async function listMailActivity(required: { principalId: string; query: MailActivityQuery ; deps: MailActivityDeps }, _options: Record<string, never> = {}): Promise<MailActivityPage> {
  const { deps } = required;
  const { query } = required;
  const access = await resolveMailActivityAccess({ deps, principalId: required.principalId }, { requireFull: query.filter.recipient !== undefined });
  const rows = await repo(deps).list({ workspaceId: deps.workspaceId, limit: query.limit + 1 }, { ...query.filter, ...(query.before ? { before: query.before } : {}) });
  const page = rows.slice(0, query.limit);
  const filtered = Object.keys(query.filter).length > 0;
  const emptyReason = filtered ? "no_matches" : "none_recorded";
  return {
    access,
    items: page.map((row) => toItem({ record: row, access })),
    nextCursor: rows.length > query.limit ? nextMailCursor({ page }) : null,
    empty: page.length > 0 || query.before ? null : emptyReason,
  };
}

/** The id encodes exactly `[idempotencyKey, recipient]`; any other shape is not one of ours. */
function isStringPair(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "string");
}

/** Parses an activity id from a listed item. @throws {ToolInputError} When it is not one. */
export function readMailActivityId({ value }: { value: unknown }, _options: Record<string, never> = {}): { idempotencyKey: string; recipient: string } {
  const decoded = typeof value === "string" && value !== "" ? decode({ value: value }) : undefined;
  if (isStringPair(decoded)) return { idempotencyKey: decoded[0], recipient: decoded[1] };
  throw new ToolInputError({ message: "activityId must be an id from mail_list_activity." });
}

export interface MailActivityDetail {
  activity: MailActivityItem;
  /** Provider feedback for this message, oldest first; empty means none received yet, not delivered. */
  feedback: MailFeedbackRecord[];
}

/**
 * One send with its feedback timeline. Full access only.
 * @returns `null` when no such send exists in this workspace.
 * @complexity One ledger row and one feedback read.
 */
export async function getMailActivity(required: { principalId: string; activityId: { idempotencyKey: string; recipient: string } ; deps: MailActivityDeps }, _options: Record<string, never> = {}): Promise<MailActivityDetail | null> {
  const { deps } = required;
  await resolveMailActivityAccess({ deps, principalId: required.principalId }, { requireFull: true });
  const found = await repo(deps).get({ workspaceId: deps.workspaceId, ...required.activityId });
  return found ? { activity: toItem({ record: found.record, access: "full" }), feedback: found.feedback } : null;
}
