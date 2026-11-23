import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { CONTENT_ANALYSIS_KEYS } from "./content-analysis-i18n.keys.js";
import { CONTENT_ANALYSIS_ROWS_A } from "./content-analysis-i18n.rows-a.js";
import { CONTENT_ANALYSIS_ROWS_B } from "./content-analysis-i18n.rows-b.js";
/**
 * @file The Content analysis card's dictionary (AW-7 Tier 2, `ContentAnalysisCard.tsx` and
 * `rules.ts`'s copy tables), in all 21 locales the admin ships. Same `DICT[locale]?.[key] ?? key`
 * shape every `*-i18n.ts` file uses, resolved through `createDictionaryTranslator` so a missing key
 * falls back to `ADMIN_COMMON_I18N` and then to the English key itself.
 *
 * Stored as one English key list plus a same-order translation row per locale, rather than 21
 * key→value objects: 58 keys × 21 locales would otherwise repeat every long English sentence 21
 * times. `content-analysis-i18n.unit.test.ts` holds every row to the key list (same length, every
 * key present, `{placeholders}` intact), so a row that drifts out of order fails there.
 *
 * `{placeholder}` templates are filled by `interpolate` AFTER translation (see `rules.ts`), so each
 * locale places the value where its own grammar wants it.
 *
 * Split by locale group (file-size limit): the key list lives in `content-analysis-i18n.keys.ts`,
 * the rows in `content-analysis-i18n.rows-a.ts` / `-b.ts`, merged here in the original order.
 */

/** One row per locale, in {@link CONTENT_ANALYSIS_KEYS} order; locale keys are disjoint, so the spread order is the old literal order. */
export const CONTENT_ANALYSIS_ROWS: Record<string, readonly string[]> = { ...CONTENT_ANALYSIS_ROWS_A, ...CONTENT_ANALYSIS_ROWS_B };

function buildDictionary(
  keys: readonly string[],
  rows: Record<string, readonly string[]>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Object.entries(rows).map(([locale, row]) => [locale, Object.fromEntries(keys.map((key, index) => {
      const value = row[index];
      if (value === undefined) throw new Error(`content analysis dictionary ${locale} is missing ${key}`);
      return [key, value];
    }))]),
  );
}

export const CONTENT_ANALYSIS_DICT: Record<string, Record<string, string>> = buildDictionary(CONTENT_ANALYSIS_KEYS, CONTENT_ANALYSIS_ROWS);

/** `CONTENT_ANALYSIS_DICT[locale]?.[key] ?? ADMIN_COMMON_I18N[locale]?.[key] ?? key` — the feature's hook
 *  binds it to the admin locale (`use-content-analysis.hooks.ts`). */
export const t = createDictionaryTranslator({ featureDictionary: CONTENT_ANALYSIS_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
