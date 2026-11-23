import { useCallback } from "react";
import { useUsers as useJiniUsers, type UsersController as JiniController } from "./use-users.hooks.js";
import type { UsersPort } from "@jini-ai/core/contracts/site/user-management-react";
import type { DictionaryTranslator } from '@jini-ai/core/text';
import { passwordResetNotice } from "../password-reset-notice.js";

/**
 * @file The locale-bound users controller: binds the host's locale hook, the users dictionary
 * translator and route navigation onto {@link useJiniUsers}. Moved from the host's
 * `features/users/hooks/users-controller.hooks.ts`; the host keeps only `useWiredUsers` (the live
 * port and its router) and injects every collaborator through {@link LocalizedUsersDependencies}.
 */

export type LocalizedUsersController = Omit<JiniController, "translate"> & {
  // Retained host field; the comment below records the pre-extraction row-menu contract.
  /** Raw resolved locale — `rules.ts`'s `userRowMenuItems` takes `locale` directly rather than a
   *  bound translator. See this file's header. */
  locale: string;
};
export interface LocalizedUsersDependencies {
  port: UsersPort;
  /** When true, auto-opens the reset-password dialog on the caller's own row once it is known —
   *  see the one-shot effect in {@link useLocalizedUsers} for why this needs both the flag AND the user list
   *  AND `me()` to have settled before it can act. */
  openOwnPasswordReset?: boolean | undefined;
  /** DI seam for `@/lib/router`'s `navigate`, same convention `use-post-editor.hooks.ts`'s `navigate`
   *  dependency uses — real impl wired only in the host's `useWiredUsers`. */
  navigate?: ((path: string, options?: { replace?: boolean }) => void) | undefined;
  /** The host's locale hook (REQUIRED; e.g. the admin's `useAdminLocale`). */
  useAdminLocale: () => string;
  /** The host's workspace query scope (e.g. its `WORKSPACE_ID`). */
  queryScope: string;
  /** The host's users dictionary translator (`t({ locale, key })`, e.g. its `users-i18n.ts` built with
   *  `createDictionaryTranslator` over its common dictionary). */
  t: DictionaryTranslator;
}

/** Bind host locale, routes and transport; Jini owns all screen state and account rules. */
export function useLocalizedUsers({ port, openOwnPasswordReset, navigate, useAdminLocale, queryScope, t }: LocalizedUsersDependencies, _optional: Record<string, never> = {}): LocalizedUsersController {
  const locale = useAdminLocale();
  const translate = useCallback((key: string) => t({ locale: locale, key: key }), [locale, t]);
  const controller = useJiniUsers({ port, translate, queryScope }, {
    openOwnPasswordReset,
    // A normal row-menu reset must not navigate; Jini calls this only for the deep-linked dialog.
    onOwnPasswordResetClosed: () => navigate?.("/users"),
    passwordResetNotice: ({ username }) => passwordResetNotice({ locale, username }),
  });
  return { ...controller, locale };
}

/** The host's zero-argument (or options-only) wired controller hook — what {@link createUsersControllerHook}
 *  and `UsersPanel` take as `useUsersHook`. */
export type WiredUsersHook = (options?: { openOwnPasswordReset?: boolean | undefined }) => LocalizedUsersController;
