import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from '@jini-ai/core/text';
import { MEMBERS_LOCALES_A } from "./members-i18n.locales-a.js";
import { MEMBERS_LOCALES_B } from "./members-i18n.locales-b.js";
/**
 * @file Spanish translation for the Members screen (`Members.tsx`) — this feature's own
 * dictionary, not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over
 * other admin sections can't collide on the same file. Same two-step fallback every other `t()`
 * in this app uses: translated value, else the English source string itself.
 *
 * Product copy stays the host's: the page description and empty-state text a host passes to
 * `Members` (`description`/`emptyDescription`) are translated by the host's own `hostCopy`, which
 * {@link createMembersTranslator} layers over this dictionary.
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
export const MEMBERS_DICT: Record<string, Record<string, string>> = { ...MEMBERS_LOCALES_A, ...MEMBERS_LOCALES_B };

/**
 * `hostCopy[locale]?.[key] ?? MEMBERS_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`.
 * @example const t = createMembersTranslator({ commonDictionary: HOST_COMMON_I18N }, { hostCopy: HOST_MEMBERS_COPY });
 */
export function createMembersTranslator(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  { hostCopy = {} }: { hostCopy?: LocaleDictionary | undefined } = {},
): DictionaryTranslator {
  const locales = new Set([...Object.keys(MEMBERS_DICT), ...Object.keys(hostCopy)]);
  const featureDictionary = Object.fromEntries([...locales].map(locale => [locale, { ...MEMBERS_DICT[locale], ...hostCopy[locale] }]));
  return createDictionaryTranslator({ featureDictionary }, { commonDictionary });
}
