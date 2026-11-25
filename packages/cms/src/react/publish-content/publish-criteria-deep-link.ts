import { querySuffix } from "@jini-ai/core/admin-runtime";

/**
 * @file `publish-criteria-tool-webmcp-plan-2026-09-24.md` §4 S2, the owner's own "PLUS" instruction
 * (not in the written plan file) — a chat conversation with no admin tab open can't call
 * `requestPublish` itself, so it hands back a link instead: `/admin/?publish=<encoded criteria>`.
 * {@link takePublishCriteriaFromQuery} is the one-time read/strip step for that query param, the
 * same shape `boot-token-fragment.ts`'s `takeBootToken` already established for the zip launcher's
 * `#boot=<token>` fragment — narrowed `Location`/`History` types, pure, unit-tested directly. No
 * logic belongs in `apps/admin/src/App.hooks.ts`'s `.tsx` sibling (memory `component_logic_belongs_hooks`), so
 * this pure helper is the one place that parses or mutates the query string.
 *
 * Unlike `takeBootToken`, an invalid payload still gets stripped — `decodePublishCriteriaFromQuery`
 * already never throws and returns `null` for anything malformed (see that function's own doc), and
 * leaving a dead `?publish=` param sitting in the address bar after a bad link was followed would
 * only confuse whoever looks at it next.
 */

/** The subset of `Location` this module reads. Narrowed (not the whole DOM `Location`) so a test
 *  can pass a plain object instead of a real `window.location` — same reasoning as
 *  `boot-token-fragment.ts`'s own `BootTokenLocation`. */
type PublishCriteriaLocation = Pick<Location, "search" | "pathname" | "hash">;

/** The subset of `History` this module writes through. Narrowed to the one method used, for the
 *  same testability reason as {@link PublishCriteriaLocation}. */
type PublishCriteriaHistory = Pick<History, "replaceState">;

/**
 * Reads and consumes a `?publish=<encoded PublishCriteria>` query param.
 *
 * @param location - `window.location` (or an equivalent) — read only, never written.
 * @param history - `window.history` (or an equivalent) — `replaceState` is called at most once,
 *   only when the param was actually present (whether or not it decoded to something valid).
 * @returns the decoded `PublishCriteria`, or `null` when the param is absent OR present but
 *   malformed — either way it is stripped, so a bad link never leaves a dead param behind.
 * @complexity O(n) in the query string's own param count; one `URLSearchParams` pass, no nested
 *   iteration.
 */
export function takePublishCriteriaFromQuery<T>(
  { location, history, parameter, decode }: { location: PublishCriteriaLocation; history: PublishCriteriaHistory; parameter: string; decode: (required: { raw: string }, optional?: Record<string, never>) => T | null },
  _optional: Record<string, never> = {},
): T | null {
  const params = new URLSearchParams(location.search);
  const raw = params.get(parameter);
  if (raw === null) return null;

  // Every OTHER query param is kept, in place — only this one is removed. An empty remainder
  // collapses to no `?` at all, rather than a bare trailing one; `location.hash` is carried through
  // unmodified, same as `boot-token-fragment.ts`'s own pathname/search preservation.
  params.delete(parameter);
  const rest = params.toString();
  const nextUrl = `${location.pathname}${querySuffix({ query: rest })}${location.hash}`;
  history.replaceState(null, "", nextUrl);

  return decode({ raw }, {});
}
