/**
 * @file `ADS-memory/.local-artifacts/publish-criteria-tool-webmcp-plan-2026-09-24.md` §2/§4 S1 — the
 * one contract shared by the dialog, the chat capability (S3) and the WebMCP projection (S5). A
 * `PublishCriteria` names what to publish and whether to overwrite; `applyPublishCriteria` turns that
 * into the same `deselectedKeys`/`overwriteKeys` shape `use-publish-content-confirm.hooks.ts` already
 * threads through a re-plan (`setDeselectedKeys`, `applyOverwriteKeys`). Criteria only ever set the
 * *initial* value of state the dialog already owns — no new selection mechanism is added, and no call
 * here can ever write anything (see plan §3: the executor built on this may only open the dialog).
 */
import type { PublishReportRow } from "./report-rows.js";

/**
 * What the assistant (chat, or a WebMCP caller) names when it asks to publish something. Every field
 * narrows an "everything" default — omitting a field, or giving it an empty array, means "don't
 * filter by this."
 */
export interface PublishCriteria {
  /** Entity types to publish, e.g. `["page","menu"]`. Omitted/empty = every type. `"pages"`/`"posts"`
   *  plurals and `"nav"`/`"navigation"` (→ `"menu"`) are accepted. */
  readonly types?: readonly string[];
  /** Specific things: a title (case-insensitive exact), an id, or a `"type:id"` key. Omitted/empty =
   *  all. */
  readonly items?: readonly string[];
  /** Tick "Overwrite on live" for every offered row that matches `types`/`items`. Default `false`. */
  readonly overwrite?: boolean;
}

/** What a `PublishCriteria` resolves to against one plan's rows. */
export interface CriteriaSelection {
  /** Selectable rows that do NOT match the criteria — the dialog's initial unchecked set. */
  readonly deselectedKeys: ReadonlySet<string>;
  /** Overwritable rows that match the criteria, populated only when `criteria.overwrite` is `true`. */
  readonly overwriteKeys: ReadonlySet<string>;
  /** `items` entries that named nothing in this plan. */
  readonly unmatchedItems: readonly string[];
  /** `types` entries no row in this plan has, after alias normalisation. */
  readonly unknownTypes: readonly string[];
}

/** @complexity O(1). */
function normalizeType({ type, typeAliases }: { type: string; typeAliases: Readonly<Record<string, string>> }, _optional = {}): string {
  const lower = type.trim().toLowerCase();
  return typeAliases[lower] ?? lower;
}

/**
 * Whether one `items` entry names this row — by label (case-insensitive), by id, or by the row's own
 * `"type:id"` key, the three forms plan §2 documents.
 *
 * @complexity O(1).
 */
function matchesItem({ row, item }: { row: PublishReportRow; item: string }, _optional = {}): boolean {
  const trimmed = item.trim();
  if (trimmed.length === 0) return false;
  if (row.names?.some(name => name.toLowerCase() === trimmed.toLowerCase())) return true;
  if (row.entityLabel.toLowerCase() === trimmed.toLowerCase()) return true;
  if (row.entityId === trimmed) return true;
  if (row.key === trimmed) return true;
  return false;
}

/**
 * Turns a `PublishCriteria` into the dialog's selection state against one plan's rows.
 *
 * `types` and `items` combine with AND, not OR: each one that is given narrows the "everything"
 * default further, so `{types:["page"], items:["About"]}` means the page named About, not every page
 * plus anything else named About. Neither field narrows the other when it is itself omitted or empty.
 *
 * @complexity O(rows × items) — an `items` list is a handful of named things per request, so this
 * stays well under a millisecond for any plan size the dialog renders.
 */
