---
name: seo-geo
description: Search visibility and indexability for public web surfaces across traditional SEO, generative engines, answer engines, AI retrieval, and chatbot discovery. Use only for public-facing pages, docs, blogs, ecommerce/product pages, directories, marketing surfaces, public app/tool landing pages, app-store metadata, or explicit user requests.
last_verified: 2026-05-19
verification_required: Re-check the source ledger before using platform-specific crawler, AI-answer, ranking, or protocol claims as findings.
---

# Search Visibility / SEO-GEO-AEO Indexability

This skill keeps public web surfaces understandable, crawlable, citeable, and navigable by search engines, answer engines, AI search systems, chatbots, AI browsers, and retrieval tools.

Use it conservatively. For most internal apps, private admin surfaces, backend-only work, and native-only screens, this skill is out of scope unless the user explicitly asks for public discoverability.

## Required Freshness Gate

Before relying on platform-specific claims, read:

- `references/search-visibility-source-ledger.md`
- `references/search-visibility-refresh-policy.md`

If a claim is stale, unsupported, or absent from the ledger, downgrade it to Advisory or ignore it. Do not create Required findings from stale SEO/GEO/AEO research, bot names, platform behavior, ranking factors, or emerging protocol claims.

## Claim Tiers

| Tier | Meaning | Can Block? | Examples |
|---|---|---|---|
| T1 Durable | Web fundamentals that change slowly | Yes | crawlable HTML, stable URLs, canonical URLs, semantic headings, accessible names, visible structured data |
| T2 Platform | Official platform-documented behavior | Yes only while current | Google AI feature controls, OpenAI/Anthropic/Perplexity crawler purposes, Bing AI reporting surfaces |
| T3 Research | Peer-reviewed or vendor research, observed behavior, optimization studies | No | GEO method lift percentages, citation-pattern studies, platform preference claims |
| T4 Emerging | Unratified or weakly adopted conventions | No | `llms.txt`, `ai.txt`, new crawler conventions not documented by major platforms |

Hard audit findings must be grounded in T1 or current T2 evidence. T3 and T4 may inform recommendations, but they are Advisory by default.

## When To Activate

Activate for:

- public websites, docs, blogs, directories, ecommerce/product pages, and marketing pages
- public app/tool landing pages and app-store metadata
- public help centers, changelogs, API docs, tutorials, and knowledge bases
- explicit user requests for SEO, GEO, AEO, AI search visibility, chatbot discoverability, indexing, schema, metadata, robots, or sitemap work

Do not activate for:

- internal dashboards or private admin areas
- authenticated-only product screens
- backend-only features
- native-only app screens with no public web discovery surface
- generic frontend work where discoverability is not a goal

## Durable Implementation Rules

These rules are safe defaults for implementers and reviewers.

### Rendered Content

- Critical public content should be available in initial HTML through SSR, SSG, ISR, prerendering, or an equivalent server-rendered path.
- CSR-only pages are a discoverability risk when crawlers or AI retrieval systems do not execute complex JavaScript.
- The rendered page must expose the same primary content, links, titles, descriptions, and structured data that users see.
- Do not use hidden text, cloaking, AI-only content, or schema for content that is not visible to users.

### Crawlability And Routing

- Public pages need stable, durable URLs.
- Important pages must be reachable through crawlable links, not only client-side click handlers, search widgets, or JS-only navigation.
- `robots.txt`, `noindex`, auth gates, redirects, canonical tags, and CDN/WAF rules must align with the discoverability goal.
- A sitemap should include important public canonical URLs and should not include private, duplicate, redirected, or intentionally noindexed pages.
- If a staging or production URL is available, verify crawler access with live HTTP checks as well as static source review. Edge WAF and bot-fight rules often cannot be detected from repo files.

### Metadata

- Each public page should have a unique `<title>`, meta description, canonical URL, and Open Graph metadata when sharing or preview quality matters.
- Metadata should match the actual visible page purpose.
- Public docs and content pages should expose meaningful `datePublished` and `dateModified` only when those dates are truthful and maintained.
- Avoid keyword stuffing and misleading metadata.

### Semantic HTML And Accessibility

- Use one clear H1 per primary page view and a logical H2/H3 outline.
- Use landmarks (`main`, `nav`, `header`, `footer`, `aside`) and descriptive link text.
- Images and media that carry meaning need accessible text equivalents.
- Accessibility and search visibility overlap: if a page is hard for assistive technology to parse, it is often hard for crawlers and retrieval agents to parse too.

### Structured Data

- Prefer JSON-LD where the stack supports it.
- Structured data must match visible content, stay current, and avoid irrelevant or misleading schema.
- Choose schema types from the page's actual purpose, such as `WebPage`, `Article`, `Product`, `Organization`, `SoftwareApplication`, `FAQPage`, `BreadcrumbList`, or `VideoObject`.
- Validate schema when tools are available. If external validators are unavailable, at minimum check JSON syntax, schema placement, visible-content parity, and duplicate/conflicting nodes.

### Content Extraction

