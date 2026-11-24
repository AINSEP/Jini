import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { RECOVERY_ES_ID_DE_ZH_CN_ZH_TW_PT_BR } from "./recovery-i18n/recovery-es-id-de-zh-cn-zh-tw-pt-br.js";
import { RECOVERY_RU_FA_AR_JA_KO_PL } from "./recovery-i18n/recovery-ru-fa-ar-ja-ko-pl.js";
import { RECOVERY_HU_FR_UK_TR_TH_IT_HI_UR_BN } from "./recovery-i18n/recovery-hu-fr-uk-tr-th-it-hi-ur-bn.js";
import type { ReactNode } from "react";

import { createDictionaryTranslator, localeEntry } from '@jini-ai/core/text';
/**
 * @file Spanish translation for the Recovery screen (`/admin/recovery`) — the restore-points
 * list, the discarded-write-window disclosure, and the plan/confirm/execute restore ceremony.
 *
 * Also covers `rules.ts`'s `categoryLabel` (the discarded-write-window category names) — the
 * earlier pass's `.tsx`-only scope left these untranslated (flagged in its handoff report as a
 * follow-up gap, same as `integrations-i18n.tsx`'s row-menu-label note); `rules.ts` imports `t`
 * from here directly. The untaught-category fallback template ("<category> writes") is built
 * directly in `rules.ts` per locale rather than through this dictionary, since Spanish's
 * "escrituras de <category>" reorders the words rather than substituting one.
 */

const RECOVERY_DICT: Record<string, Record<string, string>> = {
  ...RECOVERY_ES_ID_DE_ZH_CN_ZH_TW_PT_BR,
  ...RECOVERY_RU_FA_AR_JA_KO_PL,
  ...RECOVERY_HU_FR_UK_TR_TH_IT_HI_UR_BN,
};

/** Same two-step fallback every other `t()` in this app uses: translated value, else the English
 *  source string itself — never a raw dictionary-miss placeholder. */
export const t = createDictionaryTranslator({ featureDictionary: RECOVERY_DICT }, { commonDictionary: ADMIN_COMMON_I18N });

/** "Since <strong>{createdAt}</strong>, restoring here would discard at least:" — the timestamp
 *  is emphasized mid-sentence, so this can't be a flat `ES` entry. */
const SINCE_DISCARD_FRAGMENTS: Record<string, { before: string; after: string }> = {
  en: { before: "Since ", after: ", restoring here would discard at least:" },
  es: { before: "Desde ", after: ", restaurar aquí descartaría al menos:" },
  id: { before: "Sejak ", after: ", memulihkan di sini akan membuang setidaknya:" },
  de: { before: "Seit ", after: ", würde eine Wiederherstellung hier mindestens Folgendes verwerfen:" },
  "zh-CN": { before: "自 ", after: " 起,在此还原将至少丢弃:" },
  "zh-TW": { before: "自 ", after: " 起,在此還原將至少捨棄:" },
  "pt-BR": { before: "Desde ", after: ", restaurar aqui descartaria pelo menos:" },
  ru: { before: "С ", after: " восстановление здесь приведёт к потере как минимум:" },
  fa: { before: "از ", after: "، بازیابی در اینجا حداقل موارد زیر را دور می‌ریزد:" },
  ar: { before: "منذ ", after: "، ستؤدي الاستعادة هنا إلى فقدان ما لا يقل عن:" },
  ja: { before: "基準日時 ", after: " 以降の変更のうち、ここで復元すると少なくとも次が失われます:" },
  ko: { before: "기준 시각 ", after: " 이후의 변경 사항 중 여기서 복원하면 최소한 다음 항목이 삭제됩니다:" },
  pl: { before: "Od ", after: ", przywrócenie tutaj spowoduje utratę co najmniej:" },
  hu: { before: "A ", after: " óta történt változtatások közül az itteni visszaállítás legalább az alábbiakat elvetné:" },
  fr: { before: "Depuis ", after: ", la restauration ici entraînerait la perte d'au moins :" },
  uk: { before: "Від ", after: " відновлення тут призведе до втрати щонайменше:" },
  tr: { before: "Şu ", after: " tarihinden bu yana yapılan değişikliklerden en az aşağıdakiler burada geri yükleme yapılırsa silinir:" },
  th: { before: "ตั้งแต่ ", after: " การกู้คืนที่นี่จะละทิ้งอย่างน้อย:" },
  it: { before: "Dal ", after: ", il ripristino qui scarterebbe almeno:" },
  hi: { before: "दिनांक ", after: " से किए गए बदलावों में से यहां पुनर्स्थापित करने पर कम से कम ये बदलाव हट जाएंगे:" },
  ur: { before: "تاریخ ", after: " سے کی گئی تبدیلیوں میں سے یہاں بحال کرنے پر کم از کم درج ذیل ضائع ہو جائیں گی:" },
  bn: { before: "তারিখ ", after: " থেকে হওয়া পরিবর্তনগুলির মধ্যে এখানে পুনরুদ্ধার করলে অন্তত নিচেরগুলি হারিয়ে যাবে:" },
};

