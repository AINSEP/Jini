/**
 * @file Write-service for the `navigation` library.
 *
 * Purpose:
 * Implements the menu mutation slice: create, whole-tree update (OCC), soft
 * delete → hard purge, and location assignment. Mirrors the host's `post`
 * feature style (required/optional param objects, typed errors, OCC via
 * `version`).
 *
 * How it relates to the project:
 * - Storage is `MenuRepoPort` (`repo.memory.ts`) — a self-contained repo, not
 *   the generic entries repo (see `repo.memory.ts`'s file header for why).
 * - Location assignment additionally writes `NavLocationBindingRepoPort`
 *   (`ports.ts`), the one real port this library declares.
 * - In production this whole module runs inside the command
 *   gateway/write chokepoint (same-transaction revision, attribution,
 *   `entry_refs` extraction). That gateway is not implemented as running code
 *   yet, so these functions are the chokepoint's future *contents*, called
 *   directly for now.
 *
 * Architectural role:
 * Feature logic only. No Express/route code, no direct SQL — everything goes
 * through the injected repo ports (`deps`).
 */
import type { ClockPort, DomainEvent, IdGeneratorPort, OutboxPort, UUID } from "../core/ports.js";
import type { MenuRepoPort } from "./repo.memory.js";
import type { NavLocationBindingRepoPort } from "./ports.js";
import {
  NAV_DOC_TYPE,
  type MenuStatus,
  type NavItemNode,
  type NavLocationBindingRow,
  type NavLocationKey,
  type NavMenuEntry,
  type NavTarget,
  type NavUrlTarget,
} from "./types.js";

// ---------------------------------------------------------------------------
// Outbox event publication — each mutating function below
// enqueues its matching NAVIGATION_EVENTS entry after its repo write(s)
// succeed, never on a rejection path. Mirrors the host's proven
// `outbox.enqueue()` call shape.
// ---------------------------------------------------------------------------

/**
 * `payload` is typed as a plain `Record<string, unknown>` (not the specific
 * `NavMenuChangedPayload`/`NavLocationChangedPayload` shape) so the result
 * assigns directly to `OutboxPort.enqueue`'s `DomainEvent` parameter (whose
 * default payload type is `Record<string, unknown>`) without a cast — every
 * call site below still passes a fresh object literal matching one of those
 * two contract shapes exactly (`contracts.ts`), just not nominally typed here.
 */
