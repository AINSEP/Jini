import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** newsletter registration declarations; shared placement rationale is in ./index.ts. */
export const toolMetadata = {
  "newsletter_archive_list": {
    search: {
      keywords: "subscriber list archive retire remove hide stop using mailing list",
      queries: [
        "Can you archive this old subscriber list?",
        "How do I retire a mailing list we don't use anymore?",
        "Can I archive our default 'all subscribers' list?",
        "I want to get rid of an unused list.",
        "How do I shelve a subscriber list?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_cancel_campaign": {
    search: {
      keywords: "stop cancel kill abort email campaign newsletter send going out",
      queries: [
        "Can you cancel this newsletter before it sends?",
        "I want to stop a scheduled campaign from going out.",
        "Can I cancel a campaign that's already sending?",
        "How do I pull the plug on a draft campaign permanently?",
        "Can you take this campaign out of the send pipeline entirely?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_create_campaign": {
    search: {
      keywords: "email campaign newsletter blast send announcement compose draft write create new",
      queries: [
        "Can you draft a new email newsletter?",
        "Draft an announcement newsletter about a menu, product, or event update.",
        "How do I start a new campaign — will it send automatically?",
        "I want to create a newsletter draft I can edit later.",
        "Can you set up a new campaign in draft status?",
        "How do I begin a new email blast without sending it yet?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_create_list": {
    search: {
      keywords: "subscriber list new create mailing list audience segment group",
      queries: [
        "Can you create a new subscriber list?",
        "How do I set up a new mailing list with its own slug?",
        "I want a fresh list for a specific audience segment.",
        "Can a brand-new list become the default one automatically?",
        "How do I make a new newsletter list?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_create_subscription": {
    search: {
      keywords: "add subscribe someone member to a list mailing list sign up manually",
      queries: [
        "Can you add this member to our newsletter list?",
        "How do I subscribe an existing member — do they need to confirm it?",
        "I want to add someone to a mailing list and send them a confirmation.",
        "Can this also send them marketing content right away?",
        "How do I sign up an existing member for a specific list?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_get_campaign": {
    search: {
      keywords: "email campaign read view details one specific status",
      queries: [
        "Can you show me the full details of this one campaign?",
        "What's the current status and delivery count for this newsletter?",
        "I have a campaign id, pull up everything about it.",
        "How many emails has this campaign actually sent so far?",
        "Show me one campaign's full info.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "newsletter_list_campaigns": {
    search: {
      keywords: "email campaigns newsletters sent scheduled drafts list",
      queries: [
        "What email campaigns do we have going?",
        "Can you show me our draft newsletters?",
        "I need a campaign's id before I can edit it.",
        "List all our newsletter campaigns by status.",
        "What campaigns have we sent or scheduled?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "newsletter_list_lists": {
    search: {
      keywords: "subscriber lists mailing lists available existing audience segments what lists",
      queries: [
        "What subscriber lists do we have?",
        "I need a list id before creating a new campaign.",
        "Can you show me all our newsletter lists?",
        "What are the names of our mailing lists?",
        "List every subscriber list in the workspace.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "newsletter_list_send_log": {
    search: {
      keywords: "email sent delivery delivered log history newsletter campaign who received",
      queries: [
        "Did everyone actually receive this newsletter?",
        "Can you show me the delivery log for this campaign, email by email?",
        "Who didn't get this newsletter and why?",
        "I want to see the per-recipient send status for a campaign.",
        "How many attempts did it take to deliver to each subscriber?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- newsletter ----------------------------------------------------------------------------
  "newsletter_list_subscriptions": {
    search: {
      keywords: "signed up subscriber subscribers mailing list audience joined email list who",
      queries: [
        "Who's subscribed to this particular list?",
        "Can you show me the subscribers on our main mailing list?",
        "I want to see everyone signed up for a specific newsletter list.",
        "Show me the subscription records for one list.",
        "How many people are on this mailing list?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "newsletter_pause_campaign": {
    search: {
      keywords: "pause hold stop email campaign newsletter sending",
      queries: [
        "Can you stop this newsletter that's currently sending?",
        "How do I halt an in-progress campaign send?",
        "Once I pause a campaign, can I resume it later?",
        "I need to stop outbound mail on this campaign right now.",
        "Can you pause a campaign that's already fully sent?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_remove_subscription": {
    search: {
      keywords: "unsubscribe remove subscriber opt out mailing list",
      queries: [
        "Can you unsubscribe this person from the list?",
        "How do I remove a subscription by its id?",
        "What happens if I try to unsubscribe someone who's already unsubscribed?",
        "I want to take someone off a mailing list.",
        "Can you cancel this subscriber's spot on the list?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_resend_confirmation": {
    search: {
      keywords: "resend confirmation email opt-in link subscribe again didn't get the email",
      queries: [
        "This subscriber never got their confirmation email, can you resend it?",
        "Can you send a fresh double opt-in link, invalidating the old one?",
        "How do I resend the confirmation for a pending subscription?",
        "What happens if I try resending confirmation for an unknown subscription?",
        "Can you re-trigger the opt-in email for someone who lost it?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_resume_campaign": {
    title: 'Resume this email campaign',
    summary: 'This resumes delivery of the selected campaign to its recipients.',
    search: {
      keywords: "newsletter resume paused continue sending restart delivery remaining campaign email mailing list",
      queries: [
        "Resume this paused newsletter.",
        "Continue sending the newsletter.",
        "Restart paused newsletter delivery.",
        "Resume the email campaign's remaining recipients.",
        "Unpause this newsletter send after I approve it.",
      ],
    },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  "newsletter_schedule_campaign": {
    title: 'Schedule this email campaign',
    summary: 'This schedules the selected campaign for delivery to its recipients.',
    search: {
      keywords: "newsletter schedule campaign scheduled date time tomorrow later future issue email send",
      queries: [
        "Schedule this newsletter for tomorrow.",
        "Set a send date for this email campaign.",
        "Schedule the newsletter issue for later.",
        "Save a scheduled date for this subscriber newsletter send.",
        "Can I record when this newsletter should go out?",
      ],
    },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  "newsletter_send_campaign": {
    title: 'Send this email campaign',
    summary: 'This sends the selected campaign to its recipients.',
    search: {
      keywords: "newsletter send now launch issue subscribers mailing list email everyone blast deliver announcement",
      queries: [
        "Send this newsletter now.",
        "Launch this newsletter to subscribers.",
        "Send the newsletter to everyone.",
        "Email this newsletter to my mailing list.",
        "Send the newsletter issue after I confirm.",
      ],
    },
    approval: { class: 'publish', confirmation: 'plan' },
  },
  "newsletter_send_test": {
    search: {
      keywords: "newsletter email campaign test preview send myself site owner only proof inbox",
      queries: [
        "Send a test newsletter to myself.",
        "Test this email campaign before sending it.",
        "Email a newsletter preview to the site owner.",
        "Send me a proof of this newsletter issue.",
        "Can I check the newsletter in my own inbox first?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "newsletter_update_campaign": {
    search: {
      keywords: "email campaign edit update change subject draft",
      queries: [
        "Can you change the subject line on this draft newsletter?",
        "I need to edit the from-email and reply-to on a campaign.",
        "Can I still edit this campaign once it's scheduled?",
        "How do I update the preheader text on a draft?",
        "Can you switch which list this campaign is going to?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
