/**
 * @file Translations for the two failures the Post and Page editors now report in plain words
 * (fix/hang-bugs): a recovered draft that could not be discarded, and a dropped or pasted file whose
 * upload failed. Both used to fail silently, so neither had copy to translate.
 *
 * One module, because the discard message is shared by the Post editor (`use-post-editor.hooks.ts`)
 * and the Page editor (`use-page-editor.hooks.ts`); each feature dictionary reads from here instead
 * of carrying its own copy of the same sentence.
 *
 * Keys are the full English sentences, as everywhere else in this app. The discard sentence names the
 * banner's two buttons, so each locale spells "Discard" and "Restore" exactly as the button labels in
 * `posts-i18n.ts` do. `{name}` (the file) and `{cause}` (the already-redacted reason) must survive in
 * every locale. Same 21-locale set as every other admin dictionary.
 */

const DISCARD_FAILED = "Could not discard the recovered draft. It is still saved and the banner is still here, so you can try Discard again or Restore it.";
const UPLOAD_FAILED = "Could not add {name}. Nothing was inserted. Cause: {cause}";
const NO_REASON = "no reason was given";

/** Locale → source sentence → translation. Read by the Post and Page editor dictionaries only. */
export const EDITOR_FAILURE_DICT: Record<string, Record<string, string>> = {
  es: {
    [DISCARD_FAILED]: "No se pudo descartar el borrador recuperado. Sigue guardado y el aviso sigue aquí, así que puedes volver a intentar Descartar o Restaurarlo.",
    [UPLOAD_FAILED]: "No se pudo añadir {name}. No se insertó nada. Causa: {cause}",
    [NO_REASON]: "no se indicó ningún motivo",
  },
  id: {
    [DISCARD_FAILED]: "Draf yang dipulihkan tidak dapat dibuang. Draf masih tersimpan dan spanduknya masih ada di sini, jadi Anda dapat mencoba Buang lagi atau Pulihkan.",
    [UPLOAD_FAILED]: "Tidak dapat menambahkan {name}. Tidak ada yang disisipkan. Penyebab: {cause}",
    [NO_REASON]: "tidak ada alasan yang diberikan",
  },
  de: {
    [DISCARD_FAILED]: "Der wiederhergestellte Entwurf konnte nicht verworfen werden. Er ist weiterhin gespeichert und der Hinweis wird weiter angezeigt – du kannst es mit Verwerfen erneut versuchen oder ihn mit Wiederherstellen übernehmen.",
    [UPLOAD_FAILED]: "{name} konnte nicht hinzugefügt werden. Es wurde nichts eingefügt. Ursache: {cause}",
    [NO_REASON]: "es wurde kein Grund angegeben",
  },
  "zh-CN": {
    [DISCARD_FAILED]: "无法放弃已恢复的草稿。草稿仍已保存，提示横幅仍然显示，你可以再次点击“放弃”或点击“恢复”。",
    [UPLOAD_FAILED]: "无法添加 {name}。未插入任何内容。原因：{cause}",
    [NO_REASON]: "未给出原因",
  },
  "zh-TW": {
    [DISCARD_FAILED]: "無法捨棄已復原的草稿。草稿仍已儲存，提示橫幅仍然顯示，你可以再次點選「捨棄」或點選「還原」。",
    [UPLOAD_FAILED]: "無法新增 {name}。未插入任何內容。原因：{cause}",
    [NO_REASON]: "未提供原因",
  },
  "pt-BR": {
    [DISCARD_FAILED]: "Não foi possível descartar o rascunho recuperado. Ele continua salvo e o aviso continua aqui, então você pode tentar Descartar de novo ou Restaurá-lo.",
    [UPLOAD_FAILED]: "Não foi possível adicionar {name}. Nada foi inserido. Causa: {cause}",
    [NO_REASON]: "nenhum motivo foi informado",
  },
  ru: {
    [DISCARD_FAILED]: "Не удалось отбросить восстановленный черновик. Он по-прежнему сохранён, и уведомление всё ещё здесь, поэтому можно снова нажать «Отбросить» или «Восстановить».",
    [UPLOAD_FAILED]: "Не удалось добавить {name}. Ничего не вставлено. Причина: {cause}",
    [NO_REASON]: "причина не указана",
  },
  fa: {
    [DISCARD_FAILED]: "دور انداختن پیش‌نویس بازیابی‌شده ممکن نشد. پیش‌نویس همچنان ذخیره است و این اعلان هنوز اینجاست؛ می‌توانید دوباره «دور انداختن» را امتحان کنید یا «بازیابی» کنید.",
    [UPLOAD_FAILED]: "افزودن {name} ممکن نشد. چیزی درج نشد. علت: {cause}",
    [NO_REASON]: "دلیلی ارائه نشد",
  },
  ar: {
    [DISCARD_FAILED]: "تعذّر تجاهل المسودة المستعادة. ما زالت محفوظة وما زال الشريط ظاهرًا هنا، لذا يمكنك محاولة «تجاهل» مرة أخرى أو «استعادة» المسودة.",
    [UPLOAD_FAILED]: "تعذّرت إضافة {name}. لم يتم إدراج أي شيء. السبب: {cause}",
    [NO_REASON]: "لم يتم ذكر سبب",
  },
  ja: {
    [DISCARD_FAILED]: "復元された下書きを破棄できませんでした。下書きは保存されたままで、バナーも表示されたままなので、もう一度「破棄」を試すか「復元」できます。",
    [UPLOAD_FAILED]: "{name} を追加できませんでした。何も挿入されていません。原因: {cause}",
    [NO_REASON]: "理由は示されませんでした",
  },
  ko: {
    [DISCARD_FAILED]: "복구된 초안을 버리지 못했습니다. 초안은 그대로 저장되어 있고 배너도 그대로 남아 있으니 ‘버리기’를 다시 시도하거나 ‘복원’할 수 있습니다.",
    [UPLOAD_FAILED]: "{name}을(를) 추가하지 못했습니다. 아무것도 삽입되지 않았습니다. 원인: {cause}",
    [NO_REASON]: "이유가 제공되지 않았습니다",
  },
  pl: {
    [DISCARD_FAILED]: "Nie udało się odrzucić odzyskanego szkicu. Nadal jest zapisany, a baner nadal tu jest, więc możesz ponownie spróbować „Odrzuć” albo go „Przywróć”.",
    [UPLOAD_FAILED]: "Nie udało się dodać {name}. Nic nie zostało wstawione. Przyczyna: {cause}",
    [NO_REASON]: "nie podano przyczyny",
  },
  hu: {
    [DISCARD_FAILED]: "A helyreállított piszkozatot nem sikerült elvetni. Továbbra is mentve van, és az értesítősáv is itt marad, így újra megpróbálhatod az „Elvetés” gombot, vagy használhatod a „Visszaállítás” gombot.",
    [UPLOAD_FAILED]: "A(z) {name} hozzáadása nem sikerült. Semmi sem lett beszúrva. Ok: {cause}",
    [NO_REASON]: "nem adtak meg okot",
  },
  fr: {
    [DISCARD_FAILED]: "Impossible d’abandonner le brouillon récupéré. Il est toujours enregistré et la bannière est toujours là : vous pouvez réessayer Abandonner ou le Restaurer.",
    [UPLOAD_FAILED]: "Impossible d’ajouter {name}. Rien n’a été inséré. Cause : {cause}",
    [NO_REASON]: "aucune raison n’a été donnée",
  },
  uk: {
    [DISCARD_FAILED]: "Не вдалося відкинути відновлену чернетку. Вона досі збережена, а банер усе ще тут, тож можна ще раз натиснути «Відкинути» або «Відновити».",
    [UPLOAD_FAILED]: "Не вдалося додати {name}. Нічого не вставлено. Причина: {cause}",
    [NO_REASON]: "причину не вказано",
  },
  tr: {
    [DISCARD_FAILED]: "Kurtarılan taslak atılamadı. Taslak hâlâ kayıtlı ve başlık hâlâ burada; Vazgeç’i yeniden deneyebilir veya Geri yükle’yi kullanabilirsiniz.",
    [UPLOAD_FAILED]: "{name} eklenemedi. Hiçbir şey yerleştirilmedi. Neden: {cause}",
    [NO_REASON]: "neden belirtilmedi",
  },
  th: {
    [DISCARD_FAILED]: "ทิ้งฉบับร่างที่กู้คืนไม่สำเร็จ ฉบับร่างยังคงถูกบันทึกอยู่และแบนเนอร์ยังอยู่ที่นี่ คุณจึงลองกด “ทิ้ง” อีกครั้งหรือกด “กู้คืน” ได้",
    [UPLOAD_FAILED]: "เพิ่ม {name} ไม่สำเร็จ ไม่มีสิ่งใดถูกแทรก สาเหตุ: {cause}",
    [NO_REASON]: "ไม่ได้ระบุเหตุผล",
  },
  it: {
    [DISCARD_FAILED]: "Impossibile scartare la bozza recuperata. È ancora salvata e il banner è ancora qui, quindi puoi riprovare con Scarta oppure Ripristinarla.",
    [UPLOAD_FAILED]: "Impossibile aggiungere {name}. Non è stato inserito nulla. Causa: {cause}",
    [NO_REASON]: "nessun motivo indicato",
  },
  hi: {
    [DISCARD_FAILED]: "पुनर्प्राप्त किए गए ड्राफ़्ट को छोड़ा नहीं जा सका। वह अभी भी सहेजा हुआ है और बैनर अभी भी यहीं है, इसलिए आप फिर से “छोड़ दें” आज़मा सकते हैं या “पुनर्स्थापित करें” चुन सकते हैं।",
    [UPLOAD_FAILED]: "{name} जोड़ा नहीं जा सका। कुछ भी सम्मिलित नहीं किया गया। कारण: {cause}",
    [NO_REASON]: "कोई कारण नहीं बताया गया",
  },
  ur: {
    [DISCARD_FAILED]: "بازیافت شدہ مسودہ رد نہیں کیا جا سکا۔ وہ اب بھی محفوظ ہے اور بینر اب بھی یہیں ہے، اس لیے آپ دوبارہ «رد کریں» آزما سکتے ہیں یا «بحال کریں» منتخب کر سکتے ہیں۔",
    [UPLOAD_FAILED]: "{name} شامل نہیں کیا جا سکا۔ کچھ بھی داخل نہیں ہوا۔ وجہ: {cause}",
    [NO_REASON]: "کوئی وجہ نہیں بتائی گئی",
  },
  bn: {
    [DISCARD_FAILED]: "পুনরুদ্ধার করা খসড়াটি বাদ দেওয়া যায়নি। এটি এখনও সংরক্ষিত আছে এবং ব্যানারটিও এখানে আছে, তাই আপনি আবার “বাদ দিন” চেষ্টা করতে পারেন বা “পুনরুদ্ধার করুন” বেছে নিতে পারেন।",
    [UPLOAD_FAILED]: "{name} যোগ করা যায়নি। কিছুই সন্নিবেশ করা হয়নি। কারণ: {cause}",
    [NO_REASON]: "কোনো কারণ জানানো হয়নি",
  },
};
