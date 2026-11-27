// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CredentialStepDone, CredentialStepTodo } from "../StaticCredentialSteps.js";
import type { StaticSiteTabProps } from "../StaticSiteTab.js";
import type { PublishCredentialRowState, PublishCredentialsController } from "../hooks/use-publish-credentials.hooks.js";

afterEach(cleanup);
const kit: StaticSiteTabProps["kit"] = {
  Icon: () => null, CredentialHint: () => null, TabBar: () => null, ErrorNotice: () => null,
  SecretInput: ({ label: _label, secret, ...input }) => <input type={secret ? "password" : "text"} {...input} />,
};
const deps: StaticSiteTabProps["deps"] = {
  STATIC_SITE_CAPABILITIES: [], t: ({ key }) => key, createStaticSiteTabTranslator: () => key => key,
  adminHref: ({ routePath }) => routePath, pluginsPath: "/plugins", accessTokensPath: "/tokens", navigate: () => {},
  VIEWER_TIME_ZONE: "UTC", asciiSlug: ({ text }) => text, PUBLISH_RUN_RESULT_CLASSES: { success: "success", error: "error" },
  LINE_ICON: { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
  copy: { exportDescription: "Export", exportCommand: "export dir", credentialSubtitle: "Connect {credential}", storedTokenNotice: "Stored encrypted", pickerTokenNotice: "Choose a publishing token.", productName: "Fixture" },
};
const t = (key: string) => key;
const row: PublishCredentialRowState = {
  providerId: "museum", label: "Museum", credential: {
    tokenField: "token", tokenPageUrl: "https://account.example/tokens", userHelp: "Use the collections account.",
    fields: [
      { name: "token", label: "API token", required: true, secret: true, help: "Read and publish only." },
      { name: "accountId", label: "Account ID", required: true },
      { name: "region", label: "Region" },
    ],
  }, saved: undefined, values: {}, saving: false, error: null, verifying: false,
  verification: undefined, verifyError: null, selectingCredentialId: null, selectError: null,
};
const saved: NonNullable<PublishCredentialRowState["saved"]> = {
  id: "one", credentialType: "vendor", worksFor: [], providerId: "museum", label: "Main token",
  configured: true, isDefault: true, accountLabel: "Collections Team",
  updatedAt: "2026-11-06T00:00:00.000Z", createdAt: "2026-11-01T00:00:00.000Z",
};
const other = { ...saved, id: "two", label: "Backup token", accountLabel: null, isDefault: false };
function controller(over: Partial<PublishCredentialsController> = {}): PublishCredentialsController {
  return {
    rows: [], executionMode: "hosted-api-only", loadError: null, credentialChangePending: false,
    setField: () => {}, save: async () => {}, credentialsForProvider: () => [],
    selectCredential: async () => {}, verify: async () => {}, t, ...over,
  };
}

it("keeps the unsaved token blank and requires both fields before submitting the correct provider", () => {
  const save = vi.fn(async (_providerId: string) => {});
  const edits: Parameters<PublishCredentialsController["setField"]>[0][] = [];
  function Form() {
    const [values, setValues] = useState<Readonly<Record<string, string>>>({});
    return <CredentialStepTodo kit={kit} deps={deps} t={t} executionMode="hosted-api-only" row={{ ...row, values }}
      controller={controller({ save, setField: change => { edits.push(change); setValues(prev => ({ ...prev, [change.fieldName]: change.value })); } })} />;
  }
  render(<Form />);
  expect(screen.getByRole("heading", { name: "Connect Museum" }).textContent).toBe("Connect Museum");
  expect(screen.getByText("This workspace can't use your computer's terminal — connecting here is the only way to publish.").textContent).toContain("only way to publish");
  const token = screen.getByLabelText("API token") as HTMLInputElement;
  const account = screen.getByRole("textbox", { name: "Account ID" }) as HTMLInputElement;
  const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
  expect([token.type, token.value, token.autocomplete, token.hasAttribute("placeholder")]).toEqual(["password", "", "new-password", false]);
  expect(screen.getByRole("textbox", { name: "Region (optional)" }).getAttribute("type")).toBe("text");
  const link = screen.getByRole("link", { name: "Create a token" });
  expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual(["https://account.example/tokens", "_blank", "noreferrer"]);
  expect(button.disabled).toBe(true);
  fireEvent.change(token, { target: { value: "fixture-value" } });
  expect(button.disabled).toBe(true);
  fireEvent.change(account, { target: { value: "collection-42" } });
  expect(button.disabled).toBe(false);
  act(() => button.click());
  expect(edits).toEqual([
    { providerId: "museum", fieldName: "token", value: "fixture-value" },
    { providerId: "museum", fieldName: "accountId", value: "collection-42" },
  ]);
  expect(save.mock.calls).toEqual([["museum"]]);
});

it("shows pending save and the server refusal without resubmitting", () => {
  const save = vi.fn(async () => {});
  render(<CredentialStepTodo kit={kit} deps={deps} t={t} executionMode="hosted-api-only"
    row={{ ...row, saving: true, error: "The provider refused this token.", values: { token: "fixture", accountId: "collection-42" } }} controller={controller({ save })} />);
  const button = screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe("The provider refused this token.");
  act(() => button.click());
  expect(save).not.toHaveBeenCalled();
});

it("verifies without opening the replacement disclosure and shows the verification outcome inline", () => {
  const verify = vi.fn(async (_providerId: string) => {});
  const props = { kit, deps, t, controller: controller({ verify, credentialsForProvider: () => [saved] }) };
  const { container, rerender } = render(<CredentialStepDone {...props} row={{ ...row, saved }} />);
  const disclosure = container.querySelector("details")!;
  expect(disclosure.open).toBe(false);
  expect(screen.getByText("Collections Team").getAttribute("translate")).toBe("no");
  expect(container.querySelector("select")).toBeNull();
  act(() => screen.getByRole("button", { name: "Verify" }).click());
  expect(disclosure.open).toBe(false);
  expect(verify.mock.calls).toEqual([["museum"]]);

  rerender(<CredentialStepDone {...props} row={{ ...row, saved, verifying: true, verifyError: "Could not reach Museum", verification: {
    status: "valid", message: "Previously valid", checkedAt: "2026-11-06T00:00:00Z",
  } }} />);
  expect((screen.getByRole("button", { name: "Verifying…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Could not reach Museum").getAttribute("aria-live")).toBe("polite");
  expect(screen.queryByText("Previously valid")).toBeNull();
});

it("opens the picker on disclosure and keeps the pending selection distinct from the saved default", () => {
  const selectCredential = vi.fn<PublishCredentialsController["selectCredential"]>(async () => {});
  const props = { kit, deps, t, controller: controller({ selectCredential, credentialsForProvider: provider => {
    if (provider !== "museum") throw new Error(`Unexpected provider ${provider}`);
    return [saved, other];
  } }) };
  const { container, rerender } = render(<CredentialStepDone {...props} row={{ ...row, saved }} />);
  const details = container.querySelector("details")!;
  act(() => details.querySelector("summary")!.click());
  expect(details.open).toBe(true);
  const picker = screen.getByRole("combobox", { name: "Which saved token publishes" }) as HTMLSelectElement;
  expect(picker.value).toBe("one");
  expect(Array.from(picker.options, option => [option.value, option.text.split(" — ")[0]])).toEqual([["one", "Collections Team"], ["two", "Backup token"]]);
  expect(screen.getByText("Leave blank to keep the current token.").textContent).toBe("Leave blank to keep the current token.");
  fireEvent.change(picker, { target: { value: "two" } });
  expect(selectCredential.mock.calls).toEqual([[{ providerId: "museum", credentialId: "two" }]]);

  rerender(<CredentialStepDone {...props} row={{ ...row, saved, selectingCredentialId: "two" }} />);
  expect([picker.value, picker.disabled]).toEqual(["two", true]);
  rerender(<CredentialStepDone {...props} row={{ ...row, saved, selectError: "Could not change the default." }} />);
  expect([picker.value, picker.disabled]).toEqual(["one", false]);
  expect(screen.getByRole("alert").textContent).toBe("Could not change the default.");
});

it("uses the descriptor's token name and help without inventing a token link", () => {
  const { tokenPageUrl: _url, userHelp: _formHelp, ...credential } = row.credential;
  render(<CredentialStepTodo kit={kit} deps={deps} t={t} executionMode="self-hosted-cli"
    row={{ ...row, credential: { ...credential, help: "Connect the collections account." } }} controller={controller()} />);
  expect(screen.getByText("Connect API token").textContent).toBe("Connect API token");
  expect(screen.getByText("Connect the collections account.").textContent).toBe("Connect the collections account.");
  expect(screen.getByText("Read and publish only.").textContent).toBe("Read and publish only.");
  expect(screen.getByText("Stored encrypted").textContent).toBe("Stored encrypted");
  expect(screen.queryByRole("link", { name: "Create a token" })).toBeNull();
});

it("localizes where the provider name appears and reports verification without inventing an account label", () => {
  const translate = (key: string) => key === "{host} connected" ? "Connected to {host} successfully" : key;
  const { container, rerender } = render(<CredentialStepDone kit={kit} deps={deps} t={translate}
    row={{ ...row, saved: other, verification: { status: "valid", message: "Permissions verified", checkedAt: "2026-11-06T00:00:00Z" } }}
    controller={controller()} />);
  const summary = container.querySelector("summary");
  expect(summary?.textContent).toContain("Connected to Museum successfully · token stored, encrypted · saved 2026-11-06 00:00");
  expect(summary?.textContent).not.toContain("connected as");
  expect(screen.getByText("Museum", { selector: "summary span" }).getAttribute("translate")).toBe("no");
  const valid = screen.getByText("Permissions verified");
  expect([valid.getAttribute("aria-live"), valid.className]).toEqual(["polite", "save-ok"]);

  rerender(<CredentialStepDone kit={kit} deps={deps} t={translate}
    row={{ ...row, saved: other, verification: { status: "unreachable", message: "Provider temporarily unreachable", checkedAt: "2026-11-06T00:00:00Z" } }}
    controller={controller()} />);
  expect(screen.getByText("Provider temporarily unreachable").className).toBe("save-warning");
  expect(screen.queryByText("Permissions verified")).toBeNull();
});

it("does not render a connected summary without a saved credential", () => {
  expect(() => render(<CredentialStepDone kit={kit} deps={deps} t={t} row={row} controller={controller()} />))
    .toThrow("publish credential row museum has no saved credential");
});
