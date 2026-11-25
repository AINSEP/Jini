import type { AgentToolDefinition as SharedAgentToolDefinition } from "@jini-ai/core";
/**
 * @file Newsletter composition, list and subscription catalog.
 * Delivery tools live in delivery/tool-registrations.ts. Mass sends, scheduling and resume require
 * browser-only approval; opt-in resends and owner test sends run directly.
 * Bulk subscription import remains unavailable to the assistant.
 */
import { PREHEADER_MAX, SUBJECT_MAX, SUBJECT_MIN } from "./campaign-write-service.js";

const MUTATES_DURABLE_STATE = "mutates-durable-state" as const;
/** Bulk import stays absent: 1-500 imported contacts can each trigger a real confirmation email,
 * so one call creates third-party mail at scale. Single-contact adds send double-opt-in links,
 * never campaign content or an assertion of consent. Pause/unsubscribe only narrow delivery.
 * Shared editorial bounds come from the validators so published schemas cannot drift from them.
 * The catalog declares permissions but performs no authorization; registration handlers must
 * check them explicitly because Newsletter domain services do not authorize themselves. */

export type AgentToolSideEffect = "none" | typeof MUTATES_DURABLE_STATE | "mints-token";

export type { AgentToolActorClassRule } from "@jini-ai/core";

/**
 * JSON Schema for this tool's `input`, published to the model via `ToolDescriptor.inputSchema`
 * (`assistant/tool-registrations.ts`, which refuses to wire any tool lacking one).
 */
export type AgentToolDefinition = SharedAgentToolDefinition & { sideEffects: AgentToolSideEffect };

const CAMPAIGN_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "The campaign's id. Get it from newsletter_create_campaign's result or {{read:newsletter_campaign}}.",
} as const;

const LIST_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  description: "A newsletter list's id. Get it from newsletter_create_list's result or {{read:newsletter_list}}.",
} as const;

/** Campaign editorial fields shared by `create`/`update` — every field but `listId` maps 1:1 onto `CampaignRecord`. */
const CAMPAIGN_FIELDS_PROPERTIES = {
  subject: {
    type: "string",
    minLength: SUBJECT_MIN,
    maxLength: SUBJECT_MAX,
    description: `Email subject line (${SUBJECT_MIN}-${SUBJECT_MAX} characters).`,
  },
  preheader: {
    type: ["string", "null"],
    maxLength: PREHEADER_MAX,
    description: `Optional inbox-preview text (max ${PREHEADER_MAX} characters). Omit or pass null for none.`,
  },
  fromName: { type: "string", minLength: 1, description: "Envelope From display name." },
  fromEmail: { type: "string", minLength: 1, description: "Envelope From address." },
  replyTo: { type: "string", minLength: 1, description: "Reply-To address." },
  listId: LIST_ID_SCHEMA,
} as const;

