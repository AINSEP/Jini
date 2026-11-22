/**
 * @file The suppression operations behind a host's list/remove tools and admin routes.
 *
 * Reading the list needs the activity-read permission: it is a list of addresses, the same
 * recipient detail the activity history guards. Removal needs the suppressions-manage permission
 * AND the owner gate (holding the grant alone is not enough: `principalId` must equal the owner the
 * host passes, and an absent owner refuses everyone), a written reason that is recorded with the
 * removal, and a fresh confirmation every time, which is the host's to ask for. Removal stops the
 * do-not-send block and nothing else: it never subscribes anyone or restores newsletter consent,
 * and the plan says so before the person confirms.
 */
import { ToolInputError } from "@jini-ai/core";
import type { MailSuppressionScope } from "../ports.js";
import type { AuthorizeFn } from "@jini-ai/core/contracts/events";
import type { MailActivityPosition, MailSuppressionAdminRepo, MailSuppressionEntry, MailSuppressionReason, MailSuppressionRemoval } from "./ports.js";
import { MailActivityForbiddenError, nextMailCursor, readMailCursor, readMailPageLimit, type MailPermissionIds } from "./activity.js";

export interface MailSuppressionDeps {
  workspaceId: string;
  authorize: AuthorizeFn;
  permissions: MailPermissionIds;
  ownerPrincipalId?: Promise<string>;
  /** Absent in hermetic roots: every call refuses with {@link MailSuppressionsUnavailableError}. */
  mailSuppressionAdmin?: MailSuppressionAdminRepo;
}

export class MailSuppressionsUnavailableError extends Error {
  constructor() {
    super("The suppression list is unavailable on this server. Nothing was changed.");
    this.name = "MailSuppressionsUnavailableError";
  }
}

const SCOPES = ["all", "bulk"] as const satisfies readonly MailSuppressionScope[];
const REASONS = ["bounced", "complained", "manual"] as const satisfies readonly MailSuppressionReason[];
const MIN_REASON = 3;
const MAX_REASON = 500;

export interface MailSuppressionQuery {
  limit: number;
  before?: MailActivityPosition;
  filter: { search?: string; scope?: MailSuppressionScope; reason?: MailSuppressionReason };
}

export interface MailSuppressionPage {
  items: MailSuppressionEntry[];
  nextCursor: string | null;
  empty: "none_recorded" | "no_matches" | null;
}

function pick<T extends string>(required: { value: unknown; allowed: readonly T[]; field: string; optional: boolean }, _options: Record<string, never> = {}): T | undefined {
  if (required.optional && (required.value === undefined || required.value === "")) return undefined;
  if (typeof required.value === "string" && (required.allowed as readonly string[]).includes(required.value)) return required.value as T;
  throw new ToolInputError({ message: `${required.field} must be one of ${required.allowed.join(", ")}.` });
}

function readSearch({ value }: { value: unknown }, _options: Record<string, never> = {}): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "string" && value.trim().length <= 254) return value.trim() || undefined;
  throw new ToolInputError({ message: "search must be text of at most 254 characters." });
}

/** Parses list input from a tool's arguments or a route's query string. @throws {ToolInputError} */
export function readMailSuppressionQuery({ input }: { input: Record<string, unknown> }, _options: Record<string, never> = {}): MailSuppressionQuery {
  const scope = pick({ value: input.scope, allowed: SCOPES, field: "scope", optional: true });
  const reason = pick({ value: input.reason, allowed: REASONS, field: "reason", optional: true });
  const search = readSearch({ value: input.search });
  const before = readMailCursor({ value: input.cursor });
  return { limit: readMailPageLimit({ value: input.limit }), ...(before ? { before } : {}), filter: { ...(search ? { search } : {}), ...(scope ? { scope } : {}), ...(reason ? { reason } : {}) } };
}

async function authorizedRepo({ deps, principalId, permission }: { deps: MailSuppressionDeps; principalId: string; permission: string }, _options: Record<string, never> = {}): Promise<MailSuppressionAdminRepo> {
  const auth = await deps.authorize({ principalId, permission, workspaceId: deps.workspaceId, entityType: "mail" });
  if (!auth.allowed) throw new MailActivityForbiddenError({ permission, message: `principal '${principalId}' is not authorized for '${permission}'` });
  if (permission === deps.permissions.suppressionsManage && principalId !== await deps.ownerPrincipalId) {
    throw new MailActivityForbiddenError({ permission, message: "Only the site owner may remove a suppression." });
  }
  if (!deps.mailSuppressionAdmin) throw new MailSuppressionsUnavailableError();
  return deps.mailSuppressionAdmin;
}

