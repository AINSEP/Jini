// @vitest-environment jsdom
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EmailSenderTab, EmailStatusFacts } from "../EmailSenderTab.js";
import type { EmailApi, MailDnsStatus } from "../email-api.types.js";
import { isValidSenderEmail, readSenderRows, useEmailSender } from "../hooks/use-email-sender.hooks.js";

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type SenderApi = Pick<EmailApi, "readSender" | "saveSender" | "readDns" | "verifyDns">;
const baseDns: MailDnsStatus = { state: "no_sender", senderDomain: null, providerId: null, providerVerification: null };
const primary = {
  type: "MX", host: "example.test", name: "MX for sender domain", expected: "mx.new.example.test",
  observed: ["mx.old.example.test", "mx.legacy.example.test"], status: "Mismatch", purpose: "mail", priority: 0,
  note: "Update both old values.",
} as const;
const checked: MailDnsStatus = {
  state: "checked", senderDomain: "example.test", providerId: "provider",
  providerVerification: { state: "unknown", domain: "example.test", providerId: "provider", reason: "Provider did not answer." },
  dns: {
    overall: "Mismatch", reason: "Cached answers can linger.", checkedAt: "2026-11-24T10:00:00Z",
    records: [{ ...primary, observed: [...primary.observed] }, {
      type: "TXT", host: "_dmarc.example.test", name: "DMARC", expected: "v=DMARC1", observed: ["v=DMARC1"], status: "Matches", purpose: "mail",
    }],
  },
};
const verified: MailDnsStatus = {
  ...checked,
  providerVerification: { state: "verified", domain: "example.test", providerId: "provider" },
  dns: { overall: "Matches", records: [], checkedAt: "2026-11-25T10:00:00Z" },
};

function memoryApi() {
  const store = new Map<string, unknown>([["senderName", "Old site"], ["senderEmail", "old@example.test"], ["unrelated", false]]);
  const readSender = vi.fn<SenderApi["readSender"]>(async () => ({ data: [...store].map(([key, value]) => ({ key, value })) }));
  const saveSender = vi.fn<SenderApi["saveSender"]>(async ({ key, value }) => { store.set(key, value); return null; });
  const readDns = vi.fn<SenderApi["readDns"]>(async () => baseDns);
  const verifyDns = vi.fn<SenderApi["verifyDns"]>(async () => verified);
  return { readSender, saveSender, readDns, verifyDns };
}

function show(api: SenderApi, options: { part?: "sender" | "dns"; onChanged?: () => void; warnings?: string[] } = {}) {
  function View() {
    const controller = useEmailSender({ api, ApiError }, options.onChanged ? { onChanged: options.onChanged } : {});
    return <EmailSenderTab controller={controller} locale="en" {...(options.part ? { part: options.part } : {})}
      {...(options.warnings ? { warnings: options.warnings } : {})} />;
  }
  render(<View />);
}

