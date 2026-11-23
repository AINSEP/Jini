import { describe, expect, it } from "vitest";

import { newsletterCancelCampaignRoute } from "../cancel-campaign.js";
import { newsletterCreateCampaignRoute } from "../create-campaign.js";
import { newsletterGetCampaignRoute } from "../get-campaign.js";
import { newsletterListCampaignsRoute } from "../list-campaigns.js";
import { newsletterListSendLogRoute } from "../list-send-log.js";
import { newsletterPauseCampaignRoute } from "../pause-campaign.js";
import { newsletterResumeCampaignRoute } from "../resume-campaign.js";
import { newsletterScheduleCampaignRoute } from "../schedule-campaign.js";
import { newsletterSendCampaignRoute } from "../send-campaign.js";
import { newsletterSendTestCampaignRoute } from "../send-test-campaign.js";
import { newsletterUpdateCampaignRoute } from "../update-campaign.js";
import { allDeps, fakeCampaign, MappedTestError, PRINCIPAL, recordingAuthorize, refusalOf } from "./helpers.js";

/** @file The rules every campaign route shares: one permission on `newsletter_campaign` (never an entity id,
 *  as the hand-written guard sent none), permission before boot readiness, the injected host error mapper,
 *  unmapped errors rethrown for the host 500, and failing closed without an authorizer. */

type AnyRoute = { handle: (args: never, o?: never) => unknown };
const CAMPAIGN_ROUTES: ReadonlyArray<{ name: string; route: AnyRoute; input: unknown; permission: string }> = [
  { name: "list", route: newsletterListCampaignsRoute, input: { query: {} }, permission: "admin.newsletter.read" },
  { name: "get", route: newsletterGetCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.read" },
  { name: "create", route: newsletterCreateCampaignRoute, input: { fields: { ...fakeCampaign(), listId: "list-1" } }, permission: "admin.newsletter.campaign.compose" },
  { name: "update", route: newsletterUpdateCampaignRoute, input: { id: "camp-1", body: {} }, permission: "admin.newsletter.campaign.compose" },
  { name: "cancel", route: newsletterCancelCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.compose" },
  { name: "schedule", route: newsletterScheduleCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.schedule" },
  { name: "send", route: newsletterSendCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send" },
  { name: "send-test", route: newsletterSendTestCampaignRoute, input: { id: "camp-1", testAddresses: ["a@b.test"] }, permission: "admin.newsletter.campaign.send_test" },
  { name: "pause", route: newsletterPauseCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send" },
  { name: "resume", route: newsletterResumeCampaignRoute, input: { id: "camp-1" }, permission: "admin.newsletter.campaign.send" },
  { name: "send-log", route: newsletterListSendLogRoute, input: { id: "camp-1", query: {} }, permission: "admin.newsletter.subscriber.read" },
];

function run(route: AnyRoute, args: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(route.handle({ context: PRINCIPAL, ...args } as never));
}

describe.each(CAMPAIGN_ROUTES)("newsletter $name campaign route", ({ route, input, permission }) => {
  it("asks for its one permission on newsletter_campaign, with no entity id, before awaiting boot readiness", async () => {
    const events: string[] = [];
    const { authorize, calls } = recordingAuthorize([], events);
    await run(route, { input, authorize, deps: allDeps(() => { throw new Error("stop"); }, events) }).catch(() => undefined);
    expect(calls).toEqual([{ permission, entityType: "newsletter_campaign" }]);
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
