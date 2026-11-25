import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** comments registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  comments_get_provider: { search: { keywords: 'comments provider built-in active readiness pending', queries: ['Where do my comments live?'] }, approval: { class: 'read', confirmation: 'direct' } },
  comments_set_provider: {
    title: 'Change the comments provider',
    summary: 'This changes the service that handles comments on this site.',
    search: { keywords: 'comments provider select switch disable built-in', queries: ['Switch my comments provider.'] }, approval: { class: 'escalation', confirmation: 'plan' } },
  "comments_get_comment": {
    search: { keywords: "comment single details read approved spam trash id version" },
    approval: { class: 'read', confirmation: 'direct' },
  },

  "comments_approve_comment": {
    search: {
      keywords: "comment approve publish allow accept moderation",
      queries: [
        "Can you approve this comment so it shows up publicly?",
        "This comment got flagged as spam but it's legit, can you approve it?",
        "How do I let this pending comment through?",
        "Can you make this comment visible to visitors?",
        "I want to unhide a trashed comment by approving it.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "comments_get_settings": {
    search: {
      keywords: "comment settings configuration config current rules how comments work",
      queries: [
        "What are our current comment moderation settings?",
        "Is comment approval required before comments show up?",
        "What is the current per-visitor hourly comment limit?",
        "What's our spam auto-reject threshold set to?",
        "Are comments automatically closed after a configured number of days?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- comments ------------------------------------------------------------------------------
  "comments_list_moderation_queue": {
    search: {
      keywords: "comments waiting approval pending moderate moderation review queue unapproved held",
      queries: [
        "What comments are waiting for me to approve?",
        "Show me the pending comments queue.",
        "Are there any comments stuck in moderation right now?",
        "I need the id of a comment before I can approve it.",
        "Can you list comments that were marked as spam so I can review them?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "comments_mark_comment_spam": {
    search: {
      keywords: "comment spam junk abusive reported flag",
      queries: [
        "This comment looks like spam, can you hide it?",
        "How do I flag a comment as junk?",
        "Can you mark this as spam so it's not shown publicly?",
        "I need to hide an obviously fake comment.",
        "How do I mark a bad comment without deleting it permanently?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "comments_restore_comment": {
    search: {
      keywords: "comment undelete bring back recover unspam un-spam",
      queries: [
        "I trashed a comment by accident, can you bring it back?",
        "Can you undo marking this comment as spam?",
        "How do I restore a comment I deleted?",
        "Can you make a spam comment approved again?",
        "I want to recover a comment from the trash.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "comments_trash_comment": {
    search: {
      keywords: "comment hide remove delete trash reported abusive",
      queries: [
        "Can you delete this comment?",
        "How do I remove a rude comment from the site?",
        "I want to trash a comment but be able to bring it back later.",
        "Can you soft-delete this comment?",
        "How do I hide a comment without permanently losing it?",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "comments_update_settings": {
    search: {
      keywords: "comment settings configure change require approval turn on off limit rate moderation rules",
      queries: [
        "Can you turn on comment moderation for the site?",
        "I want to change how deep a nested reply thread can go.",
        "Can you raise the spam score threshold for auto-rejecting comments?",
        "How do I set comments to close automatically after 30 days?",
        "Can you limit how many comments one IP can post per hour?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
