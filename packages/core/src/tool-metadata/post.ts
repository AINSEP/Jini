import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** post registration declarations; shared placement rationale lives in the host aggregator. */
export const toolMetadata = {
  "content_post_create": {
    search: {
      keywords: "post blog article page pages about us contact write new create draft copy duplicate clone schedule featured image",
      queries: [
        "Can you draft a new blog post for me?",
        "How do I create a new page on the site?",
        "Can you make a new post that's published right away?",
        "I need a new page with this title, and can the URL be auto-generated?",
        "How do I add a brand-new post to the site?",
        "Write a post and schedule it to publish on Friday morning.",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "content_post_delete": {
    search: {
      keywords: "post blog article delete remove trash",
      queries: [
        "Can you delete this blog post?",
        "How do I remove a page from the site?",
        "I want to trash this post — will someone need to confirm it?",
        "Can you get rid of this old page for me?",
        "How do I delete a post that's cluttering the list?",
      ],
    },
    approval: { class: 'trash', confirmation: 'policy' },
  },
  "content_post_get": {
    search: {
      keywords: "post page article lookup find fetch read single one by id details specific copy duplicate clone",
      queries: [
        "Can you open up this specific post's full content?",
        "I have the id, show me the whole page body.",
        "Show me the details of this one page including its current version.",
        "Can you pull up the full text of this post by its id?",
        "I want to read the complete content of one page, not a summary.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_post_list": {
    search: {
      keywords: "post posts blog articles list all recent copy duplicate clone",
      queries: [
        "Show me every post we have, drafts included.",
        "Can I get the full inventory of pages on the site?",
        "List every draft and published post.",
        "Give me the complete body text for all our pages.",
        "How many posts do we have total?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "content_post_preview": {
    search: {
      keywords: "preview draft before publishing how will it look render template unpublished see page unsaved edits",
      queries: [
        "Preview this unpublished draft before publishing it.",
        "Render unsaved edits through the page's theme template.",
        "How will this draft page look once published?",
        "Try another template on this post without saving changes.",
        "Show a draft post preview with its pending body.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- content / collections --------------------------------------------------------------------------
  // Fresh UI callbacks are safe: the handler is a pure query and enforces content.read.
  "content_post_search": {
    search: {
      keywords: "post posts blog article articles find search title lookup copy duplicate clone",
      queries: [
        "Where's the page about our pricing on the site?",
        "I don't know the exact URL, can you find the post that mentions refunds?",
        "Search our posts and pages for anything about shipping.",
        "Can you find a page by what it's about instead of its title?",
        "What page or post talks about our return policy?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
    mcpUi: { redeemable: true },
  },
  "content_post_update": {
    search: {
      keywords: "post page pages blog article edit change update publish draft unpublish unpublished take down offline hide draft status publish fix typo latest title template layout assign",
      queries: [
        "Change which theme template this page uses.",
        "Unpublish this page for now, hide the page and take it offline.",
        "Can you change the title of this page?",
        "I need to fix a typo in the latest blog post title.",
        "How do I publish this post by updating its status?",
        "Publish my existing draft post about this topic.",
        "Can you rewrite this page's body and slug at the same time?",
        "How do I take a live post back to draft?",
        "Can you unpublish this page for now and put it back in draft?",
        "Can you schedule this post to go live next Monday at 9am?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "content_stats": {
    search: {
      keywords: "how many count number of posts pages articles statistics stats word count words long length percentage chart pie breakdown",
      queries: [
        "How many posts and pages are on my site?",
        "Give me a pie chart breakdown of posts versus pages.",
        "What is the word count of my articles?",
        "Which articles are longest and what is their average length?",
        "Count drafts, published content, collection entries and media.",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
