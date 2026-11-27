// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { EmailOverviewTab, testResultLine } from "../EmailOverviewTab.js";
import type { EmailApi, MailTestSendResult, MailUseRow } from "../email-api.types.js";
import { useEmailOverview } from "../hooks/use-email-overview.hooks.js";

class ApiError extends Error {
  readonly body?: Record<string, unknown>;
  constructor(readonly status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    if (body !== undefined) this.body = body;
  }
}
const envelope = { to: "operator@example.test", from: "relay@example.test", driver: "fixture", at: "2026-11-24T10:00:00Z" };
const accepted = { ...envelope, outcome: "accepted", providerMessageId: "msg-29" } satisfies MailTestSendResult;
const tests: { result: MailTestSendResult; tone: string; text: string }[] = [
  { result: accepted, tone: "ok", text: "Accepted by the provider for operator@example.test." },
  { result: { ...envelope, outcome: "captured", where: "capture", providerMessageId: "copy-1" }, tone: "neutral", text: "Kept on this machine — nothing was sent." },
  { result: { ...envelope, outcome: "redirected", redirectedTo: "sandbox@example.test", providerMessageId: "redirect-2" }, tone: "neutral", text: "Test mode sent it to sandbox@example.test instead." },
  { result: { ...envelope, outcome: "failed", message: "Try later", errorCode: "RATE_LIMITED", retryable: true }, tone: "error", text: "Not sent. Try later" },
  { result: { ...envelope, outcome: "unknown", message: "No confirmation", errorCode: "NO_RESPONSE", retryable: false }, tone: "error", text: "Not sent. No confirmation" },
];
it.each(tests)("reports $result.outcome as $tone without promising delivery", ({ result, tone, text }) => {
  expect(testResultLine({ result, locale: "en" })).toEqual({ tone, text });
});

type Api = Pick<EmailApi, "readUses" | "sendTest">;
function renderOverview(api: Api, requestId: () => string, part?: "uses" | "test") {
  function View() {
    const controller = useEmailOverview({ api, ApiError, requestId });
    return <EmailOverviewTab controller={controller} locale="en" {...(part === undefined ? {} : { part })} />;
  }
  render(<View />);
}
const report = { checkedAt: envelope.at, uses: [] as MailUseRow[] };

it("reloads Uses after a successful test send and keeps the exact recipient and idempotency key", async () => {
  const user = userEvent.setup();
  let complete!: (answer: Awaited<ReturnType<Api["sendTest"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<Api["sendTest"]>>>(resolve => { complete = resolve; });
  const readUses = vi.fn<Api["readUses"]>()
    .mockResolvedValueOnce(report)
    .mockResolvedValueOnce({ ...report, uses: [
      { use: "sign_in", label: "Override", mailLane: "transactional", state: "ready", reasons: [], sender: envelope.from,
        evidence: { outcome: "accepted", at: envelope.at } },
      { use: "newsletter", label: "Mailing", mailLane: "bulk", state: "blocked", reasons: ["origin_not_verified", "extension_reason"],
        sender: null, evidence: null },
    ] });
  const sendTest = vi.fn<Api["sendTest"]>().mockReturnValueOnce(pending);
  renderOverview({ readUses, sendTest }, () => "click-31");
  expect(await screen.findByText("Nothing on this site sends email yet.")).toBeInTheDocument();
  const test = within(screen.getByRole("region", { name: "Send test email" }));
  await user.type(test.getByRole("textbox", { name: "To" }), "operator@example.test");
  await user.click(test.getByRole("button", { name: "Send test" }));
  expect(test.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(sendTest.mock.calls).toEqual([[{ to: "operator@example.test", requestId: "click-31" }]]);
  expect(readUses).toHaveBeenCalledTimes(1);

  await act(async () => { complete({ sent: true, result: accepted }); });
  expect(test.getByRole("status")).toHaveTextContent("Accepted by the provider for operator@example.test.");
  expect(test.getByRole("button", { name: "Send test" })).toBeEnabled();
  const uses = within(screen.getByRole("region", { name: "What uses email" }));
  const signIn = within((await uses.findByText("Sign-in links")).closest("li")!);
  const newsletter = within(uses.getByText("Newsletter", { exact: true }).closest("li")!);
  expect(signIn.getByText(/Last send: accepted,/)).toBeInTheDocument();
  expect(newsletter.getByText("Blocked")).toBeInTheDocument();
  expect(newsletter.getByText("The site's address isn't verified yet.")).toBeInTheDocument();
  expect(newsletter.getByText("extension_reason")).toBeInTheDocument();
  expect(newsletter.getByText("No sends yet")).toBeInTheDocument();
  expect(readUses).toHaveBeenCalledTimes(2);
});

it("uses the operator address by default and displays the server's structured limit result distinctly from a transport error", async () => {
  const user = userEvent.setup();
  const rateLimit: MailTestSendResult = { ...envelope, outcome: "failed", errorCode: "RATE_LIMITED", message: "Retry after 15 minutes.", retryable: true };
  const readUses = vi.fn<Api["readUses"]>().mockResolvedValue(report);
  const sendTest = vi.fn<Api["sendTest"]>()
    .mockRejectedValueOnce(new ApiError(429, "Rate limited", { result: rateLimit }))
    .mockRejectedValueOnce(new Error("private server exception"))
    .mockRejectedValueOnce(new ApiError(503, "", {}));
  const requestId = vi.fn<() => string>().mockReturnValueOnce("first").mockReturnValueOnce("second").mockReturnValueOnce("third");
  renderOverview({ readUses, sendTest }, requestId, "test");
  expect(screen.queryByRole("region", { name: "What uses email" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Send test email" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send test" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Not sent. Retry after 15 minutes.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Send test" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send test" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  expect(sendTest.mock.calls).toEqual([
    [{ to: undefined, requestId: "first" }], [{ to: undefined, requestId: "second" }], [{ to: undefined, requestId: "third" }],
  ]);
  expect(readUses).toHaveBeenCalledTimes(1);
});

it("shows a retryable Uses read without rendering the test form in the Uses segment", async () => {
  const readUses = vi.fn<Api["readUses"]>().mockRejectedValueOnce(new ApiError(503, "Uses read refused"))
    .mockResolvedValueOnce(report);
  const sendTest = vi.fn<Api["sendTest"]>();
  renderOverview({ readUses, sendTest }, () => "unused", "uses");
  expect(await screen.findByRole("alert")).toHaveTextContent("Uses read refused");
  expect(screen.queryByRole("button", { name: "Send test" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Nothing on this site sends email yet.")).toBeInTheDocument();
  expect(readUses).toHaveBeenCalledTimes(2);
});

it("does not hide the server label for a newly introduced use that has no local translation", async () => {
  const extensionUse = "new_product_notification" as unknown as MailUseRow["use"];
  const readUses = vi.fn<Api["readUses"]>().mockResolvedValue({ ...report, uses: [
    { use: extensionUse, label: "New product notifications", mailLane: "transactional", state: "unknown", reasons: [], sender: null, evidence: null },
  ] });
  const sendTest = vi.fn<Api["sendTest"]>();
  renderOverview({ readUses, sendTest }, () => "unused", "uses");
  const row = within((await screen.findByText("New product notifications")).closest("li")!);
  expect(row.getByText("Unknown")).toHaveClass("status-neutral");
  expect(row.getByText("No sends yet")).toBeInTheDocument();
  expect(row.queryByText("new_product_notification")).not.toBeInTheDocument();
});
