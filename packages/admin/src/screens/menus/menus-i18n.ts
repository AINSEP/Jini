import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";
import { MENUS_DICT_ES_TO_RU } from "./i18n/menus-dict-es-to-ru.js";
import { MENUS_DICT_FA_TO_HU } from "./i18n/menus-dict-fa-to-hu.js";
import { MENUS_DICT_FR_TO_IT } from "./i18n/menus-dict-fr-to-it.js";
import { MENUS_DICT_HI_TO_BN } from "./i18n/menus-dict-hi-to-bn.js";

/**
 * @file Spanish dictionary for `Menus.tsx` (list) and `MenuEditor.tsx` (tree editor). `t()` falls
 * back to `COMMON_I18N` via `createDictionaryTranslator`, same as `trash-i18n.ts`.
 *
 * Out of scope: the native `window.confirm()` prompt `ItemRow`'s Remove button opens for an item
 * with descendants — a browser-chrome dialog, not this app's own styled `ConfirmDialog` surface.
 */

const MENUS_DICT: Record<string, Record<string, string>> = {
  ...MENUS_DICT_ES_TO_RU,
  ...MENUS_DICT_FA_TO_HU,
  ...MENUS_DICT_FR_TO_IT,
  ...MENUS_DICT_HI_TO_BN,
};

/** `MENUS_DICT` had no exported `t` at all before the original S-I18N fix — `use-menus.hooks.ts`
 *  and `use-menu-editor.hooks.ts` each built their own no-fallback `MENUS_DICT[locale]?.[key] ??
 *  key` closure inline, which is why the confirm dialog's own button (then "Delete permanently",
 *  absent from `MENUS_DICT` in most locales) rendered English almost everywhere. That dialog is
 *  now the Trash rewrite's "Move to trash?" (2026-09-21, `trash-delete-architecture.md` — see this
 *  feature's own hook/`Menus.tsx` header), but the fallback this fixed still matters for every key
 *  this dict doesn't carry per-locale. `createDictionaryTranslator` falls through to `COMMON_I18N`
 *  before the raw English key, same as `trash-i18n.ts`. */
/** Page references reuse entryRef; these labels expose pages by title rather than their ids. */
const PAGE_LINK_COPY: Record<string, readonly [string, string, string]> = {
  "es": ["Página","Elige una página…","Página no publicada"],
  "id": ["Halaman","Pilih halaman…","Halaman belum diterbitkan"],
  "de": ["Seite","Seite auswählen…","Seite nicht veröffentlicht"],
  "zh-CN": ["页面","选择页面…","页面未发布"],
  "zh-TW": ["頁面","選擇頁面…","頁面未發佈"],
  "pt-BR": ["Página","Escolha uma página…","Página não publicada"],
  "ru": ["Страница","Выберите страницу…","Страница не опубликована"],
  "fa": ["صفحه","یک صفحه انتخاب کنید…","صفحه منتشر نشده است"],
  "ar": ["صفحة","اختر صفحة…","الصفحة غير منشورة"],
  "ja": ["ページ","ページを選択…","ページは未公開です"],
  "ko": ["페이지","페이지 선택…","게시되지 않은 페이지"],
  "pl": ["Strona","Wybierz stronę…","Strona nieopublikowana"],
  "hu": ["Oldal","Válasszon oldalt…","Az oldal nincs közzétéve"],
  "fr": ["Page","Choisissez une page…","Page non publiée"],
  "uk": ["Сторінка","Виберіть сторінку…","Сторінка не опублікована"],
  "tr": ["Sayfa","Bir sayfa seçin…","Sayfa yayımlanmamış"],
  "th": ["หน้า","เลือกหน้า…","หน้ายังไม่ได้เผยแพร่"],
  "it": ["Pagina","Scegli una pagina…","Pagina non pubblicata"],
  "hi": ["पृष्ठ","कोई पृष्ठ चुनें…","पृष्ठ प्रकाशित नहीं है"],
  "ur": ["صفحہ","ایک صفحہ منتخب کریں…","صفحہ شائع نہیں ہوا"],
  "bn": ["পৃষ্ঠা","একটি পৃষ্ঠা বেছে নিন…","পৃষ্ঠা প্রকাশিত হয়নি"],
};
const MENUS_DICTIONARY: Record<string, Record<string, string>> = Object.fromEntries(
  Object.entries(MENUS_DICT).map(([locale, block]) => {
    const copy = PAGE_LINK_COPY[locale];
    if (copy === undefined) return [locale, block];
    const [page, choosePage, unpublished] = copy;
    return [locale, { ...block, "Page": page, "Choose a page…": choosePage, "Page not published": unpublished }];
  }),
);

/** The host binds its commonDictionary once; `t` falls back to the common copy on a miss. */
export function createMenusDictionary(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = MENUS_DICTIONARY;
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}
