import { interpolate, localeEntry } from '@jini-ai/core/text';
/**
 * @file The Users screen's reset-password toast copy. Moved verbatim from the host's users dictionary
 * (`users-i18n.ts`) so the locale-bound controller owns it; the rest of that dictionary stays host-side.
 */

const PASSWORD_RESET_NOTICE_TEMPLATE: Record<string, string> = {
  en: 'Password reset for "{username}" — every active session for this user was revoked.',
  es: 'Se restableció la contraseña de "{username}" — se revocó toda sesión activa de este usuario.',
  id: 'Kata sandi untuk "{username}" telah diatur ulang — semua sesi aktif pengguna ini telah dicabut.',
  de: 'Passwort für „{username}" wurde zurückgesetzt — alle aktiven Sitzungen dieses Benutzers wurden widerrufen.',
  "zh-CN": '已重置 "{username}" 的密码 — 该用户的所有活动会话均已被撤销。',
  "zh-TW": '已重設「{username}」的密碼 — 該使用者的所有現行工作階段均已被撤銷。',
  "pt-BR": 'Senha redefinida para "{username}" — todas as sessões ativas deste usuário foram revogadas.',
  ru: 'Пароль для «{username}» сброшен — все активные сеансы этого пользователя были аннулированы.',
  fa: 'رمز عبور «{username}» بازنشانی شد — تمام نشست‌های فعال این کاربر لغو شد.',
  ar: 'تمت إعادة تعيين كلمة المرور لـ "{username}" — تم إلغاء كل جلسة نشطة لهذا المستخدم.',
  ja: '「{username}」のパスワードをリセットしました — このユーザーのすべてのアクティブなセッションが無効になりました。',
  ko: '"{username}"의 비밀번호가 재설정되었습니다 — 이 사용자의 모든 활성 세션이 취소되었습니다.',
  pl: 'Zresetowano hasło dla „{username}" — wszystkie aktywne sesje tego użytkownika zostały unieważnione.',
  hu: 'A(z) „{username}" jelszava visszaállítva — a felhasználó minden aktív munkamenete visszavonásra került.',
  fr: 'Mot de passe réinitialisé pour « {username} » — toutes les sessions actives de cet utilisateur ont été révoquées.',
  uk: 'Пароль для «{username}» скинуто — усі активні сеанси цього користувача було анульовано.',
  tr: '"{username}" için parola sıfırlandı — bu kullanıcının tüm etkin oturumları iptal edildi.',
  th: 'รีเซ็ตรหัสผ่านสำหรับ "{username}" แล้ว — เซสชันที่ใช้งานอยู่ทั้งหมดของผู้ใช้รายนี้ถูกเพิกถอนแล้ว',
  it: 'Password reimpostata per "{username}" — tutte le sessioni attive di questo utente sono state revocate.',
  hi: '"{username}" के लिए पासवर्ड रीसेट कर दिया गया — इस उपयोगकर्ता का हर सक्रिय सत्र रद्द कर दिया गया।',
  ur: '"{username}" کے لیے پاس ورڈ ری سیٹ کر دیا گیا — اس صارف کا ہر فعال سیشن منسوخ کر دیا گیا۔',
  bn: '"{username}"-এর জন্য পাসওয়ার্ড রিসেট করা হয়েছে — এই ব্যবহারকারীর প্রতিটি সক্রিয় সেশন প্রত্যাহার করা হয়েছে।',
};

/** The reset-password success toast — embeds the user's own (untranslated) `username`
 *  mid-sentence, so it can't be a flat `ES` entry the way `roles-i18n.ts`'s
 *  `roleDeleteBodyParts` etc. handle the same shape. */
export function passwordResetNotice({ locale, username }: { locale: string; username: string }, _options = {}): string {
  return interpolate({ template: localeEntry({ table: PASSWORD_RESET_NOTICE_TEMPLATE, locale }), vars: { username } });
}
