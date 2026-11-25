import { describe, expect, it } from "vitest";
import { newsletterAgentToolCatalog } from "../agent-tools.js";
import { PREHEADER_MAX, SUBJECT_MAX, SUBJECT_MIN } from "../campaign-write-service.js";

describe("newsletter agent tool catalog", () => {
  it("preserves ordered IDs, declared permissions, side effects and closed schemas", () => {
    expect(newsletterAgentToolCatalog.map((tool) => [tool.name, tool.authorization, tool.sideEffects])).toEqual([
      ["newsletter_list_campaigns", { permission: "admin.newsletter.read" }, "none"],
      ["newsletter_get_campaign", { permission: "admin.newsletter.read" }, "none"],
      ["newsletter_list_lists", { permission: "admin.newsletter.read" }, "none"],
      ["newsletter_list_subscriptions", { permission: "admin.newsletter.subscriber.read" }, "none"],
      ["newsletter_list_send_log", { permission: "admin.newsletter.subscriber.read" }, "none"],
      ["newsletter_create_campaign", { permission: "admin.newsletter.campaign.compose" }, "mutates-durable-state"],
      ["newsletter_update_campaign", { permission: "admin.newsletter.campaign.compose" }, "mutates-durable-state"],
      ["newsletter_cancel_campaign", { permission: "admin.newsletter.campaign.compose" }, "mutates-durable-state"],
      ["newsletter_pause_campaign", { permission: "admin.newsletter.campaign.send" }, "mutates-durable-state"],
      ["newsletter_create_list", { permission: "admin.newsletter.list.manage" }, "mutates-durable-state"],
      ["newsletter_archive_list", { permission: "admin.newsletter.list.manage" }, "mutates-durable-state"],
      ["newsletter_create_subscription", { permission: "admin.newsletter.subscriber.manage" }, "mutates-durable-state"],
      ["newsletter_remove_subscription", { permission: "admin.newsletter.subscriber.manage" }, "mutates-durable-state"],
      ["newsletter_resend_confirmation", { permission: "admin.newsletter.subscriber.manage" }, "mutates-durable-state"],
    ]);
    for (const tool of newsletterAgentToolCatalog) {
      expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
    }
    expect(newsletterAgentToolCatalog.map((tool) => tool.name)).not.toContain("newsletter_import_subscriptions");
  });

  it.each(["newsletter_create_campaign", "newsletter_update_campaign"])("%s agrees with campaign editorial bounds", (name) => {
    expect(newsletterAgentToolCatalog.find((tool) => tool.name === name)?.inputSchema).toMatchObject({
      properties: {
        subject: { minLength: SUBJECT_MIN, maxLength: SUBJECT_MAX },
        preheader: { maxLength: PREHEADER_MAX },
      },
    });
  });

  it("limits campaign listings to exactly 100", () => {
    expect(newsletterAgentToolCatalog.find((tool) => tool.name === "newsletter_list_campaigns")?.inputSchema).toMatchObject({
      properties: { limit: { maximum: 100 } },
    });
  });
});
