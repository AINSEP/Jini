import type { ToolMetadataById } from '@jini-ai/core';
import type { ToolApprovalPolicy } from '@jini-ai/core/contracts/site/tool-metadata-approval-policy';

/** taxonomy registration declarations; shared placement rationale is in the host's tool-metadata index. */
export const toolMetadata = {
  "taxonomy_get_term": {
    search: { keywords: "term tag category details parent taxonomy id read one" },
    approval: { class: 'read', confirmation: 'direct' },
  },

  // --- taxonomy -----------------------------------------------------------------------------------
  "taxonomy_assign_terms": {
    search: {
      keywords: "tag tags label labels categorize category categories assign article post topic",
      queries: [
        "Can you tag this post with a couple categories?",
        "How do I assign tags to a piece of content?",
        "If I assign the same tag twice, does it duplicate?",
        "Can this remove tags too, or only add them?",
        "How do I attach existing terms to a collection entry?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "taxonomy_create_taxonomy": {
    search: {
      keywords: "taxonomy category system tags group create new",
      queries: [
        "Can you create a new tag group?",
        "How do I set up a new hierarchical category taxonomy?",
        "I want a flat taxonomy for simple tags, not a nested one.",
        "Can you add a brand-new taxonomy to the workspace?",
        "How do I create a new grouping system for content?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "taxonomy_create_term": {
    search: {
      keywords: "tag category term topic create new label",
      queries: [
        "Can you add a new tag under this taxonomy?",
        "How do I create a subcategory under an existing category?",
        "Can you add a term with a parent — does it check the parent is in the same taxonomy?",
        "I want to add a new term to our category list.",
        "How do I create a new tag term?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  // Deliberately UNWIRED (never agent-callable, token-gated confirmation step — see file header);
    // entry added for consistency per this dispatch's explicit instruction.
  "taxonomy_execute_merge_term": {
    title: 'Merge these terms',
    summary: 'This moves content to the destination term and permanently removes the source term.',
    search: {
      keywords: "tag category term merge combine execute run confirm confirmed apply proceed",
    },
    approval: { class: 'delete', confirmation: 'plan' },
  },
  "taxonomy_get_assigned_terms": {
    search: {
      keywords: "which tags categories does this post have assigned terms show tags of page",
      queries: [
        "Which tags does this post have?",
        "Show assigned categories for this page.",
        "Read assigned taxonomy terms for this collection entry.",
        "What categories are on this post?",
        "Show the names of the terms already attached to this content.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "taxonomy_list": {
    search: {
      keywords: "tags categories taxonomies topics labels list",
      queries: [
        "What categories and tags do we have?",
        "Can you show me all our taxonomies and their terms?",
        "I want to see the full category and tag structure.",
        "What terms exist under each taxonomy?",
        "Show me everything on the Categories and Tags screen.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "taxonomy_plan_merge_term": {
    search: {
      keywords: "tag category term merge combine duplicate preview before",
      queries: [
        "What would happen if I merged these two tags together?",
        "Can you preview a term merge before actually doing it?",
        "How much overlap is there between these two categories if I merge them?",
        "Can this tool actually perform the merge, or just show me what would happen?",
        "What content would lose its duplicate tag assignment if I merge these terms?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "taxonomy_rename_term": {
    search: {
      keywords: "tag category term rename edit change name",
      queries: [
        "Can you rename this tag?",
        "How do I fix a typo in a category name?",
        "Can you relabel a term without changing its parent or taxonomy?",
        "I want to rename an existing term in place.",
        "How do I change the display name of a category?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "taxonomy_unassign_terms": {
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
