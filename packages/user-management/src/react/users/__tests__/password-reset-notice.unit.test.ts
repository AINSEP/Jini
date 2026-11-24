import { describe, expect, it } from "vitest";
import { passwordResetNotice } from "../password-reset-notice.js";

describe("passwordResetNotice (moved verbatim from the host's users-i18n.ts)", () => {
  it("embeds the username in the locale's sentence, English as fallback", () => {
    expect(passwordResetNotice({ locale: "es", username: "ana" })).toBe('Se restableció la contraseña de "ana" — se revocó toda sesión activa de este usuario.');
    expect(passwordResetNotice({ locale: "xx", username: "bo" })).toBe('Password reset for "bo" — every active session for this user was revoked.');
  });
});