/** Newsletter's fixed agent-tool catalog. */
export const newsletterAgentToolCatalog: AgentToolDefinition[] = [
  // --- Read tools ---
  {
    name: "newsletter_list_campaigns",
    description: "Lists the workspace's campaigns, optionally filtered by status. Read-only. Call this to find a campaign's id before getting, updating, canceling, or pausing it.",
    sideEffects: "none",
    authorization: { permission: "admin.newsletter.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Maximum campaigns to scan per page." },
        cursor: { type: "string", description: "nextCursor from the previous call. Omit for the first page." },
        status: {
          type: "string",
          enum: ["draft", "scheduled", "sending", "sent", "paused", "canceled", "failed"],
          description: "Filter to campaigns in exactly this status. Omit to list every status.",
        },
      },
    },
  },
  {
    name: "newsletter_get_campaign",
    description: "Fetches a single campaign's full details by id, including its current status and delivery counters. Read-only.",
    sideEffects: "none",
    authorization: { permission: "admin.newsletter.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["campaignId"],
      properties: { campaignId: CAMPAIGN_ID_SCHEMA },
    },
  },
  {
    name: "newsletter_list_lists",
    description: "Lists the workspace's subscriber lists. Read-only. Call this to find a listId before creating a campaign, adding a subscription, or archiving a list.",
    sideEffects: "none",
    authorization: { permission: "admin.newsletter.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {},
    },
  },
  {
    name: "newsletter_list_subscriptions",
    description: "Lists the subscriptions on one list. Read-only.",
    sideEffects: "none",
    authorization: { permission: "admin.newsletter.subscriber.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["listId"],
      properties: { listId: LIST_ID_SCHEMA,
        limit: { type: "integer", minimum: 1, maximum: 100, clamp: true, description: "Maximum subscriptions per page." },
        cursor: { type: "string", description: "nextCursor from the previous call. Omit for the first page." } },
    },
  },
  {
    name: "newsletter_list_send_log",
    description: "Lists the per-recipient delivery log for one campaign (id, recipient email, delivery status, attempts). Read-only; PII-adjacent (recipient email addresses). Returns at most 100 rows; truncated: true means more rows exist.",
    sideEffects: "none",
    authorization: { permission: "admin.newsletter.subscriber.read" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["campaignId"],
      properties: { campaignId: CAMPAIGN_ID_SCHEMA },
    },
  },

  // --- Write tools: draft campaign composition (never touches status) ---
  {
    name: "newsletter_create_campaign",
    description:
      "Creates a new newsletter campaign in 'draft' status. Returns {campaign}. Use newsletter_update_campaign to edit it, newsletter_send_test for an owner-only test, or newsletter_send_campaign/newsletter_schedule_campaign for a human-confirmed subscriber send. Refuses an unknown list or invalid editorial fields.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.campaign.compose" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "fromName", "fromEmail", "replyTo", "listId"],
      properties: CAMPAIGN_FIELDS_PROPERTIES,
    },
  },
  {
    name: "newsletter_update_campaign",
    description:
      "Edits an existing campaign's editorial fields (subject/preheader/fromName/fromEmail/replyTo/listId). Only works while the campaign is 'draft' — refused once it is scheduled or beyond. A partial patch: omitted fields keep their current value. Never changes status.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.campaign.compose" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["campaignId"],
      properties: { campaignId: CAMPAIGN_ID_SCHEMA, ...CAMPAIGN_FIELDS_PROPERTIES },
    },
  },
  {
    name: "newsletter_cancel_campaign",
    description:
      "Cancels a 'draft' or 'scheduled' campaign, terminally taking it out of the send pipeline before it ever sends. This is a safety/rollback action — it never causes mail to go out, only prevents it. Cannot cancel a campaign that is already 'sending' or 'sent'.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.campaign.compose" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["campaignId"],
      properties: { campaignId: CAMPAIGN_ID_SCHEMA },
    },
  },
  {
    name: "newsletter_pause_campaign",
    description:
      "Pauses a campaign that is actively 'sending', halting remaining recipients without a confirmation card. An in-flight recipient may finish. Returns {campaign}. Use newsletter_resume_campaign to resume with human confirmation. Refuses campaigns that are not sending.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.campaign.send" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["campaignId"],
      properties: { campaignId: CAMPAIGN_ID_SCHEMA },
    },
  },

  // --- Write tools: lists ---
  {
    name: "newsletter_create_list",
    description: "Creates a new subscriber list with a unique name and slug. Always created active, never the default list.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.list.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "slug"],
      properties: {
        name: { type: "string", minLength: 1, description: "Human-readable list name." },
        slug: { type: "string", minLength: 1, description: "Unique-per-workspace slug." },
      },
    },
  },
  {
    name: "newsletter_archive_list",
    description: "Archives a subscriber list. The workspace's default 'all subscribers' list can never be archived and is refused.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.list.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["listId"],
      properties: { listId: LIST_ID_SCHEMA },
    },
  },

  // --- Write tools: individual subscriptions (never bulk import — see file header) ---
  {
    name: "newsletter_create_subscription",
    description:
      "Adds a single existing Members subscriber to a list, creating a 'pending' subscription and emailing them ONE double-opt-in confirmation link (they must still click it to become 'subscribed'). subscriberId must resolve to an existing Members principal. Never sends marketing content — only the confirmation link.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.subscriber.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["listId", "subscriberId"],
      properties: {
        listId: LIST_ID_SCHEMA,
        subscriberId: { type: "string", minLength: 1, description: "An existing Members subscriber's id." },
        source: { type: "string", enum: ["admin", "import", "api"], description: "Provenance tag for audit/consent purposes. Defaults to 'admin'." },
      },
    },
  },
  {
    name: "newsletter_remove_subscription",
    description:
      "Unsubscribes one existing subscription (admin-triggered removal, by id — not a caller-supplied email). Idempotent: removing an already-unsubscribed subscription is a no-op success. This only ever narrows a subscriber's access to future sends, never grants or re-adds it.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.subscriber.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["listId", "subscriptionId"],
      properties: {
        listId: LIST_ID_SCHEMA,
        subscriptionId: { type: "string", minLength: 1, description: "The subscription's id, as returned by newsletter_create_subscription or newsletter_list_subscriptions." },
      },
    },
  },
  {
    name: "newsletter_resend_confirmation",
    description:
      "Resends a double-opt-in link directly. Invalidates prior links for a pending subscription. Returns {delivered:true,mailDeliveryAvailable:true} as a privacy-preserving acknowledgement, without revealing whether the subscription/contact exists or guaranteeing delivery, or {delivered:false,mailDeliveryAvailable:false,note} when mail is off and nothing was sent. Requires subscriber-management permission.",
    sideEffects: MUTATES_DURABLE_STATE,
    authorization: { permission: "admin.newsletter.subscriber.manage" },
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["subscriptionId"],
      properties: {
        subscriptionId: { type: "string", minLength: 1, description: "The subscription's id, as returned by newsletter_create_subscription or newsletter_list_subscriptions." },
      },
    },
  },
];