- Put a direct answer or summary near the top of explainers, docs, FAQs, and knowledge-base pages.
- Use short, focused paragraphs, descriptive headings, lists, and tables where they improve extraction.
- Cite authoritative sources for factual claims in public content when appropriate.
- Separate marketing claims from factual, source-backed statements.

## Platform-Specific Guidance

Use current ledger entries before applying these checks.

- Distinguish training crawlers, search/retrieval crawlers, and user-directed fetchers.
- Allowing a crawler can make retrieval possible, but it does not guarantee ranking, citation, or inclusion.
- Blocking a training crawler may be desirable for content-control reasons; blocking a search/retrieval crawler can reduce AI search visibility.
- User-directed fetchers may behave differently from automatic crawlers and may not follow the same robots rules.
- `llms.txt` and `ai.txt` are awareness items unless current official platform docs or project policy make them required.

## Audit Workflow

1. Confirm the target surface is public and discoverability is in scope.
2. Read the source ledger and refresh policy. Mark stale T2/T3/T4 claims before auditing.
3. Inventory public route/page types and decide whether the audit is URL-based, source-based, or both.
4. Check rendering strategy and initial HTML for critical content.
5. Check crawlability: robots, sitemap, canonical URLs, noindex, redirects, internal links, and live crawler-style HTTP access when URLs are available.
6. Check metadata, structured data, semantic outline, accessibility landmarks, and content extraction.
7. Separate findings into Required, Recommended, and Advisory.
8. Route fixes to the right owner: Programmer, Docs, Web Design, Software Architect, DevOps, or Security.
9. Report quantitative metrics alongside qualitative findings.

## Live Verification Examples

Use live checks only when the user has provided a staging or production URL, or when local runtime self-validation has started the app.

```bash
curl -sI "https://example.com/"
curl -sL "https://example.com/robots.txt"
curl -sL "https://example.com/sitemap.xml" | head -50
curl -sL -A "OAI-SearchBot/1.0" "https://example.com/" | head -40
curl -sL -A "PerplexityBot/1.0" "https://example.com/" | head -40
```

If a bot-style request returns 403/429 or substantially different content while normal requests succeed, flag it as a live crawler-access concern and route likely CDN/WAF issues to DevOps.

## Quantitative Metrics

Report the metrics you can measure from available evidence:

| Metric | Definition |
|---|---|
| Public route inventory | Count of public routes/pages audited |
| Indexation eligibility | Percent of audited public pages not blocked by robots, auth, noindex, hard errors, or broken redirects |
| Initial HTML coverage | Percent of audited public pages whose primary content appears before client JS execution |
| Metadata completeness | Percent with title, description, canonical, and share metadata where applicable |
| Structured data coverage | Percent of eligible page types with valid and visible-content-matching JSON-LD |
| Semantic outline coverage | Percent with one H1 and logical heading order |
| Accessibility extraction coverage | Percent with landmarks, descriptive links, and meaningful alt text for important media |
| Sitemap coverage | Percent of canonical public pages represented correctly in sitemap |
| Crawler access findings | Count of robots, CDN, WAF, or HTTP status issues by crawler/user-agent class |
| Search-console evidence | Google Search Console, Bing Webmaster Tools, or AI Performance metrics when provided by the user |

## Finding Classification

- **Required:** Blocks or materially breaks discoverability for in-scope public pages. Examples: critical pages noindexed by mistake, primary content absent from initial HTML, schema contradicts visible content, public route behind accidental auth, broken canonical loops, production WAF blocks target retrieval crawlers when discoverability is required.
- **Recommended:** Improves durable discoverability but does not block it. Examples: incomplete OG metadata, weak heading hierarchy, missing optional schema, thin summaries, missing sitemap entry for a low-priority page.
- **Advisory:** Platform-volatile or research-based suggestions. Examples: GEO method experiments, emerging protocol suggestions, non-official platform observations, stale T2/T3 claims.

## Output Template

```markdown
# Search Visibility Report

Metadata:
- audited_surface:
- audit_type: url | source | mixed
- last_verified:
- source_ledger_status:
- public_scope_confirmed: yes | no

## Metrics
| Metric | Result | Evidence |
|---|---|---|

## Required Findings
| Finding | Evidence | Route |
|---|---|---|

## Recommended Findings
| Finding | Evidence | Route |
|---|---|---|

## Advisory Notes
| Note | Source tier | Freshness |
|---|---|---|

## Owner Routing
| Owner | Work |
|---|---|

## Refresh Notes
- stale_claims:
- claims_not_evaluated:
```

## Legacy References

The older reference files in this folder remain useful as background, but the source ledger is the authority for audit findings:

- `references/search-visibility-source-ledger.md`
- `references/search-visibility-refresh-policy.md`
- `references/schema-templates.md`
- `references/seo-checklist.md`
- `references/tools-and-apis.md`
- `references/google-docs-summary.md`
- `references/geo-research.md` (background only unless refreshed into the ledger)
- `references/platform-algorithms.md` (legacy/background only; do not use for hard findings without fresh ledger evidence)
