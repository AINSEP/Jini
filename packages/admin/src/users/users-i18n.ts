import { ADMIN_COMMON_I18N } from "../core/i18n-common.js";
import { translationEntry } from "../shell/lib/translation-entry.js";
import { mergeLocaleOverlays } from "../shell/lib/merge-locale-overlays.js";
import { createDictionaryTranslator } from '@jini-ai/core/text';
import { USERS_TRANSLATIONS_A } from "./i18n/users-translations-a.js";
import { USERS_TRANSLATIONS_B } from "./i18n/users-translations-b.js";
import { USERS_TRANSLATIONS_C } from "./i18n/users-translations-c.js";
import { USERS_TRANSLATIONS_D } from "./i18n/users-translations-d.js";
/**
 * @file Spanish translation for the Users screen (`Users.tsx`) — this feature's own dictionary,
 * not the shared `lib/admin-nav-i18n.ts` one, so parallel translation passes over other admin
 * sections can't collide on the same file. Same two-step fallback every other `t()` in this app
 * uses: translated value, else the English source string itself.
 */

const USERS_TRANSLATIONS: Record<string, Record<string, string>> = {
  ...USERS_TRANSLATIONS_A,
  ...USERS_TRANSLATIONS_B,
  ...USERS_TRANSLATIONS_C,
  ...USERS_TRANSLATIONS_D,
};

const PASSWORD_FIELD_TRANSLATIONS: Record<string, Record<string, string>> = {
  es: { "Confirm new password": "Confirmar nueva contraseña", "Show password": "Mostrar contraseña", "Hide password": "Ocultar contraseña", "Passwords do not match.": "Las contraseñas no coinciden." },
  id: { "Confirm new password": "Konfirmasi kata sandi baru", "Show password": "Tampilkan kata sandi", "Hide password": "Sembunyikan kata sandi", "Passwords do not match.": "Kata sandi tidak cocok." },
  de: { "Confirm new password": "Neues Passwort bestätigen", "Show password": "Passwort anzeigen", "Hide password": "Passwort verbergen", "Passwords do not match.": "Die Passwörter stimmen nicht überein." },
  "zh-CN": { "Confirm new password": "确认新密码", "Show password": "显示密码", "Hide password": "隐藏密码", "Passwords do not match.": "密码不匹配。" },
  "zh-TW": { "Confirm new password": "確認新密碼", "Show password": "顯示密碼", "Hide password": "隱藏密碼", "Passwords do not match.": "密碼不相符。" },
  "pt-BR": { "Confirm new password": "Confirmar nova senha", "Show password": "Mostrar senha", "Hide password": "Ocultar senha", "Passwords do not match.": "As senhas não coincidem." },
  ru: { "Confirm new password": "Подтвердите новый пароль", "Show password": "Показать пароль", "Hide password": "Скрыть пароль", "Passwords do not match.": "Пароли не совпадают." },
  fa: { "Confirm new password": "تأیید رمز عبور جدید", "Show password": "نمایش رمز عبور", "Hide password": "پنهان کردن رمز عبور", "Passwords do not match.": "رمزهای عبور یکسان نیستند." },
  ar: { "Confirm new password": "تأكيد كلمة المرور الجديدة", "Show password": "إظهار كلمة المرور", "Hide password": "إخفاء كلمة المرور", "Passwords do not match.": "كلمتا المرور غير متطابقتين." },
  ja: { ...translationEntry({ source: "Confirm new password", translated: "新しいパスワードを確認" }), "Show password": "パスワードを表示", "Hide password": "パスワードを隠す", ...translationEntry({ source: "Passwords do not match.", translated: "パスワードが一致しません。" }) },
  ko: { "Confirm new password": "새 비밀번호 확인", "Show password": "비밀번호 표시", "Hide password": "비밀번호 숨기기", "Passwords do not match.": "비밀번호가 일치하지 않습니다." },
  pl: { "Confirm new password": "Potwierdź nowe hasło", "Show password": "Pokaż hasło", "Hide password": "Ukryj hasło", "Passwords do not match.": "Hasła nie są zgodne." },
  hu: { "Confirm new password": "Új jelszó megerősítése", "Show password": "Jelszó megjelenítése", "Hide password": "Jelszó elrejtése", "Passwords do not match.": "A jelszavak nem egyeznek." },
  fr: { "Confirm new password": "Confirmer le nouveau mot de passe", "Show password": "Afficher le mot de passe", "Hide password": "Masquer le mot de passe", "Passwords do not match.": "Les mots de passe ne correspondent pas." },
  uk: { "Confirm new password": "Підтвердьте новий пароль", "Show password": "Показати пароль", "Hide password": "Приховати пароль", "Passwords do not match.": "Паролі не збігаються." },
  tr: { "Confirm new password": "Yeni parolayı doğrula", "Show password": "Parolayı göster", "Hide password": "Parolayı gizle", "Passwords do not match.": "Parolalar eşleşmiyor." },
  th: { ...translationEntry({ source: "Confirm new password", translated: "ยืนยันรหัสผ่านใหม่" }), ...translationEntry({ source: "Show password", translated: "แสดงรหัสผ่าน" }), ...translationEntry({ source: "Hide password", translated: "ซ่อนรหัสผ่าน" }), ...translationEntry({ source: "Passwords do not match.", translated: "รหัสผ่านไม่ตรงกัน" }) },
  it: { "Confirm new password": "Conferma nuova password", "Show password": "Mostra password", "Hide password": "Nascondi password", "Passwords do not match.": "Le password non corrispondono." },
  hi: { "Confirm new password": "नया पासवर्ड पुष्टि करें", "Show password": "पासवर्ड दिखाएँ", "Hide password": "पासवर्ड छिपाएँ", "Passwords do not match.": "पासवर्ड मेल नहीं खाते।" },
  ur: { "Confirm new password": "نئے پاس ورڈ کی تصدیق کریں", "Show password": "پاس ورڈ دکھائیں", "Hide password": "پاس ورڈ چھپائیں", "Passwords do not match.": "پاس ورڈ ایک جیسے نہیں ہیں۔" },
  bn: { "Confirm new password": "নতুন পাসওয়ার্ড নিশ্চিত করুন", "Show password": "পাসওয়ার্ড দেখান", "Hide password": "পাসওয়ার্ড লুকান", "Passwords do not match.": "পাসওয়ার্ড মিলছে না।" },
};

