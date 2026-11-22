import type { ToolMetadataById } from '@jini-ai/core';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** entries registration declarations; shared placement rationale is in the host tool-metadata aggregator. */
export const toolMetadata = {

  "collections_entry_create": {
    search: {
      keywords: "entry create new record item content add",
      queries: [
        "How do I add a new entry to a collection?",
        "Can you create a draft record under the 'Testimonials' type?",
        "I need to add a new item with these field values.",
        "How do I make a new collection entry that isn't published yet?",
        "Can you create an entry but keep it as a draft for now?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },

  "collections_entry_list": {
    search: {
      keywords: "entries records items content list all",
      queries: [
        "Show me all the entries for our 'Product' collection.",
        "What draft entries do we have in this collection type?",
        "Can I see a list of every entry, including unpublished ones?",
        "I want to browse the Collections list like the admin screen shows.",
        "What are the ids and slugs for entries under this content type?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },

  // Products and listings are operator vocabulary for collection entries.
  "collections_entry_publish": {
    search: {
      keywords: "publish live go public release draft entry post article product products listing",
      queries: [
        "How do I make this draft entry go live?",
        "Can you publish this collection item?",
        "I want this entry visible on the site now.",
        "How do I flip a draft to published status?",
        "Can you set the publish date on this entry to right now?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },

  "collections_entry_unpublish": {
    search: {
      keywords: "unpublish hide draft retract take down entry post",
      queries: [
        "How do I take this entry down without deleting it?",
        "Can you pull this published item back to unpublished?",
        "I want to hide this entry from the site but keep it around.",
        "How do I revert something back to draft after publishing it?",
        "Can you unpublish this collection item temporarily?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },

  "collections_entry_update": {
    search: {
      keywords: "entry record item content edit change save update field value",
      queries: [
        "How do I change the title on an existing collection entry?",
        "I need to update some fields on this entry without touching the rest.",
        "Can you fix the field values on this record?",
        "How do I edit an entry's data — will it fail if my version is out of date?",
        "I want to update just the fields I changed, not the whole entry.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
