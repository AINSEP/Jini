import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** navigation registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "menus_assign_location": {
    search: {
      keywords: "navigation nav menu location slot header footer place assign",
      queries: [
        "How do I put this menu in the header?",
        "Can you assign this menu to the footer location?",
        "If another menu is already in that spot, what happens to it?",
        "How do I make a menu actually show up on the live site?",
        "Can you swap which menu is bound to the primary navigation slot?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "menus_create_menu": {
    search: {
      keywords: "navigation nav menu new create header footer",
      queries: [
        "How do I create a new navigation menu?",
        "Can you make a new menu — will it show up on the site right away?",
        "I want to build a draft menu before assigning it anywhere.",
        "Can you create a menu with a unique slug?",
        "How do I start a brand-new menu from scratch?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "menus_get_menu": {
    search: {
      keywords: "navigation nav menu read view details one specific existing item tree",
      queries: [
        "Can you show me the full item tree for this one menu?",
        "I have a menu id, pull up its details.",
        "What items are in this specific menu right now?",
        "Show me one menu's structure and version number.",
        "Can I see the current layout of our main navigation menu?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "menus_list_menus": {
    search: {
      keywords: "navigation nav menus list existing header footer",
      queries: [
        "What menus do we have set up on the site?",
        "Can you show me all our navigation menus and where they're placed?",
        "I need to see the current version of a menu before editing it.",
        "List every menu with its status and item tree.",
        "Show me the menus and what locations they're assigned to.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- menus / navigation ----------------------------------------------------------------------
  "menus_update_menu_tree": {
    search: {
      keywords: "navigation nav menu header top link links add item items reorder site structure html markup custom style",
      queries: [
        "Can you rearrange the items in this menu?",
        "I need to replace the whole structure of a menu.",
        "How do I add a new link to an existing menu — do I need to list everything else too?",
        "Can you rename this menu while you're updating its items?",
        "How do I edit a menu's item tree?",
        "Can you write this menu as my own HTML so I can style it however I want?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
