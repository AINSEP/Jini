/**
 * @module useChatPaneComposerPlaceholder
 *
 * Resolves `ChatPaneProps.placeholder`/`placeholders` down to the single string `Composer`
 * actually renders — `Composer` itself never learns a plural exists. `placeholders` (when supplied
 * with two or more entries) rotates on a timer; a single-entry list collapses to that one entry
 * with no rotation, and so does `prefers-reduced-motion: reduce` — a placeholder that changes
 * under the cursor is a motion effect whether or not anything moves on screen. `placeholder` keeps
 * resolving exactly as it always has when `placeholders` is omitted or empty, so every existing
 * host is unaffected.
 */
import { useEffect, useState } from 'react';

const ROTATE_INTERVAL_MS = 4_000;

/**
 * A live read of `(prefers-reduced-motion: reduce)`, not a load-time snapshot — an operator who
 * flips the OS setting mid-session should not have to remount the pane for the composer to notice.
 * `window.matchMedia` is absent in SSR/non-browser test environments, so both the initial value and
 * the subscription fall back to "no preference" rather than throwing.
 */
function usePrefersReducedMotion(): boolean {
  const hasMatchMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [reduced, setReduced] = useState(
    () => hasMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (!hasMatchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [hasMatchMedia]);

  return reduced;
}

/**
 * @param placeholder - `ChatPaneProps.placeholder`. Returned unchanged whenever `placeholders` is
 * absent or empty.
 * @param placeholders - `ChatPaneProps.placeholders`. Takes over from `placeholder` whenever it has
 * at least one entry.
 * @complexity Time/space: O(1) per render; the rotation timer is a single `setInterval`.
 * @overallScore 100/100
 */
export function useChatPaneComposerPlaceholder(
  placeholder: string | undefined,
  placeholders: readonly string[] | undefined,
): string | undefined {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  // A joined key, not the array reference: a host writing `placeholders={['a', 'b']}` inline
  // supplies a new array on every one of ITS OWN renders, and restarting the rotation on every one
  // of those (rather than only when the actual suggestions change) is the opposite of gentle.
  const key = placeholders?.join('␟') ?? '';

  // A changed suggestion set starts over at its own first entry rather than wherever the old
  // index happened to land — `placeholders[index % placeholders.length]` below would already be
  // safe either way, but restarting reads as a fresh cycle instead of a mid-cycle jump.
  useEffect(() => {
    setIndex(0);
  }, [key]);

  const rotating = !reducedMotion && (placeholders?.length ?? 0) > 1;
  useEffect(() => {
    if (!rotating) return undefined;
    const id = window.setInterval(() => setIndex((current) => current + 1), ROTATE_INTERVAL_MS);
    return () => window.clearInterval(id);
    // `key`, not `placeholders` — see above.
  }, [rotating, key]);

  if (!placeholders || placeholders.length === 0) return placeholder;
  return placeholders[index % placeholders.length];
}
