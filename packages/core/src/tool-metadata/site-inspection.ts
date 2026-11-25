import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** site-inspection registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // Include describe_site_capabilities as operator vocabulary. FTS unicode61 does not stem:
  // capable, capability and capabilities are distinct tokens.
  "site_describe_capabilities": {
    search: {
      keywords: "describe_site_capabilities capabilities capability capable what can this site do features abilities possible available tools admin screens content types",
      queries: [
        "What can this site do?", "What is this site capable of?", "What features and tools does this site have?", "What can I do with this site?", "What is possible here?",
        "What can you do on this site?", "What can this website do for me?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- site inspection / evidence -----------------------------------------------------------------------
  // Overview/snapshot questions belong to the whole-site profile.
  "site_get_profile": {
    search: {
      keywords: "site overview summary snapshot everything about the site inventory status",
      queries: [
        "Give me an overview of my site.", "Summarize how the whole site is set up.", "What is on this site right now?", "Show me a snapshot of the site's pages, theme and settings.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },

  "fetch_published_page": {
    search: {
      keywords: "check local page visitor sees rendered output verify loads works test does it work find text on page search page contains visible text markup",
      queries: [
        "Find a string on the local rendered page.",
        "Does this page contain the text I asked for?",
        "Get visible text without markup from this local route.",
        "Search the published page for mentions of this phrase.",
        "Check what a visitor receives from the local site's rendered page.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },

  "fetch_live_url": {
    search: {
      keywords: "live site production deployed check live is it updated did it publish public website domain online real site compare local",
      queries: [
        "Has the live website updated after my publish?",
        "Fetch the production site's public page to verify the deployment.",
        "Compare what visitors get on the live domain with the local render.",
        "Is my real online site showing the newly published content?",
        "Check the deployed public website after publishing.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