export function sinceDiscardMessage({ locale, createdAt }: { locale: string; createdAt: string }, _options: Record<string, never> = {}): ReactNode {
  const f = localeEntry({ table: SINCE_DISCARD_FRAGMENTS, locale });
  return (
    <>
      {f.before}
      <strong>{createdAt}</strong>
      {f.after}
    </>
  );
}

/** One discarded-write-window count line — either an exact count or the "unknown" case
 *  (INV-05: never conflate the two). `categoryLabelText` is `rules.ts`'s `categoryLabel()` output,
 *  deliberately still English (see this file's header). */
const UNKNOWN_DISCARD_COUNT_PREFIX: Record<string, string> = {
  en: "at least an unknown number of ",
  es: "al menos una cantidad desconocida de ",
  id: "setidaknya sejumlah yang tidak diketahui dari ",
  de: "mindestens eine unbekannte Anzahl von ",
  "zh-CN": "至少未知数量的 ",
  "zh-TW": "至少未知數量的 ",
  "pt-BR": "pelo menos uma quantidade desconhecida de ",
  ru: "как минимум неизвестное количество ",
  fa: "دست‌کم تعداد نامشخصی از ",
  ar: "ما لا يقل عن عدد غير معروف من ",
  ja: "少なくとも不明な数の ",
  ko: "최소한 알 수 없는 수의 ",
  pl: "co najmniej nieznaną liczbę ",
  hu: "legalább ismeretlen számú ",
  fr: "au moins un nombre inconnu de ",
  uk: "щонайменше невідому кількість ",
  tr: "en az bilinmeyen sayıda ",
  th: "อย่างน้อยจำนวนที่ไม่ทราบของ ",
  it: "almeno un numero sconosciuto di ",
  hi: "कम से कम अज्ञात संख्या के ",
  ur: "کم از کم ایک نامعلوم تعداد کی ",
  bn: "কমপক্ষে অজানা সংখ্যক ",
};

/**
 * The quantity and the category are separate elements (web-design pass #3, 2026-09-10) so the
 * stylesheet can weight them independently. Not a copy change — every locale's words, and their
 * order, are exactly what they were; only the element boundary between them is new, and the
 * rendered `textContent` of the row is character-for-character identical.
 *
 * Why it was needed: pass #2 set the WHOLE line at 1.15rem/600 — the largest body text on the
 * screen. On the `"unknown"` branch that is heading-weight type spent on a sentence carrying no
 * magnitude, and the noun that distinguishes one row from the next ("posts/pages writes" vs
 * "plugin-table rows") sits at the very END of it, so scanning two rows read "at least an unknown
 * number of…" twice before reaching anything that differed. Split, the host stylesheet can put the weight
 * on the numeral when there IS one and on the category noun when there is not — see
 * the host's quantity class (`classNames.quantity`). `data-unknown` carries which case this is to CSS, so the distinction
 * INV-05 requires (an `"unknown"` is never a `0`) is now visible in the type itself and not only
 * in the words.
 */
/** The host stylesheet's class names for one discard-count row: the row itself, its quantity, and
 *  its category noun. The host owns the styling, so the classes arrive with the call. */
export interface DiscardCountLineClassNames { row: string; quantity: string; category: string }

export function discardCountLine({ locale, count, categoryLabelText, classNames }: { locale: string; count: number | "unknown"; categoryLabelText: string; classNames: DiscardCountLineClassNames }, _options: Record<string, never> = {}): ReactNode {
  if (count === "unknown") {
    const prefix = localeEntry({ table: UNKNOWN_DISCARD_COUNT_PREFIX, locale });
    return (
      <span className={classNames.row}>
        {/* Every locale's prefix already ends in its own trailing space, so the two spans still
            render — and serialize — as the one sentence they were before. */}
        <span className={classNames.quantity} data-unknown="true">
          {prefix}
        </span>
        <span className={classNames.category}>{categoryLabelText}</span>
      </span>
    );
  }
  return (
    <span className={classNames.row}>
      <span className={classNames.quantity}>{count}</span>{" "}
      <span className={classNames.category}>{categoryLabelText}</span>
    </span>
  );
}

