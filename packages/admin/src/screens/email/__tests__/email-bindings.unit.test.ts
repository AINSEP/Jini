import { expect, it, vi } from "vitest";
import { createEmailNavigate, createEmailTabLabel } from "../Email.hooks.js";
import { createEmailProviderLabel, createEmailProviderSelect } from "../EmailProviderTab.hooks.js";
import { createEmailPageTranslator } from "../EmailTemplateEditor.hooks.js";
import type { MailProviderConfiguration } from "../email-api.types.js";

it("binds the selected tab label to the requested locale", () => {
  const label = createEmailTabLabel({ locale: "es", labels: { sending: "Sender", none: "None" } });
  expect(label("sending")).toBe("Remitente");
  expect(label("none")).toBe("Ninguno");
});

it("replaces the Email route with the chosen section encoded independently of its tab", () => {
  const navigate = vi.fn();
  const select = createEmailNavigate({ deps: { routePath: "/mail", tabKey: "section", partKey: "item", navigate } });
  select({ tabId: "overview", part: null });
  select({ tabId: "providers", part: "smtp/one & two" });
  expect(navigate.mock.calls).toEqual([
    [{ routePath: "/mail?section=overview" }, { replace: true }],
    [{ routePath: "/mail?section=providers&item=smtp%2Fone%20%26%20two" }, { replace: true }],
  ]);
});

it("prefers a configured provider label and preserves unrecognized IDs and localized None", () => {
  const configured: MailProviderConfiguration = {
    id: "local", label: "Capture on this machine", origin: "core", hosted: false, lanes: [],
    capabilities: { feedback: false, domainVerification: false },
    credential: { required: false, saved: false }, selectable: true, setup: { fields: [] },
  };
  const label = createEmailProviderLabel({ locale: "es", providers: [configured] });
  expect(label("local")).toBe("Capture on this machine");
  expect(label("legacy-provider")).toBe("legacy-provider");
  expect(label(null)).toBe("Ninguno");
});

it("opens only the provider actually returned by Add, with or without a selection callback", () => {
  const onSelect = vi.fn();
  const select = createEmailProviderSelect({ props: { onSelect } });
  select(undefined);
  select("");
  select("new-smtp");
  createEmailProviderSelect({ props: {} })("new-smtp");
  expect(onSelect.mock.calls).toEqual([["new-smtp"]]);
});

it("passes shared toolbar copy to the page translator with the editor locale", () => {
  const pageEditorT = vi.fn(({ key }: { locale: string; key: string }) => key === "Preview" ? "Vorschau" : key === "Save" ? "Speichern" : key);
  const translate = createEmailPageTranslator({ locale: "de", pageEditorT });
  expect([translate("Preview"), translate("Save")]).toEqual(["Vorschau", "Speichern"]);
  expect(pageEditorT.mock.calls).toEqual([[{ locale: "de", key: "Preview" }], [{ locale: "de", key: "Save" }]]);
});
