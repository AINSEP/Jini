import { translate } from "./consent-dictionary.js";
import { type Translate } from '@jini-ai/core/text';

/**
 * @file Copy for Administration → Cookie Consent. One dictionary per locale serves both this page
 * and the Jini field sections it renders (they take the same English-keyed `dictionary`), so a
 * label reads the same wherever it appears.
 */

export interface ConsentTranslation {
  t: Translate;
  /** The locale's entries, for the Jini sections' `dictionary` prop; English falls through. */
  dictionary: Readonly<Record<string, string>>;
}

/** Binds both to one locale. The host's `useTranslate` hook resolves the admin's locale and memoizes
 * this per locale. @complexity O(1) per lookup. */
export function consentTranslation({ locale }: { locale: string }, _optional: Record<string, never> = {}): ConsentTranslation {
  return { t: (key: string) => translate({ locale, key }), dictionary: translate.dictionary[locale] ?? {} };
}
