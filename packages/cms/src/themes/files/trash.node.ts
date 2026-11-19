import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { TrashAdapter, TrashMarkerResult } from "../../trash/ports.js";
import { ENGINE_SUBFOLDERS, THEME_CATALOG_DIR } from "../layout.js";

export interface ThemeTrashLocation {
  liveParent: string;
  liveNames: readonly string[];
  parkedDir: string;
}

export interface ThemeTrashPorts {
  readonly findTheme: (required: { themeId: string }) => { dir: string; tier: string } | undefined;
  readonly locationError: (required: { themeId: string; reason: "invalid-segment" | "outside-themes-directory" }) => Error;
  readonly createDirectoryAdapter: (required: { locate: (required: { workspaceId: string; entityId: string }) => ThemeTrashLocation }) => TrashAdapter;
  readonly refresh: (required: {}) => void | Promise<void>;
}

/**
 * @file Where a whole theme folder goes when it is moved to the Trash, and the Trash adapter built on
 * it (2026-10-08, owner: the agent could not delete a theme at all).
 *
 * A theme is a folder, so it reuses the generic directory adapter `plugin` already uses
 * (`features/trash/adapters/directory.ts`): one atomic rename out of the site's `themes/` into a
 * sibling `themes-trash/`, one rename back on restore, and bytes removed only by the Trash's own
 * human-confirmed purge. Nothing here deletes anything.
 *
 * The parking path keeps the engine subfolder (`static/`, `templated/`, ...) the theme was discovered
 * under — `<themes>-trash/static/nordic/nordic` — because once the folder has left `themes/`, discovery
 * no longer knows where it came from, and restore must put it back in the same place.
 *
 * The theme's stored original (`__original-themes__/<tier>/<id>`, what Reset restores from) travels
 * with it (owner 2026-10-08): parked at `<themes>-trash/__original-themes__/<tier>/<id>/<id>` on
 * trash, put back on restore, removed by purge — a trashed theme leaves no orphan original behind,
 * and a restored one can still be reset. Every other original is untouched; no discovered theme's
 * folder can resolve into the catalog, which discovery excludes.
 */

/** The sibling directory trashed themes are parked in — outside `themes/`, so discovery never sees them. */
function themeTrashRoot(required: { themesDir: string }, _optional = {}): string {
  return `${resolve(required.themesDir)}-trash`;
}

function assertThemeIdSegment({ themeId, ports }: { themeId: string; ports: ThemeTrashPorts }, _optional = {}): void {
  if (["", ".", ".."].includes(themeId) || basename(themeId) !== themeId || themeId.includes("\\")) {
    throw ports.locationError({ themeId, reason: "invalid-segment" });
  }
}

/**
 * Resolves one theme id to the directory adapter's three paths.
 *
 * A theme already parked wins over a live one with the same id: hiding again then reports
 * `ALREADY_IN_TRASH`, and restoring while any live theme claims the id reports a conflict
 * (`version-changed`) instead of creating a second folder with that id.
 *
 * @throws {ThemeTrashLocationError} When the id is not one path segment, or the live theme's folder is
 *   not directly under `themesDir` or one of its {@link ENGINE_SUBFOLDERS} (e.g. a package stock theme).
 * @complexity O(t) in the discovered theme count, plus at most five `existsSync` probes.
 */
export function locateThemeFolder(required: { themesDir: string; themeId: string; ports: ThemeTrashPorts }, _optional = {}): ThemeTrashLocation {
  const { ports, themeId } = required;
  assertThemeIdSegment({ themeId, ports });
  const root = resolve(required.themesDir);
  const trashRoot = themeTrashRoot({ themesDir: root });
  const live = ports.findTheme({ themeId });

  for (const sub of ["", ...ENGINE_SUBFOLDERS]) {
    const parkedDir = join(trashRoot, sub, themeId);
    if (existsSync(parkedDir)) return { liveParent: join(root, sub), liveNames: live ? [themeId] : [], parkedDir };
  }

  if (!live) return { liveParent: root, liveNames: [], parkedDir: join(trashRoot, themeId) };
  const liveDir = resolve(live.dir);
  const sub = relative(root, dirname(liveDir));
  if (basename(liveDir) !== themeId || !(sub === "" || (ENGINE_SUBFOLDERS as readonly string[]).includes(sub))) {
    throw ports.locationError({ themeId, reason: "outside-themes-directory" });
  }
  return { liveParent: dirname(liveDir), liveNames: [themeId], parkedDir: join(trashRoot, sub, themeId) };
}

