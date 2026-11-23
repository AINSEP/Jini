/**
 * @file Translations for the form editor's unsaved-changes modal and the field dialog's
 * "CSS classes" ⓘ tip (Chrome check, 2026-10-11), merged into `FORMS_DICT` by `forms-i18n.ts`.
 * Same index-aligned layout as `forms-field-settings-i18n.ts`; its test pins the lengths.
 */
import { indexAlignedTranslations } from "./index-aligned-translations.js";
export const FORMS_LEAVE_GUARD_KEYS = [
  "Discard unsaved changes?",
  "Your changes to this form have not been saved.",
  "Discard changes",
  "Keep editing",
  "Classes are unrestricted, e.g. Tailwind md:col-span-2. Attribute names must be aria-*, data-* or a safe layout attribute; event handlers like onclick are rejected.",
] as const;

export const FORMS_LEAVE_GUARD_TRANSLATIONS: Record<string, readonly string[]> = {
  es: ["¿Descartar los cambios sin guardar?", "Los cambios de este formulario no se han guardado.", "Descartar cambios", "Seguir editando",
    "Las clases no tienen restricciones, p. ej., Tailwind md:col-span-2. Los nombres de atributo deben ser aria-*, data-* o un atributo de diseño seguro; los controladores de eventos como onclick se rechazan."],
  id: ["Buang perubahan yang belum disimpan?", "Perubahan pada formulir ini belum disimpan.", "Buang perubahan", "Lanjutkan mengedit",
    "Kelas tidak dibatasi, mis. Tailwind md:col-span-2. Nama atribut harus aria-*, data-* atau atribut tata letak yang aman; penangan peristiwa seperti onclick ditolak."],
  de: ["Nicht gespeicherte Änderungen verwerfen?", "Ihre Änderungen an diesem Formular wurden nicht gespeichert.", "Änderungen verwerfen", "Weiter bearbeiten",
    "Klassen sind uneingeschränkt, z. B. Tailwind md:col-span-2. Attributnamen müssen aria-*, data-* oder ein sicheres Layout-Attribut sein; Ereignishandler wie onclick werden abgelehnt."],
  "zh-CN": ["放弃未保存的更改？", "此表单的更改尚未保存。", "放弃更改", "继续编辑",
    "类不受限制，例如 Tailwind md:col-span-2。属性名称必须是 aria-*、data-* 或安全的布局属性；onclick 等事件处理程序会被拒绝。"],
  "zh-TW": ["捨棄未儲存的變更？", "此表單的變更尚未儲存。", "捨棄變更", "繼續編輯",
    "類別不受限制，例如 Tailwind md:col-span-2。屬性名稱必須是 aria-*、data-* 或安全的版面配置屬性；onclick 等事件處理常式會被拒絕。"],
  "pt-BR": ["Descartar alterações não salvas?", "As alterações neste formulário não foram salvas.", "Descartar alterações", "Continuar editando",
    "As classes não têm restrições, ex.: Tailwind md:col-span-2. Os nomes de atributo devem ser aria-*, data-* ou um atributo de layout seguro; manipuladores de eventos como onclick são rejeitados."],
  ru: ["Отменить несохранённые изменения?", "Изменения в этой форме не сохранены.", "Отменить изменения", "Продолжить редактирование",
    "Классы не ограничены, например Tailwind md:col-span-2. Имена атрибутов должны быть aria-*, data-* или безопасным атрибутом макета; обработчики событий вроде onclick отклоняются."],
  fa: ["تغییرات ذخیره‌نشده کنار گذاشته شوند؟", "تغییرات این فرم ذخیره نشده‌اند.", "کنار گذاشتن تغییرات", "ادامهٔ ویرایش",
    "کلاس‌ها محدودیتی ندارند، مثلاً Tailwind md:col-span-2. نام ویژگی‌ها باید aria-*، data-* یا یک ویژگی چیدمان امن باشد؛ گرداننده‌های رویداد مانند onclick رد می‌شوند."],
  ar: ["تجاهل التغييرات غير المحفوظة؟", "لم يتم حفظ تغييراتك على هذا النموذج.", "تجاهل التغييرات", "متابعة التحرير",
    "الفئات غير مقيّدة، مثل Tailwind md:col-span-2. يجب أن تكون أسماء السمات aria-* أو data-* أو سمة تخطيط آمنة؛ تُرفض معالجات الأحداث مثل onclick."],
  ja: ["保存されていない変更を破棄しますか？", "このフォームの変更は保存されていません。", "変更を破棄", "編集を続ける",
    "クラスに制限はありません（例: Tailwind md:col-span-2）。属性名は aria-*、data-*、または安全なレイアウト属性である必要があります。onclick などのイベントハンドラーは拒否されます。"],
  ko: ["저장하지 않은 변경 사항을 버릴까요?", "이 양식의 변경 사항이 저장되지 않았습니다.", "변경 사항 버리기", "계속 편집",
    "클래스에는 제한이 없습니다(예: Tailwind md:col-span-2). 속성 이름은 aria-*, data-* 또는 안전한 레이아웃 속성이어야 하며, onclick 같은 이벤트 핸들러는 거부됩니다."],
  pl: ["Odrzucić niezapisane zmiany?", "Zmiany w tym formularzu nie zostały zapisane.", "Odrzuć zmiany", "Edytuj dalej",
    "Klasy nie mają ograniczeń, np. Tailwind md:col-span-2. Nazwy atrybutów muszą być aria-*, data-* lub bezpiecznym atrybutem układu; procedury obsługi zdarzeń, takie jak onclick, są odrzucane."],
  hu: ["Elveti a nem mentett módosításokat?", "Az űrlap módosításai nincsenek mentve.", "Módosítások elvetése", "Szerkesztés folytatása",
    "Az osztályok korlátozás nélküliek, pl. Tailwind md:col-span-2. Az attribútumnév aria-*, data-* vagy biztonságos elrendezési attribútum lehet; az eseménykezelőket, például az onclick-et, elutasítjuk."],
  fr: ["Abandonner les modifications non enregistrées ?", "Les modifications de ce formulaire n’ont pas été enregistrées.", "Abandonner les modifications", "Continuer l’édition",
    "Les classes sont libres, p. ex. Tailwind md:col-span-2. Les noms d’attribut doivent être aria-*, data-* ou un attribut de mise en page sûr ; les gestionnaires d’événements comme onclick sont refusés."],
  uk: ["Скасувати незбережені зміни?", "Зміни в цій формі не збережено.", "Скасувати зміни", "Продовжити редагування",
    "Класи не обмежені, наприклад Tailwind md:col-span-2. Імена атрибутів мають бути aria-*, data-* або безпечним атрибутом макета; обробники подій на кшталт onclick відхиляються."],
  tr: ["Kaydedilmemiş değişiklikler atılsın mı?", "Bu formdaki değişiklikler kaydedilmedi.", "Değişiklikleri at", "Düzenlemeye devam et",
    "Sınıflar sınırsızdır, ör. Tailwind md:col-span-2. Öznitelik adları aria-*, data-* veya güvenli bir düzen özniteliği olmalıdır; onclick gibi olay işleyicileri reddedilir."],
  th: ["ทิ้งการเปลี่ยนแปลงที่ยังไม่บันทึกไหม", "การเปลี่ยนแปลงในฟอร์มนี้ยังไม่ได้บันทึก", "ทิ้งการเปลี่ยนแปลง", "แก้ไขต่อ",
    "คลาสไม่มีข้อจำกัด เช่น Tailwind md:col-span-2 ชื่อแอตทริบิวต์ต้องเป็น aria-*, data-* หรือแอตทริบิวต์เลย์เอาต์ที่ปลอดภัย ตัวจัดการเหตุการณ์อย่าง onclick จะถูกปฏิเสธ"],
  it: ["Scartare le modifiche non salvate?", "Le modifiche a questo modulo non sono state salvate.", "Scarta modifiche", "Continua a modificare",
    "Le classi sono libere, ad es. Tailwind md:col-span-2. I nomi degli attributi devono essere aria-*, data-* o un attributo di layout sicuro; i gestori di eventi come onclick vengono rifiutati."],
  hi: ["सहेजे न गए बदलाव छोड़ दें?", "इस फ़ॉर्म में किए गए बदलाव सहेजे नहीं गए हैं।", "बदलाव छोड़ें", "संपादन जारी रखें",
    "क्लास पर कोई रोक नहीं है, जैसे Tailwind md:col-span-2। एट्रिब्यूट नाम aria-*, data-* या कोई सुरक्षित लेआउट एट्रिब्यूट होने चाहिए; onclick जैसे इवेंट हैंडलर अस्वीकार किए जाते हैं।"],
  ur: ["غیر محفوظ تبدیلیاں ترک کریں؟", "اس فارم میں آپ کی تبدیلیاں محفوظ نہیں ہوئیں۔", "تبدیلیاں ترک کریں", "ترمیم جاری رکھیں",
    "کلاسز پر کوئی پابندی نہیں، مثلاً Tailwind md:col-span-2۔ ایٹریبیوٹ کے نام aria-*، data-* یا کوئی محفوظ لے آؤٹ ایٹریبیوٹ ہونے چاہییں؛ onclick جیسے ایونٹ ہینڈلر مسترد ہوتے ہیں۔"],
  bn: ["সংরক্ষণ না করা পরিবর্তন বাতিল করবেন?", "এই ফর্মে আপনার পরিবর্তন সংরক্ষিত হয়নি।", "পরিবর্তন বাতিল করুন", "সম্পাদনা চালিয়ে যান",
    "ক্লাসে কোনো সীমা নেই, যেমন Tailwind md:col-span-2। অ্যাট্রিবিউটের নাম aria-*, data-* বা কোনো নিরাপদ লেআউট অ্যাট্রিবিউট হতে হবে; onclick-এর মতো ইভেন্ট হ্যান্ডলার প্রত্যাখ্যাত হয়।"],
};

/** `{ locale: { key: translation } }`, built from the two lists above. */
export const FORMS_LEAVE_GUARD_I18N: Record<string, Record<string, string>> = indexAlignedTranslations({ keys: FORMS_LEAVE_GUARD_KEYS, translations: FORMS_LEAVE_GUARD_TRANSLATIONS });
