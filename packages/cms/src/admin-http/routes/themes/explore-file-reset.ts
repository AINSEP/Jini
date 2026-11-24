import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import type { ThemeFileWriteDeps } from "./explore-file-put.js";
import {
  authorizeThemeExplore, findExploreTheme, rejectThemeFileError, themePathInput,
  type ExploreTheme, type ExploreThemeLookupDeps, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** The deps this route reads. `originalSource` is the host's opaque catalog handle, passed back as-is. */
export interface ThemeFileResetRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps, ThemeFileWriteDeps {
  /** Restores a BUILT theme's whole generated tree atomically; throws a theme path error when there is no release to restore. */
  restoreGeneratedTree(required: { theme: ExploreTheme }): { restoredFiles: unknown };
  /** Whether a path is `build-preview.mjs` output (`preview/`), which only that build regenerates. */
  isGeneratedThemePath(required: { path: string }): boolean;
  /** The site's own catalog copy of the theme, or (Design C) the package's read-only catalog; `null` when neither exists. */
  resolveOriginalSource(required: { theme: ExploreTheme }): unknown;
  /** The refusal for an original saved under another layout version or with an unreadable `theme.json`, or `null`. */
  originalLayoutMismatch(required: { theme: ExploreTheme; originalSource: unknown }): { message: string; code: string } | null;
  /** Copies one file's original bytes back (never decoded); `null` when the catalog has no regular file at `path`. */
  resetFileFromOriginal(required: { theme: ExploreTheme; originalSource: unknown; path: string }): { wasModified: boolean; bytes: number } | null;
  readThemeFile(required: { theme: ExploreTheme; path: string }): string;
  /** The host's text-read limit: a restored file past it answers `content: null`. */
  maxThemeFileBytes: number;
}

/** The two reset outcomes: the whole generated release, or one file. */
export type ThemeFileResetResponse =
  | { scope: "release"; restoredFiles: unknown }
  | { scope: "file"; path: string; wasModified: boolean; bytes: number; content: string | null };

type ResetArgs = { deps: ThemeFileResetRouteDeps; theme: ExploreTheme; path: string };

/**
 * A BUILT theme's generated tree restores as ONE atomic operation rather than file-by-file: files
 * one build produced together cannot be restored separately without risking desync. A missing
 * release is the 409 `NO_ORIGINAL`; anything else goes on to the route's file-error mapping.
 * @complexity O(n) in the release's file count (host side).
 */
function resetGeneratedTree({ deps, theme }: ResetArgs, _optional: Record<string, never> = {}): ThemeFileResetResponse {
  try {
    const { restoredFiles } = deps.restoreGeneratedTree({ theme });
    deps.reloadTheme({ themeId: theme.manifest.id });
    return { scope: "release", restoredFiles };
  } catch (err) {
    if (deps.isThemePathError({ err })) rejectRoute({ status: 409, error: err instanceof Error ? err.message : String(err), code: "NO_ORIGINAL" });
    throw err;
  }
}

/**
 * The per-file reset. Its refusals stay distinct because they mean opposite things to the operator:
 * no stored original at all (a hand-made theme), an original under another layout version (checked
 * before any file is looked at), or a file the AUTHOR added (restoring it would mean deleting their
 * file — a different, more destructive operation than a button labelled Reset should do). Reloaded
 * even when nothing was written, matching the assistant's reset tool: this process's snapshot is
 * stale whenever a different process wrote the theme. `bytes` reports 0 when nothing was written.
 * @complexity O(s) in the file size (host side).
 */
function resetOneFile({ deps, theme, path }: ResetArgs, _optional: Record<string, never> = {}): ThemeFileResetResponse {
  const originalSource = deps.resolveOriginalSource({ theme });
  if (originalSource === null) rejectRoute({ status: 409, error: `theme '${theme.manifest.id}' has no stored original, so nothing can be reset`, code: "NO_ORIGINAL" });
  const mismatch = deps.originalLayoutMismatch({ theme, originalSource });
  if (mismatch) rejectRoute({ status: 409, error: mismatch.message, code: mismatch.code });
  const reset = deps.resetFileFromOriginal({ theme, originalSource, path });
  if (!reset) rejectRoute({ status: 409, error: `'${path}' is not in this theme's original, so there is nothing to reset it to`, code: "NOT_IN_ORIGINAL" });
  deps.reloadTheme({ themeId: theme.manifest.id });
  return {
    scope: "file", path, wasModified: reset.wasModified, bytes: reset.wasModified ? reset.bytes : 0,
    content: reset.bytes > deps.maxThemeFileBytes ? null : deps.readThemeFile({ theme, path }),
  };
}

/**
 * Picks the reset: the ADR-020 §5 split is checked FIRST (a built theme's generated tree restores
 * whole), then `preview/` — a write outside the "only `build-preview.mjs` regenerates this folder"
 * invariant every other write route honors — is refused, then the single file resets.
 * @complexity O(1) plus the chosen reset.
 */
function resetThemeFile(args: ResetArgs, _optional: Record<string, never> = {}): ThemeFileResetResponse {
  const { deps, theme, path } = args;
  if (deps.resolveWriteScope({ theme, path }).kind === "generated-readonly") return resetGeneratedTree(args);
  if (deps.isGeneratedThemePath({ path })) rejectRoute({ status: 409, error: `'${path}' is generated output and cannot be reset here`, code: "READ_ONLY_FILE" });
  return resetOneFile(args);
}

/**
 * POST — restore file(s) to the pristine copy in the originals catalog.
 *
 * This is the payoff for the whole copy-not-inherit model: "put it back" is a file copy, needing no
 * diff, no history, and no tooling, only possible because the original still exists byte-for-byte.
 * DESTRUCTIVE and deliberately not undoable here: the confirmation belongs in the UI, where the
 * operator can be told in words what they are about to lose.
 */
export const themeFileResetRoute = defineJsonRoute<{ themeId: string; path: string }, ThemeFileResetResponse, ThemeFileResetRouteDeps, ThemeExplorePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file/reset",
  parse: (raw) => ok({ value: themePathInput(raw) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    try {
      return ok({ value: resetThemeFile({ deps, theme, path: input.path }) });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
  },
});
