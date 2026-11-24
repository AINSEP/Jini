import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { ThemeExploreFileEntry } from "./explore-detail.js";
import type { ThemeFileIdentityLockDeps } from "./explore-file-delete.js";
import type { ThemeFileWriteDeps } from "./explore-file-put.js";
import {
  authorizeThemeExplore, findExploreTheme, rejectMissingThemeFile, rejectThemeFileError, themePathInput,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** Describes one file as a detail-listing entry (the copy/rename responses skip the content-collision lookup). */
export interface ThemeFileDescribeDeps {
  describeThemeFile(required: { theme: ExploreTheme; path: string }): ThemeExploreFileEntry;
}

/** The deps this route reads. */
export interface ThemeFileCopyRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps, ThemeFileWriteDeps, ThemeFileDescribeDeps, Pick<ThemeFileIdentityLockDeps, "listThemeFiles"> {
  isGeneratedThemePath(required: { path: string }): boolean;
  /** The next free `name-1`, `name-2`, … in the same folder (shared with the assistant's copy tool). */
  nextAvailableFileName(required: { desiredPath: string; existingPaths: ReadonlySet<string> }): string;
  copyThemeFile(required: { theme: ExploreTheme; sourcePath: string; destPath: string }): void;
}

/**
 * Refuses a copy source the route never copies: a built theme's generated tree (ADR-020 §5 —
 * duplicating INTO it would add an untracked extra to a region `build.artifactHashes` must fully
 * account for), then `preview/` (2026-08-13 security pass: the scope above answers a DIFFERENT
 * question than `build-preview.mjs`'s own output). The destination is always the SAME folder as the
 * source (only the filename is suffixed), so checking the source covers the destination too.
 * @complexity O(1) plus the injected policy calls.
 */
function rejectUncopyable({ deps, theme, path }: { deps: ThemeFileCopyRouteDeps; theme: ExploreTheme; path: string }, _optional: Record<string, never> = {}): void {
  const writeScope = deps.resolveWriteScope({ theme, path });
  if (writeScope.kind === "generated-readonly") rejectRoute({ status: 409, error: `'${path}' is read-only: ${writeScope.reason}`, code: "GENERATED_READONLY" });
  if (deps.isGeneratedThemePath({ path })) rejectRoute({ status: 409, error: `'${path}' is generated output and cannot be copied`, code: "READ_ONLY_FILE" });
}

/**
 * POST — duplicate one file inside a theme, landing the copy in the same folder under the next
 * available suffix. Deliberately takes ONLY the source `path` — the destination name is
 * server-computed, not operator input, so this route (unlike rename) needs no filename-shape
 * validation of its own. Offered for every group, `script`/`other` included: duplicating bytes under
 * a new name changes nothing any existing reference points at. Reloads after copying, or the copy
 * exists on disk while the preview and the next detail read act as if it does not.
 */
export const themeFileCopyRoute = defineJsonRoute<{ themeId: string; path: string }, ThemeExploreFileEntry & { copiedFrom: string }, ThemeFileCopyRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/copy",
  parse: (raw) => ok({ value: themePathInput(raw) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    const sourcePath = input.path;
    try {
      rejectUncopyable({ deps, theme, path: sourcePath });
      const existingPaths = new Set(deps.listThemeFiles({ theme }));
      rejectMissingThemeFile({ existingPaths, path: sourcePath });
      const destPath = deps.nextAvailableFileName({ desiredPath: sourcePath, existingPaths });
      deps.copyThemeFile({ theme, sourcePath, destPath });
      deps.reloadTheme({ themeId: theme.manifest.id });
      return ok({ value: { ...deps.describeThemeFile({ theme, path: destPath }), copiedFrom: sourcePath } });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
  },
});
