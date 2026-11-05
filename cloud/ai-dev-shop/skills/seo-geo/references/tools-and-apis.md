# SEO/GEO Tools and API Reference

Curated list of tools and APIs for SEO and GEO optimization.

---

## Free Tools

### Schema Markup Generators

| Tool | URL | Features |
|------|-----|----------|
| **TechnicalSEO.com** | technicalseo.com/tools/schema-markup-generator | Multiple schema types, validation |
| **Rank Ranger** | rankranger.com/schema-markup-generator | FAQ, Article, Product schemas |
| **Merkle** | technicalseo.com/tools/schema-markup-generator | Comprehensive schema generator |
| **JSON-LD Generator** | jsonld.com | Simple schema builder |

### Validation Tools

| Tool | URL | Purpose |
|------|-----|---------|
| **Google Rich Results Test** | search.google.com/test/rich-results | Test schema markup |
| **Schema.org Validator** | validator.schema.org | Validate any schema |
| **Google Mobile-Friendly Test** | search.google.com/test/mobile-friendly | Mobile usability |
| **PageSpeed Insights** | pagespeed.web.dev | Core Web Vitals |

### SEO Audit Tools

| Tool | URL | Features |
|------|-----|----------|
| **SEOmator** | seomator.com/free-seo-audit-tool | Comprehensive free audit |
| **Screaming Frog (Free)** | screamingfrog.co.uk | Crawl up to 500 URLs |
| **Google Search Console** | search.google.com/search-console | Official Google data |
| **Bing Webmaster Tools** | bing.com/webmasters | Bing indexing data |

---

## Paid SEO Tools

### Comprehensive Platforms

| Tool | Price | Best For |
|------|-------|----------|
| **Ahrefs** | $99/mo+ | Backlink analysis, keyword research |
| **Semrush** | $139/mo+ | All-in-one SEO + GEO toolkit |
| **Moz Pro** | $99/mo+ | Domain authority, link building |
| **SE Ranking** | $65/mo+ | Affordable all-in-one |

### Content Optimization

| Tool | Price | Best For |
|------|-------|----------|
| **Surfer SEO** | $89/mo+ | Content optimization for AI |
| **Clearscope** | $170/mo+ | Enterprise content optimization |
| **Frase** | $15/mo+ | AI content briefs |
| **MarketMuse** | $149/mo+ | Content strategy |

---

## GEO / AI Visibility Tools

### AI Search Monitoring

| Tool | Price | Platforms |
|------|-------|-----------|
| **Profound** | $499/mo+ | ChatGPT, Perplexity, Claude, Gemini |
| **Otterly.ai** | Free trial | ChatGPT, Perplexity, Google AIO |
| **SE Ranking AI Toolkit** | Included | AI Overviews, ChatGPT |
| **Semrush AI Visibility** | Included | Google AIO, ChatGPT |
| **Peec AI** | Mid-tier | Sentiment + visibility |
| **Scrunch AI** | Varies | Brand tracking, citations |

### AI Visibility Features to Look For

- Citation tracking across AI platforms
- Prompt-level insights
- Source attribution
- Sentiment analysis
- Competitive benchmarking
- Actionable recommendations

---

## APIs for Automation

### Google APIs

| API | Purpose | Docs |
|-----|---------|------|
| **Search Console API** | Indexing status, search data | developers.google.com/webmaster-tools |
| **PageSpeed API** | Core Web Vitals data | developers.google.com/speed/docs/insights/v5/get-started |
| **Indexing API** | Request indexing | developers.google.com/search/apis/indexing-api |
| **Custom Search API** | Programmatic search | developers.google.com/custom-search |

### SEO Data APIs

| API | Purpose | Pricing |
|-----|---------|---------|
| **DataForSEO** | Comprehensive SEO data | Pay-per-use |
| **Moz API** | DA, PA, link data | Included with Moz |
| **Ahrefs API** | Backlinks, keywords | Included with Ahrefs |
| **SE Ranking API** | Rankings, audits | Included with SE Ranking |
| **SEO Review Tools API** | Various SEO checks | Free tier available |

### Schema/Metadata APIs

| API | Purpose | Pricing |
|-----|---------|---------|
| **Apify Metadata Extractor** | Extract meta, sitemap, robots | $12/mo+ |
| **Firecrawl** | Website crawling for SEO | Pay-per-use |