/**
 * One page of blocked recipients, newest first: address, scope, reason and time.
 * @throws {MailActivityForbiddenError} Without the activity-read permission.
 * @complexity One indexed page read.
 */
export async function listMailSuppressions(required: { principalId: string; query: MailSuppressionQuery ; deps: MailSuppressionDeps }, _options: Record<string, never> = {}): Promise<MailSuppressionPage> {
  const { deps } = required;
  const { query } = required;
  const repo = await authorizedRepo({ deps: deps, principalId: required.principalId, permission: deps.permissions.activityRead });
  const rows = await repo.list({ workspaceId: deps.workspaceId, limit: query.limit + 1 }, { ...query.filter, ...(query.before ? { before: query.before } : {}) });
  const items = rows.slice(0, query.limit);
  const filtered = Object.keys(query.filter).length > 0;
  const emptyReason = filtered ? "no_matches" : "none_recorded";
  return {
    items,
    nextCursor: rows.length > query.limit ? nextMailCursor({ page: items }) : null,
    empty: items.length > 0 || query.before ? null : emptyReason,
  };
}

export interface MailSuppressionRemovalInput {
  address: string;
  scope: MailSuppressionScope;
  reason: string;
}

/** Address, scope and the required reason. @throws {ToolInputError} Nothing is changed. */
export function readMailSuppressionRemoval({ input }: { input: Record<string, unknown> }, _options: Record<string, never> = {}): MailSuppressionRemovalInput {
  const address = typeof input.address === "string" ? input.address.trim().toLowerCase() : "";
  if (!address.includes("@") || address.length > 254) throw new ToolInputError({ message: "address must be the suppressed email address. Nothing was changed." });
  const scope = pick({ value: input.scope, allowed: SCOPES, field: "scope", optional: false }) as MailSuppressionScope;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    throw new ToolInputError({ message: `reason is required: say why this address may be mailed again (${MIN_REASON}-${MAX_REASON} characters). It is recorded. Nothing was changed.` });
  }
  return { address, scope, reason };
}

export interface MailSuppressionRemovalPlan extends MailSuppressionRemovalInput {
  suppressionReason: MailSuppressionReason;
  suppressedAt: string;
  revision: string;
  /** What removal does and does not mean, shown before the person confirms. */
  warnings: string[];
}

const NO_CONSENT = "Removal only lifts the do-not-send block. It does not subscribe this address or restore newsletter consent.";
const WARNINGS: Record<MailSuppressionReason, string | undefined> = {
  bounced: "This address hard-bounced: the mailbox may not exist. Mailing it again can hurt the site's sender reputation.",
  complained: "This person marked the site's mail as spam. Mailing them again without fresh consent risks further complaints.",
  manual: undefined,
};

/**
 * Checks the permission and that the suppression exists, and describes the removal.
 * @throws {MailActivityForbiddenError} Without the suppressions-manage permission, or when the principal is not the owner.
 * @throws {ToolInputError} When the address is not suppressed in that scope.
 */
export async function planMailSuppressionRemoval(required: { principalId: string; input: MailSuppressionRemovalInput ; deps: MailSuppressionDeps }, _options: Record<string, never> = {}): Promise<MailSuppressionRemovalPlan> {
  const { deps } = required;
  const repo = await authorizedRepo({ deps: deps, principalId: required.principalId, permission: deps.permissions.suppressionsManage });
  const entry = await repo.find({ workspaceId: deps.workspaceId, address: required.input.address, scope: required.input.scope });
  if (!entry) throw new ToolInputError({ message: `${required.input.address} is not suppressed for ${required.input.scope} mail. Nothing was changed.` });
  const warning = WARNINGS[entry.reason];
  return { ...required.input, suppressionReason: entry.reason, suppressedAt: entry.createdAt, revision: entry.revision, warnings: [...(warning ? [warning] : []), NO_CONSENT] };
}

/**
 * Removes it, re-checking the permission at the moment of the write, and records the audit row.
 * @returns `removed: false` when it was already removed meanwhile.
 */
export async function runMailSuppressionRemoval(required: { principalId: string; plan: MailSuppressionRemovalPlan ; deps: MailSuppressionDeps }, _options: Record<string, never> = {}): Promise<{ removed: boolean; removal?: MailSuppressionRemoval }> {
  const { deps } = required;
  const repo = await authorizedRepo({ deps: deps, principalId: required.principalId, permission: deps.permissions.suppressionsManage });
  const { address, scope, reason } = required.plan;
  const removal = await repo.remove({ workspaceId: deps.workspaceId, address, scope, removalReason: reason, removedBy: required.principalId, revision: required.plan.revision });
  return removal ? { removed: true, removal } : { removed: false };
}
