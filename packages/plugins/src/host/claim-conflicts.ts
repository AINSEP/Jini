/**
 * @file `resolveClaimConflicts()` — product-neutral detection of two extensions claiming the same
 * named thing (a route, a tool name, a table, a setting id, a widget id, a permission id, an
 * exclusive hook).
 *
 * JINI CANDIDATE: nothing in this file knows about Tovu, its manifest, its plugins or its storage —
 * it takes owners and their claims as plain data and returns who keeps what. It belongs in
 * `@jini-ai/plugins` (or `@jini-ai/core`) beside the glue capability gates. Not moved yet because
 * Tovu's deploy build resolves `@jini-ai/*` from the published registry, so a Jini-side copy would be
 * unreachable from production until the owner publishes; moving it is a file move plus one import.
 *
 * ## The rules (also in `ADS-memory/specs/005-plugin-system/conflicts.spec.md`)
 *
 * 1. Owners are processed in PRECEDENCE order — the caller's order, first wins. Core goes first;
 *    after that the caller decides (Tovu: earliest-enabled first, so the NEWER plugin is the one
 *    refused — the plugin that was already working keeps working).
 * 2. A claim is `exclusive` (only one owner may hold it) or `shared` (any number of owners may hold
 *    it together — a filter pipeline hook where every filter runs in a fixed order is the example).
 *    An exclusive claim conflicts with ANY other owner's claim on the same slot, shared or not; two
 *    shared claims never conflict.
 * 3. A REFUSED owner contributes nothing: if A holds `x`, B is refused for `x`, and C claims B's
 *    other key `y`, C is accepted. Refusal is all-or-nothing per owner — half a plugin is not a
 *    state anyone can reason about, so an owner with any conflict keeps none of its claims.
 * 4. One owner claiming the same slot twice is not a conflict (a manifest repeating itself is a
 *    validation concern, not a collision between two parties).
 * 5. Keys are compared after the kind's normalization (see {@link DEFAULT_CLAIM_KIND_RULES}):
 *    identifiers are case-insensitive; a route is `METHOD /path` with parameter names erased
 *    (`/a/:id` and `/a/{slug}` are the same route) and `*`/`ANY` meaning every method.
 * 6. A key ending in `*` is a PREFIX claim: it holds every key that starts with what precedes the
 *    `*`. Core uses this to reserve whole namespaces (`/api/*`, `admin.*`) without listing every
 *    name in them; an exact claim inside a held prefix conflicts, and so does a prefix claim that
 *    covers a held exact key or overlaps a held prefix.
 *
 * Pure: no I/O, no clock, no mutation of its input.
 */

/** Whether a claim may be held by several owners at once (see rule 2). */
export type ClaimMode = "exclusive" | "shared";

/** One named thing an owner says it provides. `kind` is free text so a host can add kinds without
 *  touching this module; {@link DEFAULT_CLAIM_KIND_RULES} only supplies normalization for the
 *  common ones. */
export interface ExtensionClaim {
  readonly kind: string;
  readonly key: string;
  readonly mode: ClaimMode;
}

/** One party taking part in conflict resolution — core, a plugin, a module. */
export interface ClaimOwner {
  readonly id: string;
  readonly claims: readonly ExtensionClaim[];
}

/** One refused claim: `ownerId` wanted `kind`/`key`, `heldBy` already had it (`heldKey` is the
 *  holder's own spelling — it differs from `key` when a prefix or a normalized route matched). */
export interface ClaimConflict {
  readonly ownerId: string;
  readonly kind: string;
  readonly key: string;
  readonly heldBy: string;
  readonly heldKey: string;
}

/** How one kind's keys are compared: `normalize` turns a key into the slot strings it occupies.
 *  Most kinds occupy one slot; a route claimed for every method occupies one per method. */
export interface ClaimKindRule {
  readonly normalize: (key: string) => readonly string[];
}

export interface ResolveClaimConflictsRequired {
  /** Every owner, in precedence order — the first owner to claim a slot keeps it. */
  readonly owners: readonly ClaimOwner[];
}

export interface ResolveClaimConflictsOptional {
  /** Per-kind normalization; a kind with no rule uses {@link normalizeIdentifier}. Defaults to
   *  {@link DEFAULT_CLAIM_KIND_RULES}. */
  readonly rules?: Readonly<Record<string, ClaimKindRule>>;
}

export interface ResolveClaimConflictsResult {
  /** Owner ids that keep all their claims, in precedence order. */
  readonly accepted: readonly string[];
  /** Owner id -> every conflict that refused it (at least one per entry). */
  readonly refused: ReadonlyMap<string, readonly ClaimConflict[]>;
}

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const PREFIX_MARKER = "*";

/** Trimmed, lower-cased — tool names, table names, setting/widget/permission ids. SQLite table
 *  names are case-insensitive and the rest are human-typed ids where `Foo` and `foo` side by side
 *  would only ever be a mistake, so case never distinguishes two claims. */
