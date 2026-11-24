import { describe, expect, it } from "vitest";
import { t } from "../roles-i18n.js";
import { permissionRemoveBodyParts } from "../i18n/roles-sentence-parts.js";

/**
 * @file `roles-i18n.ts` — there was no dictionary test for this feature before C1. Scoped narrowly
 * to the strings C1 added (the "Remove permission?" title and the `permissionRemoveBodyParts`
 * sentence halves), rather than a full cross-locale parity sweep, so pre-existing dictionary drift
 * elsewhere in `ROLES_DICT` does not fail this file (`ROLES_DICT` itself is not exported — every
 * assertion here goes through the same `t`/`permissionRemoveBodyParts` a caller actually uses).
 */
// Reviewed copy expectations are literals, independent of the production translator.
const EXPECTED_TITLES: Record<string, string> = {
  es: "¿Quitar permiso?", id: "Hapus izin?", de: "Berechtigung entfernen?",
  "zh-CN": "移除权限？", "zh-TW": "移除權限？", "pt-BR": "Remover permissão?",
  ru: "Удалить разрешение?", fa: "مجوز حذف شود؟", ar: "هل تريد إزالة الإذن؟",
  ja: "権限を削除しますか？", ko: "권한을 제거하시겠습니까?", pl: "Usunąć uprawnienie?",
  hu: "Eltávolítod a jogosultságot?", fr: "Retirer l'autorisation ?", uk: "Вилучити дозвіл?",
  tr: "İzin kaldırılsın mı?", th: "นำสิทธิ์ออกหรือไม่?", it: "Rimuovere l'autorizzazione?",
  hi: "अनुमति हटाएं?", ur: "اجازت ہٹائیں؟", bn: "অনুমতি সরাবেন?",
};
const EXPECTED_BODY_PARTS: Record<string, { prefix: string; suffix: string }> = {
  en: { prefix: 'Remove "', suffix: '" from this policy? Anyone with this policy loses it.' },
  es: { prefix: '¿Quitar el permiso "', suffix: '" de esta política? Cualquiera que tenga esta política lo perderá.' },
  id: { prefix: 'Hapus izin "', suffix: '" dari kebijakan ini? Semua orang yang memiliki kebijakan ini akan kehilangannya.' },
  de: { prefix: 'Die Berechtigung „', suffix: '“ aus dieser Richtlinie entfernen? Jeder, der diese Richtlinie hat, verliert sie.' },
  "zh-CN": { prefix: '从此策略中移除权限"', suffix: '"？拥有此策略的所有人都会失去该权限。' },
  "zh-TW": { prefix: '從此政策中移除權限「', suffix: '」？擁有此政策的所有人都會失去該權限。' },
  "pt-BR": { prefix: 'Remover a permissão "', suffix: '" desta política? Todos que têm essa política a perderão.' },
  ru: { prefix: 'Удалить разрешение «', suffix: '» из этой политики? Все, у кого есть эта политика, потеряют его.' },
  fa: { prefix: 'مجوز «', suffix: '» از این خط‌مشی حذف شود؟ هرکسی که این خط‌مشی را دارد آن را از دست می‌دهد.' },
  ar: { prefix: 'إزالة الإذن "', suffix: '" من هذه السياسة؟ سيفقده كل من يملك هذه السياسة.' },
  ja: { prefix: 'このポリシーから権限「', suffix: '」を削除しますか？このポリシーを持つすべてのユーザーがこの権限を失います。' },
  ko: { prefix: '이 정책에서 "', suffix: '" 권한을 제거하시겠습니까? 이 정책을 가진 모든 사용자가 이 권한을 잃습니다.' },
  pl: { prefix: 'Usunąć uprawnienie „', suffix: '” z tej zasady? Każdy, kto ma tę zasadę, je straci.' },
  hu: { prefix: 'Eltávolítod a(z) „', suffix: '” jogosultságot ebből a szabályzatból? Mindenki elveszíti, akinek ez a szabályzata van.' },
  fr: { prefix: "Retirer l'autorisation « ", suffix: ' » de cette politique ? Toute personne disposant de cette politique la perdra.' },
  uk: { prefix: 'Вилучити дозвіл «', suffix: '» із цієї політики? Усі, хто має цю політику, втратять його.' },
  tr: { prefix: '"', suffix: '" izni bu politikadan kaldırılsın mı? Bu politikaya sahip herkes bu izni kaybeder.' },
  th: { prefix: 'นำสิทธิ์ "', suffix: '" ออกจากนโยบายนี้หรือไม่? ทุกคนที่มีนโยบายนี้จะสูญเสียสิทธิ์นี้' },
  it: { prefix: "Rimuovere l'autorizzazione \"", suffix: '" da questo criterio? Chiunque abbia questo criterio la perderà.' },
  hi: { prefix: 'इस नीति से अनुमति "', suffix: '" हटाएं? इस नीति वाला हर व्यक्ति इसे खो देगा।' },
  ur: { prefix: 'اس پالیسی سے اجازت "', suffix: '" ہٹائیں؟ اس پالیسی کا حامل ہر شخص اسے کھو دے گا۔' },
  bn: { prefix: 'এই নীতি থেকে "', suffix: '" অনুমতি সরাবেন? এই নীতি থাকা প্রত্যেকে এটি হারাবে।' },
};

const LOCALES = [
  "es", "id", "de", "zh-CN", "zh-TW", "pt-BR", "ru", "fa", "ar", "ja", "ko",
  "pl", "hu", "fr", "uk", "tr", "th", "it", "hi", "ur", "bn",
];

describe('t(locale, "Remove permission?") — C1', () => {
  for (const locale of LOCALES) {
    it(`translates for ${locale}`, () => {
      const translated = t({ locale: locale, key: "Remove permission?" });
      expect(translated.length).toBeGreaterThan(0);
      expect(translated).not.toBe("Remove permission?");
      expect(translated).toBe(EXPECTED_TITLES[locale]);
    });
  }
});

describe("permissionRemoveBodyParts — C1", () => {
  const en = { prefix: 'Remove "', suffix: '" from this policy? Anyone with this policy loses it.' };

  for (const locale of LOCALES) {
    it(`has a non-empty, translated prefix/suffix for ${locale}`, () => {
      const parts = permissionRemoveBodyParts({ locale });
      expect(parts.prefix.length).toBeGreaterThan(0);
      expect(parts.suffix.length).toBeGreaterThan(0);
      expect(parts.prefix).not.toBe(en.prefix);
      expect(parts.suffix).not.toBe(en.suffix);
      expect(parts).toEqual(EXPECTED_BODY_PARTS[locale]);
      expect(`${parts.prefix}posts.publish${parts.suffix}`).toBe(
        `${EXPECTED_BODY_PARTS[locale]!.prefix}posts.publish${EXPECTED_BODY_PARTS[locale]!.suffix}`,
      );
    });
  }

  it("falls back to English for an unrecognized locale", () => {
    expect(permissionRemoveBodyParts({ locale: "xx" })).toEqual(en);
  });
});
