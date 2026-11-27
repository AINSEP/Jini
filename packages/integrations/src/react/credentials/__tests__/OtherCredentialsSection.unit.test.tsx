// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AGENT_ELEMENT_ATTRIBUTE, AGENT_LABEL_ATTRIBUTE } from "@jini-ai/core/agent-handles";
import { formatTimestamp } from "@jini-ai/core/text";
import { OtherCredentialEntry } from "../OtherCredentialsSection.js";
import { rowHandleBase, useOtherCredentialRemoveDialog, type OtherCredentialRowState } from "../OtherCredentialsSection.hooks.js";
import type { OtherCredentialStoreInfo } from "../other-credential-stores.js";

// jsdom 26 ships HTMLDialogElement without showModal/close; give the test DOM the two native calls.
const dialogProto = HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(dialogProto, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(dialogProto, "close");
beforeAll(() => {
  Object.defineProperty(dialogProto, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(dialogProto, "close", { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterAll(() => {
  if (originalShowModal) Object.defineProperty(dialogProto, "showModal", originalShowModal); else Reflect.deleteProperty(dialogProto, "showModal");
  if (originalClose) Object.defineProperty(dialogProto, "close", originalClose); else Reflect.deleteProperty(dialogProto, "close");
});
afterEach(cleanup);

function store(id: OtherCredentialStoreInfo["id"], supportsReplace: boolean, _optional = {}): OtherCredentialStoreInfo {
  return { id, label: `${id} label`, category: "general", purposeLabel: "Ops", supportsReplace, screenLabel: `${id} screen`, screenPath: `/${id}` };
}

function row(s: OtherCredentialStoreInfo, _optional: Partial<OtherCredentialRowState> = {}): OtherCredentialRowState {
  return { key: `${s.id}:item-a`, store: s, itemId: "item-a", name: "Item A", valueFact: "••••abcd", updatedAt: null, token: "", saving: false, error: null, ..._optional };
}

const deps: Parameters<typeof OtherCredentialEntry>[0]["deps"] = {
  useAdminLocaleHook: () => "pt",
  useOtherCredentialRemoveDialogHook: useOtherCredentialRemoveDialog,
  removeDialogTitle: ({ locale, name }) => `${locale}: remove ${name}?`,
  otherCredentialRemoveDialogBody: ({ locale, store: s }) => `${locale}: body for ${s.id}`,
  VIEWER_TIME_ZONE: "UTC",
  REMOVE_FROM_HOST: "Remove from the host",
  removeHandleLabel: ({ name }) => `Remove ${name}`,
};

function controller(_optional = {}) {
  return { t: (key: string) => `T(${key})`, remove: vi.fn(async (_row: OtherCredentialRowState) => {}) };
}

describe("OtherCredentialEntry", () => {
  it("a not-configured store shows its own label, a placeholder and a deep link only", () => {
    const s = store("media-provider", true);
    const { container } = render(<OtherCredentialEntry store={s} row={undefined} controller={controller()} deps={deps} />);
    const region = container.querySelector("section")!;
    expect(region.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("security-other-credentials-media-provider-none");
    expect(region.getAttribute(AGENT_LABEL_ATTRIBUTE)).toBe("T(media-provider label) — Ops, not configured");
    expect(screen.getByRole("heading").textContent).toBe("T(media-provider label) · T(Ops)");
    expect(screen.getByText("T(Not configured)")).not.toBeNull();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/admin/media-provider");
    expect(link.textContent).toBe("T(Manage on) T(media-provider screen) ↗");
    expect(link.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("security-other-credentials-manage-media-provider");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a static row shows its fact and saved time, and Remove asks before calling the controller", async () => {
    const s = store("external-mcp", false);
    const r = row(s, { updatedAt: "2026-02-03T04:05:00Z", error: "remove failed" });
    const c = controller();
    const { container } = render(<OtherCredentialEntry store={s} row={r} controller={c} deps={deps} />);
    expect(container.querySelector("section")!.getAttribute(AGENT_LABEL_ATTRIBUTE)).toBe("Item A — Ops, configured");
    expect(container.querySelector(".access-tokens-row-fact")?.textContent).toBe("••••abcd");
    expect(container.querySelector(".access-tokens-row-summary-meta")?.textContent)
      .toBe(`T(saved) ${formatTimestamp({ iso: "2026-02-03T04:05:00Z" }, { viewerTimeZone: "UTC" })}`);
    expect(container.querySelector("input")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("remove failed");
    const dialog = container.querySelector("dialog")!;
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.querySelector("h2")?.textContent).toBe("pt: remove Item A?");
    expect(dialog.querySelector(".confirm-dialog-body")?.textContent).toBe("pt: body for external-mcp");
    const remove = screen.getByRole("button", { name: "T(Remove from the host) — Item A" });
    expect(remove.getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("security-other-credentials-remove-external-mcp-item-a");
    expect(remove.getAttribute(AGENT_LABEL_ATTRIBUTE)).toBe("Remove Item A");
    fireEvent.click(remove);
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "T(Cancel)" }));
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(c.remove).toHaveBeenCalledTimes(0);
    fireEvent.click(remove);
    const confirm = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "T(Remove from the host)")!;
    expect(confirm.hasAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe(false);
    fireEvent.click(confirm);
    expect(dialog.hasAttribute("open")).toBe(false);
    await waitFor(() => expect(c.remove).toHaveBeenCalledExactlyOnceWith(r));
  });

  it("a replaceable row shows the masked value in a disabled text field without a saved line or error", () => {
    const s = store("admin-byok", true);
    const { container } = render(<OtherCredentialEntry store={s} row={row(s)} controller={controller()} deps={deps} />);
    const input = screen.getByLabelText("T(Access token)");
    expect(input.getAttribute("id")).toBe("security-other-credential-admin-byok-item-a");
    expect(input.getAttribute("type")).toBe("text");
    expect((input as HTMLInputElement).value).toBe("••••abcd");
    expect(input.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector(".access-tokens-row-summary-meta")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link").getAttribute(AGENT_ELEMENT_ATTRIBUTE)).toBe("security-other-credentials-manage-admin-byok-item-a");
    expect(container.querySelector("dialog")?.getAttribute("aria-labelledby")).toBe("security-other-credentials-remove-title-admin-byok-item-a");
  });

  it("a static row never saved shows only its fact, without a saved line or error", () => {
    const s = store("external-mcp", false);
    const { container } = render(<OtherCredentialEntry store={s} row={row(s)} controller={controller()} deps={deps} />);
    expect(container.querySelector(".access-tokens-row-static .access-tokens-row-summary")?.textContent).toBe("••••abcd");
    expect(container.querySelector(".access-tokens-row-summary-meta")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a replaceable row with a saved time shows it inside the field label", () => {
    const s = store("site-assistant", true);
    const { container } = render(<OtherCredentialEntry store={s} row={row(s, { updatedAt: "2026-02-03T04:05:00Z" })} controller={controller()} deps={deps} />);
    expect(container.querySelector("label .access-tokens-field-label-meta")?.textContent)
      .toBe(`T(saved) ${formatTimestamp({ iso: "2026-02-03T04:05:00Z" }, { viewerTimeZone: "UTC" })}`);
  });
});

describe("OtherCredentialsSection hooks", () => {
  it("rowHandleBase keeps a safe item id and hashes an unsafe one into a handle segment", () => {
    const s = store("external-mcp", false);
    expect(rowHandleBase({ row: row(s) })).toBe("external-mcp-item-a");
    const hashed = rowHandleBase({ row: row(s, { itemId: "My Server/1" }) });
    expect(hashed.startsWith("external-mcp-")).toBe(true);
    expect(hashed).not.toContain("/");
    expect(hashed).not.toBe(rowHandleBase({ row: row(s, { itemId: "My Server/2" }) }));
  });

  it("confirm closes the dialog then removes the row; close alone never removes; a missing dialog is tolerated", () => {
    const ref = createRef<HTMLDialogElement>();
    const r = row(store("admin-byok", true));
    const remove = vi.fn(async (_row: OtherCredentialRowState) => {});
    const { close, confirm } = useOtherCredentialRemoveDialog({ ref, row: r, controller: { remove } });
    close();
    confirm();
    expect(remove).toHaveBeenCalledExactlyOnceWith(r);
  });
});
