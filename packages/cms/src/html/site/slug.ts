/**
 * @file The one text → URL-slug rule: post slugs, form and widget slugs, region handles and heading
 * anchors all derive through {@link toSlug}.
 *
 * It used to be `[^a-z0-9]+ → -` in five places. That turned "Café Münster" into `caf-m-nster` and
 * any Cyrillic, Greek or Arabic title into `""`. `@sindresorhus/slugify` transliterates instead.
 *
 * **ASCII output is byte-identical to the old rule, on purpose.** Heading anchors are recomputed at
 * every render, so any ASCII difference would silently break existing `#fragment` links. The
 * package's defaults do differ (`fooBar` → `foo-bar`, `AT&T` → `at-and-t`, `Don't` → `dont`, and
 * `^`/`` ` `` are dropped rather than used as separators). The pre-pass below turns every ASCII
 * character outside `[A-Za-z0-9]` into a space before the package sees it, and `decamelize: false`
 * keeps case boundaries joined. That combination matched the old regex on 500,000 random all-ASCII
 * strings with no mismatch (build-vs-borrow-verified 2026-09-28 §2); `__tests__/slug.test.ts` keeps
 * the old rule as its oracle.
 *
 * Scripts with no transliteration (CJK, Hebrew) still come out `""`. Callers keep their own fallback.
 */
import slugify from "@sindresorhus/slugify";

/** Every ASCII character that is not a letter or digit: exactly the old rule's separator set. */
const ASCII_NON_ALNUM = /[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;

/** Lower-case, hyphen-separated, ASCII-only slug of `text`; `""` when nothing survives.
 *  @complexity O(text length). */
export function toSlug({ text }: { text: string }, _optional = {}): string {
  return slugify(text.replace(ASCII_NON_ALNUM, " "), { decamelize: false });
}