export function applyPublishCriteria({ rows, criteria, typeAliases }: { rows: readonly PublishReportRow[]; criteria: PublishCriteria & { readonly excludeItems?: readonly string[] }; typeAliases: Readonly<Record<string, string>> }, _optional: Record<string, never> = {}): CriteriaSelection {
  const types = criteria.types ?? [];
  const items = criteria.items ?? [];
  const normalizedTypes = new Set(types.map((type) => normalizeType({ type, typeAliases })));
  const hasTypes = normalizedTypes.size > 0;
  const hasItems = items.length > 0;

  const matches = (row: PublishReportRow): boolean => {
    const typeOk = !hasTypes || normalizedTypes.has(row.entityType);
    const itemOk = !hasItems || items.some((item) => matchesItem({ row, item }));
    return typeOk && itemOk && !(criteria.excludeItems ?? []).some(item => matchesItem({ row, item }));
  };

  const deselectedKeys = new Set<string>();
  const overwriteKeys = new Set<string>();
  for (const row of rows) {
    const isMatch = matches(row);
    if (row.selectable && !isMatch) deselectedKeys.add(row.key);
    if (criteria.overwrite === true && row.overwritable && isMatch) overwriteKeys.add(row.key);
  }

  const unmatchedItems = items.filter((item) => !rows.some((row) => matchesItem({ row, item })));
  const unknownTypes = types.filter((type) => !rows.some((row) => row.entityType === normalizeType({ type, typeAliases })));

  return { deselectedKeys, overwriteKeys, unmatchedItems, unknownTypes };
}

/**
 * Turns whatever a tool call actually sent for `admin.publish_content` into a `PublishCriteria`,
 * rejecting a malformed field by name instead of silently dropping or coercing it.
 *
 * This is stricter, on purpose, than {@link decodePublishCriteriaFromQuery}: that decoder serves a
 * URL a person may have hand-edited or an older build may have produced, where the best answer to
 * garbage is "ignore it and open the dialog with nothing pre-filled" (see its own doc). A tool call
 * has no such excuse — nothing upstream of this validates `ctx.input` against
 * the host capability's `inputSchema` for the relayed chat path (`@jini-ai/daemon`'s
 * `frontend-capability-tools.ts` only checks the input is a plain object, never its shape; only the
 * WebMCP path in `toWebMcpTool` validates against the schema itself). A caller sending
 * `types: "page"` instead of `types: ["page"]` almost certainly meant something specific, and a
 * plan that silently ignored the typo would publish a different, unintended set of rows.
 *
 * @param input - The raw tool-call arguments, already confirmed to be a plain object by the caller
 * (`frontend-capability-tools.ts`'s `toCapabilityInput`, or an MCP host's own JSON parse).
 * @throws {Error} `"admin.publish_content: '<field>' must be an array of strings"` for a `types`/
 * `items` that is present but not a string array, or `"admin.publish_content: 'overwrite' must be a
 * boolean"` for a non-boolean `overwrite`. Each field is checked independently so the message names
 * the one that is actually wrong.
 * @complexity O(n) in the input's own `types`/`items` length.
 */
export function parsePublishContentToolInput({ input, capabilityId }: { input: Record<string, unknown>; capabilityId: string }, _optional: Record<string, never> = {}): PublishCriteria {
  const criteria: { types?: readonly string[]; items?: readonly string[]; overwrite?: boolean } = {};
  const types = readOptionalStringArray({ input, field: "types", capabilityId });
  if (types !== undefined) criteria.types = types;
  const items = readOptionalStringArray({ input, field: "items", capabilityId });
  if (items !== undefined) criteria.items = items;
  const overwrite = readOptionalBoolean({ input, field: "overwrite", capabilityId });
  if (overwrite !== undefined) criteria.overwrite = overwrite;
  return criteria;
}

/** One `types`/`items` field off a raw tool-call input — `undefined` when the field is absent
 *  (criteria's own "omitted means everything" convention), thrown by name when present but not an
 *  array of strings. @complexity O(n) in the array's own length. */
function readOptionalStringArray({ input, field, capabilityId }: { input: Record<string, unknown>; field: "types" | "items"; capabilityId: string }, _optional = {}): readonly string[] | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`${capabilityId}: '${field}' must be an array of strings`);
  }
  return value;
}

/** `overwrite` off a raw tool-call input — `undefined` when absent, thrown by name when present but
 *  not a boolean. @complexity O(1). */
