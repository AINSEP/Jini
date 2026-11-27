// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { renderWithAdminKit } from "../../../react/__tests__/render-with-admin-kit.js";
import { EmailActivityTab } from "../EmailActivityTab.js";
import type { EmailApi, MailActivityItem, MailActivityPage, MailSuppressionEntry } from "../email-api.types.js";
import { useLoad } from "../hooks/email-load.hooks.js";
import { useCaptureClearFlow, useEmailActivity } from "../hooks/use-email-activity.hooks.js";

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Api = Parameters<typeof useEmailActivity>[0]["api"];
const stamp = "2026-11-24T10:00:00Z";
const failed: MailActivityItem = {
  id: "send-9", recipient: "relay@example.test", use: "test", outcome: "bounced", lane: "transactional",
  providerId: "fixture-provider", originalRecipient: "original@example.test", providerMessageId: "provider-message-8",
  errorCode: "RECIPIENT_REFUSED", message: "Address rejected", createdAt: stamp, updatedAt: stamp,
};
const newer: MailActivityItem = {
  ...failed, id: "send-10", recipient: "member@example.test", outcome: "future-outcome", use: "extension_use",
  providerId: "second-provider", errorCode: null,
};
const blocked: MailSuppressionEntry = {
  address: "blocked@example.test", scope: "bulk", reason: "bounced", revision: "row-version-3", createdAt: stamp,
};
const manual: MailSuppressionEntry = {
  ...blocked, address: "manual@example.test", scope: "all", reason: "manual", revision: "row-version-6",
};
function activity(items: MailActivityItem[] = [], nextCursor: string | null = null): MailActivityPage {
  return { access: "full", items, nextCursor, empty: items.length ? null : "none_recorded" };
}
function setup(options: Partial<Api> = {}, part?: "sends" | "blocked" | "reports") {
  const api: Api = {
    listActivity: async () => activity(),
    getActivity: async ({ id }) => { throw new Error(`Unexpected activity details: ${id}`); },
    listSuppressions: async () => ({ items: [], nextCursor: null, empty: "none_recorded" }),
    removeSuppression: async input => { throw new Error(`Unexpected removal: ${input.address}`); },
    readFeedback: async () => ({ available: false, providers: [] }),
    ...options,
  };
  function View() {
    const controller = useEmailActivity({ api, ApiError, useLoadHook: useLoad, useCaptureClearFlowHook: useCaptureClearFlow }, { debounceMs: 0 });
    return <EmailActivityTab controller={controller} locale="en" {...(part ? { part } : {})} />;
  }
  return renderWithAdminKit(<View />);
}

const rowFor = (recipient: string) => within(screen.getByText(recipient, { exact: true }).closest("li")!);

