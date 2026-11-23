import type { ToolMetadataById } from '@jini-ai/core';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** publish-content registration declarations; the host's tool-metadata index explains the shared placement. */
export const toolMetadata = {
  "publish_content_connect": {
    search: {
      keywords: "changes live go live",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "publish_content_disconnect": {
    search: {
      keywords: "disconnect publishing live site connected destination stop computer forget grant undo connection",
      queries: [
        "Disconnect this computer from the live publish destination.",
        "Stop publishing content to the connected site.",
        "Forget the connected destination and reverse its publishing grant.",
        "Undo the connection to my live site.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "publish_content_execute_pull": {
    title: 'Replace local content from the source site',
    summary: 'This pulls the selected source content and may overwrite content on this site.',
    search: {
      keywords: "apply pull overwrite local with live confirm sync",
      queries: [
        "Apply the planned pull after I confirm.",
        "Overwrite local content with the live site's changes.",
        "Confirm sync and apply the downloaded live content here.",
        "Apply pull changes to my local site.",
      ],
    },
    approval: { class: 'restore-over-existing', confirmation: 'plan' },
  },
  "publish_content_plan_pull": {
    search: {
      keywords: "pull download bring back sync from live copy live content down to local get changes from live site",
      queries: [
        "Pull the live site's content down to my computer.",
        "Sync my local site with what's live.",
        "Download live content to review changes here.",
        "Bring back changes from the live site before applying them locally.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Avoid push/site terms: they belong to hosting publication, not backstop inspection.
  "publish_content_publish": {
    title: 'Publish content to the destination site',
    summary: 'This sends the selected content to the destination site and may replace its existing content.',
    search: {
      keywords: "publish pending changes live posts pages publish selected items exclude leave out overwrite replace live content",
      queries: ["Publish my changes to the live site.", "Publish only the About page.", "Publish everything except the contact page.", "Overwrite the live blog post."],
    },
    approval: { class: 'publish', confirmation: 'policy' },
  },
  // The report's strings for these two also had "push"; dropped, because it outranked
    // deployment_execute_static_publish for "push my site live to my static host" (backfill-ranking test).
  "publish_content_status": {
    search: {
      keywords: "push changes live is my site set up to publish publishing setup readiness changes live go live update live site not updating",
      queries: [
        "Is my site set up to publish?",
        "Before pushing changes live, is publishing connected?",
        "Can this computer publish changes to the live site?",
        "Where does this local site publish to?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },

  // Backstop-send history is read-only; use history words so publication requests find entry tools.
  "publish_backstop_gaps": {
    search: {
      keywords: "manual send by hand backstop gaps sent manually not covered unsupported uncovered missing type history counts reasons",
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
