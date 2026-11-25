import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** webhooks registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "webhooks_update_subscription": {
    search: { keywords: "webhook subscription edit update label target url topics endpoint" },
    approval: { class: 'edit', confirmation: 'direct' },
  },

  "webhooks_create_subscription": {
    search: {
      keywords: "webhook webhooks endpoint callback integration connect notify subscribe outgoing form submission submitted fires",
      queries: [
        "Can you set up a new webhook for us?",
        "How do I add an integration that starts active?",
        "I need a new webhook subscription — where do I get the signing secret?",
        "Can you create a new outbound webhook connection?",
        "How do I wire up a new integration endpoint?",
        "Add a webhook for form submissions.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "webhooks_delete_subscription": {
    title: 'Delete this webhook subscription',
    summary: 'This permanently removes the selected webhook subscription and stops its deliveries.',
    search: {
      keywords: "webhook webhooks endpoint remove delete disconnect integration",
      queries: [
        "Can you remove this webhook subscription?",
        "How do I delete an integration we don't use anymore?",
        "I want to disable a webhook permanently.",
        "Can you deactivate this integration subscription?",
        "What happens if I try deleting a webhook that's already deleted?",
      ],
    },
    approval: { class: 'delete', confirmation: 'plan' },
  },
  "webhooks_get_deliveries": {
    search: {
      keywords: "webhook webhooks delivery deliveries fired sent failed failure retry retries attempts log history",
      queries: [
        "Did our webhook actually fire successfully?",
        "Can you show me the delivery log for this webhook?",
        "Why did this integration fail — what was the last response?",
        "I want to see all the delivery attempts for one webhook subscription.",
        "How many times has this webhook retried?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- webhooks -----------------------------------------------------
  "webhooks_list_subscriptions": {
    search: {
      keywords: "webhook webhooks endpoint endpoints callback callbacks integration integrations outgoing notification configured",
      queries: [
        "What webhooks do we have set up?",
        "Can you show me our integration subscriptions and their last delivery?",
        "I need to see which webhooks are active.",
        "List all our outbound webhook connections.",
        "What integrations are currently configured?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "webhooks_pause_subscription": {
    search: {
      keywords: "webhook webhooks pause stop disable suspend integration",
      queries: [
        "Can you pause this webhook so it stops sending?",
        "How do I temporarily stop an integration from firing?",
        "Can you resume a webhook I paused earlier?",
        "I want to turn off deliveries for this subscription without deleting it.",
        "Can I pause and later resume the same webhook with one tool?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
