import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { ThemeExploreFileEntry } from "./explore-detail.js";
import type { ThemeFileCopyRouteDeps } from "./explore-file-copy.js";
import type { ThemeFileIdentityLockDeps, ThemeFileIdentityLockRefusal } from "./explore-file-delete.js";
import {
  authorizeThemeExplore, bodyStringField, findExploreTheme, rejectMissingThemeFile, rejectThemeFileError, themeIdParam,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** The deps this route reads. */
export interface ThemeFileRenameRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps, ThemeFileIdentityLockDeps, Pick<ThemeFileCopyRouteDeps, "describeThemeFile"> {
  /**
   * Renames `sourcePath` to `destPath` when they differ (renaming to the current name is a no-op,
   * not a collision) and reloads the theme; returns the refusal instead when the name is taken, the
   * destination is a built theme's generated tree, or the extension would change — a rename never
   * changes bytes, only how a browser interprets them, so the extension must survive it.
   */
  renameThemeFileIfChanged(required: { theme: ExploreTheme; sourcePath: string; destPath: string; name: string; existingPaths: ReadonlySet<string> }): ThemeFileIdentityLockRefusal | null;
}

/**
 * `name` is a bare filename, not a path: no `/` or `\`, which keeps rename from doubling as an
 * undocumented move-between-folders operation and — combined with the host's containment check on
 * the assembled destination — validates the one piece of operator-authored path input as strictly
 * as a write target. `null` means `name` is valid.
 * @complexity O(n) in the name length.
 */
export function validateRenameTargetName({ name }: { name: string }, _optional: Record<string, never> = {}): string | null {
  if (name.length === 0) return "name is required";
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return `name '${name}' must be a plain filename in the same folder, not a path`;
  }
  return null;
}

/**
 * Validates and performs the rename, answering the destination path. Hard-blocks (through the
 * host's identity lock) a theme's required files and the identity-locked `script`/`other` groups —
 * a renamed `main.js` silently 404s every `<script src>` still pointing at it, and nothing tracks
 * those references — while an ordinary page rename only changes its URL, which the UI warns about.
 * @complexity O(n) in the theme's file count (host listing).
 */
function renameInTheme({ deps, theme, sourcePath, name }: { deps: ThemeFileRenameRouteDeps; theme: ExploreTheme; sourcePath: string; name: string }, _optional: Record<string, never> = {}): string {
  const sourceError = deps.checkFileIdentityChange({ theme, path: sourcePath, action: "renamed" });
  if (sourceError) rejectRoute({ status: sourceError.status, error: sourceError.error, code: sourceError.code });
  const nameError = validateRenameTargetName({ name });
  if (nameError) rejectRoute({ status: 400, error: nameError, code: "INVALID_NAME" });
  const existingPaths = new Set(deps.listThemeFiles({ theme }));
  rejectMissingThemeFile({ existingPaths, path: sourcePath });
  const slash = sourcePath.lastIndexOf("/");
  const destPath = slash === -1 ? name : `${sourcePath.slice(0, slash)}/${name}`;
  const refusal = deps.renameThemeFileIfChanged({ theme, sourcePath, destPath, name, existingPaths });
  if (refusal) rejectRoute({ status: refusal.status, error: refusal.error, code: refusal.code });
  return destPath;
}

/** POST — rename (move within the same folder) one file inside a theme. */
export const themeFileRenameRoute = defineJsonRoute<{ themeId: string; path: string; name: string }, ThemeExploreFileEntry & { renamedFrom: string }, ThemeFileRenameRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/rename",
  parse: (raw) => ok({ value: {
    themeId: themeIdParam(raw.params),
    path: bodyStringField({ body: raw.body, field: "path" }),
    name: bodyStringField({ body: raw.body, field: "name" }),
  } }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    try {
      const destPath = renameInTheme({ deps, theme, sourcePath: input.path, name: input.name });
      return ok({ value: { ...deps.describeThemeFile({ theme, path: destPath }), renamedFrom: input.path } });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
  },
});
