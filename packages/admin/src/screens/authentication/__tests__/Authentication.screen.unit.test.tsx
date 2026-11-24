// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, SETTINGS_DIALOG_DICTIONARIES, SettingsDialogShell } from "@jini-ai/ui";
import { beforeEach, describe, expect, it } from "vitest";

import { Authentication, type AuthenticationProps } from "../Authentication.js";
import type { AuthenticationSecretInputProps, AuthenticationSettingsShellProps } from "../authentication-host-slots.js";
import { PROVIDER_CATALOG_FIXTURE } from "./provider-catalog.fixture.js";

/**
 * @file `Authentication` with every host collaborator injected: the real `@jini-ai/ui` settings
 * shell as the host binds it, a secret input shaped like the host's, the locale and theme hooks,
 * the provider catalog and the product name (K3).
 */

// Locale delivery is outside this claim: it is injected through the component's hook prop, and the
// real component, shell and translators all run.
const language = { locale: "es" };
const useAdminLocaleHook = () => language.locale;

/** Like the host's: a secret field is a password input; a plain one turns browser autofill off. */
function SecretInput({ label: _label, secret, ...props }: AuthenticationSecretInputProps) {
  return secret ? <input {...props} type="password" /> : <input {...props} type="text" autoComplete="off" />;
}

function SettingsShell(props: AuthenticationSettingsShellProps) {
  return (
    <I18nProvider initialLocale="en" dictionaries={SETTINGS_DIALOG_DICTIONARIES} fallbackLocale="en" syncDocumentAttributes={false}>
      <SettingsDialogShell {...props} tabs={[...props.tabs]} />
    </I18nProvider>
  );
}

function renderScreen(overrides: Partial<AuthenticationProps> = {}) {
  return render(<Authentication useAdminLocaleHook={useAdminLocaleHook} useAdminThemeBoundaryHook={() => ({})} productName="Acme"
    providers={PROVIDER_CATALOG_FIXTURE} SecretInput={SecretInput} SettingsShell={SettingsShell} {...overrides} />);
}

beforeEach(() => { language.locale = "es"; });

describe("Authentication localized credential preview", () => {
  // F1.3/F2.4/F6.2: hardcoding English, losing hint associations, or enabling fields must fail.
  it("translates field labels, associated hints and provider notes while rejecting secret input", async () => {
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Autenticación" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Google" }));
    const identity = screen.getByLabelText(/^ID de cliente/) as HTMLInputElement;
    const secret = screen.getByLabelText(/^Secreto de cliente/) as HTMLInputElement;
    expect(identity.getAttribute("autocomplete")).toBe("off");
    expect(identity.required).toBe(true);
    expect(identity.matches(":disabled")).toBe(true);
    expect(secret.getAttribute("type")).toBe("password");
    expect(secret.getAttribute("placeholder")).toBe("Introduce el secreto de cliente de Google");
    expect(secret.getAttribute("autocomplete")).toBe("new-password");
    expect(secret.matches(":disabled")).toBe(true);
    expect(document.getElementById(identity.getAttribute("aria-describedby")!)?.textContent)
      .toBe("ID de cliente de aplicación web OAuth 2.0 de Google Cloud Console.");
    expect(document.getElementById(secret.getAttribute("aria-describedby")!)?.textContent)
      .toBe("Secreto de cliente OAuth 2.0 vinculado al ID de cliente.");
    expect(screen.getByRole("note").textContent).toBe("Aún no está conectado a un backend de autenticación de proveedor. Estos campos obligatorios se muestran para planificar la configuración; Acme no puede guardar credenciales ni habilitar el inicio de sesión con Google desde esta pantalla hoy.");
    await user.type(secret, "should-not-be-retained");
    expect(secret.value).toBe("");

    await user.click(screen.getByRole("button", { name: "LinkedIn" }));
    expect(screen.getByLabelText(/^Secreto de cliente/).getAttribute("placeholder")).toBe("Introduce el secreto de cliente de LinkedIn");
    expect(screen.getByRole("note").textContent).toBe("Aún no está conectado a un backend de autenticación de proveedor. Estos campos obligatorios se muestran para planificar la configuración; Acme no puede guardar credenciales ni habilitar el inicio de sesión con LinkedIn desde esta pantalla hoy.");
  });

  it("falls back to English for an unsupported locale", async () => {
    language.locale = "unsupported-locale";
    const user = userEvent.setup();
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Authentication" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Facebook" }));
    expect(screen.getByLabelText(/^App ID/).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(/^App secret/).getAttribute("placeholder")).toBe("Enter Meta app secret");
    expect(screen.getByRole("note").textContent).toBe("Not connected to a provider authentication backend yet. These required fields are shown for setup planning; Acme cannot save credentials or enable Facebook sign-in from this screen today.");
  });

  it("spreads the boundary attributes returned by the injected useAdminThemeBoundaryHook onto the page", () => {
    renderScreen({ useAdminThemeBoundaryHook: () => ({ "data-theme": "dark" }) });
    expect(document.querySelector(".jini-settings-ui-section--page-flow")?.getAttribute("data-theme")).toBe("dark");
  });
});

describe("Authentication host collaborators", () => {
  // K3: the host's product name lands where the home panel names who signs administrators in.
  it("names the host's product on the Home tab", () => {
    language.locale = "en";
    renderScreen({ productName: "Example CMS" });
    expect(screen.getByRole("note").textContent).toBe("Example CMS currently signs administrators in with a local username and password. A provider authentication backend, secure provider-credential storage contract, callback handling, and token lifecycle are not implemented yet.");
  });

  // The catalog is host policy: the screen renders exactly the providers it is handed.
  it("renders one tab per injected provider and no others", () => {
    renderScreen({ providers: PROVIDER_CATALOG_FIXTURE.filter((provider) => provider.id === "linkedin") });
    expect(screen.getByRole("button", { name: "LinkedIn" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Google" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Facebook" })).toBeNull();
  });

  // Rule: a class this screen renders is `jini-*`. The shell's own markup is the shell's business,
  // so inside it only this screen's panels are checked; the root itself must be present.
  it("renders only jini-prefixed classes in its own markup", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen();
    const ownClasses = () => [
      ...[container.firstElementChild!, ...container.firstElementChild!.querySelectorAll("*")].filter((el) => !el.closest(".jini-tabbed-dialog")),
      ...container.querySelectorAll(".jini-settings-section, .jini-settings-section *"),
    ].flatMap((el) => [...el.classList]);
    const home = ownClasses();
    await user.click(screen.getByRole("button", { name: "Google" }));
    const provider = ownClasses();
    expect(home).toContain("jini-page");
    expect(provider).toContain("jini-source-config-field");
    for (const name of [...home, ...provider]) expect(name).toMatch(/^jini-/);
  });
});
