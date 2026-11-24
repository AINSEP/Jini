import { describe, expect, it } from "vitest";

import { newsletterArchiveListRoute } from "../archive-list.js";
import { newsletterCancelCampaignRoute } from "../cancel-campaign.js";
import { newsletterCreateCampaignRoute } from "../create-campaign.js";
import { newsletterCreateListRoute } from "../create-list.js";
import { newsletterCreateSubscriptionRoute } from "../create-subscription.js";
import { newsletterGetCampaignRoute } from "../get-campaign.js";
import { newsletterImportSubscriptionsRoute } from "../import-subscriptions.js";
import { newsletterListCampaignsRoute } from "../list-campaigns.js";
import { newsletterListListsRoute } from "../list-lists.js";
import { newsletterListSendLogRoute } from "../list-send-log.js";
import { newsletterListSubscriptionsRoute } from "../list-subscriptions.js";
import { newsletterPauseCampaignRoute } from "../pause-campaign.js";
import { newsletterRemoveSubscriptionRoute } from "../remove-subscription.js";
import { newsletterResendConfirmationRoute } from "../resend-confirmation.js";
import { newsletterResumeCampaignRoute } from "../resume-campaign.js";
import { newsletterScheduleCampaignRoute } from "../schedule-campaign.js";
import { newsletterSendCampaignRoute } from "../send-campaign.js";
import { newsletterSendTestCampaignRoute } from "../send-test-campaign.js";
import { newsletterUpdateCampaignRoute } from "../update-campaign.js";
import { toDataResponse } from "../../../http/newsletter.js";
import { allDeps, fakeCampaign, MappedTestError, PRINCIPAL, recordingAuthorize, refusalOf } from "./helpers.js";

/** @file The rules every newsletter route shares: one permission on its own entity type (never an entity id,
 *  as the hand-written guard sent none), permission before boot readiness, the injected host error mapper,
 *  unmapped errors rethrown for the host 500, and failing closed without an authorizer. */

type AnyRoute = { handle: (args: never, o?: never) => unknown };
const ROUTES: ReadonlyArray<{ name: string; route: AnyRoute; input: unknown; permission: string; entityType: string }> = [
  { name: "list", route: newsletterListCampaignsRoute, input: { query: {} }, permission: "admin.newsletter.read", entityType: "newsletter_campaign" },
  { name: "get", route: newsletterGetCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.read", entityType: "newsletter_campaign" },
  { name: "create", route: newsletterCreateCampaignRoute, input: { fields: { ...fakeCampaign(), listId: "list-1" } }, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" },
  { name: "update", route: newsletterUpdateCampaignRoute, input: { id: "camp-1", body: {} }, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" },
  { name: "cancel", route: newsletterCancelCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.compose", entityType: "newsletter_campaign" },
  { name: "schedule", route: newsletterScheduleCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.schedule", entityType: "newsletter_campaign" },
  { name: "send", route: newsletterSendCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" },
  { name: "send-test", route: newsletterSendTestCampaignRoute, input: { id: "camp-1", testAddresses: ["a@b.test"] }, permission: "admin.newsletter.campaign.send_test", entityType: "newsletter_campaign" },
  { name: "pause", route: newsletterPauseCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" },
  { name: "resume", route: newsletterResumeCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send", entityType: "newsletter_campaign" },
  { name: "send-log", route: newsletterListSendLogRoute, input: { id: "camp-1", query: {} }, permission: "admin.newsletter.subscriber.read", entityType: "newsletter_campaign" },
  { name: "list-lists", route: newsletterListListsRoute, input: {}, permission: "admin.newsletter.read", entityType: "newsletter_list" },
  { name: "create-list", route: newsletterCreateListRoute, input: { name: "Digest", slug: "digest" }, permission: "admin.newsletter.list.manage", entityType: "newsletter_list" },
  { name: "archive-list", route: newsletterArchiveListRoute, input: { id: "list-1" }, permission: "admin.newsletter.list.manage", entityType: "newsletter_list" },
  { name: "list-subscriptions", route: newsletterListSubscriptionsRoute, input: { listId: "list-1", query: {} }, permission: "admin.newsletter.subscriber.read", entityType: "newsletter_subscription" },
  { name: "create-subscription", route: newsletterCreateSubscriptionRoute, input: { listId: "list-1", subscriberId: "member-1", source: "admin" }, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" },
  { name: "import-subscriptions", route: newsletterImportSubscriptionsRoute, input: { listId: "list-1", subscriberIds: ["member-1"] }, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" },
  { name: "remove-subscription", route: newsletterRemoveSubscriptionRoute, input: { listId: "list-1", id: "sub-1" }, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" },
  { name: "resend-confirmation", route: newsletterResendConfirmationRoute, input: { id: "sub-1" }, permission: "admin.newsletter.subscriber.manage", entityType: "newsletter_subscription" },
];

function run(route: AnyRoute, args: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(route.handle({ context: PRINCIPAL, ...args } as never));
}

describe.each(ROUTES)("newsletter $name route", ({ route, input, permission, entityType }) => {
  it("asks for its one permission on its entity type, with no entity id, before awaiting boot readiness", async () => {
    const events: string[] = [];
    const { authorize, calls } = recordingAuthorize([], events);
    await run(route, { input, authorize, deps: allDeps(() => { throw new Error("stop"); }, events) }).catch(() => undefined);
    expect(calls).toEqual([{ permission, entityType }]);
    expect(events.slice(0, 2)).toEqual(["authorize", "ready"]);
  });

  it("touches no collaborator and never awaits readiness when authorization refuses", async () => {
    const events: string[] = [];
    const touched: string[] = [];
    const { authorize } = recordingAuthorize([permission], events);
    await expect(run(route, { input, authorize, deps: allDeps((name) => { touched.push(name); return null; }, events) })).rejects.toThrow(`denied ${permission}`);
    expect(touched).toEqual([]);
    expect(events).toEqual(["authorize"]);
  });

  it("answers a host-mapped domain error with the mapper's exact status and body", async () => {
    const { authorize } = recordingAuthorize();
    const body = { error: "campaign is sending", code: "NEWSLETTER_CAMPAIGN_NOT_EDITABLE", details: { currentStatus: "sending" } };
    expect(await refusalOf(() => run(route, { input, authorize, deps: allDeps(() => { throw new MappedTestError(409, body); }) }))).toEqual({ status: 409, body });
  });

  it("rethrows an unmapped error unchanged, so the host's failure port answers the 500", async () => {
    const { authorize } = recordingAuthorize();
    await expect(run(route, { input, authorize, deps: allDeps(() => { throw new Error("private storage details"); }) })).rejects.toThrow("private storage details");
  });

  it("rethrows a rejected boot-readiness promise unchanged", async () => {
    const { authorize } = recordingAuthorize();
    const deps = { ...allDeps(() => null), newsletterReady: Promise.reject(new Error("migrations failed")) };
    await expect(run(route, { input, authorize, deps })).rejects.toThrow("migrations failed");
  });

  it("fails closed when the host mounted it without an authorizer", async () => {
    await expect(run(route, { input, deps: allDeps(() => null) })).rejects.toThrow(/no authorizer/);
  });
});

describe("toDataResponse", () => {
  it("retains every data value, including false and null", () => {
    expect(toDataResponse({ data: { id: "campaign-8", enabled: false, optional: null } })).toEqual({ data: { id: "campaign-8", enabled: false, optional: null } });
  });
});