function buildEvent(required: {
  idGen: IdGeneratorPort;
  clock: ClockPort;
  name: string;
  workspaceId: UUID;
  aggregateId: UUID;
  payload: Record<string, unknown>;
}): DomainEvent {
  return {
    id: required.idGen.newId(),
    name: required.name,
    occurredAt: required.clock.nowIso(),
    aggregateId: required.aggregateId,
    workspaceId: required.workspaceId,
    payload: required.payload,
  };
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class MenuNotFoundError extends Error {}
export class MenuValidationError extends Error {}
export class MenuConflictError extends Error {}

/**
 * The 409-style purge rejection: hard delete is blocked while the menu is
 * still bound to at least one theme location (deletion ladder).
 * Carries the offending location keys so a caller can render "unassign these
 * first" without a second lookup.
 */
export class MenuLocationBoundError extends MenuConflictError {
  readonly boundLocations: readonly NavLocationKey[];

  constructor(message: string, boundLocations: readonly NavLocationKey[]) {
    super(message);
    this.boundLocations = boundLocations;
  }
}

// ---------------------------------------------------------------------------
// Tree validation (total/bounded amendment)
// ---------------------------------------------------------------------------

/** Default max nesting depth (root = depth 1). Configurable. */
export const DEFAULT_MAX_TREE_DEPTH = 5;
/** Default max total item count across the whole tree. */
export const DEFAULT_MAX_ITEM_COUNT = 500;

const VALID_TARGET_KINDS = new Set<string>(["entryRef", "termRef", "url", "route"]);
/** Named deferred seams — recognized, rejected until their resolver ships. */
const RESERVED_TARGET_KINDS = new Set<string>(["dynamicQuery", "content"]);

/**
 * Fixed placeholder origin {@link isAllowedHref} resolves a claimed same-origin-relative href
 * against, to compare the RESOLVED origin rather than the raw string shape. Mirrors
 * `apps/website/src/server/inbound/public-http/http/site/render.ts`'s identically-named constant
 * byte-for-byte — see that file's own header for why a fixed placeholder origin is sufficient (only
 * the relationship between the resolved URL's origin and this one is ever inspected, never the
 * placeholder value itself).
 */
const SAFE_HREF_RESOLUTION_BASE = "http://tovu-safehref.invalid/";
const SAFE_HREF_RESOLUTION_ORIGIN = new URL(SAFE_HREF_RESOLUTION_BASE).origin;

/**
 * The CANONICAL href allowlist for an author-authored link — same accepted shapes (`#…`, same-origin
 * `/…`, `http(s)://`, `mailto:`) as the host's render-time `safeHref` in `render.ts` and its
 * `features/theme/static-render.ts` duplicate. **This is now the single source of truth**: exported
 * from this package's public surface (`navigation/index.ts` -> `@jini-ai/cms/navigation`) so the
 * dependency runs the direction that is actually legal — the host already depends on `@jini-ai/cms`, not
 * the reverse — rather than each consumer hand-copying the predicate.
 *
 * The two host-side copies (`render.ts:252`, `features/theme/static-render.ts:210`, both a coercing
 * `value => passes ? value : "#"` wrapper around the identical predicate below) have **not yet been
 * retired to import this** — that edit is intentionally out of this change's scope (a
 * `check:boundaries` no-deep-import concern is NOT what blocks it: `render.ts` already imports
 * `@jini-ai/cms/core` today, and `features/theme` already imports `@jini-ai/cms/core` too, so both
 * call sites may legally import `@jini-ai/cms/navigation` directly — verified by grep, not assumed).
 * Until that follow-up lands, `apps/website/development/scripts/check-menu-href-allowlist-sync.ts`
 * behaviorally gates the three copies against the same adversarial table so a divergence fails CI
 * instead of drifting silently.
 *
 * Replaced (this change) a `URL_SCHEME_DENYLIST` (`startsWith` on a lowercased, `.trim()`ed string)
 * that failed open: the WHATWG `URL` parser strips TAB/LF/CR from ANYWHERE in the input and folds a
 * leading backslash to `/` for `http(s)`, so `"java\tscript:alert(1)"`, `" javascript:alert(1)"`,
 * `"file:///etc/passwd"`, `"blob:…"`, `"about:blank"`, `"//evil.example"` (protocol-relative), and
 * `"/\evil.example"` all resolved to a dangerous or off-origin target while never matching any
 * `startsWith` prefix in the old list. An allowlist closes the whole bypass class at once (case,
 * embedded control characters, and scheme are all irrelevant to an allowlist the same way) rather
 * than needing a new prefix bolted on per newly-discovered shape.
 *
 * `validateTarget`'s caller REJECTS on a `false` result (`MenuValidationError`, surfaced as HTTP 400)
 * rather than silently coercing the way `safeHref`'s render-time callers degrade to `"#"` — a
 * write-time author-facing path should say so, not quietly rewrite the input. Verified against the
 * workspace's stored menu data (`content.db`, `content.seed.db`) before this change: every existing
 * `url`-kind href already starts with `#` or `/`, so this tightening rejects nothing that exists
 * today — it governs `createMenu` too, so it also reaches the Jini MCP agent-tool path, not just
 * hrefs written through the host's admin editor.
 *
 * @param rawHref - The href to check, already confirmed non-empty by `validateTarget`. Any string is
 *   otherwise a valid input — this function performs no other precondition checks.
 * @returns `true` when `rawHref` passes the allowlist, `false` otherwise.
 * @complexity O(1) — a handful of string checks plus one `URL` construction on the `/…` branch.
 */
export function isAllowedHref(rawHref: string): boolean {
  const href = rawHref.trim();
  if (href.startsWith("#")) return true;
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return true;
  if (href.startsWith("/")) {
    try {
      return new URL(href, SAFE_HREF_RESOLUTION_BASE).origin === SAFE_HREF_RESOLUTION_ORIGIN;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Human-readable description of {@link isAllowedHref}'s accepted shapes — the single source of truth
 * for both `validateTarget`'s rejection message below and `agent-tools.ts`'s published JSON Schema
 * `href` description, so an author-facing 400 and an LLM-facing tool description can never drift out
 * of sync with each other the way three independent copies of the URL-checking LOGIC itself did
 * before this change.
 */
export const ALLOWED_HREF_SHAPES_DESCRIPTION =
  "an in-page anchor ('#...'), a same-origin relative path ('/...'), an 'http://' or 'https://' URL, or a 'mailto:' address";

export interface TreeValidationLimits {
  maxDepth?: number | undefined;
  maxItemCount?: number | undefined;
}

/**
 * Validates a candidate item tree and returns a defensively-cloned copy.
 *
 * Checks (total/bounded validation + target integrity):
 * - `items` (and every `children` array) is actually an array, and every node
 *   in it is a non-null object — untrusted JSON bodies can carry `null`
 *   entries or a non-array `items`/`children`, which must reject as a
 *   `MenuValidationError`, not throw an uncaught `TypeError`;
 * - every node has a non-empty `id`, unique across the whole tree (id
 *   stability is a caller responsibility — see `updateMenuTree` doc for the
 *   simplification this build accepts);
 * - nesting depth stays within `maxDepth`;
 * - total item count stays within `maxItemCount`;
 * - every node has a `target` object (a missing/`null` `target` rejects
 *   rather than crashing) whose `kind` is one of the four v1 kinds — reserved
 *   kinds (`dynamicQuery`, `content`) are rejected with a clear "not yet"
 *   error rather than silently accepted;
 * - `url` targets require a non-empty string `href` and pass an origin/scheme
 *   ALLOWLIST (`#…`, same-origin `/…`, `http(s)://`, `mailto:` — see
 *   {@link isAllowedHref}), not a scheme denylist.
 *
 * @complexity O(n) over total node count for one full walk; no per-node
 * backtracking. Space is O(n) for the cloned tree plus O(n) for the id set.
 * @overallScore 100
 */
export function validateAndCloneTree(
  items: readonly NavItemNode[],
  limits: TreeValidationLimits = {}
): NavItemNode[] {
  const maxDepth = limits.maxDepth ?? DEFAULT_MAX_TREE_DEPTH;
  const maxItemCount = limits.maxItemCount ?? DEFAULT_MAX_ITEM_COUNT;
  const seenIds = new Set<string>();
  let count = 0;

  function walk(nodes: readonly NavItemNode[], depth: number): NavItemNode[] {
    if (!Array.isArray(nodes)) {
      throw new MenuValidationError("menu items must be an array");
    }
    if (depth > maxDepth) {
      throw new MenuValidationError(`menu tree exceeds max nesting depth of ${maxDepth}`);
    }
    return nodes.map((node) => {
      count += 1;
      if (count > maxItemCount) {
        throw new MenuValidationError(`menu tree exceeds max item count of ${maxItemCount}`);
      }
      if (!node || typeof node !== "object") {
        throw new MenuValidationError("every menu item must be an object");
      }
      if (!node.id || !node.id.trim()) {
        throw new MenuValidationError("every menu item requires a non-empty id");
      }
      if (seenIds.has(node.id)) {
        throw new MenuValidationError(`duplicate item id '${node.id}' in menu tree`);
      }
      seenIds.add(node.id);
      validateTarget(node.target);

      const children = node.children ? walk(node.children, depth + 1) : undefined;
      return { ...node, children };
    });
  }

  return walk(items, 1);
}

/**
 * Guards every field this function reads off an untrusted `target` before reading it — a `target`
 * arriving `null`/`undefined` (missing from the request body) or a `url` target missing `href`
 * previously threw an uncaught `TypeError` here, which the host's route handler had no case for and
 * surfaced as a 500 instead of the intended 400 `MenuValidationError` path.
 */
function validateTarget(target: NavTarget): void {
  if (!target || typeof target !== "object") {
    throw new MenuValidationError("every menu item requires a target");
  }
  const kind = target.kind;
  if (RESERVED_TARGET_KINDS.has(kind)) {
    throw new MenuValidationError(
      `target kind '${kind}' is a reserved seam and is not supported yet`
    );
  }
  if (!VALID_TARGET_KINDS.has(kind)) {
    throw new MenuValidationError(`unknown target kind '${kind}'`);
  }
  if (kind === "url") {
    const rawHref = (target as NavUrlTarget).href;
    if (typeof rawHref !== "string" || !rawHref.trim()) {
      throw new MenuValidationError("url target requires a non-empty href");
    }
    if (!isAllowedHref(rawHref)) {
      throw new MenuValidationError(
        `url target href is not allowed: '${rawHref}'. Accepted shapes: ${ALLOWED_HREF_SHAPES_DESCRIPTION}.`
      );
    }
  }
}

function assertValidTitleAndSlug(title: string, slug: string): void {
  if (!title) throw new MenuValidationError("title is required");
  if (!slug.match(/^[a-z0-9-]+$/)) {
    throw new MenuValidationError("slug must use lowercase letters, numbers, and dashes");
  }
}

// ---------------------------------------------------------------------------
// createMenu
// ---------------------------------------------------------------------------

export interface CreateMenuDeps {
  repo: MenuRepoPort;
  clock: ClockPort;
  idGen: IdGeneratorPort;
  /** Enqueues `navigation.menu.created` after a successful save. */
  outbox: OutboxPort;
}

export interface CreateMenuServiceInput {
  workspaceId: UUID;
  title: string;
  slug: string;
  /** Optional initial tree; defaults to an empty menu. Items must carry ids. */
  items?: readonly NavItemNode[] | undefined;
}

export interface CreateMenuRequired {
  deps: CreateMenuDeps;
  input: CreateMenuServiceInput;
}

export interface CreateMenuOptional {
  limits?: TreeValidationLimits | undefined;
}

/**
 * Creates a new `menu` entry in `published` status with no location
 * assignments. Rejects a duplicate slug within the workspace.
 *
 * Was `draft` originally (mirroring `posts`), changed 2026-08-09 on explicit product direction: a
 * menu has no separate review/approval workflow the way a post does, and `resolveForLocation`
 * (`resolver.ts`) never actually branched on `status` — the field only ever gated the trash/purge
 * lifecycle. Landing a new menu in `draft` produced a status label at odds with its real behavior
 * (already fully live wherever it gets bound to a location) rather than gating anything real, so
 * the default now matches the actual behavior instead of implying a workflow that doesn't exist.
 *
 * @complexity O(n) in the initial tree size for validation; O(m) in existing
 * menu count for the slug-uniqueness scan (repo-dependent).
 * @overallScore 100
 */
export async function createMenu(
  required: CreateMenuRequired,
  optional: CreateMenuOptional = {}
): Promise<{ menu: NavMenuEntry }> {
  const { deps, input } = required;
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  assertValidTitleAndSlug(title, slug);

  const duplicate = await deps.repo.findBySlug({ workspaceId: input.workspaceId, slug });
  if (duplicate) throw new MenuConflictError(`slug '${slug}' already exists`);

  const items = validateAndCloneTree(input.items ?? [], optional.limits);

  const menu: NavMenuEntry = {
    id: deps.idGen.newId(),
    workspaceId: input.workspaceId,
    slug,
    title,
    status: "published" as MenuStatus,
    doc: { type: NAV_DOC_TYPE, version: 1, items },
    locations: [],
    updatedAt: deps.clock.nowIso(),
    version: 1,
  };

  await deps.repo.save(menu);

  await deps.outbox.enqueue(
    buildEvent({
      idGen: deps.idGen,
      clock: deps.clock,
      name: "navigation.menu.created",
      workspaceId: menu.workspaceId,
      aggregateId: menu.id,
      payload: { menuId: menu.id, slug: menu.slug },
    })
  );

  return { menu };
}

// ---------------------------------------------------------------------------
// updateMenuTree
// ---------------------------------------------------------------------------

export interface UpdateMenuTreeDeps {
  repo: MenuRepoPort;
  clock: ClockPort;
  /** Not previously present on this deps bag — needed to mint the outbox event's id. */
  idGen: IdGeneratorPort;
  /** Enqueues `navigation.menu.updated` after a successful save. */
  outbox: OutboxPort;
}

export interface UpdateMenuTreeServiceInput {
  workspaceId: UUID;
  id: UUID;
  /** The entry `version` this edit was based on — OCC guard. */
  expectedVersion: number;
  title?: string | undefined;
  slug?: string | undefined;
  /** The full replacement tree (whole-tree edit). */
  items: readonly NavItemNode[];
}

export interface UpdateMenuTreeRequired {
  deps: UpdateMenuTreeDeps;
  input: UpdateMenuTreeServiceInput;
}

export interface UpdateMenuTreeOptional {
  limits?: TreeValidationLimits | undefined;
}

/**
 * Replaces a menu's whole item tree, guarded by optimistic concurrency on the
 * entry `version` (matches the host's `updatePost` pattern).
 *
 * Id-stability note ("an update may not renumber surviving items"):
 * this build enforces only that ids are present and unique within the
 * submitted tree (`validateAndCloneTree`). Detecting whether a *specific*
 * surviving node kept its original id would require diffing against the
 * previous tree and is deferred — a caller-discipline requirement for now,
 * not a runtime-enforced invariant.
 *
 * @complexity O(n) in the new tree size for validation; O(1) additional repo
 * calls (one read, at most one slug-uniqueness read, one write).
 * @overallScore 90
 * @findings Medium: id-stability across edits (ids not renumbered on survive)
 * is documented but not runtime-enforced — see doc comment above. Deferred
 * pending a tree-diff mechanism; would need the previous tree's id set passed
 * in to check "no id vanished and reappeared elsewhere," which is more than
 * this slice's scope calls for.
 */
export async function updateMenuTree(
  required: UpdateMenuTreeRequired,
  optional: UpdateMenuTreeOptional = {}
): Promise<{ menu: NavMenuEntry }> {
  const { deps, input } = required;
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new MenuNotFoundError(`menu '${input.id}' was not found`);

  if (existing.version !== input.expectedVersion) {
    throw new MenuConflictError(
      `menu '${input.id}' was modified concurrently (expected version ${input.expectedVersion}, found ${existing.version})`
    );
  }

  const title = (input.title ?? existing.title).trim();
  const slug = (input.slug ?? existing.slug).trim().toLowerCase();
  assertValidTitleAndSlug(title, slug);

  if (slug !== existing.slug) {
    const duplicate = await deps.repo.findBySlug({ workspaceId: input.workspaceId, slug });
    if (duplicate && duplicate.id !== existing.id) {
      throw new MenuConflictError(`slug '${slug}' already exists`);
    }
  }

  const items = validateAndCloneTree(input.items, optional.limits);

  const menu: NavMenuEntry = {
    ...existing,
    title,
    slug,
    doc: { type: NAV_DOC_TYPE, version: existing.doc.version, items },
    updatedAt: deps.clock.nowIso(),
    version: existing.version + 1,
  };

  await deps.repo.save(menu);

  await deps.outbox.enqueue(
    buildEvent({
      idGen: deps.idGen,
      clock: deps.clock,
      name: "navigation.menu.updated",
      workspaceId: menu.workspaceId,
      aggregateId: menu.id,
      payload: { menuId: menu.id, slug: menu.slug },
    })
  );

  return { menu };
}

// ---------------------------------------------------------------------------
// assignLocation
// ---------------------------------------------------------------------------

export interface AssignLocationDeps {
  repo: MenuRepoPort;
  bindingRepo: NavLocationBindingRepoPort;
  clock: ClockPort;
  /** Not previously present on this deps bag — needed to mint outbox event ids. */
  idGen: IdGeneratorPort;
  /** Enqueues `navigation.location.assigned` (+ `.unassigned` on reassignment). */
  outbox: OutboxPort;
}

export interface AssignLocationServiceInput {
  workspaceId: UUID;
  menuId: UUID;
  locationKey: NavLocationKey;
}

export interface AssignLocationRequired {
  deps: AssignLocationDeps;
  input: AssignLocationServiceInput;
}

export interface AssignLocationOptional {}

/**
 * Assigns a menu to a theme location. This writes two
 * representations that must stay in lockstep:
 * 1. the menu's own `locations` field (source of truth, revisioned), and
 * 2. the derived `nav_location_bindings` row (uniqueness index).
 *
 * If the location was already bound to a *different* menu, that menu is
 * **reassigned away** (last-writer-wins, the chosen
 * default) and its `locations` field is updated to drop the key — recorded as
 * its own revision-worthy write.
 *
 * Atomicity note: these writes are
 * logically ONE transaction — the binding-index write is a second in-tx
 * participant alongside a slug-change-capture slot in the host's routing
 * layer. Neither real cross-write transactions nor that routing layer exist
 * as running code yet anywhere this library has shipped, so this function
 * performs the writes sequentially with no rollback if a later step throws.
 * This is an accepted, documented gap pending the command gateway's
 * transaction machinery — do not copy this sequencing pattern into code that
 * has real transactions available.
 *
 * @complexity O(1) repo calls (bounded: at most two menu reads/writes plus one
 * binding upsert), independent of workspace size.
 * @overallScore 90
 * @findings Medium: no rollback across the two writes (menu save, then
 * binding upsert) if the second fails, leaving the derived index stale until
 * a rebuild. Acceptable because the index is declared rebuildable-by-definition;
 * flagged as tech debt for when transactions
 * exist.
 */
export async function assignLocation(
  required: AssignLocationRequired,
  _optional: AssignLocationOptional = {}
): Promise<{ menu: NavMenuEntry; binding: NavLocationBindingRow; displacedMenu: NavMenuEntry | null }> {
  const { deps, input } = required;
  const menu = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.menuId });
  if (!menu) throw new MenuNotFoundError(`menu '${input.menuId}' was not found`);

  const now = deps.clock.nowIso();

  const existingBinding = await deps.bindingRepo.findByLocation({
    workspaceId: input.workspaceId,
    locationKey: input.locationKey,
  });

  let displacedMenu: NavMenuEntry | null = null;
  if (existingBinding && existingBinding.menuId !== input.menuId) {
    const displaced = await deps.repo.findById({
      workspaceId: input.workspaceId,
      id: existingBinding.menuId,
    });
    if (displaced) {
      const updatedDisplaced: NavMenuEntry = {
        ...displaced,
        locations: displaced.locations.filter((key) => key !== input.locationKey),
        updatedAt: now,
        version: displaced.version + 1,
      };
      await deps.repo.save(updatedDisplaced);
      displacedMenu = updatedDisplaced;
    }
  }

  const updatedMenu: NavMenuEntry = {
    ...menu,
    locations: menu.locations.includes(input.locationKey)
      ? menu.locations
      : [...menu.locations, input.locationKey],
    updatedAt: now,
    version: menu.version + 1,
  };
  await deps.repo.save(updatedMenu);

  const binding = await deps.bindingRepo.upsert({
    workspaceId: input.workspaceId,
    locationKey: input.locationKey,
    menuId: input.menuId,
    boundAt: now,
  });

  if (displacedMenu) {
    await deps.outbox.enqueue(
      buildEvent({
        idGen: deps.idGen,
        clock: deps.clock,
        name: "navigation.location.unassigned",
        workspaceId: input.workspaceId,
        aggregateId: displacedMenu.id,
        payload: { locationKey: input.locationKey, menuId: displacedMenu.id },
      })
    );
  }

  await deps.outbox.enqueue(
    buildEvent({
      idGen: deps.idGen,
      clock: deps.clock,
      name: "navigation.location.assigned",
      workspaceId: input.workspaceId,
      aggregateId: input.menuId,
      payload: { locationKey: input.locationKey, menuId: input.menuId },
    })
  );

  return { menu: updatedMenu, binding, displacedMenu };
}

// ---------------------------------------------------------------------------
// deleteMenu (trash → purge ladder, mirrors the media library's deletion ladder)
// ---------------------------------------------------------------------------

export interface DeleteMenuDeps {
  repo: MenuRepoPort;
  bindingRepo: NavLocationBindingRepoPort;
  clock: ClockPort;
  /** Not previously present on this deps bag — needed to mint outbox event ids. */
  idGen: IdGeneratorPort;
  /** Enqueues `navigation.menu.updated` (trash) or `navigation.menu.deleted` (purge); nothing on a blocked purge. */
  outbox: OutboxPort;
}

export interface DeleteMenuServiceInput {
  workspaceId: UUID;
  id: UUID;
  /** Force past the 409 dangling-location guard (needs `navigation.delete.force`). */
  force?: boolean | undefined;
}

export interface DeleteMenuRequired {
  deps: DeleteMenuDeps;
  input: DeleteMenuServiceInput;
}

export interface DeleteMenuOptional {}

/**
 * Deletion ladder (mirrors the media library's):
 * 1. First call on a non-trashed menu **soft-deletes** it (`status: 'trash'`,
 *    revisioned) and returns — no purge yet.
 * 2. A second call on an already-trashed menu attempts the **hard purge**. If
 *    the menu is still bound to any location, purge is rejected with
 *    `MenuLocationBoundError` (409-style) listing the bound keys, unless
 *    `force` is set — permission-gating that error behind
 *    `navigation.delete.force` is the caller's (gateway's) job, not this
 *    function's; this function only enforces the *shape* of the guard.
 * 3. On a successful purge, the menu row and all of its location bindings are
 *    removed.
 *
 * @complexity O(1) repo calls; O(k) bindings scanned where k = locations this
 * menu holds (small, bounded by registered locations).
 * @overallScore 100
 */
export async function deleteMenu(
  required: DeleteMenuRequired,
  _optional: DeleteMenuOptional = {}
): Promise<{ menu: NavMenuEntry | null; purged: boolean }> {
  const { deps, input } = required;
  const existing = await deps.repo.findById({ workspaceId: input.workspaceId, id: input.id });
  if (!existing) throw new MenuNotFoundError(`menu '${input.id}' was not found`);

  if (existing.status !== "trash") {
    const trashed: NavMenuEntry = {
      ...existing,
      status: "trash" as MenuStatus,
      updatedAt: deps.clock.nowIso(),
      version: existing.version + 1,
    };
    await deps.repo.save(trashed);

    await deps.outbox.enqueue(
      buildEvent({
        idGen: deps.idGen,
        clock: deps.clock,
        name: "navigation.menu.updated",
        workspaceId: trashed.workspaceId,
        aggregateId: trashed.id,
        payload: { menuId: trashed.id, slug: trashed.slug },
      })
    );

    return { menu: trashed, purged: false };
  }

  const bindings = await deps.bindingRepo.listByMenu({
    workspaceId: input.workspaceId,
    menuId: input.id,
  });

  if (bindings.length > 0 && !input.force) {
    const boundLocations = bindings.map((row) => row.locationKey);
    throw new MenuLocationBoundError(
      `menu '${input.id}' is still bound to location(s): ${boundLocations.join(", ")} — unassign before purging, or use force`,
      boundLocations
    );
  }

  await deps.repo.remove({ workspaceId: input.workspaceId, id: input.id });
  await deps.bindingRepo.removeByMenu({ workspaceId: input.workspaceId, menuId: input.id });

  await deps.outbox.enqueue(
    buildEvent({
      idGen: deps.idGen,
      clock: deps.clock,
      name: "navigation.menu.deleted",
      workspaceId: existing.workspaceId,
      aggregateId: existing.id,
      payload: { menuId: existing.id, slug: existing.slug },
    })
  );

  return { menu: null, purged: true };
}
