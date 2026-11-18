import { forwardRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeUmKit, renderWithUmKit } from "../../__tests__/fake-um-kit.js";
import { UserManagementKitMissingError, type SecretInputProps } from "../../kit.js";
import { Login } from "../Login.js";
import type { LoginController } from "../hooks/use-login.hooks.js";

const translate = (key: string) => (key === "Show password" ? "Mostrar contraseña" : key);
const port = { login: async () => ({ user: { id: "u", username: "operator" } }) };
const controller = (overrides: Partial<LoginController> = {}): (() => LoginController) => () => ({
  username: "admin", setUsername: vi.fn(), password: "pw", setPassword: vi.fn(), error: null, busy: false,
  submit: vi.fn(async () => {}), ...overrides,
});
const renderLogin = (hook: () => LoginController, kit = fakeUmKit()) =>
  renderWithUmKit(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={hook} />, { kit });

/** Page-level coverage through the fake kit: the sign-in screen renders its password field through the kit's SecretInput slot, never `ui`'s. */
describe("Login through the user-management kit", () => {
  it("renders the password field as the kit's SecretInput slot, labelled by the caller's own <label>", () => {
    const { container } = renderLogin(controller());
    const slot = container.querySelector('[data-um-kit="SecretInput"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector("input")).toHaveValue("pw");
    expect(slot?.querySelector("input")?.id).toBe(container.querySelector("label[for]")?.getAttribute("for"));
  });

  it("hands the slot the translated eye-toggle labels and the autofill hint", () => {
    const seen: SecretInputProps[] = [];
    const Capture = forwardRef<HTMLInputElement, Omit<SecretInputProps, "ref">>(function Capture(props, ref) { seen.push(props); return <input ref={ref} />; });
    renderLogin(controller(), fakeUmKit({ components: { SecretInput: Capture } }));
    expect(seen.at(-1)).toMatchObject({ label: "Password", toggleLabels: { show: "Mostrar contraseña", hide: "Hide password" }, autoComplete: "current-password", value: "pw" });
  });

  it("forwards typing to the controller's setPassword", () => {
    const setPassword = vi.fn();
    const { container } = renderLogin(controller({ setPassword }));
    const input = container.querySelector('[data-um-kit="SecretInput"] input') as HTMLInputElement;
    input.focus();
    // The fake's input is a plain controlled <input>: a change event reaches the page's onChange.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "new-secret");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setPassword).toHaveBeenCalledWith("new-secret");
  });

  it("shows the sign-in error in plain words and keeps the slot", () => {
    const { getByRole, container } = renderLogin(controller({ error: "Wrong username or password." }));
    expect(getByRole("alert")).toHaveTextContent("Wrong username or password.");
    expect(container.querySelector('[data-um-kit="SecretInput"]')).not.toBeNull();
  });

  it("renders no password slot while the authenticator step is showing", () => {
    const { container } = renderLogin(controller({ mfa: { pendingToken: "proof", code: "", setCode: vi.fn(), cancel: vi.fn() } }));
    expect(container.querySelector('[data-um-kit="SecretInput"]')).toBeNull();
  });

  it("throws the typed missing-provider error when no kit is mounted", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Login port={port} translate={translate} productName="Example" onLogin={vi.fn()} useLoginHook={controller()} />))
        .toThrow(UserManagementKitMissingError);
    } finally { quiet.mockRestore(); }
  });
});
