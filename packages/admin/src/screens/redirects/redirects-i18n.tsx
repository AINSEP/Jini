import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import type { ReactNode } from "react";

import { InfoTip } from "../../react/kit.js";

import { mergeLocaleOverlays, createDictionaryTranslator, interpolate, localeEntry } from '@jini-ai/core/text';
import { REDIRECTS_LOCALES_A } from "./redirects-i18n.locales-a.js";
import { REDIRECTS_LOCALES_B } from "./redirects-i18n.locales-b.js";
import { MATCH_TYPE_TRANSLATIONS, WILDCARD_CAP_NOTICE_TRANSLATIONS } from "./redirects-i18n.overlays.js";
/**
 * @file Spanish translation for the Redirects screen (`/admin/redirects`) — the create form, the
 * bulk-import affordance, table headers, and the delete-confirm dialog.
 *
 * Also covers Jini `redirects/rules.ts`'s `redirectRowMenuItems` labels (Disable/Enable/Delete) — the
 * earlier pass's `.tsx`-only scope left these untranslated (same gap `integrations-i18n.tsx`'s file
 * header documented). The host's `integrations/jini-admin/redirects-ports.ts` supplies this
 * translator to the extracted rules; the package never imports the host dictionary.
 */

/** All 21 locales, in the original order; locale keys are disjoint, so the spread order is the old literal order. */
const REDIRECTS_TRANSLATIONS: Record<string, Record<string, string>> = { ...REDIRECTS_LOCALES_A, ...REDIRECTS_LOCALES_B };

const REDIRECTS_DICT: Record<string, Record<string, string>> = mergeLocaleOverlays({ base: REDIRECTS_TRANSLATIONS }, { overlays: [MATCH_TYPE_TRANSLATIONS, WILDCARD_CAP_NOTICE_TRANSLATIONS] });

/** Same two-step fallback every other `t()` in this app uses: translated value, else the English
 *  source string itself — never a raw dictionary-miss placeholder. */