/** The page-header info tip (owner ask, 2026-09-24): explains there's no "forgot password"
 *  self-service flow yet, and that the owner/an admin resets a locked-out user's password from
 *  this page. Its own small dictionary, same shape as {@link PASSWORD_FIELD_TRANSLATIONS} above,
 *  rather than editing all 21 locale blocks in {@link USERS_TRANSLATIONS}. */
const RESET_PASSWORD_INFO_TRANSLATIONS: Record<string, Record<string, string>> = {
  es: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Todavía no hay un correo de 'olvidé mi contraseña'. Si alguien queda bloqueado, el propietario puede restablecer su contraseña aquí.",
  },
  id: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Belum ada email 'lupa kata sandi'. Jika seseorang terkunci, pemilik dapat mengatur ulang kata sandinya di sini.",
  },
  de: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Noch keine 'Passwort vergessen'-E-Mail. Wenn jemand ausgesperrt ist, kann der Inhaber das Passwort hier zurücksetzen.",
  },
  "zh-CN": {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "尚未提供\"忘记密码\"邮件。如果有人被锁定，所有者可以在此重置其密码。",
  },
  "zh-TW": {
    ...translationEntry({ source: "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.",
      translated: "尚未提供「忘記密碼」電子郵件功能。如果有人被鎖定，擁有者可以在這裡重設密碼。" }),
  },
  "pt-BR": {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Ainda não há e-mail de 'esqueci minha senha'. Se alguém for bloqueado, o proprietário pode redefinir a senha aqui.",
  },
  ru: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Письма «Забыли пароль» пока нет. Если кого-то заблокировали, владелец может сбросить его пароль здесь.",
  },
  fa: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "هنوز ایمیل «فراموشی رمز عبور» وجود ندارد. اگر کسی قفل شود، مالک می‌تواند رمز عبور او را از اینجا بازنشانی کند.",
  },
  ar: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "لا توجد رسالة \"نسيت كلمة المرور\" بعد. إذا تم قفل حساب أحدهم، يمكن للمالك إعادة تعيين كلمة مروره من هنا.",
  },
  ja: {
    ...translationEntry({ source: "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.",
      translated: "「パスワードを忘れた場合」のメールはまだありません。ロックアウトされた場合は、オーナーがここでパスワードをリセットできます。" }),
  },
  ko: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "아직 '비밀번호 찾기' 이메일이 없습니다. 누군가 잠기면 소유자가 여기에서 비밀번호를 재설정할 수 있습니다.",
  },
  pl: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Nie ma jeszcze e-maila 'nie pamiętam hasła'. Jeśli ktoś zostanie zablokowany, właściciel może tutaj zresetować jego hasło.",
  },
  hu: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Még nincs 'elfelejtett jelszó' e-mail. Ha valaki kizárja magát, a tulajdonos itt tudja visszaállítani a jelszavát.",
  },
  fr: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Pas encore d'e-mail « mot de passe oublié ». Si quelqu'un est bloqué, le propriétaire peut réinitialiser son mot de passe ici.",
  },
  uk: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Листа «Забули пароль» поки немає. Якщо когось заблоковано, власник може скинути його пароль тут.",
  },
  tr: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Henüz 'şifremi unuttum' e-postası yok. Biri hesabından kilitlenirse sahibi parolasını buradan sıfırlayabilir.",
  },
  th: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "ยังไม่มีอีเมล 'ลืมรหัสผ่าน' หากมีใครถูกล็อกไม่ให้เข้าใช้งาน เจ้าของสามารถรีเซ็ตรหัสผ่านให้ที่นี่ได้",
  },
  it: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "Non c'è ancora un'e-mail 'password dimenticata'. Se qualcuno viene bloccato, il proprietario può reimpostare la password qui.",
  },
  hi: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "अभी तक 'पासवर्ड भूल गए' ईमेल नहीं है। अगर किसी का खाता लॉक हो जाए, तो मालिक यहां से उसका पासवर्ड रीसेट कर सकता है।",
  },
  ur: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "ابھی تک 'پاس ورڈ بھول گئے' ای میل موجود نہیں ہے۔ اگر کوئی لاک ہو جائے تو مالک یہاں سے اس کا پاس ورڈ ری سیٹ کر سکتا ہے۔",
  },
  bn: {
    "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.":
      "এখনো 'পাসওয়ার্ড ভুলে গেছেন' ইমেইল নেই। কেউ লক হয়ে গেলে, মালিক এখান থেকে তার পাসওয়ার্ড রিসেট করতে পারেন।",
  },
};

const OWNER_LABELS: Record<string, string> = {
  "es": "Propietario",
  "id": "Pemilik",
  "de": "Inhaber",
  "zh-CN": "所有者",
  "zh-TW": "擁有者",
  "pt-BR": "Proprietário",
  "ru": "Владелец",
  "fa": "مالک",
  "ar": "المالك",
  "ja": "オーナー",
  "ko": "소유자",
  "pl": "Właściciel",
  "hu": "Tulajdonos",
  "fr": "Propriétaire",
  "uk": "Власник",
  "tr": "Sahip",
  "th": "เจ้าของ",
  "it": "Proprietario",
  "hi": "स्वामी",
  "ur": "مالک",
  "bn": "মালিক"
};

const USERS_DICT: Record<string, Record<string, string>> = mergeLocaleOverlays(
  { base: USERS_TRANSLATIONS },
  { overlays: [
    Object.fromEntries(Object.entries(OWNER_LABELS).map(([locale, owner]) => [locale, { Owner: owner }])),
    PASSWORD_FIELD_TRANSLATIONS,
    RESET_PASSWORD_INFO_TRANSLATIONS,
  ] },
);

export const t = createDictionaryTranslator({ featureDictionary: USERS_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