describe("Sender and DNS", () => {
  it("validates a From address locally, then persists the changed name and email and refreshes DNS", async () => {
    const user = userEvent.setup();
    const api = memoryApi();
    const onChanged = vi.fn();
    show(api, { part: "sender", onChanged, warnings: ["sender_unverified", "extension warning"] });
    const sender = within(screen.getByRole("region", { name: "Sender" }));
    const name = await sender.findByRole("textbox", { name: "Name" });
    const email = sender.getByRole("textbox", { name: "From address" });
    expect(name).toHaveValue("Old site");
    expect(email).toHaveValue("old@example.test");
    expect(sender.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(sender.getByText("The provider has not verified the sender's domain.")).toBeInTheDocument();
    expect(sender.getByText("extension warning")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "DNS" })).not.toBeInTheDocument();

    await user.clear(email);
    await user.type(email, "operator@example");
    await user.click(sender.getByRole("button", { name: "Save" }));
    expect(await sender.findByRole("alert")).toHaveTextContent("Enter one email address, like hello@example.com.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(api.saveSender).not.toHaveBeenCalled();

    await user.clear(email);
    await user.type(email, "operator+mail@example.test");
    await user.clear(name);
    await user.type(name, "  New site  ");
    expect(sender.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(sender.getByRole("button", { name: "Save" }));
    expect(await sender.findByRole("status")).toHaveTextContent("Saved");
    expect(api.saveSender.mock.calls).toEqual([
      [{ key: "senderName", value: "New site" }], [{ key: "senderEmail", value: "operator+mail@example.test" }],
    ]);
    const { data } = await api.readSender();
    expect(readSenderRows(data)).toEqual({ name: "New site", email: "operator+mail@example.test" });
    expect(name).toHaveValue("New site");
    expect(sender.getByRole("button", { name: "Save" })).toBeDisabled();
    await waitFor(() => expect(api.readDns).toHaveBeenCalledTimes(2));
    expect(onChanged.mock.calls).toEqual([[]]);
  });

  it("writes only the changed field, keeps edits after a refusal, and retries without writing the untouched setting", async () => {
    const api = memoryApi();
    const denied = new ApiError(409, "Sender settings changed. Retry.");
    api.saveSender.mockRejectedValueOnce(denied);
    const onChanged = vi.fn();
    const { result } = renderHook(() => useEmailSender({ api, ApiError }, { onChanged }));
    await waitFor(() => expect(result.current.draft).toEqual({ name: "Old site", email: "old@example.test" }));
    act(() => result.current.setDraft({ email: "" }));
    await act(async () => { await result.current.save(); });
    expect(result.current).toMatchObject({ draft: { email: "" }, dirty: true, saveState: { error: "Sender settings changed. Retry." } });
    expect(readSenderRows((await api.readSender()).data).email).toBe("old@example.test");
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => { await result.current.save(); });
    expect(api.saveSender.mock.calls).toEqual([[{ key: "senderEmail", value: "" }], [{ key: "senderEmail", value: "" }]]);
    expect(readSenderRows((await api.readSender()).data).email).toBe("");
    expect(result.current).toMatchObject({ dirty: false, saveState: "saved" });
    expect(onChanged.mock.calls).toEqual([[]]);
  });

  it("does not send a settings write before the initial sender read settles", async () => {
    const api = memoryApi();
    let load!: (result: Awaited<ReturnType<SenderApi["readSender"]>>) => void;
    api.readSender.mockReturnValueOnce(new Promise(resolve => { load = resolve; }));
    const { result } = renderHook(() => useEmailSender({ api, ApiError }));
    await act(async () => { await result.current.save(); });
    expect(api.saveSender).not.toHaveBeenCalled();
    await act(async () => { load({ data: [{ key: "senderName", value: 99 }, { key: "unrelated", value: "unrelated" }] }); });
    expect(result.current.sender).toEqual({ kind: "loaded", data: { name: "", email: "" } });
    expect(result.current.dirty).toBe(false);
  });

  it("shows observed mismatches, then recovers from a denied DNS check without losing its prior results", async () => {
    const user = userEvent.setup();
    const api = memoryApi();
    let fail!: (error: Error) => void;
    api.readDns.mockResolvedValue(checked);
    api.verifyDns.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
    show(api, { part: "dns" });
    const dns = within(screen.getByRole("region", { name: "DNS" }));
    const mx = within((await dns.findByText("MX", { exact: true })).closest("li")!);
    expect(mx.getByText("Mismatch")).toHaveClass("status-error");
    expect(mx.getByText("Priority 0")).toBeInTheDocument();
    expect(mx.getByText("mx.old.example.test · mx.legacy.example.test")).toBeInTheDocument();
    expect(mx.getByRole("button", { name: "Copy: MX value" })).toBeInTheDocument();
    expect(mx.getByText("Update both old values.")).toBeInTheDocument();
    const txt = within(dns.getByText("TXT", { exact: true }).closest("li")!);
    expect(txt.getByText("Matches")).toHaveClass("status-ok");
    expect(txt.queryByText("Found")).not.toBeInTheDocument();
    expect(dns.getByText("Provider did not answer.")).toBeInTheDocument();
    expect(dns.getByText("Cached answers can linger.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sender" })).not.toBeInTheDocument();

    await user.click(dns.getByRole("button", { name: "Check again" }));
    expect(dns.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await act(async () => { fail(new ApiError(503, "Resolver unavailable.")); });
    expect(dns.getByRole("alert")).toHaveTextContent("Resolver unavailable.");
    expect(dns.getByText("MX", { exact: true })).toBeInTheDocument();
    await user.click(dns.getByRole("button", { name: "Check again" }));
    expect(await dns.findByText("This provider needs no DNS records.")).toBeInTheDocument();
    expect(dns.getByText("Verified by the provider")).toHaveClass("status-ok");
    expect(dns.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.verifyDns.mock.calls).toEqual([[], []]);
  });

  it.each([
    { state: "no_sender", line: "Set a From address first.", includeMessage: false },
    { state: "requirements_failed", line: "The provider answered with an error.", includeMessage: true },
  ] as const)("describes the unavailable record table for $state", async ({ state, line, includeMessage }) => {
    const api = memoryApi();
    api.readDns.mockResolvedValue({ ...baseDns, state, message: "Server detail." });
    show(api);
    const dns = within(screen.getByRole("region", { name: "DNS" }));
    expect(await dns.findByText(includeMessage ? line + " Server detail." : line)).toBeInTheDocument();
    expect(dns.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sender" })).toBeInTheDocument();
  });

  it("keeps the provider's domain verdict separate from delivery capability and omits an unknown domain", () => {
    const view = render(<EmailStatusFacts status={{ mailDeliveryAvailable: true }} locale="en" />);
    expect(screen.queryByText("Domain")).not.toBeInTheDocument();
    view.rerender(<EmailStatusFacts status={{
      mailDeliveryAvailable: false, senderDomainVerification: { state: "pending", domain: "example.test", providerId: "provider" },
    }} locale="en" />);
    expect(screen.getByText("example.test")).toBeInTheDocument();
    expect(screen.getByText("The provider is still verifying")).toHaveClass("status-warning");
  });
});

it.each([
  { value: "", valid: true }, { value: " ada+ops@example.test ", valid: true }, { value: "unknown", valid: false },
  { value: "@example.test", valid: false }, { value: "a@invalid", valid: false }, { value: "a@domain.", valid: false },
  { value: "a@example.test,b@example.test", valid: false }, { value: "a b@example.test", valid: false },
])("validates the literal From address '$value' as $valid", ({ value, valid }) => {
  expect(isValidSenderEmail({ value })).toBe(valid);
});

it("shows a neutral label for a DNS status introduced by a newer server without treating it as a mismatch", async () => {
  const api = memoryApi();
  // The authenticated transport's type is an assertion about JSON, not a runtime enum validator.
  const futureStatus = "CheckingDelegation" as unknown as NonNullable<MailDnsStatus["dns"]>["records"][number]["status"];
  api.readDns.mockResolvedValue({
    ...checked, providerVerification: null,
    dns: { overall: "Unknown", checkedAt: "2026-11-25T10:00:00Z", records: [
      { ...primary, observed: [...primary.observed], status: futureStatus },
    ] },
  });
  show(api, { part: "dns" });
  expect(await screen.findByText("CheckingDelegation")).toHaveClass("status-neutral");
  expect(screen.queryByText("Found")).not.toBeInTheDocument();
  expect(screen.queryByText("Provider did not answer.")).not.toBeInTheDocument();
});