/** The baseline-unavailable warning names the literal word "unknown" used in the count lines
 *  above, so it's translated as one static block rather than a flat key — keeping both mentions of
 *  "desconocido"/"unknown" in agreement. */
const BASELINE_UNAVAILABLE_TEXT: Record<string, string> = {
  en: 'The discarded-write-window baseline could not be computed for this site right now — every count above is shown as "unknown", not a verified zero.',
  es: 'No se pudo calcular la línea base de la ventana de escritura descartada para este sitio en este momento — cada recuento anterior se muestra como "desconocido", no como un cero verificado.',
  id: 'Baseline jendela penulisan yang dibuang tidak dapat dihitung untuk situs ini saat ini — setiap hitungan di atas ditampilkan sebagai "tidak diketahui", bukan nol yang terverifikasi.',
  de: 'Die Baseline für das verworfene Schreibfenster konnte für diese Website derzeit nicht berechnet werden — jede Zählung oben wird als „unbekannt" angezeigt, nicht als verifizierte Null.',
  "zh-CN": '目前无法为此站点计算已丢弃写入窗口的基线 — 上面的每个计数均显示为"未知",而非经验证的零。',
  "zh-TW": '目前無法為此網站計算已捨棄寫入視窗的基準線 — 上方每個計數皆顯示為「未知」,而非經驗證的零。',
  "pt-BR": 'Não foi possível calcular a linha de base da janela de gravação descartada para este site no momento — cada contagem acima é exibida como "desconhecida", não como um zero verificado.',
  ru: "Базовое значение окна отброшенных записей не удалось вычислить для этого сайта прямо сейчас — каждый счётчик выше отображается как «неизвестно», а не как подтверждённый ноль.",
  fa: "خط پایه پنجره نوشتن دورریخته‌شده اکنون برای این سایت قابل محاسبه نبود — هر شمارش بالا به‌صورت «نامشخص» نمایش داده می‌شود، نه صفرِ تأییدشده.",
  ar: 'تعذّر حساب خط الأساس لنافذة الكتابة المُهمَلة لهذا الموقع الآن — يُعرض كل عدد أعلاه على أنه "غير معروف"، وليس صفرًا موثَّقًا.',
  ja: "このサイトの破棄された書き込みウィンドウのベースラインは現在計算できませんでした — 上記の各件数は検証済みのゼロではなく「不明」として表示されています。",
  ko: '현재 이 사이트에 대한 폐기된 쓰기 구간의 기준값을 계산할 수 없습니다 — 위의 모든 수치는 검증된 0이 아니라 "알 수 없음"으로 표시됩니다.',
  pl: "Nie udało się obecnie obliczyć wartości bazowej okna odrzuconych zapisów dla tej witryny — każda liczba powyżej jest wyświetlana jako „nieznana”, a nie zweryfikowane zero.",
  hu: "Az eldobott írási ablak alapértékét jelenleg nem sikerült kiszámítani ehhez a webhelyhez — a fenti minden szám „ismeretlenként” jelenik meg, nem ellenőrzött nullaként.",
  fr: "Impossible de calculer actuellement la référence de la fenêtre d'écriture ignorée pour ce site — chaque décompte ci-dessus est affiché comme « inconnu », et non comme un zéro vérifié.",
  uk: "Наразі не вдалося обчислити базове значення вікна відкинутих записів для цього сайту — кожен підрахунок вище показано як «невідомо», а не як підтверджений нуль.",
  tr: 'Bu site için atılan yazma penceresi temel değeri şu anda hesaplanamadı — yukarıdaki her sayım, doğrulanmış bir sıfır olarak değil, "bilinmiyor" olarak gösterilir.',
  th: 'ไม่สามารถคำนวณค่าพื้นฐานของช่วงเวลาการเขียนที่ถูกละทิ้งสำหรับเว็บไซต์นี้ได้ในขณะนี้ — จำนวนทั้งหมดข้างต้นแสดงเป็น "ไม่ทราบ" ไม่ใช่ศูนย์ที่ยืนยันแล้ว',
  it: 'Non è stato possibile calcolare la baseline della finestra di scrittura scartata per questo sito in questo momento — ogni conteggio sopra è mostrato come "sconosciuto", non come uno zero verificato.',
  hi: 'इस साइट के लिए छोड़े गए लेखन-विंडो की आधाररेखा अभी गणना नहीं की जा सकी — ऊपर दिखाई गई हर गिनती "अज्ञात" के रूप में दिखाई जाती है, सत्यापित शून्य के रूप में नहीं।',
  ur: 'اس سائٹ کے لیے ضائع شدہ تحریری ونڈو کی بیس لائن ابھی حساب نہیں کی جا سکی — اوپر دکھائی گئی ہر گنتی "نامعلوم" کے طور پر ظاہر ہوتی ہے، تصدیق شدہ صفر کے طور پر نہیں۔',
  bn: 'এই সাইটের জন্য বাতিল করা লেখা-উইন্ডোর বেসলাইন এখনই গণনা করা যায়নি — উপরের প্রতিটি গণনা "অজানা" হিসেবে দেখানো হয়েছে, যাচাইকৃত শূন্য হিসেবে নয়।',
};

