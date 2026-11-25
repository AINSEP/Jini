import { translate } from "./consent-dictionary.js";
import { bindDictionaryNames } from "../../core/bind-dictionary-names.js";
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
  /** The host product's name, handed on to the sections so they can name their own copy after it. */
  productName: string;
}

/** Binds both to one locale. The host's `useTranslate` hook resolves the admin's locale and memoizes
 * this per locale. The dictionary writes the host's product as `{productName}`, so the host passes
 * its own name here and no product is spelled by the package. @complexity O(k) in the locale's entries. */
export function consentTranslation({ locale, productName }: { locale: string; productName: string }, _optional: Record<string, never> = {}): ConsentTranslation {
  const block = translate.dictionary[locale];
  const dictionary = block ? bindDictionaryNames({ dictionary: { [locale]: block }, names: { productName } })[locale] ?? {} : {};
  return { t: (key: string) => translate({ locale, key }), dictionary, productName };
}
