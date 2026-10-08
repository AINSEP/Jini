/** Test constant: source features/trash/adapters/redirect.ts:15. */
export const REDIRECT_ENTITY_TYPE = "redirect";
import type { TrashMarkerResult } from "../../../trash/index.js";

/** What a blocker-free domain's `remove*` port (`RemovePostFn`, `RemoveWidgetFn`, ...) can return. */
export type RemoveWithoutBlockerResult =
  | { ok: true; version: number | null }
  | { ok: false; reason: "not-found" | "version-changed" };

/**
 * Narrows `bindRemoveEntity`'s result for a type whose registry entry declares no `blocker`
 * (redirect/comment/form_submission — none of `registry.ts`'s three entries for them sets one).
 * `TrashMarkerResult` (T1) is generic over every registered kind, so TypeScript cannot see that on
 * its own; this is the composition-root seam that carries the narrower promise those domains'
 * OWN structural types (`RemoveRedirectFn`/`RemoveCommentFn`/`RemoveFormSubmissionFn`) still make.
 * A `"blocked"` result here is a composition bug (a blocker was added to one of these three entries
 * without updating this call site to match) — fail fast rather than silently drop it.
 *
 * Shared by both composition roots (`server/runtime/composition`'s `app.ts` and `deps.ts`) and by
 * the tests that wire a blocker-free removal, so a test never carries its own drifting twin.
 *
 * @param required.remove the bound trash removal (`bindRemoveEntity`/`bindWidgetRemoval`, or a test
 *   double over an adapter's `hide`).
 * @returns the same removal, typed as the domain port's narrower result.
 * @throws Error when `remove` answers `"blocked"`.
 * @complexity O(1) beyond `remove` itself.
 */
export function removeEntityWithoutBlocker<Input extends { id: string }>(
  required: { remove: (input: Input) => Promise<TrashMarkerResult> },
  _optional: Record<string, never> = {}
): (input: Input) => Promise<RemoveWithoutBlockerResult> {
  return async (input) => {
    const result = await required.remove(input);
    if (!result.ok && result.reason === "blocked") {
      throw new Error(`trash: '${input.id}' reported 'blocked' from a type registered with no blocker — composition bug`);
    }
    return result;
  };
}
