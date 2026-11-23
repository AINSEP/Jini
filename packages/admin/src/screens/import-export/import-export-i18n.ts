import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { IMPORT_EXPORT_ES_ID_DE_ZH_CN_ZH_TW_PT_BR } from "./import-export-i18n/import-export-es-id-de-zh-cn-zh-tw-pt-br.js";
import { IMPORT_EXPORT_RU_FA_AR_JA_KO_PL } from "./import-export-i18n/import-export-ru-fa-ar-ja-ko-pl.js";
import { IMPORT_EXPORT_HU_FR_UK_TR_TH_IT_HI_UR_BN } from "./import-export-i18n/import-export-hu-fr-uk-tr-th-it-hi-ur-bn.js";

import { createDictionaryTranslator } from '@jini-ai/core/text';
/**
 * @file Copy for the Operations → Import & Export panel, every locale the site-transfer dictionary carries.
 * The titles reuse the wording the screens they link to already use (Deployment → Static Site,
 * the nav's "Import & Export"), so a card and its destination read the same in every language. The Export and Import tabs' own content reads the Sites dictionary
 * (the host's site-transfer translator); only the tab labels live here.
 * The per-locale blocks live in `import-export-i18n/` (size ratchet).
 */
export const IMPORT_EXPORT_DICT: Record<string, Record<string, string>> = {
  ...IMPORT_EXPORT_ES_ID_DE_ZH_CN_ZH_TW_PT_BR,
  ...IMPORT_EXPORT_RU_FA_AR_JA_KO_PL,
  ...IMPORT_EXPORT_HU_FR_UK_TR_TH_IT_HI_UR_BN,
};

export const t = createDictionaryTranslator({ featureDictionary: IMPORT_EXPORT_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