it("keeps prior sends visible on a failed page and appends the retried cursor result exactly once", async () => {
  const user = userEvent.setup();
  let reject!: (error: Error) => void;
  const pending = new Promise<MailActivityPage>((_resolve, fail) => { reject = fail; });
  const listActivity = vi.fn<EmailApi["listActivity"]>()
    .mockResolvedValueOnce(activity([failed], "next-7"))
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce(activity([newer]));
  setup({ listActivity }, "sends");
  const section = within(screen.getByRole("region", { name: "Recent sends" }));
  expect(await section.findByText("relay@example.test")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Blocked addresses" })).not.toBeInTheDocument();
  await user.click(section.getByRole("button", { name: "Load more" }));
  expect(section.getByRole("button", { name: "Loading…" })).toBeDisabled();
  await act(async () => { reject(new ApiError(503, "Next page unavailable")); });
  expect(section.getByText("Next page unavailable")).toBeInTheDocument();
  expect(section.getByText("relay@example.test")).toBeInTheDocument();

  await user.click(section.getByRole("button", { name: "Load more" }));
  expect(await section.findByText("member@example.test")).toBeInTheDocument();
  expect(rowFor("member@example.test").getByText("future-outcome")).toHaveClass("status-neutral");
  expect(rowFor("member@example.test").getByText(/extension_use/)).toBeInTheDocument();
  expect(section.getAllByText("relay@example.test")).toHaveLength(1);
  expect(section.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  expect(section.queryByText("Next page unavailable")).not.toBeInTheDocument();
  expect(listActivity.mock.calls).toEqual([
    [{ filter: { outcome: undefined, recipient: undefined } }],
    [{ filter: { outcome: undefined, recipient: undefined }, cursor: "next-7" }],
    [{ filter: { outcome: undefined, recipient: undefined }, cursor: "next-7" }],
  ]);
});

it("opens only the chosen recipient’s details and ignores a superseded response", async () => {
  const user = userEvent.setup();
  let resolveSecond!: (data: Awaited<ReturnType<EmailApi["getActivity"]>>) => void;
  let resolveFirst!: (data: Awaited<ReturnType<EmailApi["getActivity"]>>) => void;
  const first = new Promise<Awaited<ReturnType<EmailApi["getActivity"]>>>(resolve => { resolveFirst = resolve; });
  const second = new Promise<Awaited<ReturnType<EmailApi["getActivity"]>>>(resolve => { resolveSecond = resolve; });
  const getActivity = vi.fn<EmailApi["getActivity"]>(async ({ id }) => {
    if (id === "send-9") return first;
    if (id === "send-10") return second;
    throw new ApiError(404, "Unknown send");
  });
  setup({ getActivity, listActivity: async () => activity([newer, failed]) });
  await screen.findByText("relay@example.test");
  const firstRow = rowFor("relay@example.test");
  const secondRow = rowFor("member@example.test");
  await user.click(secondRow.getByRole("button", { name: "Details" }));
  expect(secondRow.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
  await user.click(firstRow.getByRole("button", { name: "Details" }));
  expect(secondRow.getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "false");
  await act(async () => { resolveFirst({ activity: failed, feedback: [
    { kind: "bounced", occurredAt: stamp, receivedAt: stamp },
    { kind: "unknown_event", occurredAt: stamp, receivedAt: stamp },
  ] }); });
  expect(firstRow.getByText("original@example.test")).toBeInTheDocument();
  expect(firstRow.getByText("provider-message-8")).toBeInTheDocument();
  expect(firstRow.getByText("RECIPIENT_REFUSED")).toBeInTheDocument();
  expect(firstRow.getByText("Address rejected")).toBeInTheDocument();
  expect(firstRow.getByText(/unknown_event ·/)).toBeInTheDocument();
  await act(async () => { resolveSecond({ activity: newer, feedback: [] }); });
  expect(firstRow.getByText("fixture-provider")).toBeInTheDocument();
  expect(firstRow.queryByText("second-provider")).not.toBeInTheDocument();
  expect(getActivity.mock.calls).toEqual([[{ id: "send-10" }], [{ id: "send-9" }]]);
  await user.click(firstRow.getByRole("button", { name: "Hide details" }));
  expect(firstRow.queryByText("fixture-provider")).not.toBeInTheDocument();
});

it("shows masked rows without detail access and sends the settled recipient/outcome filters", async () => {
  const user = userEvent.setup();
  const { id: _id, ...withoutId } = failed;
  const listActivity = vi.fn<EmailApi["listActivity"]>(async ({ filter }) => filter.outcome || filter.recipient
    ? { ...activity(), empty: "no_matches" }
    : { ...activity([{ ...withoutId, recipient: "m***@example.test" }]), access: "masked" });
  setup({ listActivity }, "sends");
  expect(await screen.findByText("Addresses are partly hidden for your role.")).toBeInTheDocument();
  expect(rowFor("m***@example.test").queryByRole("button", { name: "Details" })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByRole("combobox", { name: "Outcome" }), "bounced");
  await user.type(screen.getByRole("searchbox", { name: "Recipient" }), "  qa@example.test ");
  await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith({ filter: { outcome: "bounced", recipient: "qa@example.test" } }));
  expect(await screen.findByText("No sends match.")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Outcome" }), "");
  await waitFor(() => expect(listActivity).toHaveBeenLastCalledWith({ filter: { outcome: undefined, recipient: "qa@example.test" } }));
});

it("never replaces a newly filtered first page with an old page that was already in flight", async () => {
  const user = userEvent.setup();
  let resolveOld!: (page: MailActivityPage) => void;
  const oldPage = new Promise<MailActivityPage>(resolve => { resolveOld = resolve; });
  const filtered = { ...newer, id: "filtered-1", recipient: "filtered@example.test", outcome: "failed" };
  const listActivity = vi.fn<EmailApi["listActivity"]>(async ({ filter, cursor }) => {
    if (cursor === "next-7" && !filter.outcome) return oldPage;
    if (filter.outcome === "failed" && !cursor) return activity([filtered]);
    if (!filter.outcome && !cursor) return activity([failed], "next-7");
    throw new ApiError(400, "Unexpected cursor/filter pair");
  });
  setup({ listActivity }, "sends");
  await screen.findByText("relay@example.test");
  await user.click(screen.getByRole("button", { name: "Load more" }));
  expect(listActivity).toHaveBeenLastCalledWith({ filter: { outcome: undefined, recipient: undefined }, cursor: "next-7" });
  await user.selectOptions(screen.getByRole("combobox", { name: "Outcome" }), "failed");
  await screen.findByText("filtered@example.test");

  await act(async () => { resolveOld(activity([newer])); });
  expect(screen.getByText("filtered@example.test")).toBeInTheDocument();
  expect(screen.queryByText("member@example.test")).not.toBeInTheDocument();
  expect(screen.queryByText("relay@example.test")).not.toBeInTheDocument();
});

it("requires a reason and a matching plan revision, then reloads the blocked addresses", async () => {
  const user = userEvent.setup();
  let active = [manual, blocked];
  const listSuppressions = vi.fn<EmailApi["listSuppressions"]>(async ({ search }) => ({
    items: search ? active.filter(row => row.address.includes(search)) : [...active],
    nextCursor: null, empty: search ? "no_matches" : null,
  }));
  const removeSuppression = vi.fn<EmailApi["removeSuppression"]>(async (input, options) => {
    if (input.address !== "blocked@example.test" || input.scope !== "bulk" || input.reason !== "Reviewed the bounce") throw new ApiError(400, "Invalid selection");
    if (!options) return { removed: false, confirmationRequired: true, plan: {
      ...input, suppressionReason: "bounced", suppressedAt: stamp, revision: "plan-4", warnings: ["Mail can resume immediately."],
    } };
    if (options.confirm?.revision !== "plan-4") throw new ApiError(409, "Wrong revision");
    active = active.filter(row => row.address !== input.address);
    return { removed: true };
  });
  setup({ listSuppressions, removeSuppression }, "blocked");
  await screen.findByText("blocked@example.test");
  expect(rowFor("manual@example.test").getByText("Added by hand")).toHaveClass("status-neutral");
  const row = rowFor("blocked@example.test");
  expect(row.getByText(/Newsletters only/)).toBeInTheDocument();
  expect(row.getByText("Bounced")).toHaveClass("status-warning");
  await user.click(row.getByRole("button", { name: "Unblock" }));
  const reason = within(screen.getByRole("dialog", { name: "Unblock an address" }));
  await user.click(reason.getByRole("button", { name: "Continue" }));
  expect(reason.getByRole("alert")).toHaveTextContent("Say why this address may get email again.");
  expect(removeSuppression).not.toHaveBeenCalled();
  await user.type(reason.getByRole("textbox", { name: "Reason (kept in the record)" }), " Reviewed the bounce ");
  await user.click(reason.getByRole("button", { name: "Continue" }));
  const confirm = within(await screen.findByRole("dialog", { name: "Unblock this address?" }));
  expect(confirm.getByText("Reason: Reviewed the bounce")).toBeInTheDocument();
  expect(confirm.getByText("Mail can resume immediately.")).toBeInTheDocument();
  expect(confirm.getByText(/Blocked since .* \(Bounced\)/)).toBeInTheDocument();
  expect(removeSuppression).toHaveBeenCalledTimes(1);
  await user.click(confirm.getByRole("button", { name: "Unblock" }));
  expect(await screen.findByRole("status")).toHaveTextContent("blocked@example.test can get email again.");
  await waitFor(() => expect(screen.queryByText("blocked@example.test", { exact: true })).not.toBeInTheDocument());
  expect(screen.getByText("manual@example.test")).toBeInTheDocument();
  expect(removeSuppression.mock.calls).toEqual([
    [{ address: "blocked@example.test", scope: "bulk", reason: "Reviewed the bounce" }],
    [{ address: "blocked@example.test", scope: "bulk", reason: "Reviewed the bounce" }, { confirm: { revision: "plan-4" } }],
  ]);
  await user.type(screen.getByRole("searchbox", { name: "Search blocked addresses" }), "  no-matches ");
  await waitFor(() => expect(listSuppressions).toHaveBeenLastCalledWith({ search: "no-matches" }));
  expect(await screen.findByText("No blocked addresses match.")).toBeInTheDocument();
});

it("keeps owner-only refusal in the unblock dialog and does not remove or claim success", async () => {
  const user = userEvent.setup();
  const removeSuppression = vi.fn<EmailApi["removeSuppression"]>(async () => { throw new ApiError(403, "Server forbidden"); });
  setup({ listSuppressions: async () => ({ items: [blocked], nextCursor: null, empty: null }), removeSuppression }, "blocked");
  await screen.findByText("blocked@example.test");
  await user.click(rowFor("blocked@example.test").getByRole("button", { name: "Unblock" }));
  const dialog = within(screen.getByRole("dialog", { name: "Unblock an address" }));
  await user.type(dialog.getByRole("textbox", { name: "Reason (kept in the record)" }), "Verified bounce");
  await user.click(dialog.getByRole("button", { name: "Continue" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("Only the site owner can remove a block.");
  await user.click(dialog.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("blocked@example.test", { exact: true })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(removeSuppression.mock.calls).toEqual([[{ address: "blocked@example.test", scope: "bulk", reason: "Verified bounce" }]]);
});

it("describes active feedback webhooks, origin prerequisites and unsupported providers separately", async () => {
  setup({ readFeedback: async () => ({ available: true, providers: [
    { providerId: "one", label: "Relay", lanes: ["transactional"], supported: true, webhookUrl: "https://site.example.test/hooks/mail/one",
      webhookPath: "/hooks/mail/one", signingSecret: null, state: "receiving", lastVerifiedEvent: { kind: "delivered", receivedAt: stamp } },
    { providerId: "two", label: "Bulk", lanes: ["bulk"], supported: true, webhookUrl: null,
      webhookPath: "/hooks/mail/two", signingSecret: null, state: "secret_missing", lastVerifiedEvent: null },
    { providerId: "local", label: "Local", lanes: ["transactional"], supported: false, webhookUrl: null,
      webhookPath: "/hooks/mail/local", signingSecret: null, state: "unsupported", lastVerifiedEvent: null },
  ] }) }, "reports");
  const reports = within(screen.getByRole("region", { name: "Bounce and spam reports" }));
  const relay = within((await reports.findByText("Relay")).closest("li")!);
  const bulk = within(reports.getByText("Bulk").closest("li")!);
  const local = within(reports.getByText("Local").closest("li")!);
  expect(relay.getByText("Receiving")).toHaveClass("status-ok");
  expect(relay.getByText("https://site.example.test/hooks/mail/one")).toBeInTheDocument();
  expect(relay.getByRole("button", { name: "Copy: Relay webhook URL" })).toBeInTheDocument();
  expect(relay.getByText(/Last report: .*2026/)).toBeInTheDocument();
  expect(bulk.getByText("Verify the site's address first; the webhook URL needs it.")).toBeInTheDocument();
  expect(local.getByText("Not supported by this provider")).toBeInTheDocument();
  expect(local.queryByText(/Verify the site's address first/)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Recent sends" })).not.toBeInTheDocument();
});

it("shows an empty detail as no feedback and a permission refusal as a distinct state", async () => {
  const user = userEvent.setup();
  const getActivity = vi.fn<EmailApi["getActivity"]>(async ({ id }) => {
    if (id === "send-10") throw new ApiError(403, "Provider details are restricted");
    const minimal = { ...failed, errorCode: null };
    delete minimal.originalRecipient;
    delete minimal.providerMessageId;
    return { activity: minimal, feedback: [] };
  });
  setup({ getActivity, listActivity: async () => activity([failed, newer]) }, "sends");
  await screen.findByText("relay@example.test");
  const first = rowFor("relay@example.test");
  await user.click(first.getByRole("button", { name: "Details" }));
  expect(await first.findByText("None received yet")).toBeInTheDocument();
  expect(first.queryByText("Meant for")).not.toBeInTheDocument();
  expect(first.queryByText("Message ID")).not.toBeInTheDocument();
  expect(first.queryByText("Error", { exact: true })).not.toBeInTheDocument();
  const second = rowFor("member@example.test");
  await user.click(second.getByRole("button", { name: "Details" }));
  expect(await second.findByText("You don't have permission to see this.")).toBeInTheDocument();
  expect(second.queryByText("None received yet")).not.toBeInTheDocument();
  expect(getActivity.mock.calls).toEqual([[{ id: "send-9" }], [{ id: "send-10" }]]);
});
