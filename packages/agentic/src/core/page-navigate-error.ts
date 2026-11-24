/**
 * @file Rewraps `page.navigate`'s "not a published page" refusal with host wording.
 *
 * `executePageCapability` (`page-executor.ts`) refuses an unregistered page id with:
 *
 * ```
 * "${safePage}" is not a published page. Available: ${safePages join(', ') or '(none)'}
 * ```
 *
 * That message is correct for what it checks — `safePages` are the host's registered screen ids,
 * never a content title or slug. But "page" and "published" are also the vocabulary a CMS-style
 * host uses for its own, unrelated content records, so a request that meant a content page can
 * read this refusal as "there is no published page named that" rather than "that is not a
 * registered screen id". The executor's own message stays as it is (accurate, and shared by every
 * host); a host whose vocabulary collides rewraps it at its `page.navigate` registration instead,
 * reshaping the lower-layer error before it reaches the model rather than editing the layer that
 * threw it. Only the host knows its words, so it injects `describeRefusal`.
 */

/** The tool id `page.navigate`'s capability is registered under (capability ids become tool ids verbatim). */
export const PAGE_NAVIGATE_TOOL_ID = 'page.navigate';

/**
 * Matches the executor's exact refusal shape. Anchored at both ends (`^`/`$`) so a message that
 * merely CONTAINS this phrase (unlikely, but not worth risking) is not mistaken for the refusal
 * itself; `s` so a page id or screen list containing a stray newline (neither is expected, but
 * neither is impossible) does not break the match.
 */
const PAGE_NAVIGATE_NOT_FOUND_PATTERN = /^"(.*)" is not a published page\. Available: (.*)$/s;

/** The two parts of a refusal: the requested page id and the executor's available-screens list, both verbatim. */
export interface PageNavigateRefusal {
  readonly page: string;
  readonly availableScreens: string;
}

/** Host wording for a refusal; its result becomes the rewrapped error's message. */
export type DescribePageNavigateRefusal = (refusal: PageNavigateRefusal, optional?: Record<string, never>) => string;

/** The structural slice of a tool registration this module reads (no `@jini-ai/core` edge). */
export interface PageNavigateRegistration {
  readonly descriptor: { readonly id: string };
  readonly handler: (...args: never[]) => Promise<unknown>;
}

/**
 * Detects `page.navigate`'s "not a published page" refusal and rewraps it with the host's
 * `describeRefusal`; every other rejection passes through completely unchanged (the SAME object,
 * not a rebuilt copy — this function does not own any other error shape).
 *
 * @complexity O(n) in the message length (one regex match) — negligible, and run at most once per
 * rejected `page.navigate` call.
 */
export function rewrapPageNavigateError(
  { err, describeRefusal }: { err: unknown; describeRefusal: DescribePageNavigateRefusal },
  _optional = {},
): unknown {
  if (!(err instanceof Error)) return err;
  const match = PAGE_NAVIGATE_NOT_FOUND_PATTERN.exec(err.message);
  if (!match) return err;
  const [, page = '', availableScreens = ''] = match;
  return new Error(describeRefusal({ page, availableScreens }));
}

/**
 * The wiring half: rewraps ONLY the `page.navigate` registration's handler in a `try`/`catch` that
 * routes its rejection through {@link rewrapPageNavigateError}; every other registration is
 * returned as the identical object, untouched.
 *
 * A `.map` over the whole array rather than a lookup-and-splice: frontend tool registrations are a
 * flat, order-independent list (each entry is one capability's own tool), so there is no ordering
 * to preserve beyond "same length, same relative order" — which `.map` gives for free.
 *
 * @complexity O(n) in `registrations.length` to build the wrapped array; each wrapped handler adds
 * O(1) overhead (one `try`/`catch`) per invocation.
 */
export function withPageNavigateErrorRewrap<R extends PageNavigateRegistration>(
  { registrations, describeRefusal }: { registrations: readonly R[]; describeRefusal: DescribePageNavigateRefusal },
  _optional: Record<string, never> = {},
): readonly R[] {
  return registrations.map((registration) => {
    if (registration.descriptor.id !== PAGE_NAVIGATE_TOOL_ID) return registration;
    const handler = registration.handler as (...args: unknown[]) => Promise<unknown>;
    const rewrapped = async (...args: unknown[]): Promise<unknown> => {
      try {
        return await handler(...args);
      } catch (err) {
        throw rewrapPageNavigateError({ err, describeRefusal });
      }
    };
    return { ...registration, handler: rewrapped as R['handler'] };
  });
}
