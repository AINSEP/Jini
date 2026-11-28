/**
 * @file Fault injection for the resend acknowledgement's log path: the Core log describer is
 * replaced (only here) by one that throws, to prove a diagnostics failure can neither break the
 * constant acknowledgement nor leak the raw error into the log.
 */
import { afterEach, expect, it, vi } from "vitest";
import { resendPendingSubscriptionConfirmation } from "../tool-registrations.write.js";
import { newsletterHarness, subscriptionRow } from "./tool-registrations.harness.js";

const describer = vi.hoisted(() => ({ fail: false, calls: [] as unknown[] }));
vi.mock("@jini-ai/core/model-facing-tool-errors", async (importOriginal) => {
  const real = await importOriginal<typeof import("@jini-ai/core/model-facing-tool-errors")>();
  return { ...real, describeErrorForLog: (required: { err: unknown }) => {
    describer.calls.push(required.err);
    if (describer.fail) throw new Error("describer broke");
    return real.describeErrorForLog(required);
  } };
});

afterEach(() => { vi.restoreAllMocks(); describer.fail = false; describer.calls = []; });

function failingResend() {
  const { deps } = newsletterHarness({ subscriptions: [subscriptionRow("s1", { status: "pending" })] });
  deps.newsletterSubscriberDirectory = { getContact: async ({ subscriberId }) => ({ subscriberId, workspaceId: "ws-1", email: "person-s1@example.test", emailDeliverable: true }), getContacts: async () => [] };
  const failure = new Error("smtp refused person-s1@example.test");
  deps.buildConfirmationDeps = () => { throw failure; };
  return { deps, failure };
}

it("a describer that throws still acknowledges and logs only the fixed placeholder", async () => {
  const { deps, failure } = failingResend();
  describer.fail = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect(await resendPendingSubscriptionConfirmation({ deps, subscriptionId: "s1", signal: new AbortController().signal })).toEqual({ delivered: true, mailDeliveryAvailable: true });
  expect(describer.calls).toEqual([failure]);
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith("[newsletter] confirmation request could not be processed; inspect mail configuration", "[diagnostic unavailable]");
});

it("a working describer's text replaces the placeholder", async () => {
  const { deps, failure } = failingResend();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await resendPendingSubscriptionConfirmation({ deps, subscriptionId: "s1", signal: new AbortController().signal });
  expect(describer.calls).toEqual([failure]);
  const logged = log.mock.calls[0]?.[1];
  expect(typeof logged).toBe("string");
  expect(logged).not.toBe("[diagnostic unavailable]");
  expect(logged).not.toContain("person-s1@example.test");
});
