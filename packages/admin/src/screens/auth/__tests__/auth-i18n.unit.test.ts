import { describe, expect, it } from "vitest";
import { t } from "../auth-i18n.js";

// Author Checklist F4.3/F6.2: English-only Login tests miss a dropped locale dictionary.
// Real translation factory, literal expectations, no shared state or runtime effects.
describe("signed-out operator translations", () => {
  it.each([
    ["Sign in to your workspace", "Inicia sesión en tu espacio de trabajo"],
    ["Username", "Nombre de usuario"],
    ["Password", "Contraseña"],
    ["Sign in", "Iniciar sesión"],
    ["Signing in…", "Iniciando sesión…"],
  ])("translates Spanish login copy %s", (key, expected) => {
    expect(t({ locale: "es", key: key })).toBe(expected);
  });

  it("does not reuse another locale and preserves unknown copy", () => {
    expect(t({ locale: "de", key: "Signing in…" })).toBe("Anmeldung läuft…");
    expect(t({ locale: "es", key: "Signing in…" })).toBe("Iniciando sesión…");
    expect(t({ locale: "es", key: "Cancel" })).toBe("Cancelar");
    expect(t({ locale: "en", key: "Sign in" })).toBe("Sign in");
    expect(t({ locale: "unknown-locale", key: "Username" })).toBe("Username");
    expect(t({ locale: "es", key: "Unlisted login error" })).toBe("Unlisted login error");
  });
});
