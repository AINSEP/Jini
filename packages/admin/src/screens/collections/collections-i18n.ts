import { createDictionaryTranslator, type DictionaryTranslator, type LocaleDictionary, interpolate, localeEntry } from "@jini-ai/core/text";
import { COLLECTIONS_DICT_PART_1 } from "./i18n/collections-dict-1.js";
import { COLLECTIONS_DICT_PART_2 } from "./i18n/collections-dict-2.js";
import { COLLECTIONS_DICT_PART_3, COLLECTIONS_AUDIT_I18N, COLLECTIONS_EMBED_I18N } from "./i18n/collections-dict-3.js";

/**
 * @file Spanish dictionary for `Collections.tsx` (list + its three modals), `CollectionEntries.tsx`
 * (per-type entry list), and `CollectionEntryEditor.tsx` (entry editor). Same
 * `DICT[locale]?.[key] ?? key` shape `SettingsUi.tsx`'s own `const t` uses.
 *
 * A few entries are small `{placeholder}` templates rather than pre-split fragments — resolved with
 * a plain `.replace()` at the call site — since the interpolated value (a content-type or entry
 * label) sits in the middle of the Spanish sentence, not always in the same relative position
 * English puts it.
 */

const COLLECTIONS_DICT: Record<string, Record<string, string>> = { ...COLLECTIONS_DICT_PART_1, ...COLLECTIONS_DICT_PART_2, ...COLLECTIONS_DICT_PART_3 };


function mergeDictionaryTranslations(
  dictionary: Record<string, Record<string, string>>,
  translationsByLocale: Record<string, Record<string, string>>,
) {
  for (const [locale, translations] of Object.entries(translationsByLocale)) {
    const block = dictionary[locale];
    if (block === undefined) throw new Error(`collections dictionary has no ${locale} block to extend`);
    Object.assign(block, translations);
  }
}

mergeDictionaryTranslations(COLLECTIONS_DICT, COLLECTIONS_AUDIT_I18N);
mergeDictionaryTranslations(COLLECTIONS_DICT, COLLECTIONS_EMBED_I18N);

/** The host binds its commonDictionary once. `t` is `COLLECTIONS_DICT[locale]?.[key] ?? commonDictionary[locale]?.[key] ?? key`
 *  via `createDictionaryTranslator`, so a shared word this dict doesn't carry for a locale still renders translated.
 *  The host's `.hooks.ts` files (no JSX) import the bound `t` directly instead of duplicating the lookup. */
export function createCollectionsDictionary(
  { commonDictionary }: { commonDictionary: LocaleDictionary },
  _optional = {},
): { t: DictionaryTranslator } {
  const featureDictionary = COLLECTIONS_DICT;
  return { t: createDictionaryTranslator({ featureDictionary }, { commonDictionary }) };
}

