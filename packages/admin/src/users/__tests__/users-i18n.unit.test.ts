import { describe, expect, it } from "vitest";
import { t } from "../users-i18n.js";

/**
 * @file `users-i18n.ts` — the dictionary moved from the host verbatim and was split into four
 * per-locale-group part files plus three overlays. These assertions go through the same `t` a caller
 * uses and pin one key per layer for every locale, so a part file dropped from the merge, an overlay
 * dropped from `mergeLocaleOverlays`, or a lost common-dictionary fallback fails here.
 */
// Reviewed copy expectations are literals, independent of the production translator.
const EXPECTED_USERS: Record<string, string> = {
  es: "Usuarios", id: "Pengguna", de: "Benutzer", "zh-CN": "用户", "zh-TW": "使用者",
  "pt-BR": "Usuários", ru: "Пользователи", fa: "کاربران", ar: "المستخدمون", ja: "ユーザー",
  ko: "사용자", pl: "Użytkownicy", hu: "Felhasználók", fr: "Utilisateurs", uk: "Користувачі",
  tr: "Kullanıcılar", th: "ผู้ใช้", it: "Utenti", hi: "उपयोगकर्ता", ur: "صارفین", bn: "ব্যবহারকারী",
};
const EXPECTED_OWNER: Record<string, string> = {
  es: "Propietario", id: "Pemilik", de: "Inhaber", "zh-CN": "所有者", "zh-TW": "擁有者",
  "pt-BR": "Proprietário", ru: "Владелец", fa: "مالک", ar: "المالك", ja: "オーナー", ko: "소유자",
  pl: "Właściciel", hu: "Tulajdonos", fr: "Propriétaire", uk: "Власник", tr: "Sahip", th: "เจ้าของ",
  it: "Proprietario", hi: "स्वामी", ur: "مالک", bn: "মালিক",
};
const EXPECTED_CONFIRM_PASSWORD: Record<string, string> = {
  es: "Confirmar nueva contraseña", id: "Konfirmasi kata sandi baru", de: "Neues Passwort bestätigen",
  "zh-CN": "确认新密码", "zh-TW": "確認新密碼", "pt-BR": "Confirmar nova senha", ru: "Подтвердите новый пароль",
  fa: "تأیید رمز عبور جدید", ar: "تأكيد كلمة المرور الجديدة", ja: "新しいパスワードを確認", ko: "새 비밀번호 확인",
  pl: "Potwierdź nowe hasło", hu: "Új jelszó megerősítése", fr: "Confirmer le nouveau mot de passe",
  uk: "Підтвердьте новий пароль", tr: "Yeni parolayı doğrula", th: "ยืนยันรหัสผ่านใหม่", it: "Conferma nuova password",
  hi: "नया पासवर्ड पुष्टि करें", ur: "نئے پاس ورڈ کی تصدیق کریں", bn: "নতুন পাসওয়ার্ড নিশ্চিত করুন",
};
const RESET_INFO_KEY =
  "No 'forgot password' email yet. If someone is locked out, the owner can reset their password here.";

describe("users-i18n t — every locale reaches each layer", () => {
  for (const locale of Object.keys(EXPECTED_USERS)) {
    it(`${locale}: base part file, Owner overlay, password-field overlay`, () => {
      expect(t({ locale: locale, key: "Users" })).toBe(EXPECTED_USERS[locale]);
      expect(t({ locale: locale, key: "Owner" })).toBe(EXPECTED_OWNER[locale]);
      expect(t({ locale: locale, key: "Confirm new password" })).toBe(EXPECTED_CONFIRM_PASSWORD[locale]);
      expect(t({ locale: locale, key: RESET_INFO_KEY })).not.toBe(RESET_INFO_KEY);
    });
  }
});

describe("users-i18n t — specific entries and fallbacks", () => {
  it("translates the reset-password info tip", () => {
    expect(t({ locale: "es", key: RESET_INFO_KEY })).toBe(
      "Todavía no hay un correo de 'olvidé mi contraseña'. Si alguien queda bloqueado, el propietario puede restablecer su contraseña aquí.",
    );
  });

  it("keeps a translationEntry-built key", () => {
    expect(t({ locale: "es", key: "Password" })).toBe("Contraseña");
  });

  it("falls back to the common dictionary for a key the screen does not own", () => {
    expect(t({ locale: "es", key: "Delete" })).toBe("Eliminar");
  });

  it("returns the English source for English and for an unknown key", () => {
    expect(t({ locale: "en", key: "Users" })).toBe("Users");
    expect(t({ locale: "es", key: "not a users key" })).toBe("not a users key");
  });
});
