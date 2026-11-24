import { describe, expect, it } from "vitest";
import { newsletterResendConfirmationRoute as route } from "../resend-confirmation.js";
import { baseDeps, fakeSubscription, PRINCIPAL, raw, recordingAuthorize, refusalOf, WORKSPACE_ID } from "./helpers.js";

/** @file RESEND_CONFIRMATION: a fresh token for a known subscription's directory contact; always `{ delivered: true }`; unknown id is the host's 404. */

function setup({ stored, contact }: { stored: unknown; contact: { email: string } | null }) {
  const issued: unknown[] = [];
  const contactLookups: unknown[] = [];
  const deps = {
    ...baseDeps(),
    newsletterSubscriptionRepo: { findById: async () => stored as ReturnType<typeof fakeSubscription> | null },
    newsletterSubscriberDirectory: { getContact: async (i: unknown) => { contactLookups.push(i); return contact; } },
    issueConfirmationToken: async (input: unknown) => { issued.push(input); return { tokenId: "t1" }; },
  };
  const run = () => route.handle({ input: { id: "sub-1" }, deps, context: PRINCIPAL, authorize: recordingAuthorize().authorize });
  return { issued, contactLookups, run };
}

describe("newsletterResendConfirmationRoute", () => {
  it("keeps the method, path and default 200 and reads :id as sent", () => {
    expect([route.method, route.path, route.successStatus, route.maxBodyBytes]).toEqual(["post", "/api/admin/v1/workspaces/:workspaceId/newsletter/subscriptions/:id/resend-confirmation", undefined, undefined]);
    expect(route.parse(raw({ id: "sub-1" }))).toEqual({ ok: true, value: { id: "sub-1" } });
    expect(route.parse(raw({}))).toEqual({ ok: true, value: { id: "undefined" } });
  });

  it("issues a confirmation token for the subscription's directory contact and answers delivered", async () => {
    const { issued, contactLookups, run } = setup({ stored: fakeSubscription(), contact: { email: "reader@example.com" } });
    expect(await run()).toEqual({ ok: true, value: { delivered: true } });
    expect(contactLookups).toEqual([{ workspaceId: WORKSPACE_ID, subscriberId: "member-1" }]);
    expect(issued).toEqual([{ workspaceId: WORKSPACE_ID, subscriptionId: "sub-1", recipientEmail: "reader@example.com" }]);
  });

  it("answers delivered with nothing issued when the directory has no contact (anti-enumeration)", async () => {
    const { issued, run } = setup({ stored: fakeSubscription(), contact: null });
    expect(await run()).toEqual({ ok: true, value: { delivered: true } });
    expect(issued).toEqual([]);
  });

  it("refuses an unknown subscription with the host's exact 404 body before any contact lookup", async () => {
    const { issued, contactLookups, run } = setup({ stored: null, contact: { email: "reader@example.com" } });
    expect(await refusalOf(run)).toEqual({ status: 404, body: { error: "subscription sub-1 was not found", code: "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" } });
    expect([issued, contactLookups]).toEqual([[], []]);
  });
});