/** The tier folders directly under `dir`, or none when it does not exist. @complexity O(entries). */
function tierDirs({ dir }: { dir: string }, _optional = {}): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * Resolves a theme's stored original to the directory adapter's three paths — the original's own
 * parking spot next to the theme's (see this file's header).
 *
 * The tier is the live theme's when it is discovered; otherwise (the theme is in the Trash) it is read
 * off whichever tier folder holds the id, parked first, then live — so this never needs the registry
 * to restore, and a re-hide after a failed restore finds the original it just put back.
 *
 * @throws {ThemeTrashLocationError} When the id is not one path segment.
 * @complexity O(k) in the catalog's tier folders, plus that many `existsSync` probes.
 */
function locateThemeOriginal(required: { themesDir: string; themeId: string; ports: ThemeTrashPorts }, _optional = {}): ThemeTrashLocation {
  const { ports, themeId } = required;
  assertThemeIdSegment({ themeId, ports });
  const liveRoot = join(resolve(required.themesDir), THEME_CATALOG_DIR);
  const parkedRoot = join(themeTrashRoot({ themesDir: required.themesDir }), THEME_CATALOG_DIR);
  const at = ({ tier }: { tier: string }, _optional = {}): ThemeTrashLocation => {
    const liveParent = join(liveRoot, tier);
    return { liveParent, liveNames: existsSync(join(liveParent, themeId)) ? [themeId] : [], parkedDir: join(parkedRoot, tier, themeId) };
  };

  const parkedTier = tierDirs({ dir: parkedRoot }).find((tier) => existsSync(join(parkedRoot, tier, themeId)));
  if (parkedTier !== undefined) return at({ tier: parkedTier });
  const liveTier = ports.findTheme({ themeId })?.tier ?? tierDirs({ dir: liveRoot }).find((tier) => existsSync(join(liveRoot, tier, themeId)));
  return liveTier === undefined ? { liveParent: liveRoot, liveNames: [], parkedDir: join(parkedRoot, themeId) } : at({ tier: liveTier });
}

/**
 * The `theme` Trash adapter: the directory adapter over {@link locateThemeFolder}, plus a rescan of the
 * live theme registry (and a preview refresh) after every move, so a trashed theme disappears from
 * `theme_list` at once and a restored one comes back — whichever surface did the restore.
 *
 * The theme's stored original moves alongside ({@link locateThemeOriginal}), all-or-nothing: a theme
 * with no original moves alone; if the original cannot follow, the theme's own move is undone.
 *
 * @param required.themes the live, mutable registry `RouteDeps.themes` holds; rescanned in place.
 * @param optional.rename test seam forwarded to the directory adapter.
 * @complexity O(1) to build; each move costs one rename plus one theme rediscovery.
 */
