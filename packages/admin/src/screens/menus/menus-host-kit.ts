/**
 * @file What the host injects into the menus screen's hooks beyond each hook's port and bound
 * translator: its admin request error class (as a predicate), its version-conflict test and copy key,
 * its slug rule, the admin shell's slug-redirect rule and its failure channel. Nothing in this folder
 * imports a host module; the host binds one {@link MenusHostKit} at its composition root and passes it
 * to every hook. The menu editor's own state/action hooks and write hooks ride on the same kit
 * (`useMenuEditorState` … `useMenuSave`), so `useMenuEditor` calls no sibling custom hook directly;
 * the host passes this package's implementations.
 */
import type { useMenuEditorState, useMenuFieldActions, useMenuItemActions } from "./hooks/use-menu-editor-state.hooks.js";
import type { useMenuCopyEmbed, useMenuSave } from "./hooks/use-menu-editor-writes.hooks.js";

/** The fields the menus trash classifier reads off a failed admin request. */
export interface MenusApiErrorLike extends Error {
  readonly status: number;
  readonly code?: string | undefined;
}

/** The slice of the host's admin failure channel the menu editor reports a failed copy through. */
export interface MenusFailureReporter {
  /** The channel's current generation — captured BEFORE an await so a stale report is dropped. */
  getGeneration: () => number;
  /** Whether a clipboard rejection is the browser refusing (permission/focus), not a real failure. */
  isClipboardRefusal: (required: { error: unknown }) => boolean;
  /** Publishes one local, user-facing failure (the host's formatter redacts `cause`). */
  publishLocal: (
    required: { message: string; action: string; step: string; cause: unknown },
    optional: { generation?: number },
  ) => void;
}

/** Everything the menus hooks receive from the host beyond their port and bound translator. */
export interface MenusHostKit {
  /** Whether `e` is the error class the host's admin `request` throws. The trash classifier narrows
   *  on this, so a plain `Error` with the same fields must answer `false`. */
  isApiError: (e: unknown) => e is MenusApiErrorLike;
  /** Whether `error` is a lost compare-and-set (`409 VERSION_CONFLICT`). */
  isVersionConflict: (required: { error: unknown }) => boolean;
  /** The host's untranslated version-conflict copy key, looked up through the bound `t`. */
  versionConflictMessage: string;
  /** The host's browser-safe slug rule (new-menu titles derive their slug through it). */
  toSlug: (required: { text: string }) => string;
  /** The admin shell's slug-redirect rule (`shell/lib/slug-redirect-path`), bound by the host. */
  slugRedirectPath: (required: { base: string; requestedId: string; item: { id: string; slug: string } }) => string | null;
  /** The host's admin failure channel — see {@link MenusFailureReporter}. */
  failures: MenusFailureReporter;
  /** The editor's state cells (`use-menu-editor-state.hooks.ts`' `useMenuEditorState`). */
  useMenuEditorState: typeof useMenuEditorState;
  /** The title/slug/mode setters over that state (`useMenuFieldActions`). */
  useMenuFieldActions: typeof useMenuFieldActions;
  /** The tree edit actions over that state (`useMenuItemActions`). */
  useMenuItemActions: typeof useMenuItemActions;
  /** Copy HTML embed (`use-menu-editor-writes.hooks.ts`' `useMenuCopyEmbed`). */
  useMenuCopyEmbed: typeof useMenuCopyEmbed;
  /** Save (`useMenuSave`). */
  useMenuSave: typeof useMenuSave;
}