const LIFECYCLE_VERB: Record<string, Record<"deprecate" | "reactivate" | "tombstone", string>> = {
  en: { deprecate: "deprecate", reactivate: "reactivate", tombstone: "tombstone" },
  es: { deprecate: "marcar como obsoleto", reactivate: "reactivar", tombstone: "eliminar definitivamente" },
  id: { deprecate: "menandai usang", reactivate: "mengaktifkan kembali", tombstone: "menghapus permanen" },
  de: { deprecate: "als veraltet markiert", reactivate: "reaktiviert", tombstone: "endgültig gelöscht" },
  "zh-CN": { deprecate: "标记为已弃用", reactivate: "重新启用", tombstone: "永久删除" },
  "zh-TW": { deprecate: "標記為已淘汰", reactivate: "重新啟用", tombstone: "永久刪除" },
  "pt-BR": { deprecate: "marcar como obsoleto", reactivate: "reativar", tombstone: "excluir definitivamente" },
  ru: { deprecate: "пометить как устаревшее", reactivate: "восстановить", tombstone: "удалить навсегда" },
  fa: { deprecate: "علامت‌گذاری به‌عنوان منسوخ", reactivate: "فعال‌سازی مجدد", tombstone: "حذف دائمی" },
  ar: { deprecate: "التمييز كمهمَل", reactivate: "إعادة التفعيل", tombstone: "الحذف نهائيًا" },
  ja: { deprecate: "非推奨に設定", reactivate: "再有効化", tombstone: "完全に削除" },
  ko: { deprecate: "지원 중단 처리", reactivate: "재활성화", tombstone: "영구 삭제" },
  pl: { deprecate: "oznaczyć jako przestarzałe", reactivate: "przywrócić", tombstone: "usunąć na stałe" },
  hu: { deprecate: "elavulttá jelölni", reactivate: "újraaktiválni", tombstone: "véglegesen törölni" },
  fr: { deprecate: "marquer comme obsolète", reactivate: "réactiver", tombstone: "supprimer définitivement" },
  uk: { deprecate: "позначити як застаріле", reactivate: "відновити", tombstone: "видалити назавжди" },
  tr: { deprecate: "kullanımdan kaldırma", reactivate: "yeniden etkinleştirme", tombstone: "kalıcı olarak silme" },
  th: { deprecate: "ทำเครื่องหมายว่าเลิกใช้งาน", reactivate: "เปิดใช้งานอีกครั้ง", tombstone: "ลบถาวร" },
  it: { deprecate: "contrassegnare come obsoleto", reactivate: "riattivare", tombstone: "eliminare definitivamente" },
  hi: {
    deprecate: "अप्रचलित के रूप में चिह्नित करना",
    reactivate: "पुनः सक्रिय करना",
    tombstone: "स्थायी रूप से हटाना",
  },
  ur: {
    deprecate: "متروک کے طور پر نشان زد کرنا",
    reactivate: "دوبارہ فعال کرنا",
    tombstone: "مستقل طور پر حذف کرنا",
  },
  bn: {
    deprecate: "অপ্রচলিত হিসেবে চিহ্নিত করা",
    reactivate: "পুনরায় সক্রিয় করা",
    tombstone: "স্থায়ীভাবে মুছে ফেলা",
  },
};

const LIFECYCLE_FAILURE_TEMPLATE: Record<string, string> = {
  en: 'Failed to {verb} "{label}"',
  es: 'No se pudo {verb} "{label}"',
  id: 'Gagal {verb} "{label}"',
  de: '"{label}" konnte nicht {verb} werden',
  "zh-CN": '无法{verb}"{label}"',
  "zh-TW": '無法{verb}"{label}"',
  "pt-BR": 'Não foi possível {verb} "{label}"',
  ru: 'Не удалось {verb} "{label}"',
  fa: '{verb} "{label}" ناموفق بود',
  ar: 'تعذّر {verb} "{label}"',
  ja: '"{label}"を{verb}できませんでした',
  ko: '"{label}"을(를) {verb}하지 못했습니다',
  pl: 'Nie udało się {verb} "{label}"',
  hu: 'Nem sikerült {verb}: "{label}"',
  fr: 'Impossible de {verb} « {label} »',
  uk: 'Не вдалося {verb} "{label}"',
  tr: '"{label}" {verb} işlemi başarısız oldu',
  th: 'ไม่สามารถ{verb} "{label}" ได้',
  it: 'Impossibile {verb} "{label}"',
  hi: '"{label}" को {verb} नहीं हो सका',
  ur: '"{label}" کو {verb} نہیں ہو سکا',
  bn: '"{label}" {verb} যায়নি',
};

/** `useCollections`' `runLifecycle` failure message — embeds the raw lifecycle op
 *  ("deprecate"/"reactivate"/"tombstone") and the content type's own (untranslated) `label` mid-
 *  sentence, so it can't be a flat `COLLECTIONS_DICT` entry. Reuses this dictionary's own
 *  Deprecate/Reactivate/Tombstone verb translations rather than inventing new wording. */
