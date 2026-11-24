import { useEffect, useRef } from "react";

/**
 * @file The one behavior the owner named that neither the controller nor the markup owns on its
 * own: **a successful create returns to the "All sites" tab, where the new site's card is.**
 *
 * Her words: *"the new website will be a tab with a list that will create a new website. That
 * should go back to the first tab, and then we should see the new website created there."*
 *
 * It lives here rather than in the host's sites controller hook because that controller knows nothing about
 * tabs or the router — it reports `createdName` and stops — and it cannot live in the host's Sites screen,
 * which carries no logic of its own (the host's `.tsx` rule). A separate hook also keeps the
 * removal reversible: deleting this one call restores the previous "stay on the form" behavior
 * without touching the create path itself.
 */

/**
 * Calls `returnToList` on the TRANSITION into a created state, never on the state itself.
 *
 * The distinction is the whole point. A plain `if (createdName !== null)` effect would also fire on
 * MOUNT whenever `createdName` is already set — a remount while a "Created" line is still up, or a
 * test rendering that state directly — and yank the operator off whichever tab they deliberately
 * opened. Seeding the ref with the value present at mount makes the first run a no-op by
 * construction rather than by a separate `mounted` flag.
 *
 * `createSite`'s success handler sets a fresh `createdName` on every create, and `setCreateName`
 * clears it back to `null` on the next edit, so two creates in a row are two distinct transitions
 * (`null` -> `a`, `null` -> `b`) rather than one.
 *
 * @param required.createdName The controller's `createdName` — the site the last successful create made.
 * @param required.returnToList Navigates to the "All sites" tab. Must be referentially stable (a
 *   module-level function in the host's Sites screen), or the effect re-runs every render.
 * @complexity Time/space: O(1).
 */
export function useReturnToSiteListOnCreate({ createdName, returnToList }: { createdName: string | null; returnToList: () => void }, _optional = {}): void {
  const lastSeen = useRef(createdName);
  useEffect(() => {
    const previous = lastSeen.current;
    lastSeen.current = createdName;
    if (createdName === null || createdName === previous) return;
    returnToList();
  }, [createdName, returnToList]);
}