export function normalizeIdentifier({ key }: { key: string }, _optional: Record<string, never> = {}): readonly string[] {
  return [key.trim().toLowerCase()];
}

/** One path: lower-cased, slashes collapsed, trailing slash dropped, every parameter segment
 *  (`:id`, `{id}`, `[id]`) erased to `:` so two routes that differ only by parameter NAME — which
 *  a router cannot tell apart — compare equal. A trailing `*` survives as the prefix marker. */
function normalizePath(path: string): string {
  const segments = path
    .trim()
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => (/^(:.+|\{.+\}|\[.+\])$/.test(segment) ? ":" : segment));
  return `/${segments.join("/")}`;
}

/** `"GET /a/:id"` -> `["GET /a/:"]`; `"/a"` or `"* /a"` or `"ANY /a"` -> one slot per method. */
export function normalizeRoute({ key }: { key: string }, _optional: Record<string, never> = {}): readonly string[] {
  const trimmed = key.trim();
  const space = trimmed.indexOf(" ");
  const method = space === -1 ? "*" : trimmed.slice(0, space).toUpperCase();
  const path = normalizePath(space === -1 ? trimmed : trimmed.slice(space + 1));
  const methods = method === "*" || method === "ANY" ? HTTP_METHODS : [method];
  return methods.map((each) => `${each} ${path}`);
}

/** The kinds Tovu (and most hosts) need. A host adds or overrides kinds by spreading this. */
export const DEFAULT_CLAIM_KIND_RULES: Readonly<Record<string, ClaimKindRule>> = {
  route: { normalize: (key) => normalizeRoute({ key }) },
};

interface HeldSlot {
  readonly ownerId: string;
  readonly kind: string;
  readonly key: string;
  readonly slot: string;
  readonly mode: ClaimMode;
}

interface PendingSlot {
  readonly claim: ExtensionClaim;
  readonly slot: string;
}

function isPrefix(slot: string): boolean {
  return slot.endsWith(PREFIX_MARKER);
}

/** Whether two normalized slots of the same kind name overlapping things (rule 6). */
function slotsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  const aStem = isPrefix(a) ? a.slice(0, -1) : undefined;
  const bStem = isPrefix(b) ? b.slice(0, -1) : undefined;
  if (aStem !== undefined && b.startsWith(aStem)) return true;
  if (bStem !== undefined && a.startsWith(bStem)) return true;
  return false;
}

function slotsFor(claim: ExtensionClaim, rules: Readonly<Record<string, ClaimKindRule>>): readonly PendingSlot[] {
  const rule = rules[claim.kind];
  const slots = rule ? rule.normalize(claim.key) : normalizeIdentifier({ key: claim.key });
  return slots.map((slot) => ({ claim, slot }));
}

/** The first already-held slot a pending slot collides with, if any (rule 2: shared+shared never
 *  collides; anything involving an exclusive claim does). */
function findHolder(held: readonly HeldSlot[], ownerId: string, pending: PendingSlot): HeldSlot | undefined {
  return held.find(
    (each) =>
      each.ownerId !== ownerId &&
      each.kind === pending.claim.kind &&
      !(each.mode === "shared" && pending.claim.mode === "shared") &&
      slotsOverlap(each.slot, pending.slot),
  );
}

/** Every conflict one owner has against what is already held; one entry per distinct claim. */
function conflictsFor(held: readonly HeldSlot[], owner: ClaimOwner, pending: readonly PendingSlot[]): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  const reported = new Set<ExtensionClaim>();
  for (const each of pending) {
    if (reported.has(each.claim)) continue;
    const holder = findHolder(held, owner.id, each);
    if (!holder) continue;
    reported.add(each.claim);
    conflicts.push({ ownerId: owner.id, kind: each.claim.kind, key: each.claim.key, heldBy: holder.ownerId, heldKey: holder.key });
  }
  return conflicts;
}

/**
 * Decides, owner by owner in precedence order, who keeps their claims (see this file's header for
 * the six rules).
 *
 * @complexity O(S²) in the total slot count across all owners — a site has tens of plugins with a
 *   handful of claims each, so a linear scan of held slots beats an index that prefix claims would
 *   make complicated.
 */
export function resolveClaimConflicts(
  required: ResolveClaimConflictsRequired,
  optional: ResolveClaimConflictsOptional = {},
): ResolveClaimConflictsResult {
  const rules = optional.rules ?? DEFAULT_CLAIM_KIND_RULES;
  const held: HeldSlot[] = [];
  const accepted: string[] = [];
  const refused = new Map<string, readonly ClaimConflict[]>();

  for (const owner of required.owners) {
    const pending = owner.claims.flatMap((claim) => slotsFor(claim, rules));
    const conflicts = conflictsFor(held, owner, pending);
    if (conflicts.length > 0) {
      refused.set(owner.id, conflicts);
      continue;
    }
    for (const each of pending) {
      held.push({ ownerId: owner.id, kind: each.claim.kind, key: each.claim.key, slot: each.slot, mode: each.claim.mode });
    }
    accepted.push(owner.id);
  }

  return { accepted, refused };
}
