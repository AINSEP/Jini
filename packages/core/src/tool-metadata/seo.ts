import type { ToolMetadataById } from '../tool-metadata-types.js';
import type { ToolApprovalPolicy } from '../contracts/site/tool-metadata-approval-policy.js';

/** seo registration declarations; shared placement rationale is in the host aggregator. */
export const toolMetadata = {
  "seo_analyze_entry": {
    search: {
      keywords: "seo search results ranking google visibility not showing up indexed problems audit page",
      queries: [
        "How's this page's SEO score?",
        "What SEO issues does this page have, like a missing description?",
        "Can you audit this entry's search-engine metadata?",
        "Is this page missing anything important for SEO?",
        "Can you grade this page's SEO out of 100?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "seo_get_entry_meta": {
    search: {
      keywords: "seo meta title description tags page preview snippet",
      queries: [
        "What SEO title and description is actually showing for this page?",
        "Can you show me the effective meta tags for this entry?",
        "What's the resolved Open Graph and Twitter card data for this page?",
        "I want to see the final SEO values after overrides are applied.",
        "What does the JSON-LD look like for this specific entry?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  "seo_get_settings": {
    search: {
      keywords: "seo settings current site wide defaults meta social",
      queries: [
        "What are our site-wide SEO defaults?",
        "What's our default Open Graph image set to?",
        "Is the sitemap toggle turned on for the whole site?",
        "What do our robots.txt custom rules look like?",
        "What's the title template applied across all pages?",
      ],
    },
    approval: { class: 'read', confirmation: 'direct' },
  },
  // --- seo ---------------------------------------------------------------------------------------
  "seo_regenerate_sitemap": {
    search: {
      keywords: "sitemap google search engine index rebuild regenerate crawl submit",
      queries: [
        "Can you force the sitemap to rebuild right now?",
        "Our sitemap seems stale, can you refresh it?",
        "How do I bypass the sitemap cache and regenerate it immediately?",
        "Can you rebuild the sitemap without losing any entries?",
        "I just changed a bunch of pages, can you regenerate the sitemap now?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "seo_set_entry_overrides": {
    search: {
      keywords: "seo meta title description override page tags hide google noindex robots search engines index indexing exclude",
      queries: [
        "Can you set a custom SEO title for just this one page?",
        "I want to override the meta description on this entry.",
        "How do I mark this page as noindex?",
        "Can you set a canonical URL for this entry — does that also refresh the sitemap?",
        "How do I override SEO fields for one page without touching the site defaults?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
  "seo_set_settings": {
    search: {
      keywords: "seo settings change update site wide defaults meta social robots",
      queries: [
        "Can you update our default meta description for the whole site?",
        "How do I change the site-wide title template?",
        "Can you turn off the sitemap for the whole site?",
        "I want to update our robots.txt rules — will it fail entirely if one field is wrong?",
        "How do I set a new default social share image sitewide?",
      ],
    },
    approval: { class: 'edit', confirmation: 'direct' },
  },
} as const satisfies ToolMetadataById<ToolApprovalPolicy>;
