/**
 * @file Categories & Tags screen dictionary slice — the merge wizard, in every locale. One of the slices the former single
 * host `taxonomy-i18n.ts` was split into by screen area; `create-taxonomy-dictionary.ts` composes them
 * (entries and their why-comments are unchanged, just regrouped).
 */
export const TAXONOMY_MERGE_I18N: Record<string, Record<string, string>> = {
  es: {
    // Merge wizard
    "Merge into another term": "Combinar con otro término",
    "Choose a term…": "Elige un término…",
    "Planning…": "Planificando…",
    "Plan merge": "Planificar combinación",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Esto moverá {count} asignación(es) de contenido superpuestas al término de destino y combinará",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "con él. Confirmar emite un token de ejecución único — todavía no se combina nada.",
    "Confirming…": "Confirmando…",
    "Confirm merge": "Confirmar combinación",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Confirmado. Ejecutar combina los términos ahora — esto no se puede deshacer.",
    "Merging…": "Combinando…",
    "Execute merge": "Ejecutar combinación",
  },
  id: {
    "Merge into another term": "Gabungkan ke istilah lain",
    "Choose a term…": "Pilih istilah…",
    "Planning…": "Merencanakan…",
    "Plan merge": "Rencanakan penggabungan",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Ini akan memindahkan {count} penetapan konten yang tumpang tindih ke istilah target dan menggabungkan",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "ke dalamnya. Mengonfirmasi akan menerbitkan token eksekusi sekali pakai — belum ada yang digabungkan.",
    "Confirming…": "Mengonfirmasi…",
    "Confirm merge": "Konfirmasi penggabungan",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Dikonfirmasi. Menjalankan akan menggabungkan istilah sekarang — ini tidak dapat dibatalkan.",
    "Merging…": "Menggabungkan…",
    "Execute merge": "Jalankan penggabungan",
  },
  de: {
    "Merge into another term": "In einen anderen Begriff zusammenführen",
    "Choose a term…": "Begriff wählen…",
    "Planning…": "Wird geplant…",
    "Plan merge": "Zusammenführung planen",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Dies verschiebt {count} sich überschneidende Inhaltszuweisung(en) auf den Zielbegriff und führt ihn mit",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "zusammen. Das Bestätigen erzeugt ein einmaliges Ausführungs-Token — noch wird nichts zusammengeführt.",
    "Confirming…": "Wird bestätigt…",
    "Confirm merge": "Zusammenführung bestätigen",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Bestätigt. Das Ausführen führt die Begriffe jetzt zusammen — dies kann nicht rückgängig gemacht werden.",
    "Merging…": "Wird zusammengeführt…",
    "Execute merge": "Zusammenführung ausführen",
  },
  "zh-CN": {
    "Merge into another term": "合并到另一个术语",
    "Choose a term…": "选择术语…",
    "Planning…": "规划中…",
    "Plan merge": "规划合并",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "这将把 {count} 个重叠的内容分配移动到目标术语,并将其与",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "合并。确认操作会颁发一次性执行令牌 — 目前尚未合并任何内容。",
    "Confirming…": "确认中…",
    "Confirm merge": "确认合并",
    "Confirmed. Executing merges the terms now — this cannot be undone.": "已确认。执行操作将立即合并这些术语 — 此操作无法撤销。",
    "Merging…": "合并中…",
    "Execute merge": "执行合并",
  },
  "zh-TW": {
    "Merge into another term": "合併到另一個詞彙",
    "Choose a term…": "選擇詞彙…",
    "Planning…": "規劃中…",
    "Plan merge": "規劃合併",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "這將把 {count} 個重疊的內容指派移動到目標詞彙,並將其與",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "合併。確認操作會核發一次性執行權杖 — 目前尚未合併任何內容。",
    "Confirming…": "確認中…",
    "Confirm merge": "確認合併",
    "Confirmed. Executing merges the terms now — this cannot be undone.": "已確認。執行操作將立即合併這些詞彙 — 此操作無法復原。",
    "Merging…": "合併中…",
    "Execute merge": "執行合併",
  },
  "pt-BR": {
    "Merge into another term": "Mesclar com outro termo",
    "Choose a term…": "Escolha um termo…",
    "Planning…": "Planejando…",
    "Plan merge": "Planejar mesclagem",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Isso moverá {count} atribuição(ões) de conteúdo sobrepostas para o termo de destino e mesclará",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "com ele. Confirmar emite um token de execução único — nada foi mesclado ainda.",
    "Confirming…": "Confirmando…",
    "Confirm merge": "Confirmar mesclagem",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Confirmado. Executar mescla os termos agora — esta ação não pode ser desfeita.",
    "Merging…": "Mesclando…",
    "Execute merge": "Executar mesclagem",
  },
  ru: {
    "Merge into another term": "Объединить с другим термином",
    "Choose a term…": "Выберите термин…",
    "Planning…": "Планирование…",
    "Plan merge": "Спланировать объединение",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Это переместит {count} пересекающихся назначений контента в целевой термин и объединит",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "с ним. Подтверждение выдаёт одноразовый токен выполнения — пока ничего не объединено.",
    "Confirming…": "Подтверждение…",
    "Confirm merge": "Подтвердить объединение",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Подтверждено. Выполнение немедленно объединит термины — это действие нельзя отменить.",
    "Merging…": "Объединение…",
    "Execute merge": "Выполнить объединение",
  },
  fa: {
    "Merge into another term": "ادغام با اصطلاح دیگر",
    "Choose a term…": "انتخاب اصطلاح…",
    "Planning…": "در حال برنامه‌ریزی…",
    "Plan merge": "برنامه‌ریزی ادغام",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "این کار {count} اختصاص محتوای همپوشان را به اصطلاح مقصد منتقل می‌کند و آن را با",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "ادغام می‌کند. تأیید یک توکن اجرای یک‌بارمصرف صادر می‌کند — هنوز چیزی ادغام نشده است.",
    "Confirming…": "در حال تأیید…",
    "Confirm merge": "تأیید ادغام",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "تأیید شد. اجرا هم‌اکنون اصطلاحات را ادغام می‌کند — این کار قابل بازگشت نیست.",
    "Merging…": "در حال ادغام…",
    "Execute merge": "اجرای ادغام",
  },
  ar: {
    "Merge into another term": "دمج مع مصطلح آخر",
    "Choose a term…": "اختر مصطلحًا…",
    "Planning…": "جارٍ التخطيط…",
    "Plan merge": "تخطيط الدمج",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "سيؤدي هذا إلى نقل {count} تخصيص محتوى متداخل إلى المصطلح الهدف ودمج",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "معه. يؤدي التأكيد إلى إصدار رمز تنفيذ لمرة واحدة — لم يتم دمج أي شيء بعد.",
    "Confirming…": "جارٍ التأكيد…",
    "Confirm merge": "تأكيد الدمج",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "تم التأكيد. سيؤدي التنفيذ إلى دمج المصطلحات الآن — لا يمكن التراجع عن هذا الإجراء.",
    "Merging…": "جارٍ الدمج…",
    "Execute merge": "تنفيذ الدمج",
  },
  ja: {
    "Merge into another term": "他の用語に統合",
    "Choose a term…": "用語を選択…",
    "Planning…": "計画中…",
    "Plan merge": "統合を計画",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "これにより、重複するコンテンツの割り当て {count} 件が対象の用語に移動し、",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "と統合されます。確定すると一回限りの実行トークンが発行されます — まだ統合は実行されていません。",
    "Confirming…": "確定中…",
    "Confirm merge": "統合を確定",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "確定しました。実行すると用語が今すぐ統合されます — この操作は元に戻せません。",
    "Merging…": "統合中…",
    "Execute merge": "統合を実行",
  },
  ko: {
    "Merge into another term": "다른 용어와 병합",
    "Choose a term…": "용어 선택…",
    "Planning…": "계획 중…",
    "Plan merge": "병합 계획",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "이 작업은 겹치는 콘텐츠 할당 {count}개를 대상 용어로 이동하고, ",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "와(과) 병합합니다. 확인하면 일회용 실행 토큰이 발급됩니다 — 아직 병합되지 않았습니다.",
    "Confirming…": "확인 중…",
    "Confirm merge": "병합 확인",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "확인되었습니다. 실행하면 용어가 즉시 병합됩니다 — 이 작업은 되돌릴 수 없습니다.",
    "Merging…": "병합 중…",
    "Execute merge": "병합 실행",
  },
  pl: {
    "Merge into another term": "Połącz z innym terminem",
    "Choose a term…": "Wybierz termin…",
    "Planning…": "Planowanie…",
    "Plan merge": "Zaplanuj połączenie",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Spowoduje to przeniesienie {count} nakładających się przypisań treści do terminu docelowego i połączy",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "z nim. Potwierdzenie wygeneruje jednorazowy token wykonania — nic nie zostało jeszcze połączone.",
    "Confirming…": "Potwierdzanie…",
    "Confirm merge": "Potwierdź połączenie",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Potwierdzono. Wykonanie natychmiast połączy terminy — tej czynności nie można cofnąć.",
    "Merging…": "Łączenie…",
    "Execute merge": "Wykonaj połączenie",
  },
  hu: {
    "Merge into another term": "Összevonás másik kifejezéssel",
    "Choose a term…": "Válasszon kifejezést…",
    "Planning…": "Tervezés…",
    "Plan merge": "Összevonás tervezése",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Ez áthelyezi a(z) {count} átfedő tartalom-hozzárendelést a célkifejezésre, és összevonja",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "vele. A megerősítés egyszer használatos végrehajtási tokent ad ki — még semmi sincs összevonva.",
    "Confirming…": "Megerősítés…",
    "Confirm merge": "Összevonás megerősítése",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Megerősítve. A végrehajtás azonnal összevonja a kifejezéseket — ez a művelet nem vonható vissza.",
    "Merging…": "Összevonás…",
    "Execute merge": "Összevonás végrehajtása",
  },
  fr: {
    "Merge into another term": "Fusionner avec un autre terme",
    "Choose a term…": "Choisissez un terme…",
    "Planning…": "Planification…",
    "Plan merge": "Planifier la fusion",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Cela déplacera {count} attribution(s) de contenu se chevauchant vers le terme cible et fusionnera",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "avec lui. La confirmation émet un jeton d'exécution à usage unique — rien n'est encore fusionné.",
    "Confirming…": "Confirmation…",
    "Confirm merge": "Confirmer la fusion",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Confirmé. L'exécution fusionne les termes immédiatement — cette action est irréversible.",
    "Merging…": "Fusion…",
    "Execute merge": "Exécuter la fusion",
  },
  uk: {
    "Merge into another term": "Об'єднати з іншим терміном",
    "Choose a term…": "Виберіть термін…",
    "Planning…": "Планування…",
    "Plan merge": "Спланувати об'єднання",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Це перемістить {count} перекривних призначень контенту до цільового терміна та об'єднає",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "з ним. Підтвердження видасть одноразовий токен виконання — поки нічого не об'єднано.",
    "Confirming…": "Підтвердження…",
    "Confirm merge": "Підтвердити об'єднання",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Підтверджено. Виконання негайно об'єднає терміни — цю дію не можна скасувати.",
    "Merging…": "Об'єднання…",
    "Execute merge": "Виконати об'єднання",
  },
  tr: {
    "Merge into another term": "Başka bir terimle birleştir",
    "Choose a term…": "Bir terim seçin…",
    "Planning…": "Planlanıyor…",
    "Plan merge": "Birleştirmeyi planla",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Bu, {count} çakışan içerik atamasını hedef terime taşıyacak ve",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "ile birleştirecektir. Onaylamak tek seferlik bir yürütme jetonu verir — henüz hiçbir şey birleştirilmedi.",
    "Confirming…": "Onaylanıyor…",
    "Confirm merge": "Birleştirmeyi onayla",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Onaylandı. Yürütme, terimleri şimdi birleştirir — bu işlem geri alınamaz.",
    "Merging…": "Birleştiriliyor…",
    "Execute merge": "Birleştirmeyi yürüt",
  },
  th: {
    "Merge into another term": "ผสานเข้ากับคำศัพท์อื่น",
    "Choose a term…": "เลือกคำศัพท์…",
    "Planning…": "กำลังวางแผน…",
    "Plan merge": "วางแผนการผสาน",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "การดำเนินการนี้จะย้าย {count} การกำหนดเนื้อหาที่ทับซ้อนกันไปยังคำศัพท์เป้าหมาย และจะผสานรวมกับ",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "การยืนยันจะออกโทเคนการดำเนินการแบบใช้ครั้งเดียว — ยังไม่มีการผสานรวมใดๆ",
    "Confirming…": "กำลังยืนยัน…",
    "Confirm merge": "ยืนยันการผสาน",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "ยืนยันแล้ว การดำเนินการจะผสานคำศัพท์ทันที การดำเนินการนี้ไม่สามารถย้อนกลับได้",
    "Merging…": "กำลังผสาน…",
    "Execute merge": "ดำเนินการผสาน",
  },
  it: {
    "Merge into another term": "Unisci a un altro termine",
    "Choose a term…": "Scegli un termine…",
    "Planning…": "Pianificazione…",
    "Plan merge": "Pianifica unione",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "Questo sposterà {count} assegnazione/i di contenuto sovrapposta/e sul termine di destinazione e unirà",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "con esso. La conferma emette un token di esecuzione monouso — non è stato ancora unito nulla.",
    "Confirming…": "Conferma…",
    "Confirm merge": "Conferma unione",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "Confermato. L'esecuzione unisce subito i termini — questa azione non può essere annullata.",
    "Merging…": "Unione…",
    "Execute merge": "Esegui unione",
  },
  hi: {
    "Merge into another term": "किसी अन्य टर्म में मर्ज करें",
    "Choose a term…": "एक टर्म चुनें…",
    "Planning…": "योजना बनाई जा रही है…",
    "Plan merge": "मर्ज की योजना बनाएं",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "इससे {count} अतिव्यापी कंटेंट असाइनमेंट लक्ष्य टर्म पर ले जाए जाएंगे और",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "के साथ मर्ज कर दिए जाएंगे। पुष्टि करने पर एक बार इस्तेमाल होने वाला एक्ज़ीक्यूशन टोकन जारी होता है — अभी तक कुछ भी मर्ज नहीं हुआ है।",
    "Confirming…": "पुष्टि की जा रही है…",
    "Confirm merge": "मर्ज की पुष्टि करें",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "पुष्टि हो गई। एक्ज़ीक्यूट करने पर टर्म अभी मर्ज हो जाएंगे — इसे पूर्ववत नहीं किया जा सकता।",
    "Merging…": "मर्ज हो रहा है…",
    "Execute merge": "मर्ज एक्ज़ीक्यूट करें",
  },
  ur: {
    "Merge into another term": "کسی دوسرے ٹرم میں ضم کریں",
    "Choose a term…": "ایک ٹرم منتخب کریں…",
    "Planning…": "منصوبہ بندی ہو رہی ہے…",
    "Plan merge": "انضمام کی منصوبہ بندی کریں",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "اس سے {count} اوورلیپنگ کنٹینٹ اسائنمنٹس ٹارگٹ ٹرم پر منتقل ہو جائیں گی اور",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "کے ساتھ ضم کر دی جائیں گی۔ تصدیق کرنے پر ایک بار استعمال ہونے والا ایگزیکیوشن ٹوکن جاری ہوتا ہے — ابھی تک کچھ بھی ضم نہیں ہوا۔",
    "Confirming…": "تصدیق ہو رہی ہے…",
    "Confirm merge": "انضمام کی تصدیق کریں",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "تصدیق ہو گئی۔ اب ایگزیکیوٹ کرنے پر ٹرمز ضم ہو جائیں گی — اسے واپس نہیں لیا جا سکتا۔",
    "Merging…": "ضم ہو رہا ہے…",
    "Execute merge": "انضمام ایگزیکیوٹ کریں",
  },
  bn: {
    "Merge into another term": "অন্য একটি টার্মে মার্জ করুন",
    "Choose a term…": "একটি টার্ম বেছে নিন…",
    "Planning…": "পরিকল্পনা করা হচ্ছে…",
    "Plan merge": "মার্জের পরিকল্পনা করুন",
    "This will move {count} overlapping content assignment(s) onto the target term and merge":
      "এতে {count} ওভারল্যাপিং কন্টেন্ট অ্যাসাইনমেন্ট টার্গেট টার্মে সরানো হবে এবং",
    "away. Confirming issues a one-time execution token — nothing is merged yet.":
      "-এর সাথে মার্জ করা হবে। নিশ্চিত করলে একবার ব্যবহারযোগ্য এক্সিকিউশন টোকেন ইস্যু হয় — এখনো কিছুই মার্জ হয়নি।",
    "Confirming…": "নিশ্চিত করা হচ্ছে…",
    "Confirm merge": "মার্জ নিশ্চিত করুন",
    "Confirmed. Executing merges the terms now — this cannot be undone.":
      "নিশ্চিত করা হয়েছে। এক্সিকিউট করলে টার্মগুলো এখনই মার্জ হয়ে যাবে — এটি পূর্বাবস্থায় ফেরানো যাবে না।",
    "Merging…": "মার্জ করা হচ্ছে…",
    "Execute merge": "মার্জ এক্সিকিউট করুন",
  },
};