export function baselineUnavailableMessage({ locale }: { locale: string }, _options: Record<string, never> = {}): ReactNode {
  return <>{localeEntry({ table: BASELINE_UNAVAILABLE_TEXT, locale })}</>;
}

/** "Restore plan ready (plan <code>{planId}</code>). Confirming issues a one-time execution token
 *  — nothing is restored yet." */
const RESTORE_PLAN_READY_FRAGMENTS: Record<string, { before: string; after: string }> = {
  en: {
    before: "Restore plan ready (plan ",
    after: "). Confirming issues a one-time execution token — nothing is restored yet.",
  },
  es: {
    before: "Plan de restauración listo (plan ",
    after: "). Confirmarlo emite un token de ejecución de un solo uso: nada se ha restaurado todavía.",
  },
  id: {
    before: "Rencana pemulihan siap (rencana ",
    after: "). Konfirmasi akan menerbitkan token eksekusi sekali pakai — belum ada yang dipulihkan.",
  },
  de: {
    before: "Wiederherstellungsplan bereit (Plan ",
    after: "). Die Bestätigung stellt ein einmaliges Ausführungstoken aus — es wurde noch nichts wiederhergestellt.",
  },
  "zh-CN": {
    before: "恢复计划已就绪(计划 ",
    after: ")。确认将签发一次性执行令牌 — 目前尚未恢复任何内容。",
  },
  "zh-TW": {
    before: "還原計畫已就緒(計畫 ",
    after: ")。確認會核發一次性執行權杖 — 目前尚未還原任何內容。",
  },
  "pt-BR": {
    before: "Plano de restauração pronto (plano ",
    after: "). Confirmar emite um token de execução único — nada foi restaurado ainda.",
  },
  ru: {
    before: "План восстановления готов (план ",
    after: "). Подтверждение выдаёт одноразовый токен выполнения — пока ничего не восстановлено.",
  },
  fa: {
    before: "طرح بازیابی آماده است (طرح ",
    after: "). تأیید یک نشانه اجرای یک‌بارمصرف صادر می‌کند — هنوز چیزی بازیابی نشده است.",
  },
  ar: {
    before: "خطة الاستعادة جاهزة (الخطة ",
    after: "). يؤدي التأكيد إلى إصدار رمز تنفيذ لمرة واحدة — لم تتم استعادة أي شيء بعد.",
  },
  ja: {
    before: "復元プランの準備ができました(プラン ",
    after: ")。確認すると1回限りの実行トークンが発行されます — まだ何も復元されていません。",
  },
  ko: {
    before: "복원 계획이 준비되었습니다(계획 ",
    after: "). 확인하면 일회용 실행 토큰이 발급됩니다 — 아직 아무것도 복원되지 않았습니다.",
  },
  pl: {
    before: "Plan przywracania gotowy (plan ",
    after: "). Potwierdzenie wydaje jednorazowy token wykonania — nic nie zostało jeszcze przywrócone.",
  },
  hu: {
    before: "A visszaállítási terv kész (terv ",
    after: "). A megerősítés egyszeri végrehajtási tokent állít ki — még semmi sem lett visszaállítva.",
  },
  fr: {
    before: "Plan de restauration prêt (plan ",
    after: "). La confirmation émet un jeton d'exécution à usage unique — rien n'est encore restauré.",
  },
  uk: {
    before: "План відновлення готовий (план ",
    after: "). Підтвердження видає одноразовий токен виконання — поки що нічого не відновлено.",
  },
  tr: {
    before: "Geri yükleme planı hazır (plan ",
    after: "). Onaylamak tek kullanımlık bir yürütme jetonu verir — henüz hiçbir şey geri yüklenmedi.",
  },
  th: {
    before: "แผนการกู้คืนพร้อมแล้ว (แผน ",
    after: ") การยืนยันจะออกโทเคนการดำเนินการแบบใช้ครั้งเดียว — ยังไม่มีการกู้คืนใดๆ",
  },
  it: {
    before: "Piano di ripristino pronto (piano ",
    after: "). La conferma emette un token di esecuzione monouso — non è stato ancora ripristinato nulla.",
  },
  hi: {
    before: "पुनर्स्थापना योजना तैयार है (योजना ",
    after: ")। पुष्टि करने पर एक बार उपयोग होने वाला निष्पादन टोकन जारी होता है — अभी तक कुछ भी पुनर्स्थापित नहीं हुआ है।",
  },
  ur: {
    before: "بحالی کا منصوبہ تیار ہے (منصوبہ ",
    after: ")۔ تصدیق کرنے پر ایک بار استعمال ہونے والا ایگزیکیوشن ٹوکن جاری ہوتا ہے — ابھی تک کچھ بھی بحال نہیں ہوا۔",
  },
  bn: {
    before: "পুনরুদ্ধার পরিকল্পনা প্রস্তুত (পরিকল্পনা ",
    after: ")। নিশ্চিত করলে একবার ব্যবহারযোগ্য এক্সিকিউশন টোকেন ইস্যু হয় — এখনও কিছুই পুনরুদ্ধার করা হয়নি।",
  },
};