export function lifecycleFailureMessage(
  { locale, op, label }: { locale: string; op: "deprecate" | "reactivate" | "tombstone"; label: string },
  _optional = {},
): string {
  const verb = localeEntry({ table: LIFECYCLE_VERB, locale })[op];
  return interpolate({ template: localeEntry({ table: LIFECYCLE_FAILURE_TEMPLATE, locale }), vars: { verb, label } });
}

const ENTRY_LIFECYCLE_FAILURE: Record<string, Record<"publish" | "unpublish", string>> = {
  en: { publish: "Failed to publish entry", unpublish: "Failed to unpublish entry" },
  es: { publish: "No se pudo publicar la entrada", unpublish: "No se pudo anular la publicación de la entrada" },
  id: { publish: "Gagal memublikasikan entri", unpublish: "Gagal membatalkan publikasi entri" },
  de: {
    publish: "Eintrag konnte nicht veröffentlicht werden",
    unpublish: "Veröffentlichung des Eintrags konnte nicht aufgehoben werden",
  },
  "zh-CN": { publish: "无法发布条目", unpublish: "无法取消发布条目" },
  "zh-TW": { publish: "無法發布項目", unpublish: "無法取消發布項目" },
  "pt-BR": { publish: "Não foi possível publicar a entrada", unpublish: "Não foi possível despublicar a entrada" },
  ru: { publish: "Не удалось опубликовать запись", unpublish: "Не удалось снять запись с публикации" },
  fa: { publish: "انتشار ورودی ناموفق بود", unpublish: "لغو انتشار ورودی ناموفق بود" },
  ar: { publish: "تعذّر نشر الإدخال", unpublish: "تعذّر إلغاء نشر الإدخال" },
  ja: { publish: "エントリを公開できませんでした", unpublish: "エントリの公開を取り消せませんでした" },
  ko: { publish: "항목을 게시하지 못했습니다", unpublish: "항목 게시를 취소하지 못했습니다" },
  pl: { publish: "Nie udało się opublikować wpisu", unpublish: "Nie udało się cofnąć publikacji wpisu" },
  hu: {
    publish: "Nem sikerült közzétenni a bejegyzést",
    unpublish: "Nem sikerült visszavonni a bejegyzés közzétételét",
  },
  fr: { publish: "Échec de la publication de l'entrée", unpublish: "Échec de la dépublication de l'entrée" },
  uk: { publish: "Не вдалося опублікувати запис", unpublish: "Не вдалося зняти запис з публікації" },
  tr: { publish: "Girdi yayımlanamadı", unpublish: "Girdinin yayımı kaldırılamadı" },
  th: { publish: "ไม่สามารถเผยแพร่รายการได้", unpublish: "ไม่สามารถยกเลิกการเผยแพร่รายการได้" },
  it: {
    publish: "Impossibile pubblicare la voce",
    unpublish: "Impossibile rimuovere la pubblicazione della voce",
  },
  hi: { publish: "प्रविष्टि प्रकाशित नहीं की जा सकी", unpublish: "प्रविष्टि का प्रकाशन रद्द नहीं किया जा सका" },
  ur: { publish: "اندراج شائع نہیں کیا جا سکا", unpublish: "اندراج کی اشاعت منسوخ نہیں کی جا سکی" },
  bn: { publish: "এন্ট্রি প্রকাশ করা যায়নি", unpublish: "এন্ট্রির প্রকাশনা বাতিল করা যায়নি" },
};

/** `useCollectionEntryEditor`'s `toggleLifecycle` failure message — embeds the raw op
 *  ("publish"/"unpublish"), so it can't be a flat `COLLECTIONS_DICT` entry. Reuses this
 *  dictionary's own Publish/Unpublish verb translations. */
export function entryLifecycleFailureMessage({ locale, op }: { locale: string; op: "publish" | "unpublish" }, _optional = {}): string {
  return localeEntry({ table: ENTRY_LIFECYCLE_FAILURE, locale })[op];
}