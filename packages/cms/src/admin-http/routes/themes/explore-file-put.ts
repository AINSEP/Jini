import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import {
  authorizeThemeExplore, bodyRecord, bodyStringField, findExploreTheme, rejectThemeFileError, themeIdParam,
  type ExploreTheme, type ExploreThemeLookupDeps, type ExploreWriteScope, type ThemeExplorePrincipal, type ThemeFileErrorDeps,
} from "./explore-shared.js";

/** The write-scope resolution and reload every writing Explore route shares. */
export interface ThemeFileWriteDeps {
  /** The host's ADR-020 write scope for one path (`"generated-readonly"` for a built theme's generated tree). */
  resolveWriteScope(required: { theme: ExploreTheme; path: string }): ExploreWriteScope;
  /**
   * Re-read one theme from disk and swap it into the live theme list. Mandatory after ANY write:
   * the preview renders from contents read once at discovery, so skipping it makes a save invisible.
   */
  reloadTheme(required: { themeId: string }): void;
}

/** The deps this route reads. */
export interface ThemeFilePutRouteDeps extends ExploreThemeLookupDeps, ThemeFileErrorDeps, ThemeFileWriteDeps {
  /** The host's save gate for an `"editable"` path: generated/trash refusal, the group and extension rules. */
  isPutWritable(required: { theme: ExploreTheme; path: string; writeScope: ExploreWriteScope }): boolean;
  /** Writes one file through the containment helper (refuses escapes and, unless asked, oversized files). */
  writeThemeFile(required: { theme: ExploreTheme; path: string; content: string; overwriteOversized: boolean }): void;
}

/**
 * The PUT body: `content` stays unknown until the theme exists (the one shape check this route 400s
 * on). `overwriteOversized` is true only for the boolean `true`; any other value, the string "true"
 * included, keeps the writer's refusal to replace a file past the read limit. The admin editor never
 * sends it.
 */
export interface ThemeFilePutInput { themeId: string; path: string; content: unknown; overwriteOversized: boolean }

/**
 * Refuses a path PUT may not write: an inherited template source, a built theme's generated tree
 * (ADR-020 §5, a lifecycle-class refusal checked BEFORE the group-based gate — nothing about the
 * path's extension or group changes it), then the host's save gate. Enforced here, not only by the
 * client hiding the Save button: a PUT built by hand (or by an older cached client) is refused too.
 * @complexity O(1) plus the injected policy calls.
 */
function rejectUnwritable({ deps, theme, path }: { deps: ThemeFilePutRouteDeps; theme: ExploreTheme; path: string }, _optional: Record<string, never> = {}): void {
  if (Object.hasOwn(theme.inheritedTemplateSources ?? {}, path)) {
    rejectRoute({ status: 403, error: `'${path}' is inherited from the bundled theme and is read-only`, code: "READ_ONLY_FILE" });
  }
  const writeScope = deps.resolveWriteScope({ theme, path });
  if (writeScope.kind === "generated-readonly") rejectRoute({ status: 403, error: `'${path}' is read-only: ${writeScope.reason}`, code: "GENERATED_READONLY" });
  if (!deps.isPutWritable({ theme, path, writeScope })) rejectRoute({ status: 403, error: `'${path}' is read-only in Explore and cannot be saved`, code: "READ_ONLY_FILE" });
}

/**
 * PUT one file inside a theme.
 *
 * Reachable only for themes DISCOVERY returned — which structurally excludes the originals catalog,
 * since it is never discovered. That is the invariant the whole copy model rests on: an original
 * cannot be edited, so a copy always has something intact to reset to. `bytes` is the UTF-8 length
 * of what was written.
 */
export const themeFilePutRoute = defineJsonRoute<ThemeFilePutInput, { path: string; bytes: number }, ThemeFilePutRouteDeps, ThemeExplorePrincipal>({
  method: "put",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/file",
  parse: (raw) => {
    const body = bodyRecord({ body: raw.body });
    return ok({ value: { themeId: themeIdParam(raw.params), path: bodyStringField({ body: raw.body, field: "path" }), content: body.content, overwriteOversized: body.overwriteOversized === true } });
  },
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemeExplore({ authorize });
    const theme = findExploreTheme({ deps, themeId: input.themeId });
    const { path, content } = input;
    if (typeof content !== "string") rejectRoute({ status: 400, error: "content must be a string", code: "INVALID_BODY" });
    try {
      rejectUnwritable({ deps, theme, path });
      deps.writeThemeFile({ theme, path, content, overwriteOversized: input.overwriteOversized });
      deps.reloadTheme({ themeId: theme.manifest.id });
    } catch (err) {
      return rejectThemeFileError({ err, deps });
    }
    return ok({ value: { path, bytes: new TextEncoder().encode(content).length } });
  },
});
