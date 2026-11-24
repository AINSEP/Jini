import type { ReactNode } from "react";

import { createDictionaryTranslator, interpolate, localeEntry, type DictionaryTranslator, type LocaleDictionary } from "@jini-ai/core/text";
import { INTEGRATIONS_DICT_ES_TO_KO } from "./i18n/integrations-dict-es-to-ko.js";
import { INTEGRATIONS_DICT_PL_TO_BN } from "./i18n/integrations-dict-pl-to-bn.js";

/**
 * @file Spanish translation for the Integrations list (`/admin/addons/integrations`) and its
 * delivery-log sub-screen (`/admin/addons/integrations/:subscriptionId`) — form labels, table headers,
 * empty states, and confirm-dialog copy.
 *
 * Also covers `rules.ts`'s `integrationRowMenuItems` row-menu labels (Pause/Resume/Delete) — the
 * earlier pass's `.tsx`-only scope left these untranslated (flagged in its handoff report as a
 * follow-up gap); `rules.ts` imports `t` from here directly.
 *
 * `Soon` (added 2026-09-19, for the MCP Server tab's new `TabBarTab.tag`) is copied verbatim from
 * `lib/admin-nav-i18n.ts`'s own `Soon` entries per locale rather than retranslated — same word,
 * same app, and that file's own translations were already reviewed. `Providers.tsx`'s own header
 * explains why this feature keeps its own dictionary instead of reading that one directly: it is
 * scoped to the nav only.
 */

const INTEGRATIONS_DICT: Record<string, Record<string, string>> = {
  ...INTEGRATIONS_DICT_ES_TO_KO,
  ...INTEGRATIONS_DICT_PL_TO_BN,
};

/** The host binds its commonDictionary once; `t` falls back to the common copy on a miss. */
export function createIntegrationsDictionary({ commonDictionary }: { commonDictionary: LocaleDictionary }, _optional = {}): { t: DictionaryTranslator } {
  return { t: createDictionaryTranslator({ featureDictionary: INTEGRATIONS_DICT }, { commonDictionary }) };
}

/** The delete-confirm body embeds the webhook's own label mid-sentence. */
const DELETE_WEBHOOK_FRAGMENTS: Record<string, { before: string; after: string }> = {
  en: { before: 'Delete webhook "', after: '"? This cannot be undone.' },
  es: { before: '¿Eliminar el webhook "', after: '"? Esta acción no se puede deshacer.' },
  id: { before: 'Hapus webhook "', after: '"? Tindakan ini tidak dapat dibatalkan.' },
  de: { before: 'Webhook "', after: '" löschen? Dies kann nicht rückgängig gemacht werden.' },
  "zh-CN": { before: "删除 webhook“", after: "”?此操作无法撤销。" },
  "zh-TW": { before: "刪除 webhook「", after: "」?此操作無法復原。" },
  "pt-BR": { before: 'Excluir o webhook "', after: '"? Esta ação não pode ser desfeita.' },
  ru: { before: "Удалить webhook «", after: "»? Это действие нельзя отменить." },
  fa: { before: "حذف webhook «", after: "»؟ این کار قابل بازگشت نیست." },
  ar: { before: 'حذف الـ webhook "', after: '"؟ لا يمكن التراجع عن هذا الإجراء.' },
  ja: { before: "webhook「", after: "」を削除しますか?この操作は元に戻せません。" },
  ko: { before: 'webhook "', after: '"을(를) 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.' },
  pl: { before: "Usunąć webhook „", after: "”? Tej operacji nie można cofnąć." },
  hu: { before: "Törli a(z) „", after: "” webhookot? Ez a művelet nem vonható vissza." },
  fr: { before: "Supprimer le webhook « ", after: " » ? Cette action est irréversible." },
  uk: { before: "Видалити webhook «", after: "»? Цю дію не можна скасувати." },
  tr: { before: '"', after: '" webhook\'u silinsin mi? Bu işlem geri alınamaz.' },
  th: { before: 'ลบ webhook "', after: '" ใช่หรือไม่ ไม่สามารถยกเลิกการดำเนินการนี้ได้' },
  it: { before: 'Eliminare il webhook "', after: '"? Questa azione non può essere annullata.' },
  hi: { before: 'वेबहुक "', after: '" हटाएं? इसे पूर्ववत नहीं किया जा सकता।' },
  ur: { before: 'ویب ہک "', after: '" حذف کریں؟ اسے واپس نہیں لایا جا سکتا۔' },
  bn: { before: 'ওয়েবহুক "', after: '" মুছবেন? এটি পূর্বাবস্থায় ফেরানো যাবে না।' },
};

export function deleteWebhookBody({ locale, label }: { locale: string; label: string }, _optional = {}): ReactNode {
  const f = localeEntry({ table: DELETE_WEBHOOK_FRAGMENTS, locale });
  return (
    <p>
      {f.before}
      {label}
      {f.after}
    </p>
  );
}

/** The row-menu trigger's accessible name embeds the webhook's own label. */
const ACTIONS_FOR_WEBHOOK_TEMPLATE: Record<string, string> = {
  en: 'Actions for webhook "{label}"',
  es: 'Acciones para el webhook "{label}"',
  id: 'Tindakan untuk webhook "{label}"',
  de: 'Aktionen für Webhook "{label}"',
  "zh-CN": "“{label}”webhook 的操作",
  "zh-TW": "「{label}」webhook 的動作",
  "pt-BR": 'Ações para o webhook "{label}"',
  ru: "Действия для webhook «{label}»",
  fa: "اقدامات برای webhook «{label}»",
  ar: 'إجراءات لـ webhook "{label}"',
  ja: "「{label}」webhookの操作",
  ko: '"{label}" webhook에 대한 작업',
  pl: "Akcje dla webhooka „{label}”",
  hu: "Műveletek a(z) „{label}” webhookhoz",
  fr: "Actions pour le webhook « {label} »",
  uk: "Дії для webhook «{label}»",
  tr: '"{label}" webhook\'u için işlemler',
  th: 'การดำเนินการสำหรับ webhook "{label}"',
  it: 'Azioni per il webhook "{label}"',
  hi: 'वेबहुक "{label}" के लिए कार्रवाइयां',
  ur: 'ویب ہک "{label}" کے لیے اقدامات',
  bn: 'ওয়েবহুক "{label}" এর জন্য কার্যক্রম',
};

export function actionsForWebhookLabel({ locale, label }: { locale: string; label: string }, _optional = {}): string {
  return interpolate({ template: localeEntry({ table: ACTIONS_FOR_WEBHOOK_TEMPLATE, locale }), vars: { label } });
}
