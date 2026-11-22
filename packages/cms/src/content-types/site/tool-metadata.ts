import type { ToolMetadataById } from '@jini-ai/core';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** content-types registration declarations; shared placement rationale is in the host tool-metadata aggregator. */
export const toolMetadata = {
  "collections_content_type_define": {
    search: {
      keywords: "content type custom fields schema model post type kind of content structure define build register new new content type collection kind model schema team staff products bio fields custom",
      queries: [
        "How do I add a brand new content type to the CMS?",
        "We need a new kind of entry for 'Events' — how do I register that?",
        "Can you set up a new content model with its own fields?",
        "I want to create a custom content type from scratch.",
        "How do I register a new entry schema in the workspace?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "collections_content_type_deprecate": {
    search: {
      keywords: "content type retire stop using disable old outdated no longer need freeze",
      queries: [
        "How do I stop people from creating new entries of a certain type?",
        "We don't want any more 'Legacy Post' entries made, can you retire that type?",
        "Can you mark this content type as deprecated?",
        "I want to phase out an old content type without deleting existing entries.",
        "How do I block new entries for a content type but keep the old ones?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "collections_content_type_list": {
    search: {
      keywords: "content types schema models available what content kinds exist fields structure collections collection list what have",
      queries: [
        "What content types do we have set up on the site?",
        "Where can I see all my content type schemas and their current version?",
        "Is the 'Recipe' content type still active or did someone retire it?",
        "I need the current version number for a content type before I edit it.",
        "Can you show me every content type, including old ones nobody uses anymore?",
        "Which collections / content types do I have?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "collections_content_type_reactivate": {
    search: {
      keywords: "content type bring back restore undeprecate enable again turn back on",
      queries: [
        "I deprecated a content type by mistake, can you turn it back on?",
        "How do I bring back a retired content type?",
        "Can you make a deprecated content type active again?",
        "We need to start using that old content type again.",
        "How do I undo a content type deprecation?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "collections_content_type_tombstone": {
    search: {
      keywords: "content type delete remove permanently destroy get rid of",
      queries: [
        "How do I permanently get rid of a deprecated content type?",
        "Can you fully remove a content type and its indexes?",
        "We're done with this content type forever, how do I tear it down?",
        "How do I clean up the search indexes for an old content type?",
        "Is there a way to finalize deleting a content type that's already deprecated?",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "collections_content_type_update_fields": {
    search: {
      keywords: "content type fields schema add remove change edit structure update model rename field add field new field fields column property collection products price schema",
      queries: [
        "I need to change the fields on an existing content type.",
        "How do I add a new field to the 'Product' content type?",
        "Can you replace the whole schema for this content type?",
        "The fields on our content type are wrong, how do I fix them?",
        "I want to overwrite the field list for a content type.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // --- content types (custom fields / schema) -----------------------------------------------------------
    // Deliberately UNWIRED (never agent-callable, token-gated destructive removal — see file header);
    // entries added for consistency, same reasoning as backup_execute_restore above.
  "collections_plan_cleanup": {
    search: {
      keywords: "content type content types cleanup clean up purge wipe delete permanently preview plan check what would happen before dry run eligible eligibility tombstoned old unused",
    },
  },
  "collections_execute_cleanup": {
    search: {
      keywords: "content type content types cleanup clean up purge wipe delete permanently erase get rid of remove run execute confirm confirmed tombstoned old unused rows records data",
    },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
