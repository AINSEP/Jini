import assert from "node:assert/strict";
import { test } from "vitest";

import { NEWSLETTER_CAMPAIGN_TYPE, NEWSLETTER_PERMISSIONS } from "../types.js";

test("the newsletter permission catalog is exactly the ten admin.newsletter.* strings the routes are authored against", () => {
  assert.deepEqual(NEWSLETTER_PERMISSIONS, [
    "admin.newsletter.read",
    "admin.newsletter.campaign.compose",
    "admin.newsletter.campaign.schedule",
    "admin.newsletter.campaign.send",
    "admin.newsletter.campaign.send_test",
    "admin.newsletter.list.manage",
    "admin.newsletter.subscriber.read",
    "admin.newsletter.subscriber.manage",
    "admin.newsletter.settings.manage",
    "admin.newsletter.manage",
  ]);
  assert.equal(new Set(NEWSLETTER_PERMISSIONS).size, NEWSLETTER_PERMISSIONS.length, "no permission is listed twice");
  // REQ-25: the stale unprefixed `newsletter.*` strings must never come back.
  assert.ok(NEWSLETTER_PERMISSIONS.every((permission) => permission.startsWith("admin.newsletter.")));
});

test("the campaign content-type slug is the registered newsletter_campaign type", () => {
  assert.equal(NEWSLETTER_CAMPAIGN_TYPE, "newsletter_campaign");
});
