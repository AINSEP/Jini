import { defineJsonRoute, ok } from "@jini-ai/core/contracts/server";
import { rejectRoute } from "@jini-ai/core/errors/route-refusal";

import { authorizeThemes, type ThemeRoutePrincipal } from "./shared.js";

/** Every refusal the host's duplication service raises (each one fixable by a different input). */
export type ThemeDuplicateRefusalCode =
  | "SOURCE_NOT_FOUND" | "INVALID_NAME" | "INVALID_ID" | "ID_TAKEN" | "SOURCE_NOT_COPYABLE" | "SYMLINK" | "TOO_LARGE" | "BAD_MANIFEST";

/** HTTP status per refusal: an unknown source is a 404, a taken id a 409, everything else bad input. */
export const THEME_DUPLICATE_ERROR_STATUS: Readonly<Record<ThemeDuplicateRefusalCode, number>> = {
  SOURCE_NOT_FOUND: 404,
  ID_TAKEN: 409,
  INVALID_NAME: 400,
  INVALID_ID: 400,
  SOURCE_NOT_COPYABLE: 400,
  SYMLINK: 400,
  TOO_LARGE: 400,
  BAD_MANIFEST: 400,
};

/** The route's input after the body's coercion rules. */
export interface ThemeDuplicateInput { sourceThemeId: string; newName: string; newId: string | undefined }

/**
 * The host's duplication service: copies one discovered theme into a new folder and rescans, so the
 * copy is already in the live theme list. `theme` is the copy as discovery loaded it (absent when it
 * did not load). Throws a refusal the host's {@link ThemeDuplicateRouteDeps.duplicateThemeErrorCode}
 * recognizes.
 */
export type ThemeDuplicateFn = (
  required: { sourceThemeId: string; newName: string },
  optional: { newId?: string | undefined },
) => {
  result: { id: string; name: string; tier: string; sourceThemeId: string; files: number };
  theme: { status: string; errors: readonly string[] } | undefined;
};

/** The 201 body: the copy's identity, its source, how many files were copied, and the refreshed catalogue. */
export interface ThemeDuplicateEnvelope {
  theme: { id: string; name: string; tier: string; status: string; errors: readonly string[] };
  sourceThemeId: string;
  files: number;
  availableThemeIds: string[];
}

/** The deps this route reads. */
export interface ThemeDuplicateRouteDeps {
  workspaceId: string;
  duplicateTheme: ThemeDuplicateFn;
  /** Asks the host's preview pipeline to re-capture card previews for the themes directory. */
  refreshThemePreviews: () => void;
  catalogThemeIds: () => string[];
  /** The refusal code of a host duplication error, or `undefined` for any other failure. */
  duplicateThemeErrorCode: (required: { err: unknown }) => ThemeDuplicateRefusalCode | undefined;
}

/**
 * Keep the HTTP body's coercion rules separate from the duplication service's validation: a missing
 * or non-object body reads as no fields, `newName` is stringified (the service refuses `""`), and
 * only a non-empty string `newId` is passed on (anything else means "derive it from the name").
 * @complexity O(1).
 */
function duplicateInput({ body, sourceThemeId }: { body: unknown; sourceThemeId: unknown }, _optional: Record<string, never> = {}): ThemeDuplicateInput {
  const record = (body ?? {}) as Record<string, unknown>;
  return {
    sourceThemeId: String(sourceThemeId ?? ""),
    newName: String(record.newName ?? ""),
    newId: typeof record.newId === "string" && record.newId.length > 0 ? record.newId : undefined,
  };
}

/**
 * POST — duplicate one discovered theme into a new theme folder (the Themes screen's Duplicate
 * action). Body: `{ newName: string, newId?: string }`.
 *
 * Calls the SAME duplication service the `theme_duplicate` agent tool calls — what id a copy gets and
 * what is refused cannot differ between the screen and the assistant. The service rescans before
 * returning, so the response's `availableThemeIds` already includes the copy.
 *
 * Gated on `theme.edit` (the tool's permission): this creates theme source, which is more than
 * `theme.set`'s "choose among existing themes". Never activates — the screen's own Activate button
 * does that as a separate, deliberate step.
 */
export const themeDuplicateRoute = defineJsonRoute<ThemeDuplicateInput, ThemeDuplicateEnvelope, ThemeDuplicateRouteDeps, ThemeRoutePrincipal>({
  method: "post",
  path: "/api/admin/v1/workspaces/:workspaceId/themes/:themeId/duplicate",
  parse: (raw) => ok({ value: duplicateInput({ body: raw.body, sourceThemeId: raw.params.themeId }) }),
  handle: async ({ input, deps, authorize }) => {
    await authorizeThemes({ authorize, permission: "theme.edit", entityType: "theme" });
    try {
      const { result, theme } = deps.duplicateTheme({ sourceThemeId: input.sourceThemeId, newName: input.newName }, { newId: input.newId });
      deps.refreshThemePreviews();
      return ok({ value: {
        theme: { id: result.id, name: result.name, tier: result.tier, status: theme?.status ?? "invalid", errors: theme?.errors ?? [] },
        sourceThemeId: result.sourceThemeId,
        files: result.files,
        availableThemeIds: deps.catalogThemeIds(),
      } });
    } catch (err) {
      const code = deps.duplicateThemeErrorCode({ err });
      if (code === undefined) throw err;
      return rejectRoute({ status: THEME_DUPLICATE_ERROR_STATUS[code], error: err instanceof Error ? err.message : String(err), code });
    }
  },
}, { successStatus: 201 });
