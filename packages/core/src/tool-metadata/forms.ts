import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** forms registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "forms_list_providers": {
    search: {
      keywords: "forms collection provider providers settings external embedded public answers validation",
      queries: ["Which form providers can I use?", "What public settings does this form provider need?"],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "forms_delivery_status": {
    search: {
      keywords: "form submission delivery deliveries destination destinations sheet spreadsheet sent reached status retry retrying failed attempts",
      queries: [
        "Did this form submission reach the spreadsheet?",
        "Which form deliveries failed or are still retrying?",
        "Why didn't the new signup show up in our sheet?",
        "Show me the delivery status of the latest form entries.",
        "Are any form submissions stuck waiting to be sent to their destination?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "forms_create_definition": {
    search: {
      keywords: "form contact form build create new fields",
      queries: [
        "How do I build a new contact form?",
        "Can you set up a new form with a specific URL slug?",
        "I want to create a signup form with these fields.",
        "How do I add a brand-new form to the site?",
        "Can you make a new form definition — can the slug ever change later?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "forms_get_submission": {
    search: {
      keywords: "form submission response reply entry message detail",
      queries: [
        "Can you pull up the full details of one specific form submission?",
        "I have a submission id, show me everything that was submitted.",
        "What did this particular visitor fill out on the form?",
        "Can you show me the exact time and IP for this one submission?",
        "I need to look at a single form response in detail.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "forms_list_definitions": {
    search: {
      keywords: "forms contact form list existing built",
      queries: [
        "What forms do we have set up on the site?",
        "I need the id for our contact form before I can edit it.",
        "Show me all our form definitions and how many fields each has.",
        "Which forms are active versus disabled?",
        "Can you list every form by name and slug?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- forms ----------------------------------------------------------------------------------
  "forms_list_submissions": {
    search: {
      keywords: "form submitted submissions contact responses replies entries messages people sent enquiries",
      queries: [
        "What submissions have come in on our contact form?",
        "Can you show me the latest form entries, newest first?",
        "Who submitted this form and when?",
        "I want to see all the responses to our survey form.",
        "Show me the IP addresses on recent form submissions.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "forms_pull_submissions": {
    search: {
      keywords: "form submissions pull import fetch sync bring new entries signups waitlist hosting host waiting",
      queries: [
        "Pull the new form submissions from the host.",
        "Are there new signups waiting at the hosting provider? Bring them in.",
        "Import the waitlist entries people submitted on the live static export.",
        "Sync form entries from our hosting into the admin.",
        "Fetch the latest form responses that are waiting at the host.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "forms_set_definition_status": {
    search: {
      keywords: "form enable disable turn off retire deactivate activate",
      queries: [
        "How do I turn off a form so people can't submit it anymore?",
        "Can you disable this old form?",
        "Is there a way to delete a form, or just disable it?",
        "How do I re-enable a form I turned off earlier?",
        "Can you take this form out of service?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "forms_update_definition": {
    search: {
      keywords: "form edit change existing update fields recipients send email notify notification notifications submissions address recipient recipients inbox forward",
      queries: [
        "Can you add a new field to our existing form?",
        "I need to change who gets notified when this form is submitted.",
        "Send this form's submissions to a different email address.",
        "Can you rename this form without changing its URL?",
        "How do I edit the fields on a form I already made?",
        "Can I remove a field from a form, or does that get blocked?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