export function restorePlanReadyMessage({ locale, planId }: { locale: string; planId: string }, _options: Record<string, never> = {}): ReactNode {
  const f = localeEntry({ table: RESTORE_PLAN_READY_FRAGMENTS, locale });
  return (
    <>
      {f.before}
      <code>{planId}</code>
      {f.after}
    </>
  );
}

/** "Restore run <code>{restoreRunId}</code> finished in state {stateNode}." — `stateNode` is the
 *  caller's own `<span className={status...}>{state}</span>`, passed through rather than rebuilt
 *  here since the status value and its class name are not translatable content. */
const RESTORE_DONE_FRAGMENTS: Record<string, { before: string; middle: string; after: string }> = {
  en: { before: "Restore run ", middle: " finished in state ", after: "." },
  es: { before: "La ejecución de restauración ", middle: " finalizó en estado ", after: "." },
  id: { before: "Proses pemulihan ", middle: " selesai dengan status ", after: "." },
  de: { before: "Wiederherstellungslauf ", middle: " wurde mit Status ", after: " abgeschlossen." },
  "zh-CN": { before: "恢复运行 ", middle: " 以状态 ", after: " 结束。" },
  "zh-TW": { before: "還原執行 ", middle: " 以狀態 ", after: " 結束。" },
  "pt-BR": { before: "A execução de restauração ", middle: " terminou no estado ", after: "." },
  ru: { before: "Запуск восстановления ", middle: " завершился в состоянии ", after: "." },
  fa: { before: "اجرای بازیابی ", middle: " با وضعیت ", after: " به پایان رسید." },
  ar: { before: "انتهى تشغيل الاستعادة ", middle: " بالحالة ", after: "." },
  ja: { before: "復元の実行 ", middle: " は状態 ", after: " で終了しました。" },
  ko: { before: "복원 실행 ", middle: "의 상태가 ", after: "(으)로 종료되었습니다." },
  pl: { before: "Uruchomienie przywracania ", middle: " zakończyło się w stanie ", after: "." },
  hu: { before: "A visszaállítási futtatás ", middle: " a következő állapotban fejeződött be: ", after: "." },
  fr: { before: "L'exécution de restauration ", middle: " s'est terminée à l'état ", after: "." },
  uk: { before: "Виконання відновлення ", middle: " завершилося у стані ", after: "." },
  tr: { before: "Geri yükleme çalıştırması ", middle: " şu durumda tamamlandı: ", after: "." },
  th: { before: "การรันการกู้คืน ", middle: " เสร็จสิ้นในสถานะ ", after: " แล้ว" },
  it: { before: "L'esecuzione del ripristino ", middle: " è terminata nello stato ", after: "." },
  hi: { before: "पुनर्स्थापना रन ", middle: " की स्थिति ", after: " में समाप्त हुई।" },
  ur: { before: "بحالی رن ", middle: " کی حالت ", after: " میں مکمل ہوئی۔" },
  bn: { before: "পুনরুদ্ধার রান ", middle: "-এর অবস্থা ", after: "-এ শেষ হয়েছে।" },
};

export function restoreDoneMessage({ locale, restoreRunId, stateNode }: { locale: string; restoreRunId: string; stateNode: ReactNode }, _options: Record<string, never> = {}): ReactNode {
  const f = localeEntry({ table: RESTORE_DONE_FRAGMENTS, locale });
  return (
    <>
      {f.before}
      <code>{restoreRunId}</code>
      {f.middle}
      {stateNode}
      {f.after}
    </>
  );
}
