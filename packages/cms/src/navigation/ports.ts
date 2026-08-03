/**
 * @file Ports + typed-call contracts for the `navigation` library (ADR-029).
 *
 * ADR-006 (rule-of-two) applied honestly to navigation:
 *
 * - **`NavLocationBindingRepoPort` IS a port.** It persists the derived
 *   `nav_location_bindings` index and has two real adapters, one built now:
 *   in-memory (dev/tests) + SQLite (persistent, host-supplied) — the same shape
 *   every other repo in this library already follows.
 *
 * - **Menus themselves add NO new persistence port.** A menu is an ADR-022
 *   entry; it rides the existing entries repo (in-memory + SQLite), which
 *   already passes rule-of-two. Inventing a `MenuRepoPort` would be a second
 *   store for data that already has one.
 *
 * - **`NavTargetResolver` is NOT a port — it is one evaluator.** Resolving a
 *   target ref to an href/label is ordinary core code over routing + entries +
 *   taxonomy (ADR-009 §1 typed calls). There is exactly one production
 *   implementation, so — following ADR-021 §2's self-application of ADR-006 to
 *   `authorize()` ("no PolicyPort; one evaluator") — it stays a plain typed-call
 *   contract, refactored into a port only if a second real resolver appears.
 *
 * INTERFACES ONLY. No feature logic lives here.
 */
import type { ISODateTime, UUID } from "../core/ports.js";
import type {
  NavLocationBindingRow,
  NavLocationDescriptor,
  NavLocationKey,
  NavMenuDoc,
  NavMenuEntry,
  ResolvedNav,
} from "./types.js";

// ---------------------------------------------------------------------------
// Port: the derived location-binding index (rule-of-two: in-memory + SQLite)
// ---------------------------------------------------------------------------

/**
 * Persistence for the derived `nav_location_bindings` index (ADR-029
 * §Decision-3). Writes happen only inside the same transaction as the menu-entry
 * mutation that changed `locations` (single write chokepoint, ADR-022 §4a); this
 * port is the storage seam, not a second write path. `rebuildForWorkspace`
 * exists because the index is **rebuildable by definition** (ADR-022 §5) —
 * a full rescan of menu entries can always reconstruct it.
 */
export interface NavLocationBindingRepoPort {
  /** The menu currently bound to a location, if any. */
  findByLocation(required: {
    workspaceId: UUID;
    locationKey: NavLocationKey;
  }): Promise<NavLocationBindingRow | null>;

  /** All locations a given menu currently fills. */
  listByMenu(required: { workspaceId: UUID; menuId: UUID }): Promise<NavLocationBindingRow[]>;

  /** Every binding in the workspace (admin overview + render prefetch). */
  listByWorkspace(required: { workspaceId: UUID }): Promise<NavLocationBindingRow[]>;

  /**
   * Assign a location to a menu. Honors `UNIQUE (workspace_id, location_key)` —
   * claiming a location already bound elsewhere **reassigns** it (last writer
   * wins) and the caller records the displaced menu's revision through the
   * chokepoint (ADR-029 §Decision-3). Returns the row that now holds the binding.
   */
  upsert(required: {
    workspaceId: UUID;
    locationKey: NavLocationKey;
    menuId: UUID;
    boundAt: ISODateTime;
  }): Promise<NavLocationBindingRow>;

  /** Remove a single location binding (unassign). */
  remove(required: { workspaceId: UUID; locationKey: NavLocationKey }): Promise<void>;

  /** Drop every binding for a menu (menu purge). */
  removeByMenu(required: { workspaceId: UUID; menuId: UUID }): Promise<void>;

  /**
   * Rebuild the whole workspace's index from the authoritative menu entries.
   * The index is derived + rebuildable (ADR-022 §5), so this is always safe.
   */
  rebuildForWorkspace(required: {
    workspaceId: UUID;
    bindings: readonly NavLocationBindingRow[];
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Typed-call contracts (NOT injected ports — one evaluator each, ADR-009 §1)
// ---------------------------------------------------------------------------

/** Context needed to compute hrefs + active-state during resolution. */
export interface NavResolveContext {
  readonly workspaceId: UUID;
  /**
   * The current request route/path, used to compute `isCurrent`/`isActive`.
   * Absent for non-request resolution (e.g. an AI preview).
   */
  readonly currentPath?: string | undefined;
}

/**
 * Resolves a stored `NavMenuDoc` into a render-ready `ResolvedNav` — targets to
 * hrefs, labels filled from targets, active-state computed, unavailable targets
 * flagged. One production evaluator (routing + entries + taxonomy typed calls),
 * so this is a contract, not a port (see file header). The theme receives only
 * the resolved data (ADR-020 §6).
 */
export interface NavTargetResolver {
  resolve(required: {
    context: NavResolveContext;
    menuId: UUID;
    locationKey: NavLocationKey;
    title: string;
    doc: NavMenuDoc;
  }): Promise<ResolvedNav>;
}

/**
 * The navigation library's public read surface over the entries repo, exposed as
 * typed calls (ADR-009 §1) so callers (theme renderer, routing, AI tools) never
 * reach into storage. Reuses the entries repo underneath — adds no new port.
 */
export interface NavMenuReadModel {
  /** Load a menu entry as the typed navigation projection. */
  getMenu(required: { workspaceId: UUID; menuId: UUID }): Promise<NavMenuEntry | null>;
  getMenuBySlug(required: { workspaceId: UUID; slug: string }): Promise<NavMenuEntry | null>;
  listMenus(required: { workspaceId: UUID }): Promise<NavMenuEntry[]>;
  /**
   * Resolve the menu bound to a theme location, already rendered to
   * `ResolvedNav`. Returns `null` when the location has no menu. This is the one
   * call the theme renderer makes.
   */
  resolveForLocation(required: {
    context: NavResolveContext;
    locationKey: NavLocationKey;
  }): Promise<ResolvedNav | null>;
}

/**
 * Registry of theme/plugin-declared locations (populated by the
 * `navigation.locations.register` hook, ADR-029 §Hooks). Read-only lookup; the
 * writable side is the hook, not this contract.
 */
export interface NavLocationRegistry {
  list(required: { workspaceId: UUID }): NavLocationDescriptor[];
  get(required: { workspaceId: UUID; key: NavLocationKey }): NavLocationDescriptor | null;
}
