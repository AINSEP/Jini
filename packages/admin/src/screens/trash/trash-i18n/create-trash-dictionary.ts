import { createDictionaryTranslator, mergeLocaleOverlays, type LocaleDictionary } from "@jini-ai/core/text";
import { TRASH_I18N_A } from "./trash-i18n-a.js";
import { TRASH_I18N_B } from "./trash-i18n-b.js";
import { TRASH_I18N_C } from "./trash-i18n-c.js";

/**
 * @file Dictionary for the Trash screen.
 *
 * Every copy string on this screen goes through `t(locale, key)` with the English copy AS the key,
 * which is the host's convention (`comments-i18n.ts`, `@jini-ai/admin/screens/redirects/redirects-i18n`, …). `createDictionaryTranslator`
 * falls through to the host's shared common dictionary (which already carries "Trash", "Delete permanently", "Cancel",
 * "Delete", "Kind", "Title", "Status") and then to the English key itself, so a locale/key this file does
 * not carry renders the English source string rather than a placeholder.
 *
 * Covers the same 21 locales every other feature dictionary in the host ships (`es`, `id`, `de`,
 * `zh-CN`, `zh-TW`, `pt-BR`, `ru`, `fa`, `ar`, `ja`, `ko`, `pl`, `hu`, `fr`, `uk`, `tr`, `th`, `it`,
 * `hi`, `ur`, `bn`) — confirmed by grepping `comments-i18n.ts`, `media-i18n.ts`, and
 * `external-mcp-i18n.ts` for their locale blocks rather than assuming; all three agree with each
 * other and with the host's common dictionary.
 *
 * `Restore`, `Load more`, `Loading…`, `Delete permanently?`, `This cannot be undone.` and the
 * `Comment`/`Media` entity-kind nouns reuse the exact translated values already established for the
 * same English string in `comments-i18n.ts` / `posts-i18n.ts` / `media-i18n.ts`, per the host's own
 * convention of not inventing a second wording for a phrase another feature already translated.
 *
 * Plural note: `"{count} selected"` and `"{count} item(s) will be deleted permanently. …"` go through
 * this file's own flat `t()` + `interpolate()` call sites in `Trash.tsx`/`rules.ts` — there is no
 * `pickPlural` wiring at those call sites (see `Jini packages/ui/src/features/i18n/template-i18n.ts`), so these translations follow
 * the SAME precedent `taxonomy-i18n.ts` already established for its own `"{count} …(s)…"` string:
 * languages with a written singular/plural noun contrast keep the source's own "(s)"-style
 * parenthetical marker (`es`, `de`, `pt-BR`, `fr`, `it`), and languages where numeral + noun does not
 * take a written plural marker (`id`, `zh-CN`, `zh-TW`, `ja`, `ko`, `th`, `hu`, `tr`, `fa`, `hi`, `ur`,
 * `bn`) use the plain singular form regardless of count. `ru`, `uk`, and `pl` have three-plus-form
 * plural systems (1 / 2–4 / 5+, or similar) that neither this marker convention nor a two-form
 * `pickPlural` can express correctly; those three use one invariant plural-leaning form, same
 * simplification `taxonomy-i18n.ts` already accepted for the identical problem in the identical three
 * locales. This is a known, reported limitation — see the handoff — not a silent gap.
 */

/**
 * The composed Trash dictionary plus the translator the host's screen, rules and hook call. The host
 * binds it once with its own shared-words dictionary (K4-i18n-common) and may pass `productEntries`:
 * per-locale entries whose key or value names the product (K3), which never ship in this package and
 * are composed last so they win on a collision. The three slices carry disjoint locale sets, so their
 * spread keeps the host-visible locale order (language pickers and parity tests read the keys).
 */
export function createTrashDictionary(
  { commonDictionary, productEntries = {} }: { commonDictionary: LocaleDictionary; productEntries?: LocaleDictionary },
  _optional: Record<string, never> = {},
) {
  const dictionary = mergeLocaleOverlays(
    { base: { ...TRASH_I18N_A, ...TRASH_I18N_B, ...TRASH_I18N_C } },
    { overlays: [productEntries] },
  );
  const t = createDictionaryTranslator({ featureDictionary: dictionary }, { commonDictionary });
  return { dictionary, t };
}
