import { useCallback as useQueryFetchCallback } from "react";
import { useFetchQuery, useFetchMutation, useInvalidate } from "../../../react/kit.js";
import { useCallback, useState } from "react";
import type { AdminMenu } from "../api/menus-api.types.js";
import type { MenusHostKit } from "../menus-host-kit.js";
import type { MenusPort } from "./menus-port.hooks.js";

import { type Translate } from '@jini-ai/core/text';
/**
 * @file Everything the Menus LIST does, so `Menus.tsx` is only markup.
 *
 * Naming follows the `use-<thing>.hooks.ts` convention. Screen-local because nothing outside the
 * menus screen needs it; promote to a shared hooks folder only when a second screen actually does.
 *
 * `deps.port` is injected (see `menus-port.hooks.ts`) rather than reaching for the host's admin
 * client directly, sharing the `MenusPort` the menu editor hook also injects.
 *
 * `t` (standing i18n rule, 2026-08-11 — a component with a hook gets a BOUND `t` from that hook,
 * not its own locale/dictionary import, same shape the pages hook established):
 * injected alongside `port` purely so `Menus.tsx` has somewhere to source the UI copy it renders.
 * This hook's OWN load-error string stays hardcoded English (unchanged) — the host reads its admin
 * locale and menus dictionary only inside its wired binding. `deps.kit` carries the host's request
 * error predicate (`menus-host-kit.ts`).
 *
 * Trash rewrite (2026-09-21, `trash-delete-architecture.md`): every admin delete button now goes
 * through the generic `POST .../trash/items`
 * (`port.trash`, which binds to `api.trash({ type: "menu", id })`), and a trashed menu is hidden
 * from `listMenus()` by the server's own default filter. There is no `status === "trash"` row left
 * to force-delete from this list any more — the Trash screen owns restore/purge from here. Mirrors
 * the widgets library hook's `requestTrash`/`confirmTrash`/`cancelTrash` shape exactly.
 */

export interface MenusDependencies {
  port: MenusPort;
  t: Translate;
  /** The host's request-error predicate — see `menus-host-kit.ts`. */
  kit: MenusHostKit;
}

export interface MenusController {
  menus: AdminMenu[] | null;
  error: string | null;
  /** The menu a "Trash" click is asking to confirm — `null` when the dialog is closed.
   *  `ConfirmDialog` stays mounted unconditionally in the view (see its own doc comment on why);
   *  this is what drives its `open` prop. Set by {@link requestTrash}; no network call happens
   *  until {@link confirmTrash}. */
  pendingTrash: AdminMenu | null;
  /** True only while the CONFIRMED trash for {@link pendingTrash} is in flight — same
   *  `pendingX !== null && xId === pendingX.id` shape `use-widgets-library.hooks.ts` uses. */
  trashing: boolean;
  requestTrash: (menu: AdminMenu) => void;
  confirmTrash: () => Promise<void>;
  cancelTrash: () => void;
  /** Bound translator — `Menus.tsx`'s only source of UI copy; see this file's own header. */
  t: Translate;
}

/**
 * Classifies a failed `port.trash` call the same way `@jini-ai/admin/forms` rules.ts's `describeTrashError` does
 * for the generic `POST /trash/items` 404/409 contract — kept local rather than imported since
 * this is the only caller in the menus screen today (see that file's own doc comment for the fuller
 * rationale, shared verbatim here): a 404 means the row is already gone (quiet re-read, no banner);
 * `TRASH_VERSION_CHANGED` means it changed under the operator since this screen last read it
 * (specific reload-and-retry copy); anything else falls through to the generic fallback message.
 *
 * @complexity Time/space: O(1) — one host error-class check plus two fixed comparisons.
 */
function describeMenuTrashError(
  { e, fallback, translate, kit }: { e: unknown; fallback: string; translate: Translate; kit: MenusHostKit },
  _optional = {},
): { alreadyGone: boolean; message: string | null } {
  if (kit.isApiError(e)) {
    if (e.status === 404) return { alreadyGone: true, message: null };
    if (e.code === "TRASH_VERSION_CHANGED") {
      return { alreadyGone: false, message: translate("This item changed since you loaded it. Reload and try again.") };
    }
  }
  return { alreadyGone: false, message: e instanceof Error ? e.message : fallback };
}

export function useMenus({ port, t, kit }: MenusDependencies, _optional: Record<string, never> = {}): MenusController {
  const queryFetch = useQueryFetchCallback(async () => {
    try { return (await port.listMenus()).menus; }
    catch (error) { if (error instanceof Error) throw error; throw new Error("failed to load menus", { cause: error }); }
  }, [port]);
  const query = useFetchQuery({ key: ["menus", "list"], fetch: queryFetch }, { staleTime: 0 });
  const menus = query.data ?? null;
  const invalidate = useInvalidate();
  const trash = useFetchMutation({ run: ({ input }: { input: string }) => port.trash({ id: input }) }, { invalidates: [["menus"]] });
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? query.error?.message ?? null;
  const [pendingTrash, setPendingTrash] = useState<AdminMenu | null>(null);
  const [trashingId, setTrashingId] = useState<string | null>(null);

  // Latest-wins for `load()`: the mount read and each trash re-read can be in flight together with
  // no ordering guarantee. Without it, trashing A then B lets A's older read settle last and put B
  // back to `active`. Same guard `use-widgets-library.hooks.ts` uses for the same shape.
  // The cache now owns the latest-wins reads described above.
  const load = useCallback(() => invalidate({ key: ["menus"] }), [invalidate]);

  /** Opens the "Move to trash?" confirm for `menu` — no network call happens until
   *  {@link confirmTrash}. */
  function requestTrash(menu: AdminMenu) {
    setError(null);
    setPendingTrash(menu);
  }

  function cancelTrash() {
    setPendingTrash(null);
  }

  /** The confirmed trash request. See {@link describeMenuTrashError} for the 404/409 mapping. */
  async function confirmTrash() {
    if (!pendingTrash) return;
    const menu = pendingTrash;
    setTrashingId(menu.id);
    setError(null);
    try {
      await trash.mutate({ input: menu.id });
    } catch (e) {
      const { alreadyGone, message } = describeMenuTrashError({ e: e, fallback: "delete failed", translate: t, kit });
      if (alreadyGone) {
        load();
      } else {
        setError(message);
      }
    } finally {
      setTrashingId((current) => (current === menu.id ? null : current));
      setPendingTrash((current) => (current?.id === menu.id ? null : current));
    }
  }

  return {
    menus,
    error,
    pendingTrash,
    trashing: pendingTrash !== null && trashingId === pendingTrash.id,
    requestTrash,
    confirmTrash,
    cancelTrash,
    t,
  };
}
