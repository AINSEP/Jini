import type { ToolMetadataById } from "../../tool-metadata-types.js";
import type { ToolApprovalPolicy } from "../../contracts/site/tool-metadata-approval-policy.js";

/** mail-status registration declarations; shared placement rationale is in the host's tool-metadata catalog index. */
export const toolMetadata = {
  "system_get_mail_status": {
    search: {
      keywords: "email mail not arriving didn't get email sending configured smtp provider delivery magic link",
      queries: [
        "Why is my email not arriving?",
        "I didn't get the sign-in email; is sending configured?",
        "Check which mail provider or SMTP driver is active.",
        "Can this site deliver real email or does it print to the console?",
        "Why didn't my magic link arrive?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_set_provider": {
    title: 'Change the email provider',
    summary: 'This changes the service used to send email from this site.',
    // Vendor-neutral on purpose: core names no hosted mail provider (no-vendor-in-core.boundary.test.ts);
    // a provider's own name and setup know-how ship in its agent plugin (content/agent-plugins/<vendor>/).
    search: {
      keywords: "email mail provider switch change choose smtp hosted api sending service configure set up",
      queries: ["Switch my site's email to SMTP.", "Use a hosted email API to send this site's email.", "Set up which provider sends my email."],
    },
    approval: { class: 'escalation', confirmation: 'plan' },
  },
  "mail_send_test": {
    title: 'Send a test email',
    summary: 'This sends a real email to the selected recipient.',
    search: {
      keywords: "send test email mail check delivery works inbox try verify",
      queries: ["Send me a test email.", "Check that my site can actually send email."],
    },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  "mail_list_providers": {
    search: {
      keywords: "email mail providers installed list configured key saved setup fields smtp hosted api",
      queries: ["Which email providers can this site use?", "Is my mail provider's key saved?", "What do I need to set up SMTP?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_configure_provider": {
    search: {
      keywords: "email mail provider configure set up save key api key replace rotate smtp password without switching",
      queries: ["Set up a mail provider without switching to it yet.", "Replace my email provider's API key.", "Save the SMTP password for my site's email."],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_get_readiness": {
    search: {
      keywords: "email uses readiness sign-in links confirmations form notifications newsletter blocked ready why not sending",
      queries: ["Which of my site's emails can send right now?", "Why aren't form notification emails going out?", "Is newsletter email blocked?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_list_activity": {
    search: {
      keywords: "email activity recent sends history log failures bounced delivered complained suppressed outcome",
      queries: ["Show recent emails this site sent.", "Which emails bounced?", "Did the sign-in email to this address go out?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_get_activity": {
    search: {
      keywords: "email send detail feedback timeline delivered bounced message id provider error",
      queries: ["Show the details of that email send.", "What happened to this email after the provider accepted it?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_list_suppressions": {
    search: {
      keywords: "email suppression list blocked recipients do not send bounced complained unsubscribe blocklist",
      queries: ["Which addresses will my site not email?", "Is this address blocked from my emails?", "Show bounced email addresses."],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "mail_remove_suppression": {
    title: 'Allow email to this recipient again',
    summary: 'This removes the selected suppression so email delivery can resume.',
    search: {
      keywords: "email unblock remove suppression allow email again bounced complained do not send list",
      queries: ["Let my site email this address again.", "Remove this address from the do-not-send list."],
    },
    approval: { class: 'escalation', confirmation: 'plan' },
  },
  "mail_get_feedback_setup": {
    search: {
      keywords: "email feedback webhook bounces complaints delivery events signing secret setup provider reports",
      queries: ["Is bounce and complaint reporting set up for my email?", "What webhook URL do I give my mail provider?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