---

## Browser Extensions

### SEO Analysis

| Extension | Browser | Features |
|-----------|---------|----------|
| **SEOquake** | Chrome/Firefox | Quick SEO metrics |
| **MozBar** | Chrome | DA, PA, link data |
| **Ahrefs SEO Toolbar** | Chrome | Backlinks, keywords |
| **Detailed SEO Extension** | Chrome | Technical SEO checks |

### Schema Testing

| Extension | Browser | Features |
|-----------|---------|----------|
| **Structured Data Testing Tool** | Chrome | View page schema |
| **Schema Builder** | Chrome | Generate schema |

---

## Command Line Tools

### curl Commands for SEO Checks

```bash
# Check meta tags
curl -sL "https://example.com" | grep -E "<title>|<meta"

# Check robots.txt
curl -s "https://example.com/robots.txt"

# Check sitemap
curl -s "https://example.com/sitemap.xml"

# Check HTTP headers
curl -I "https://example.com"

# Check redirect chain
curl -sIL "https://example.com" | grep -E "HTTP|Location"

# Check page size
curl -sL "https://example.com" | wc -c

# Check load time
curl -o /dev/null -s -w "Total: %{time_total}s\n" "https://example.com"
```

### Using Google APIs via curl

```bash
# PageSpeed Insights (no API key needed for basic)
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com"

# With API key (more requests allowed)
curl "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://example.com&key=YOUR_API_KEY"
```

---

## Robots.txt Template for AI Bots

```
# Search Engines
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# AI Bots
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Applebot-Extended
Allow: /

# Sitemap
Sitemap: https://example.com/sitemap.xml
```

---

## Practical Tools

Use built-in shell tools, browser-based validators, and WebSearch rather than local helper scripts.

### Quick Page Inspection

```bash
curl -sL "https://example.com" | grep -E "<title>|<meta name=\"description\"|<meta property=\"og:|application/ld\\+json" | head -20
curl -s "https://example.com/robots.txt"
curl -s "https://example.com/sitemap.xml" | head -50
```

### Browser-Based Validation

```bash
open "https://search.google.com/test/rich-results?url={encoded_url}"
open "https://validator.schema.org/?url={encoded_url}"
open "https://www.google.com/search?q=site:{domain}"
open "https://www.bing.com/search?q=site:{domain}"
```

### Research Inputs

- Use WebSearch for keyword research, SERP review, and competitor comparison.
- Use public SEO platforms manually when you need paid metrics like backlink counts or keyword difficulty.

---

## Workflow Integration

### Using with OPC Skills

- Use the twitter skill to find current SEO tips.
- Use the reddit skill to find community discussions.
- Use WebSearch for keyword research and competitor analysis.

### Automation Ideas

1. **Weekly SEO audit** - Crawl site with curl, check for errors
2. **Schema monitoring** - Validate schema after deploys with Rich Results Test API
3. **Ranking tracking** - Monitor AI visibility with Otterly.ai or Profound
4. **Content freshness** - Flag outdated content based on dateModified
5. **Competitor monitoring** - Track competitor changes with DataForSEO API

---

## Resources

### Learning

| Resource | URL | Type |
|----------|-----|------|
| **Google SEO Guide** | developers.google.com/search/docs | Official |
| **Moz Beginner's Guide** | moz.com/beginners-guide-to-seo | Tutorial |
| **Backlinko** | backlinko.com/hub/seo | Advanced |
| **Search Engine Journal** | searchenginejournal.com | News |

### GEO Research

| Resource | URL | Type |
|----------|-----|------|
| **Princeton GEO Paper** | arxiv.org/abs/2311.09735 | Research |
| **GEO Guide (SingleGrain)** | singlegrain.com/geo | Guide |
| **AI Search Optimization (Semrush)** | semrush.com/blog/ai-search-optimization | Tutorial |

### Communities

| Community | Platform | Focus |
|-----------|----------|-------|
| **r/SEO** | Reddit | General SEO |
| **r/bigseo** | Reddit | Advanced SEO |
| **r/TechSEO** | Reddit | Technical SEO |
| **SEO Twitter** | Twitter | News, tips |
