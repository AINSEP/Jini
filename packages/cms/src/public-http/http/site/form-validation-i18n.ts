/** Public form copy follows the rendered document/form language; field labels remain authored. */
/** [required, select, too long, invalid, "this field", too long with the field's {max} characters]. */
import type { FormValidationCopy } from "../../../forms/validation-messages.js";

/** The fallback for any locale without its own row. */
const ENGLISH_COPY: FormValidationCopy = ["Please enter {label}.", "Please select {label}.", "Please shorten {label}.", "Please check {label}.", "this field", "Please keep {label} to {max} characters or fewer."];

export const FORM_VALIDATION_COPY: Record<string, FormValidationCopy> = {
  en: ENGLISH_COPY,
  es: ["Introduce {label}.", "Selecciona {label}.", "Acorta {label}.", "Revisa {label}.", "este campo", "Acorta {label} a {max} caracteres como máximo."],
  id: ["Silakan isi {label}.", "Silakan pilih {label}.", "Silakan persingkat {label}.", "Silakan periksa {label}.", "bidang ini", "Silakan persingkat {label} menjadi maksimal {max} karakter."],
  de: ["Bitte füllen Sie {label} aus.", "Bitte wählen Sie {label} aus.", "Bitte kürzen Sie {label}.", "Bitte prüfen Sie {label}.", "dieses Feld", "Bitte kürzen Sie {label} auf höchstens {max} Zeichen."],
  "zh-CN": ["请填写{label}。", "请选择{label}。", "请缩短{label}。", "请检查{label}。", "此字段", "请将{label}缩短至{max}个字符以内。"],
  "zh-TW": ["請填寫{label}。", "請選擇{label}。", "請縮短{label}。", "請檢查{label}。", "此欄位", "請將{label}縮短至{max}個字元以內。"],
  "pt-BR": ["Preencha {label}.", "Selecione {label}.", "Encurte {label}.", "Verifique {label}.", "este campo", "Encurte {label} para no máximo {max} caracteres."],
  ru: ["Заполните поле «{label}».", "Выберите «{label}».", "Сократите текст в поле «{label}».", "Проверьте поле «{label}».", "это поле", "Максимум символов в поле «{label}»: {max}."],
  fa: ["لطفاً {label} را وارد کنید.", "لطفاً {label} را انتخاب کنید.", "لطفاً {label} را کوتاه‌تر کنید.", "لطفاً {label} را بررسی کنید.", "این فیلد", "لطفاً {label} را به حداکثر {max} نویسه کوتاه کنید."],
  ar: ["يرجى إدخال {label}.", "يرجى اختيار {label}.", "يرجى تقصير {label}.", "يرجى التحقق من {label}.", "هذا الحقل", "الحد الأقصى لعدد الأحرف في {label}: {max}."],
  ja: ["{label}を入力してください。", "{label}を選択してください。", "{label}を短くしてください。", "{label}を確認してください。", "この項目", "{label}は{max}文字以内にしてください。"],
  ko: ["{label}을(를) 입력해 주세요.", "{label}을(를) 선택해 주세요.", "{label}을(를) 줄여 주세요.", "{label}을(를) 확인해 주세요.", "이 항목", "{label}은(는) {max}자 이내로 입력해 주세요."],
  pl: ["Wypełnij pole „{label}”.", "Wybierz „{label}”.", "Skróć tekst w polu „{label}”.", "Sprawdź pole „{label}”.", "to pole", "Maksymalna liczba znaków w polu „{label}”: {max}."],
  hu: ["Töltse ki ezt: {label}.", "Válassza ki ezt: {label}.", "Rövidítse le ezt: {label}.", "Ellenőrizze ezt: {label}.", "ez a mező", "Rövidítse le ezt: {label} (legfeljebb {max} karakter)."],
  fr: ["Veuillez renseigner {label}.", "Veuillez sélectionner {label}.", "Veuillez raccourcir {label}.", "Veuillez vérifier {label}.", "ce champ", "Veuillez raccourcir {label} à {max} caractères maximum."],
  uk: ["Заповніть поле «{label}».", "Виберіть «{label}».", "Скоротіть текст у полі «{label}».", "Перевірте поле «{label}».", "це поле", "Максимум символів у полі «{label}»: {max}."],
  tr: ["Lütfen {label} alanını doldurun.", "Lütfen {label} seçeneğini seçin.", "Lütfen {label} metnini kısaltın.", "Lütfen {label} alanını kontrol edin.", "bu alan", "Lütfen {label} metnini en fazla {max} karakter olacak şekilde kısaltın."],
  th: ["โปรดกรอก{label}", "โปรดเลือก{label}", "โปรดย่อ{label}ให้สั้นลง", "โปรดตรวจสอบ{label}", "ช่องนี้", "โปรดย่อ{label}ให้ไม่เกิน {max} ตัวอักษร"],
  it: ["Compila {label}.", "Seleziona {label}.", "Accorcia {label}.", "Controlla {label}.", "questo campo", "Accorcia {label} a non più di {max} caratteri."],
  hi: ["कृपया {label} भरें।", "कृपया {label} चुनें।", "कृपया {label} छोटा करें।", "कृपया {label} जाँचें।", "यह फ़ील्ड", "कृपया {label} को अधिकतम {max} अक्षरों तक छोटा करें।"],
  ur: ["براہ کرم {label} درج کریں۔", "براہ کرم {label} منتخب کریں۔", "براہ کرم {label} مختصر کریں۔", "براہ کرم {label} چیک کریں۔", "یہ خانہ", "براہ کرم {label} کو زیادہ سے زیادہ {max} حروف تک مختصر کریں۔"],
  bn: ["অনুগ্রহ করে {label} পূরণ করুন।", "অনুগ্রহ করে {label} নির্বাচন করুন।", "অনুগ্রহ করে {label} সংক্ষিপ্ত করুন।", "অনুগ্রহ করে {label} যাচাই করুন।", "এই ঘর", "অনুগ্রহ করে {label} সর্বোচ্চ {max} অক্ষরে সংক্ষিপ্ত করুন।"],
};

export function formValidationCopy({ locale }: { locale: string }, _optional = {}) {
  const normalized = locale.toLowerCase();
  let key = Object.keys(FORM_VALIDATION_COPY).find((key) => key.toLowerCase() === normalized);
  if (key === undefined) {
    if (normalized.startsWith("zh")) key = /(tw|hk|hant)/.test(normalized) ? "zh-TW" : "zh-CN";
    else key = normalized.split("-")[0] ?? normalized;
  }
  return FORM_VALIDATION_COPY[key] ?? (key === "pt" ? FORM_VALIDATION_COPY["pt-BR"] : undefined) ?? ENGLISH_COPY;
}
