import { ADMIN_COMMON_I18N } from "../../core/i18n-common.js";
import { DATABASE_ES_ID_DE_ZH_CN_ZH_TW_PT_BR } from "./database-i18n/database-es-id-de-zh-cn-zh-tw-pt-br.js";
import { DATABASE_RU_FA_AR_JA_KO_PL } from "./database-i18n/database-ru-fa-ar-ja-ko-pl.js";
import { DATABASE_HU_FR_UK_TR_TH_IT_HI_UR_BN } from "./database-i18n/database-hu-fr-uk-tr-th-it-hi-ur-bn.js";
import type { ReactNode } from "react";

import { createDictionaryTranslator, localeEntry } from '@jini-ai/core/text';
/**
 * @file Spanish translation for the Database screen (`/admin/database`) — filter bar, table
 * headers, section headings, button/status labels, and the migrate-forward ceremony copy.
 *
 * DRIFT-WARNING KEYS: the ten `resolveSchemaStateWarning` strings appear in every locale below.
 * They are safety-critical copy about data integrity, so they must not fall back to English for a
 * locale the admin already supports.
 *
 * Same "resolve outside React context" shape the admin navigation dictionary and the Settings
 * dialog's own `const t` use: a plain lookup fed by the locale this page reads from the host's
 * language setting, not an ambient `I18nProvider` (there is none outside the Settings dialog's own
 * subtree).
 */

const DATABASE_DICT: Record<string, Record<string, string>> = {
  ...DATABASE_ES_ID_DE_ZH_CN_ZH_TW_PT_BR,
  ...DATABASE_RU_FA_AR_JA_KO_PL,
  ...DATABASE_HU_FR_UK_TR_TH_IT_HI_UR_BN,
};

export const t = createDictionaryTranslator({ featureDictionary: DATABASE_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

/** The "Plan ready" ceremony message embeds `<code>{planId}</code>` mid-sentence, so it can't be a
 *  flat `ES` entry — word order differs by locale, not just the substituted value. */
const PLAN_READY_FRAGMENTS: Record<string, { before: string; after: string }> = {
  en: {
    before: "Plan ready (plan ",
    after: "). Confirming issues a one-time execution token — nothing is migrated yet.",
  },
  es: {
    before: "Plan listo (plan ",
    after: "). Confirmarlo emite un token de ejecución de un solo uso: nada se ha migrado todavía.",
  },
  id: {
    before: "Rencana siap (rencana ",
    after: "). Konfirmasi akan menerbitkan token eksekusi sekali pakai — belum ada yang dimigrasikan.",
  },
  de: {
    before: "Plan bereit (Plan ",
    after: "). Die Bestätigung stellt ein einmaliges Ausführungstoken aus — es wurde noch nichts migriert.",
  },
  "zh-CN": {
    before: "计划已就绪(计划 ",
    after: ")。确认将签发一次性执行令牌 — 目前尚未进行任何迁移。",
  },
  "zh-TW": {
    before: "計畫已就緒(計畫 ",
    after: ")。確認會核發一次性執行權杖 — 目前尚未進行任何遷移。",
  },
  "pt-BR": {
    before: "Plano pronto (plano ",
    after: "). Confirmar emite um token de execução único — nada foi migrado ainda.",
  },
  ru: {
    before: "План готов (план ",
    after: "). Подтверждение выдаёт одноразовый токен выполнения — пока ничего не мигрировано.",
  },
  fa: {
    before: "طرح آماده است (طرح ",
    after: "). تأیید یک نشانه اجرای یک‌بارمصرف صادر می‌کند — هنوز چیزی مهاجرت نکرده است.",
  },
  ar: {
    before: "الخطة جاهزة (الخطة ",
    after: "). يؤدي التأكيد إلى إصدار رمز تنفيذ لمرة واحدة — لم يتم ترحيل أي شيء بعد.",
  },
  ja: {
    before: "プランの準備ができました(プラン ",
    after: ")。確認すると1回限りの実行トークンが発行されます — まだ何も移行されていません。",
  },
  ko: {
    before: "계획이 준비되었습니다(계획 ",
    after: "). 확인하면 일회용 실행 토큰이 발급됩니다 — 아직 아무것도 마이그레이션되지 않았습니다.",
  },
  pl: {
    before: "Plan gotowy (plan ",
    after: "). Potwierdzenie wydaje jednorazowy token wykonania — nic nie zostało jeszcze zmigrowane.",
  },
  hu: {
    before: "A terv kész (terv ",
    after: "). A megerősítés egyszeri végrehajtási tokent állít ki — még semmi sem lett migrálva.",
  },
  fr: {
    before: "Plan prêt (plan ",
    after: "). La confirmation émet un jeton d'exécution à usage unique — rien n'est encore migré.",
  },
  uk: {
    before: "План готовий (план ",
    after: "). Підтвердження видає одноразовий токен виконання — поки що нічого не мігровано.",
  },
  tr: {
    before: "Plan hazır (plan ",
    after: "). Onaylamak tek kullanımlık bir yürütme jetonu verir — henüz hiçbir şey taşınmadı.",
  },
  th: {
    before: "แผนพร้อมแล้ว (แผน ",
    after: ") การยืนยันจะออกโทเคนการดำเนินการแบบใช้ครั้งเดียว — ยังไม่มีการย้ายข้อมูลใดๆ",
  },
  it: {
    before: "Piano pronto (piano ",
    after: "). La conferma emette un token di esecuzione monouso — non è stato ancora migrato nulla.",
  },
  hi: {
    before: "योजना तैयार है (योजना ",
    after: ")। पुष्टि करने पर एक बार उपयोग होने वाला निष्पादन टोकन जारी होता है — अभी तक कुछ भी माइग्रेट नहीं हुआ है।",
  },
  ur: {
    before: "منصوبہ تیار ہے (منصوبہ ",
    after: ")۔ تصدیق کرنے پر ایک بار استعمال ہونے والا ایگزیکیوشن ٹوکن جاری ہوتا ہے — ابھی تک کچھ بھی مائیگریٹ نہیں ہوا۔",
  },
  bn: {
    before: "পরিকল্পনা প্রস্তুত (পরিকল্পনা ",
    after: ")। নিশ্চিত করলে একবার ব্যবহারযোগ্য এক্সিকিউশন টোকেন ইস্যু হয় — এখনও কিছুই মাইগ্রেট করা হয়নি।",
  },
};

export function planReadyMessage({ locale, planId }: { locale: string; planId: string }, _options = {}): ReactNode {
  const f = localeEntry({ table: PLAN_READY_FRAGMENTS, locale });
  return (
    <>
      {f.before}
      <code>{planId}</code>
      {f.after}
    </>
  );
}