export const t = createDictionaryTranslator({ featureDictionary: REDIRECTS_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

// 2026-10-16 (owner: "it looks bad"): the label was a sentence with the whole rule shape inline as
// `<code>`, which read as body text mixed with monospace. Now a one-line hint, with the fields
// behind an ⓘ (the admin's tooltip convention); the placeholder still shows a full example rule.
const IMPORT_RULES_LABEL_COPY: Record<string, { hint: string; fields: string; optional: string }> = {
  en: { hint: "Paste a JSON array of rules, up to 500.", fields: "Fields", optional: "Optional" },
  es: { hint: "Pega un arreglo JSON de reglas, hasta 500.", fields: "Campos", optional: "Opcionales" },
  id: { hint: "Tempel array JSON berisi aturan, maksimal 500.", fields: "Kolom", optional: "Opsional" },
  de: { hint: "Fügen Sie ein JSON-Array mit Regeln ein, bis zu 500.", fields: "Felder", optional: "Optional" },
  "zh-CN": { hint: "粘贴规则的 JSON 数组，最多 500 条。", fields: "字段", optional: "可选" },
  "zh-TW": { hint: "貼上規則的 JSON 陣列，最多 500 條。", fields: "欄位", optional: "選用" },
  "pt-BR": { hint: "Cole um array JSON de regras, até 500.", fields: "Campos", optional: "Opcionais" },
  ru: { hint: "Вставьте JSON-массив правил, до 500.", fields: "Поля", optional: "Необязательные" },
  fa: { hint: "آرایه JSON از قانون‌ها را جای‌گذاری کنید، حداکثر 500.", fields: "فیلدها", optional: "اختیاری" },
  ar: { hint: "الصق مصفوفة JSON من القواعد، حتى 500.", fields: "الحقول", optional: "اختيارية" },
  ja: { hint: "ルールの JSON 配列を貼り付けてください（最大 500 件）。", fields: "フィールド", optional: "任意" },
  ko: { hint: "규칙의 JSON 배열을 붙여넣으세요(최대 500개).", fields: "필드", optional: "선택" },
  pl: { hint: "Wklej tablicę JSON reguł, maks. 500.", fields: "Pola", optional: "Opcjonalne" },
  hu: { hint: "Illessze be a szabályok JSON tömbjét, legfeljebb 500-at.", fields: "Mezők", optional: "Nem kötelező" },
  fr: { hint: "Collez un tableau JSON de règles, jusqu'à 500.", fields: "Champs", optional: "Facultatifs" },
  uk: { hint: "Вставте JSON-масив правил, до 500.", fields: "Поля", optional: "Необов'язкові" },
  tr: { hint: "Kuralların JSON dizisini yapıştırın, en fazla 500.", fields: "Alanlar", optional: "İsteğe bağlı" },
  th: { hint: "วางอาร์เรย์ JSON ของกฎ สูงสุด 500 รายการ", fields: "ฟิลด์", optional: "ไม่บังคับ" },
  it: { hint: "Incolla un array JSON di regole, fino a 500.", fields: "Campi", optional: "Facoltativi" },
  hi: { hint: "नियमों का JSON ऐरे पेस्ट करें, अधिकतम 500।", fields: "फ़ील्ड", optional: "वैकल्पिक" },
  ur: { hint: "اصولوں کا JSON اری پیسٹ کریں، زیادہ سے زیادہ 500۔", fields: "فیلڈز", optional: "اختیاری" },
  bn: { hint: "নিয়মগুলোর একটি JSON অ্যারে পেস্ট করুন, সর্বোচ্চ 500টি।", fields: "ফিল্ড", optional: "ঐচ্ছিক" },
};

/** The bulk-import label: a one-line hint plus an ⓘ naming the rule fields. The package's
 *  `shapeCode` element is no longer rendered — the field names are the same literal keys here. */
export function importRulesLabel({ locale }: { locale: string }, { _shapeCode }: { _shapeCode?: ReactNode } = {}): ReactNode {
  const c = localeEntry({ table: IMPORT_RULES_LABEL_COPY, locale });
  return (
    <>
      {c.hint}
      {/* The ⓘ sits inside the package's `<label for>`: without this, a tap on it also activates
          the label, focusing the textarea, whose blur closes the tip the tap just opened. */}
      <span onClick={(event) => event.preventDefault()}>
        <InfoTip
          label={`${c.fields}: matchType, fromPattern, toTarget, statusCode. ${c.optional}: override, priority.`}
          agentHandle="redirects-import-fields-info"
        />
      </span>
    </>
  );
}

const IMPORT_RESULT_SUMMARY_TEMPLATE: Record<string, string> = {
  en: "{created} created, {failed} failed.",
  es: "{created} creadas, {failed} fallidas.",
  id: "{created} dibuat, {failed} gagal.",
  de: "{created} erstellt, {failed} fehlgeschlagen.",
  "zh-CN": "已创建 {created} 个，失败 {failed} 个。",
  "zh-TW": "已建立 {created} 個，失敗 {failed} 個。",
  "pt-BR": "{created} criados, {failed} com falha.",
  ru: "Создано: {created}, ошибок: {failed}.",
  fa: "{created} مورد ایجاد شد، {failed} مورد ناموفق بود.",
  ar: "تم إنشاء {created}، وفشل {failed}.",
  ja: "作成 {created} 件、失敗 {failed} 件。",
  ko: "{created}개 생성됨, {failed}개 실패.",
  pl: "Utworzono: {created}, błędów: {failed}.",
  hu: "Létrehozva: {created}, sikertelen: {failed}.",
  fr: "{created} créés, {failed} échoués.",
  uk: "Створено: {created}, помилок: {failed}.",
  tr: "{created} oluşturuldu, {failed} başarısız oldu.",
  th: "สร้างแล้ว {created} รายการ ล้มเหลว {failed} รายการ",
  it: "{created} creati, {failed} falliti.",
  hi: "{created} बनाए गए, {failed} विफल रहे।",
  ur: "{created} بنائے گئے، {failed} ناکام ہوئے۔",
  bn: "{created} তৈরি হয়েছে, {failed} ব্যর্থ হয়েছে।",
};

/** The import result summary — "{created} created, {failed} failed." */
export function importResultSummary({ locale, created, failed }: { locale: string; created: number; failed: number }, _options: Record<string, never> = {}): string {
  return interpolate({ template: localeEntry({ table: IMPORT_RESULT_SUMMARY_TEMPLATE, locale }), vars: {
    created,
    failed,
  } });
}

const CREATED_LABEL: Record<string, string> = {
  en: "Created",
  es: "Creada",
  id: "Dibuat",
  de: "Erstellt",
  "zh-CN": "已创建",
  "zh-TW": "已建立",
  "pt-BR": "Criado",
  ru: "Создано",
  fa: "ایجاد شد",
  ar: "تم الإنشاء",
  ja: "作成済み",
  ko: "생성됨",
  pl: "Utworzono",
  hu: "Létrehozva",
  fr: "Créé",
  uk: "Створено",
  tr: "Oluşturuldu",
  th: "สร้างแล้ว",
  it: "Creato",
  hi: "बनाया गया",
  ur: "تخلیق کردہ",
  bn: "তৈরি হয়েছে",
};

/** One created-item line: "Created {fromPattern} → {toTarget}" — "Created" is a status word, not
 *  full-sentence copy, so translated as a short label preceding the arrow. */
export function createdLabel({ locale }: { locale: string }, _options: Record<string, never> = {}): string {
  return localeEntry({ table: CREATED_LABEL, locale });
}

const FAILED_ITEM_LABEL_TEMPLATE: Record<string, string> = {
  en: "Item {index} ({code})",
  es: "Elemento {index} ({code})",
  id: "Item {index} ({code})",
  de: "Element {index} ({code})",
  "zh-CN": "项目 {index}（{code}）",
  "zh-TW": "項目 {index}（{code}）",
  "pt-BR": "Item {index} ({code})",
  ru: "Элемент {index} ({code})",
  fa: "مورد {index} ({code})",
  ar: "العنصر {index} ({code})",
  ja: "項目 {index}（{code}）",
  ko: "항목 {index}({code})",
  pl: "Element {index} ({code})",
  hu: "{index}. elem ({code})",
  fr: "Élément {index} ({code})",
  uk: "Елемент {index} ({code})",
  tr: "Öğe {index} ({code})",
  th: "รายการที่ {index} ({code})",
  it: "Elemento {index} ({code})",
  hi: "आइटम {index} ({code})",
  ur: "آئٹم {index} ({code})",
  bn: "আইটেম {index} ({code})",
};

/** One failed-item line: "Item {index} ({code})". */
export function failedItemLabel({ locale, index, code }: { locale: string; index: number; code: string }, _options: Record<string, never> = {}): string {
  return interpolate({ template: localeEntry({ table: FAILED_ITEM_LABEL_TEMPLATE, locale }), vars: { index, code } });
}

const DELETE_REDIRECT_BODY_FRAGMENTS: Record<string, { before: string; after: string }> = {
  en: { before: 'Delete the redirect rule from "', after: '"?' },
  es: { before: '¿Eliminar la regla de redirección desde "', after: '"?' },
  id: { before: 'Hapus aturan pengalihan dari "', after: '"?' },
  de: { before: "Weiterleitungsregel von „", after: "“ löschen?" },
  "zh-CN": { before: "删除来自“", after: "”的重定向规则？" },
  "zh-TW": { before: "刪除來自「", after: "」的重新導向規則？" },
  "pt-BR": { before: 'Excluir a regra de redirecionamento de "', after: '"?' },
  ru: { before: 'Удалить правило перенаправления из "', after: '"?' },
  fa: { before: 'قانون تغییرمسیر از "', after: '" حذف شود؟' },
  ar: { before: 'هل تريد حذف قاعدة إعادة التوجيه من "', after: '"؟' },
  ja: { before: "「", after: "」からのリダイレクトルールを削除しますか？" },
  ko: { before: '"', after: '"에서의 리디렉션 규칙을 삭제하시겠습니까?' },
  pl: { before: 'Usunąć regułę przekierowania z "', after: '"?' },
  hu: { before: "Törli az átirányítási szabályt innen: „", after: "”?" },
  fr: { before: "Supprimer la règle de redirection depuis « ", after: " » ?" },
  uk: { before: 'Видалити правило переспрямування з "', after: '"?' },
  tr: { before: '"', after: '" kaynaklı yönlendirme kuralı silinsin mi?' },
  th: { before: 'ลบกฎการเปลี่ยนเส้นทางจาก "', after: '" หรือไม่?' },
  it: { before: 'Eliminare la regola di reindirizzamento da "', after: '"?' },
  hi: { before: 'रीडायरेक्ट नियम "', after: '" से हटाएं?' },
  ur: { before: 'ری ڈائریکٹ اصول "', after: '" سے حذف کریں؟' },
  bn: { before: 'রিডাইরেক্ট নিয়ম "', after: '" থেকে মুছবেন?' },
};

/** The delete-confirm body embeds the rule's own `fromPattern` mid-sentence. */
export function deleteRedirectBody({ locale, fromPattern }: { locale: string; fromPattern: string }, _options: Record<string, never> = {}): ReactNode {
  const f = localeEntry({ table: DELETE_REDIRECT_BODY_FRAGMENTS, locale });
  return (
    <p>
      {f.before}
      {fromPattern}
      {f.after}
    </p>
  );
}

const ACTIONS_FOR_REDIRECT_TEMPLATE: Record<string, string> = {
  en: 'Actions for redirect rule from "{fromPattern}"',
  es: 'Acciones para la regla de redirección desde "{fromPattern}"',
  id: 'Tindakan untuk aturan pengalihan dari "{fromPattern}"',
  de: "Aktionen für Weiterleitungsregel von „{fromPattern}“",
  "zh-CN": "来自“{fromPattern}”的重定向规则操作",
  "zh-TW": "來自「{fromPattern}」的重新導向規則操作",
  "pt-BR": 'Ações para a regra de redirecionamento de "{fromPattern}"',
  ru: 'Действия для правила перенаправления из "{fromPattern}"',
  fa: 'عملیات برای قانون تغییرمسیر از "{fromPattern}"',
  ar: 'إجراءات لقاعدة إعادة التوجيه من "{fromPattern}"',
  ja: "「{fromPattern}」からのリダイレクトルールの操作",
  ko: '"{fromPattern}"에서의 리디렉션 규칙에 대한 작업',
  pl: 'Działania dla reguły przekierowania z "{fromPattern}"',
  hu: "Műveletek a(z) „{fromPattern}” forrású átirányítási szabályhoz",
  fr: "Actions pour la règle de redirection depuis « {fromPattern} »",
  uk: 'Дії для правила переспрямування з "{fromPattern}"',
  tr: '"{fromPattern}" kaynaklı yönlendirme kuralı için işlemler',
  th: 'การดำเนินการสำหรับกฎการเปลี่ยนเส้นทางจาก "{fromPattern}"',
  it: 'Azioni per la regola di reindirizzamento da "{fromPattern}"',
  hi: 'रीडायरेक्ट नियम "{fromPattern}" के लिए कार्रवाइयां',
  ur: 'ری ڈائریکٹ اصول "{fromPattern}" کے لیے اقدامات',
  bn: 'রিডাইরেক্ট নিয়ম "{fromPattern}" এর জন্য কার্যক্রম',
};

/** The row-menu trigger's accessible name embeds the rule's own `fromPattern`. */
export function actionsForRedirectLabel({ locale, fromPattern }: { locale: string; fromPattern: string }, _options: Record<string, never> = {}): string {
  return interpolate({ template: localeEntry({ table: ACTIONS_FOR_REDIRECT_TEMPLATE, locale }), vars: { fromPattern } });
}
