---
name: search-visibility-source-ledger
description: Tracks factual SEO/GEO/AEO and AI crawler claims with source URL, verification date, claim tier, refresh window, and allowed audit use.
last_updated: 2026-05-19
---

# Search Visibility Source Ledger

This ledger is the source of truth for platform-specific search visibility claims used by `skills/seo-geo/SKILL.md` and the Search Visibility agent.

## Claim Tiers

| Tier | Definition | Refresh Window | Can Be Required? |
|---|---|---|---|
| T1 Durable | Stable web fundamentals and broadly supported implementation rules | 12 months | Yes |
| T2 Platform | Official platform documentation or current platform-owned announcements | 90 days | Yes while current |
| T3 Research | Peer-reviewed research, vendor studies, or measured behavior outside official platform docs | 180 days | No, Advisory only |
| T4 Emerging | Unratified conventions, community proposals, or weakly adopted AI discovery files | 60 days | No, Advisory only |

## Active Claims

Most T2 claims below were initialized from one 2026-05-19 research pass, so their first refresh due date intentionally lands together. A full Search Visibility refresh before 2026-08-17 satisfies the initial T2 batch; later claim updates may stagger dates by platform.

| Claim ID | Claim Summary | Tier | Source | Last Verified | Refresh Due | Audit Use |
|---|---|---|---|---|---|---|
| GAI-001 | Google says no special AI-only markup or files are required for Google AI features; foundational SEO applies. | T2 Platform | https://developers.google.com/search/docs/appearance/ai-features?hl=en | 2026-05-19 | 2026-08-17 | Required only for Google-specific advice while current |
| GAI-002 | Google AI feature eligibility depends on the page being indexed and snippet-eligible; controls include `nosnippet`, `data-nosnippet`, `max-snippet`, and `noindex`. | T2 Platform | https://developers.google.com/search/docs/appearance/ai-features?hl=en | 2026-05-19 | 2026-08-17 | Required only for Google-specific advice while current |
| GJS-001 | Googlebot crawls, renders, and indexes pages; blocked resources or pages can prevent rendering and indexing. | T2 Platform | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | 2026-05-19 | 2026-08-17 | Required while current |
| GJS-002 | SSR, static rendering, or prerendering can help users and crawlers access content faster; not every retrieval system should be assumed to execute complex JavaScript. | T2 Platform | https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics | 2026-05-19 | 2026-08-17 | Required for public rendering decisions while current |
| GSD-001 | Google recommends JSON-LD for structured data where possible. | T2 Platform | https://developers.google.com/search/docs/appearance/structured-data/sd-policies | 2026-05-19 | 2026-08-17 | Required while current |
| GSD-002 | Structured data must represent visible page content, be current, and avoid misleading or irrelevant markup. | T2 Platform | https://developers.google.com/search/docs/appearance/structured-data/sd-policies | 2026-05-19 | 2026-08-17 | Required while current |
| OAI-001 | `OAI-SearchBot` is used for OpenAI/ChatGPT search visibility, separate from `GPTBot` training access. | T2 Platform | https://platform.openai.com/docs/bots | 2026-05-19 | 2026-08-17 | Required only when OpenAI search visibility is in scope and current |
| OAI-002 | `GPTBot` is for OpenAI training use; blocking it is a content-use policy choice, not the same as blocking search retrieval. | T2 Platform | https://platform.openai.com/docs/bots | 2026-05-19 | 2026-08-17 | Advisory or policy guidance unless search/training access is explicit |
| OAI-003 | `ChatGPT-User` is user-directed and may not follow the same automatic crawler rules; use `OAI-SearchBot` for Search opt-out/allow decisions. | T2 Platform | https://platform.openai.com/docs/bots | 2026-05-19 | 2026-08-17 | Required only when OpenAI user-action behavior is in scope and current |
| ANT-001 | Anthropic documents separate crawler categories for training, user-directed retrieval, and search optimization. | T2 Platform | https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler | 2026-05-19 | 2026-08-17 | Required only for Anthropic-specific advice while current |
| PPLX-001 | Perplexity documents `PerplexityBot` for surfacing and linking sites in answers, and separate user-directed behavior. | T2 Platform | https://docs.perplexity.ai/docs/resources/perplexity-crawlers | 2026-05-19 | 2026-08-17 | Required only for Perplexity-specific advice while current |
| BING-001 | Bing Webmaster Tools includes AI Performance reporting for AI citations, cited pages, grounding queries, and page-level citation activity. | T2 Platform | https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview | 2026-05-19 | 2026-08-17 | Advisory unless Bing data is available |
| GEXT-001 | `Google-Extended` controls Gemini/Vertex training and grounding use; it does not affect Google Search inclusion or ranking. | T2 Platform | https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers | 2026-05-19 | 2026-08-17 | Required only for Google-Extended policy advice while current |
| GEO-001 | The Princeton/IIT Delhi/Georgia Tech/Allen Institute GEO paper studied methods that can increase visibility in generative engine responses under study conditions. | T3 Research | https://arxiv.org/abs/2311.09735 | 2026-05-19 | 2026-11-15 | Advisory only; do not use study percentages as guaranteed production effects |
| LLMSTXT-001 | `llms.txt` is an emerging community proposal, not a required or broadly official platform prerequisite in this ledger. | T4 Emerging | https://llmstxt.org/ | 2026-05-19 | 2026-07-18 | Advisory awareness only |

## Retired Or Superseded Claims

| Claim ID | Original Claim | Reason | Retired On |
|---|---|---|---|
| LEGACY-001 | Exact platform ranking weights and visibility boost percentages from older SEO/GEO guides are hard audit findings. | Replaced by tiered source governance; exact lifts are research/advisory unless re-verified for the project context. | 2026-05-19 |

## Update Log

| Date | Updater | Change |
|---|---|---|
| 2026-05-19 | Coordinator(Cowork) | Initial ledger from official Google/OpenAI/Anthropic/Perplexity/Bing sources and GEO research. |
