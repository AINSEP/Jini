// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_ELEMENT_ATTRIBUTE } from "@jini-ai/core/agent-handles";
import {
  AdminByokKeyFooter, AdminByokMigrationPrompt, AdminByokSettingsFooter, resolveByokSettingsStatusLine,
  type AdminByokKeyFooterProps, type AdminByokMigrationPromptProps, type AdminByokSettingsFooterProps,
} from "../AdminByokKeyPanel.js";

afterEach(cleanup);

const locales: string[] = [];
const useAdminLocaleHook = () => "es";
const createTranslator: AdminByokMigrationPromptProps["createTranslator"] = ({ locale }) => { locales.push(locale); return ({ key }) => `${locale}:${key}`; };

type PromptController = AdminByokMigrationPromptProps["controller"];
function prompt(_optional: Partial<PromptController> = {}): PromptController {
  return { legacyKey: "legacy", saveState: { status: "idle" }, migrateLegacyKey: vi.fn(async () => {}), dismissLegacyPrompt: vi.fn(), ..._optional };
}

describe("AdminByokMigrationPrompt", () => {
  it("renders nothing once there is no legacy key", () => {
    const { container } = render(<AdminByokMigrationPrompt controller={prompt({ legacyKey: null })} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(container.innerHTML).toBe("");
  });

  it("saves or dismisses, and derives -save/-dismiss handles from the base", () => {
    const c = prompt();
    render(<AdminByokMigrationPrompt controller={c} agentHandle="byok-migrate" useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    const save = screen.getByRole("button", { name: "es:Save to my account" });
    expect(save.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("byok-migrate-save");
    expect(screen.getByRole("button", { name: "es:Not now" }).getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("byok-migrate-dismiss");
    fireEvent.click(save);
    fireEvent.click(screen.getByRole("button", { name: "es:Not now" }));
    expect(c.migrateLegacyKey).toHaveBeenCalledTimes(1);
    expect(c.dismissLegacyPrompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").querySelector(".save-error")).toBeNull();
  });

  it("without a base handle carries no agent markup; saving disables both; an error shows its message", () => {
    render(<AdminByokMigrationPrompt controller={prompt({ saveState: { status: "saving" } })} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    const saving = screen.getByRole("button", { name: "es:Saving…" });
    expect(saving.hasAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe(false);
    expect(saving.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "es:Not now" }).hasAttribute("disabled")).toBe(true);
    cleanup();
    render(<AdminByokMigrationPrompt controller={prompt({ saveState: { status: "error", message: "seal failed" } })} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(screen.getByText("seal failed").className).toBe("save-error");
  });
});

type KeyController = AdminByokKeyFooterProps["controller"];
function keyController(_optional: Partial<KeyController> = {}): KeyController {
  return { saveState: { status: "idle" }, canSaveKey: true, stored: null, storedKeyIsForOtherEndpoint: false, saveKey: vi.fn(async () => {}), ..._optional };
}

describe("AdminByokKeyFooter", () => {
  it("saves through the controller, publishes its handle, and passes isStored=false and the shared translator", () => {
    const resolve = vi.fn<AdminByokKeyFooterProps["resolveByokFooterStatusLine"]>((_required, options) => options?.t?.("line") ?? null);
    const c = keyController();
    render(<AdminByokKeyFooter controller={c} agentHandle="byok-save-key" useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} resolveByokFooterStatusLine={resolve} />);
    expect(resolve.mock.calls[0]?.[0]).toEqual({ status: "idle", isStored: false });
    expect(screen.getByText("es:line").className).toBe("assistant-save-line");
    const button = screen.getByRole("button", { name: "es:Save key" });
    expect(button.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("byok-save-key");
    fireEvent.click(button);
    expect(c.saveKey).toHaveBeenCalledTimes(1);
  });

  it("uses the host t when given; saving disables the button; an error shows its message", () => {
    const resolve = vi.fn<AdminByokKeyFooterProps["resolveByokFooterStatusLine"]>((_required, options) => options?.t?.("line") ?? null);
    render(<AdminByokKeyFooter controller={keyController({ saveState: { status: "saving" }, stored: { isSet: true } })} t={key => `host:${key}`}
      useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} resolveByokFooterStatusLine={resolve} />);
    expect(resolve.mock.calls[0]?.[0]).toEqual({ status: "saving", isStored: true });
    expect(screen.getByText("host:line")).not.toBeNull();
    const button = screen.getByRole("button", { name: "es:Saving…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.hasAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe(false);
    cleanup();
    render(<AdminByokKeyFooter controller={keyController({ saveState: { status: "error", message: "rejected" }, canSaveKey: false })}
      useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} resolveByokFooterStatusLine={() => null} />);
    expect(screen.getByText("rejected").className).toBe("save-error");
    expect(screen.getByRole("button", { name: "es:Save key" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("resolveByokSettingsStatusLine", () => {
  it("speaks only for saving and saved, defaulting to English passthrough", () => {
    expect(resolveByokSettingsStatusLine({ status: "saving" })).toBe("Saving…");
    expect(resolveByokSettingsStatusLine({ status: "saved" }, { t: key => `x:${key}` })).toBe("x:Settings saved.");
    expect(resolveByokSettingsStatusLine({ status: "idle" })).toBeNull();
    expect(resolveByokSettingsStatusLine({ status: "error" })).toBeNull();
  });
});

describe("AdminByokSettingsFooter", () => {
  type SettingsController = AdminByokSettingsFooterProps["controller"];
  function settings(_optional: Partial<SettingsController> = {}): SettingsController {
    return { settingsSaveState: { status: "idle" }, saveSettings: vi.fn(async () => {}), ..._optional };
  }

  it("idle: no status line, saves through the controller with its handle", () => {
    const c = settings();
    const { container } = render(<AdminByokSettingsFooter controller={c} agentHandle="byok-save-settings" useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(container.querySelector(".assistant-save-line")).toBeNull();
    const button = screen.getByRole("button", { name: "es:Save settings" });
    expect(button.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("byok-save-settings");
    fireEvent.click(button);
    expect(c.saveSettings).toHaveBeenCalledTimes(1);
  });

  it("saved shows the shared-translated line; host t wins; saving disables; error shows", () => {
    render(<AdminByokSettingsFooter controller={settings({ settingsSaveState: { status: "saved" } })} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(screen.getByText("es:Settings saved.").className).toBe("assistant-save-line");
    cleanup();
    render(<AdminByokSettingsFooter controller={settings({ settingsSaveState: { status: "saving" } })} t={key => `host:${key}`} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(screen.getByText("host:Saving…")).not.toBeNull();
    const button = screen.getByRole("button", { name: "es:Saving…" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.hasAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe(false);
    cleanup();
    render(<AdminByokSettingsFooter controller={settings({ settingsSaveState: { status: "error", message: "bad model" } })} useAdminLocaleHook={useAdminLocaleHook} createTranslator={createTranslator} />);
    expect(screen.getByText("bad model").className).toBe("save-error");
    expect(locales.every(locale => locale === "es")).toBe(true);
  });
});