export function createThemeTrashAdapter(
  required: { themesDir: string; ports: ThemeTrashPorts },
  _optional: Record<string, never> = {}
): TrashAdapter {
  const { ports, themesDir } = required;
  const refresh = ports.refresh;
  const adapter = ports.createDirectoryAdapter(
    { locate: ({ entityId }) => locateThemeFolder({ ports, themesDir, themeId: entityId }) }
  );
  const original = createThemeOriginalTrashAdapter({ ports, themesDir });
  const pair = { adapter, original, refresh };
  // Not `withFollowUps`: its `afterUnhide` fires only with a stored `priorMarker`, which a directory
  // move never has, so a restore would leave the registry stale.
  return {
    entityType: adapter.entityType,
    hide: (hideRequired, hideOptional) => hideThemeWithOriginal({ ...pair, hideRequired }, hideOptional),
    unhide: (unhideRequired, unhideOptional) => unhideThemeWithOriginal({ ...pair, unhideRequired }, unhideOptional),
    async purge(purgeRequired, purgeOptional) {
      const outcome = await adapter.purge(purgeRequired, purgeOptional);
      if (outcome !== "version-changed") await original.purge(purgeRequired, purgeOptional);
      return outcome;
    },
  };
}

/** The directory adapter over {@link locateThemeOriginal}, creating a missing tier folder before a restore. */
function createThemeOriginalTrashAdapter(
  required: { themesDir: string; ports: ThemeTrashPorts },
  _optional: Record<string, never> = {}
): TrashAdapter {
  const { ports, themesDir } = required;
  return ports.createDirectoryAdapter(
    {
      locate: ({ entityId }) => {
        const location = locateThemeOriginal({ ports, themesDir, themeId: entityId });
        // The directory adapter stats the live parent before a restore; the tier folder may be gone.
        if (location.liveNames.length === 0 && existsSync(location.parkedDir)) mkdirSync(location.liveParent, { recursive: true });
        return location;
      },
    }
  );
}

/** The theme adapter, its stored original's adapter, and the registry refresh that follows every move. */
interface ThemeTrashPair {
  readonly adapter: TrashAdapter;
  readonly original: TrashAdapter;
  readonly refresh: ThemeTrashPorts["refresh"];
}

/** A move of the original that leaves nothing to undo: it happened, or there was none to move. */
const settled = ({ result }: { result: TrashMarkerResult }, _optional = {}): boolean => result.ok || result.reason === "not-found";

async function hideThemeWithOriginal(
  required: ThemeTrashPair & { hideRequired: Parameters<TrashAdapter["hide"]>[0] },
  hideOptional?: Parameters<TrashAdapter["hide"]>[1]
): Promise<TrashMarkerResult> {
  const { adapter, original, refresh, hideRequired } = required;
  const result = await adapter.hide(hideRequired, hideOptional);
  if (!result.ok) return result;
  // Theme first, then its original (located by the live theme's tier, before the rescan below).
  // The undo rescans first: the registry still lists the theme, which would read as a live
  // folder claiming the id and refuse the move back.
  const undoTheme = async () => {
    await refresh({});
    await adapter.unhide({ ...hideRequired, expectedVersion: null });
    await refresh({});
  };
  let originalResult: TrashMarkerResult;
  try {
    originalResult = await original.hide(hideRequired, hideOptional);
  } catch (error) {
    await undoTheme();
    throw error;
  }
  if (!settled({ result: originalResult })) {
    await undoTheme();
    return originalResult;
  }
  await refresh({});
  return result;
}

async function unhideThemeWithOriginal(
  required: ThemeTrashPair & { unhideRequired: Parameters<TrashAdapter["unhide"]>[0] },
  unhideOptional?: Parameters<TrashAdapter["unhide"]>[1]
): Promise<TrashMarkerResult> {
  const { adapter, original, refresh, unhideRequired } = required;
  // Original first: if the theme then cannot come back, only an original THIS call moved is
  // re-parked — never a live original that some other theme with this id now owns.
  const originalResult = await original.unhide(unhideRequired, unhideOptional);
  const reparkOriginal = async () => {
    if (originalResult.ok) await original.hide({ ...unhideRequired, expectedVersion: null });
  };
  let result: TrashMarkerResult;
  try {
    result = await adapter.unhide(unhideRequired, unhideOptional);
  } catch (error) {
    await reparkOriginal();
    throw error;
  }
  if (!result.ok) {
    await reparkOriginal();
    return result;
  }
  await refresh({});
  return result;
}