function readOptionalBoolean({ input, field, capabilityId }: { input: Record<string, unknown>; field: "overwrite"; capabilityId: string }, _optional = {}): boolean | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${capabilityId}: '${field}' must be a boolean`);
  }
  return value;
}

/**
 * What the tool returns to the model after `requestPublish` resolves (plan §2). `nextStep` is always
 * the same sentence — "Check the list in the Publish dialog, then click Publish." — because the model
 * has exactly one next move regardless of what it asked for: it cannot act further itself.
 */
export interface PublishRequestResult {
  readonly opened: boolean;
  readonly planned: boolean;
  readonly site: string | null;
  readonly willPublish: readonly string[];
  readonly willOverwrite: readonly string[];
  readonly leftAlone: readonly { label: string; reason: string }[];
  readonly unmatchedItems: readonly string[];
  readonly unknownTypes: readonly string[];
  readonly nextStep: string;
}

/** The caps {@link decodePublishCriteriaFromQuery} applies to a hostile query value — host policy,
 *  injected (K5). See the host's own comments for how each number was chosen. */
export interface PublishCriteriaLimits {
  /** Cap on the raw (still-encoded) query value's own length. */
  readonly maxQueryLength: number;
  /** Cap on `types`/`items` array length once decoded. */
  readonly maxListLength: number;
  /** Cap on one `types`/`items` entry's own length. */
  readonly maxEntryLength: number;
}

/**
 * Encodes a `PublishCriteria` as the value of the `publish` query param. Plain JSON,
 * `encodeURIComponent`-escaped — readable in the address bar, no extra dependency, and exactly
 * reversible by {@link decodePublishCriteriaFromQuery}. Fields that mean "everything"/`false` (an
 * omitted or empty `types`/`items`, `overwrite: false`) are left out of the payload entirely rather
 * than encoded as their empty/false form, so a round trip never grows a link past what the caller
 * actually named.
 *
 * @complexity O(n) in the criteria's own `types`/`items` length.
 */
export function encodePublishCriteriaToQuery(criteria: PublishCriteria): string {
  const payload: { types?: readonly string[]; items?: readonly string[]; overwrite?: true } = {};
  if (criteria.types && criteria.types.length > 0) payload.types = criteria.types;
  if (criteria.items && criteria.items.length > 0) payload.items = criteria.items;
  if (criteria.overwrite === true) payload.overwrite = true;
  return encodeURIComponent(JSON.stringify(payload));
}

/**
 * The other half of {@link encodePublishCriteriaToQuery} — and the one that has to survive a hostile
 * or malformed `publish` value, since anything that can build a URL can build this string. Never
 * throws: `null` covers every shape of bad input (not JSON, not an object, an array, a primitive, or
 * anything past the caps below) the same way, because none of them earn the caller a more specific
 * complaint than "ignore this and open the dialog with nothing pre-filled."
 *
 * Unknown fields are dropped by construction rather than rejected — only `types`/`items`/`overwrite`
 * are ever read off the parsed object, so a payload from a newer or older build that carries an extra
 * field decodes as whatever of these three it also carries, not as `null`. A bad ENTRY inside
 * `types`/`items` (wrong type, empty, oversized) is dropped the same way, one at a time, rather than
 * failing the whole list — see {@link sanitizeCriteriaList}.
 *
 * @complexity O(n) in the decoded payload's own `types`/`items` length.
 */
export function decodePublishCriteriaFromQuery({ raw, limits }: { raw: string; limits: PublishCriteriaLimits }, _optional = {}): PublishCriteria | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > limits.maxQueryLength) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return sanitizeCriteriaObject({ obj: parsed as Record<string, unknown>, limits });
}

/** Keeps only supported criteria fields from a decoded object, using the query's forgiving caps.
 *  @complexity O(n) in the decoded object's `types`/`items` length. */
function sanitizeCriteriaObject(
  { obj, limits }: { obj: Record<string, unknown>; limits: PublishCriteriaLimits },
  _options: Record<string, never> = {},
): PublishCriteria {
  const types = sanitizeCriteriaList({ value: obj.types, limits });
  const items = sanitizeCriteriaList({ value: obj.items, limits });
  const overwrite = obj.overwrite === true;

  const criteria: { types?: readonly string[]; items?: readonly string[]; overwrite?: boolean } = {};
  if (types) criteria.types = types;
  if (items) criteria.items = items;
  if (overwrite) criteria.overwrite = true;
  return criteria;
}

/**
 * One decoded `types`/`items` list, trimmed to `limits.maxListLength` entries of at most
 * `limits.maxEntryLength` characters each and with every non-string or empty entry dropped.
 * `undefined` for an empty result, matching `PublishCriteria`'s own "omitted means everything"
 * convention rather than encoding a now-empty array back onto the criteria.
 *
 * @complexity O(n).
 */
function sanitizeCriteriaList({ value, limits }: { value: unknown; limits: PublishCriteriaLimits }, _optional = {}): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= limits.maxEntryLength)
    .slice(0, limits.maxListLength);
  return cleaned.length > 0 ? cleaned : undefined;
}
