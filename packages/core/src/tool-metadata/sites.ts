import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** sites registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "sites_get_site": {
    search: { keywords: "site local client registry folder name details single serving queued" },
    approval: { class: 'read', confirmation: 'direct' },
  },

  // Create and activate sites from chat, matching the admin Sites screen.
  "sites_create_site": {
    search: {
      keywords: "create a new site create a new website make a new site add another site start a blank site empty client folder init",
      queries: [
        "Create a new site.",
        "Make a new site for another client.",
        "Create a new blank site.",
        "Start a fresh empty site called acme.",
        "Add a new site to my sites folder.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- sites (site directory) ---------------------------------------------------------------------------
  // Copy/duplicate/clone vocabulary must discover site duplication.
  "sites_duplicate_site": {
    search: {
      keywords: "site sites copy duplicate clone new client starting point template sample landing based on existing existing site " +
        "spin up stand up set up create from a copy of same content",
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "sites_list": {
    search: {
      keywords: "local sites computer clients registry list folders serving active current queued pending restart switching disabled",
      queries: [
        "Which client sites are stored on this computer?",
        "List my local sites before copying one.",
        "Which site is currently serving and which is queued for restart?",
        "Can I see the site registry when switching is disabled?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "sites_switch_site": {
    search: {
      keywords: "switch site change site activate site serve served serving which site use open work on another different client website restart dev server go to",
      queries: [
        "Switch to my other site.",
        "Work on the acme site instead of this one.",
        "Change which site the dev server is serving.",
        "Activate a different site and restart.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
