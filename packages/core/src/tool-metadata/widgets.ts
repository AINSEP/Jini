import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** widgets registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  // --- widgets -------------------------------------------------------------------------------------
  "widgets_bind_region": {
    search: {
      keywords: "widget sidebar footer region area slot place put add section",
      queries: [
        "How do I set up a new widget area?",
        "Can you bind a new region key for widgets?",
        "If I bind a region that already exists, does it create a duplicate?",
        "I want to create an empty widget slot to fill later.",
        "How do I register a new widget region on the theme?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_create_instance": {
    search: {
      keywords: "widget gallery images photos grid carousel masonry create add new block sidebar footer",
      queries: [
        "Can you create a new widget?",
        "How do I make a new widget instance with a specific config?",
        "If I create a widget, does it automatically show up on the site?",
        "I want to set up a new widget of a certain type.",
        "Can you validate a widget's config against its schema when creating it?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_get_instance": {
    search: {
      keywords: "widget read view details one existing current where used which pages use uses used usage where banner",
      queries: [
        "Where is this widget actually being used on the site?",
        "Can you show me one widget's config and everywhere it's placed?",
        "I want to see a widget's current state plus its region placements.",
        "Is this widget embedded inline anywhere?",
        "Can you show me the full details for a single widget instance?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "widgets_get_region": {
    search: {
      keywords: "widget region read view current placements existing",
      queries: [
        "What widgets are placed in this specific region?",
        "Can you show me if any widget in this region is broken?",
        "I need the current version of a region before I update its placements.",
        "What's actually filling the sidebar widget area right now?",
        "Is a widget in this region missing or the wrong type?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "widgets_insert_embed": {
    search: {
      keywords: "widget embed insert add put inline post entry body content",
      queries: [
        "Can you embed a widget inside this post's body?",
        "How do I add an inline widget to a page's content?",
        "Can I put a widget inside another widget?",
        "What happens if I try to embed too many widgets in one document?",
        "How do I insert a widget reference into the middle of a page?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_list_instances": {
    search: {
      keywords: "widget widgets list existing placed blocks",
      queries: [
        "What widgets do we have set up on the site?",
        "Can you show me only active widgets, not trashed ones?",
        "I want to filter widgets by type.",
        "Show me every widget instance and its current config.",
        "What widgets are currently active in the workspace?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "widgets_list_regions": {
    search: {
      keywords: "widget regions areas slots sidebar footer available",
      queries: [
        "What widget regions are currently bound on the site?",
        "Can you show me each region and how many widgets are placed there?",
        "I want to see which theme areas have widgets assigned.",
        "Are there any regions that got orphaned after a theme switch?",
        "What widget slots exist right now?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "widgets_remove_embed": {
    search: {
      keywords: "widget embed remove delete take out inline post body",
      queries: [
        "Can you remove this inline widget from the page body?",
        "How do I delete one embedded widget without deleting the widget itself?",
        "I want to take out a widget embed by its placement id.",
        "Can you pull a widget out of the page content?",
        "How do I remove an inline widget slot from an entry?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_reorder_embeds": {
    search: {
      keywords: "widget embed reorder rearrange change order position swap",
      queries: [
        "Can you swap which widget shows in each embed slot?",
        "How do I change the widgets assigned to existing embed slots without changing the layout?",
        "I want to reassign what fills each inline widget spot in a document.",
        "Can this add new embed slots, or only reshuffle existing ones?",
        "Do I need to specify a widget for every single slot, or can I skip some?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_set_region_placements": {
    search: {
      keywords: "widget region replace set whole list sidebar footer bulk update",
      queries: [
        "How do I change which widgets show up in the sidebar?",
        "Can you replace the whole list of widgets in this region?",
        "What happens if I reference a widget that's trashed in the placement list?",
        "I need to see the current placements before I overwrite them, right?",
        "How do I reorder or swap out widgets in a region all at once?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "widgets_trash_instance": {
    search: {
      keywords: "widget delete remove trash soft delete remove delete take off widget footer sidebar header",
      queries: [
        "Can you delete this widget?",
        "What happens to the places this widget is used if I trash it?",
        "How do I remove a widget instance — is it a hard delete?",
        "Can I trash a widget even if it's currently placed somewhere?",
        "Is there a way to permanently purge a widget, or just trash it?",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "widgets_update_instance": {
    search: {
      keywords: "widget update edit change config settings instance",
      queries: [
        "Can you change the settings on this existing widget?",
        "How do I edit a widget's config?",
        "Can I change what type this widget is?",
        "I want to replace a widget's configuration entirely.",
        "How do I update the content inside a widget instance?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
