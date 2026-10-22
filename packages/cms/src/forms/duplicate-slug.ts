import { SLUG_PATTERN } from "./write-service.js";
import { deriveAvailableName } from "@jini-ai/core/naming";

/**
 * @file `content_duplicate`'s `"form"` resource needs a slug for the copy, and Forms — unlike Posts —
 * has nowhere to get one.
 *
 * `createPost` derives and disambiguates a slug itself whenever the caller omits one, which is why
 * `duplicatePostOrPage` can just pass `slug: undefined` and be done. `createFormDefinition` is the
 * opposite: `slug` is required, is immutable after creation (`updateFormDefinition` always re-passes
 * `existing.slug`), and is validated against `@jini-ai/cms/forms`' `SLUG_PATTERN` plus the adapter's
 * reserved set. Duplicating a form therefore has to arrive with a valid, free slug in hand — otherwise every
 * copy of "Contact Us" collides with the previous one and the operator sees a raw
 * `FormSlugConflictError` instead of a copy.
 *
 * Kept as its own pure module (mirroring `features/post/duplicate-embeds.ts`) rather than inlined in
 * `tool-registrations.ts`: the character-class, truncation and suffix-search edges are exactly the
 * kind of logic that is cheap to assert directly and expensive to reach through a repo, a command
 * gateway and an outbox.
 *
 * Deliberately NOT exported as a general-purpose Forms slug helper: `forms_create_definition` still
 * takes an explicit caller-supplied slug, and giving it a silent derivation would change a published
 * tool contract this task has no mandate to change.
 *
 * The bounded suffix-search LOOP itself was first shared with
 * `../content-duplication/derive-available-name.ts` (2026-09-08), generalized from this file's own
 * original loop. Its implementation and rationale now live in `@jini-ai/core/naming`'s
 * `deriveAvailableName`, keeping the collision-search shape shared with the NAME derivation every
 * `content_duplicate` resource needs, rather than reinvented a second time. This file keeps
 * everything SLUG-specific: the character class (`slugifyFormName`), the length ceiling and
 * base-shortening (`withSuffix`), and the reserved-word list (`RESERVED_SLUGS`).
 */

/** The ceiling `SLUG_PATTERN` (`^[a-z0-9][a-z0-9-]{0,63}$`) itself imposes: 1 + 63 characters. */
export const FORM_SLUG_MAX_LENGTH = 64;

/**
 * The slug used when a name has no sluggable characters at all (e.g. `"!!! ---"`, or a name written
 * entirely in a script this ASCII-only pattern cannot represent). `SLUG_PATTERN` has no "empty"
 * form, so something concrete has to stand in; the suffix search below then disambiguates it the
 * same way it disambiguates any other collision.
 */
const FALLBACK_SLUG = "form";

/**
 * Route sentinel the admin Forms editor reserves for its own create-mode URL — re-stated from
 * `write-service.ts`'s private `RESERVED_SLUGS` because it is private there. A derived slug landing
 * on it is treated as taken rather than rejected: the caller never chose it, so suffixing is the
 * right repair, and `createFormDefinition` would reject it outright a moment later anyway.
 */
// The host supplies this reserved set; its admin create-route sentinel remains host policy.

/**
 * Converts a form name into the longest `SLUG_PATTERN`-satisfying slug it can, or `""` when the name
 * contains nothing sluggable.
 *
 * Returns `""` rather than a fallback so a caller can tell "nothing to work with" apart from a real
 * derivation — {@link deriveAvailableFormSlug} is where the fallback is applied. Truncation trims any
 * hyphen the cut exposes, since a trailing hyphen is legal under the pattern but reads as a mistake.
 *
 * @param name - The (possibly already numbered, e.g. "Landing sample — xai 2") form name to derive
 * from.
 * @returns A slug of at most {@link FORM_SLUG_MAX_LENGTH} characters, or `""`.
 * @complexity O(n) in the name's length.
 */
export function slugifyFormName(
  { name, slugify }: { name: string; slugify: (name: string) => string },
  _optional: Record<string, never> = {},
): string {
  return slugify(name).slice(0, FORM_SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

/**
 * Derives a slug for a duplicated form that is both valid under `SLUG_PATTERN` and free.
 *
 * `isTaken` is injected rather than a repo handle so the search is directly testable and so this
 * module carries no port dependency; production passes a `formDefinitionRepo.findBySlug` lookup.
 * Note this is advisory, not a lock: the DB unique index remains the real tie-break, so a genuine
 * race still surfaces as `FormSlugConflictError` from `createFormDefinition`. That is the intended
 * split (`write-service.ts`'s own header states it), not a gap this function is trying to close.
 *
 * The suffix is appended within the length ceiling, truncating the base as needed, so a maximum
 * length name still disambiguates instead of producing an over-long slug create would reject.
 *
 * @param required.name - The copy's name, already defaulted by the caller.
 * @param options.isTaken - Whether a candidate slug is already used in this workspace.
 * @returns A slug satisfying `SLUG_PATTERN` that `isTaken` reported free.
 * @throws {Error} If {@link MAX_SUFFIX_ATTEMPTS} candidates are all taken.
 * @complexity O(k) `isTaken` calls where k is the number of colliding candidates, bounded at
 * {@link MAX_SUFFIX_ATTEMPTS}.
 */
export async function deriveAvailableFormSlug(
  required: { name: string; slugify: (name: string) => string; maxAttempts: number; reservedSlugs: ReadonlySet<string>; isTaken: (slug: string) => Promise<boolean> },
  _optional: Record<string, never> = {}
): Promise<string> {
  const base = slugifyFormName({ name: required.name, slugify: required.slugify }) || FALLBACK_SLUG;

  return deriveAvailableName(
    {
      base,
      withSuffix: ({ base, suffix }) => withSuffix(base, suffix),
      // RESERVED_SLUGS/SLUG_PATTERN are "skip this candidate", not "this candidate is taken" — but
      // the generic loop makes no distinction between the two (see its own doc), so folding both
      // checks in here reproduces this function's original `continue`-then-try-the-next-suffix
      // behavior exactly.
      isTaken: async ({ candidate }) => {
        if (required.reservedSlugs.has(candidate)) return true;
        if (!SLUG_PATTERN.test(candidate)) return true;
        return required.isTaken(candidate);
      },
      exhaustionMessage: ({ maxAttempts }) =>
        `no free slug could be derived from '${required.name}' after ${maxAttempts} attempts — ` +
          "give the copy an explicit slug",
    },
    { maxAttempts: required.maxAttempts },
  );
}

/**
 * Appends `-<suffix>` while keeping the result within {@link FORM_SLUG_MAX_LENGTH}, shortening the
 * base (never the suffix) when the two together would overflow — the suffix is what makes the slug
 * unique, so it is the half that must survive.
 *
 * @complexity O(1).
 */
function withSuffix(base: string, suffix: number): string {
  const tail = `-${suffix}`;
  const room = FORM_SLUG_MAX_LENGTH - tail.length;
  return `${base.slice(0, room).replace(/-+$/g, "")}${tail}`;
}
