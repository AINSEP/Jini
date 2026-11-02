# Discovery and classification

Version: 1.0.0 (2026-10-08)

Everything here is read-only. Nothing in this file writes to this site.

## 1. robots.txt

Read `<origin>/robots.txt` with the page reader, raw.

- Every `Sitemap: <url>` line (case-insensitive, any position in the file) is a sitemap to read.
- `Disallow:` rules under `User-agent: *` apply to this import. A URL whose path starts with a
  disallowed prefix is classified **skip** with the reason "disallowed by robots.txt".
- A 404 robots.txt is normal: continue with `<origin>/sitemap.xml`.

## 2. Sitemaps

Read each sitemap with the page reader, raw.

- `<urlset>`: each `<url>` has a `<loc>` (the page) and an optional `<lastmod>` (a fallback date
  for posts with no date of their own; never the primary date).
- `<sitemapindex>`: each `<sitemap><loc>` is a child sitemap. Fetch them. Platforms split
  them by type, and the child sitemap's own name is a strong classification hint:
  `post-sitemap.xml`, `posts.xml`, `blog-posts-sitemap.xml` hold posts; `page-sitemap.xml`,
  `pages.xml` hold pages; `category-sitemap.xml`, `tag-sitemap.xml`, `author-sitemap.xml`,
  `product-sitemap.xml` hold things to skip.
- Ignore `<image:image>` and `<video:video>` children here; images are taken from the pages.
- A sitemap URL on another host is not followed.

## 3. Crawl fallback (no usable sitemap)

Fetch the homepage with `format: "html"` and walk its `links` breadth-first:

- Same host only (`internal: true`). `www.` and the bare domain count as the same host.
- Skip any link that would be skipped by § 5 before fetching it.
- Cap: **50 pages** by default. When the cap is reached, stop crawling, import what was found,
  and say in the report how many more links were left (the owner can ask for the rest).
- Never submit forms, follow `mailto:`/`tel:`/`javascript:` links, or request URLs with a
  query string that changes state (`?add-to-cart=`, `?action=`, `?logout`).

## 4. Normalization

Before classifying, reduce every URL to one canonical form:

- Lower-case the scheme and host; drop default ports; drop the `#fragment`.
- Drop tracking parameters (`utm_*`, `fbclid`, `gclid`, `ref`, `mc_*`). A URL that
  still has a query string after that is usually a filter or search view: skip it.
- Treat `/about` and `/about/` as the same URL. Treat `/index.html` as its folder.
- If the fetched page declares `<link rel="canonical">` on the same host, use that URL as the
  identity and drop the duplicates that point at it.

## 5. Classification

Decide in this order. The first rule that matches wins. Record the rule as the reason.

### Skip

| Rule id | Matches | Why |
|---|---|---|
| `skip-archive` | a path segment `tag`, `tags`, `category`, `categories`, `author`, `authors`, `archive`, `archives` | generated listing; this site builds its own from the imported taxonomy |
| `skip-pagination` | a `page/<n>` path, or a `?page=` / `?paged=` query | duplicate of a listing |
| `skip-feed` | a path segment `feed` or `rss`, or a path ending `.xml` / `.rss` / `.atom` | machine feed |
| `skip-commerce-account` | a path segment `cart`, `checkout`, `basket`, `account`, `my-account`, `login`, `logout`, `signin`, `signup`, `register`, `search` | per-visitor or transactional page |
| `skip-platform` | a path starting with `wp-admin`, `wp-json`, `wp-content`, `wp-login.php`, `xmlrpc.php`, `_api`, `static` | platform internals |
| `skip-file` | a path ending in a non-page file type (`.pdf`, `.jpg`, `.png`, `.zip`, ...) | not a page; images come in through the pages that use them |
| `skip-error` | the fetch returned a status other than 200, or `finalUrl` is on another host | unreachable or off-site |
| `skip-duplicate` | same title and nearly the same text as a URL already planned (for example a legal page published at two addresses) | keep the first, list the twin as skipped |

### Post

A URL is a **post** when any of these holds:

| Rule id | Signal |
|---|---|
| `post-path-segment` | a path segment `blog`, `news`, `journal`, `articles`, `posts`, `stories`, `updates`, `insights` **followed by a further segment** (the bare `/blog/` itself is the post listing: skip it with `skip-archive` wording "post listing") |
| `post-date-path` | a `/YYYY/MM/` or `/YYYY/MM/DD/` segment pair in the path |
| `post-markup` | `og:type` is `article`, or the page has `<article>` with a `<time datetime>` or `article:published_time`, or JSON-LD `@type` `BlogPosting` / `NewsArticle` / `Article` |
| `post-sitemap` | it was listed in a post sitemap (§ 2) |

### Page

Everything else that returned 200 HTML is a **page** (`page-default`). The homepage is always a
page, whatever its markup says (`page-home`).

Legal pages (privacy, terms, cookies, imprint) are pages. If this site already has a page
for the same purpose, the plan offers "update existing" or "skip"; never silently create a
second privacy policy.

## 6. Post details

- **Date**, in this order: `article:published_time`, JSON-LD `datePublished`, the first
  `<time datetime>` inside the article, a `/YYYY/MM/DD/` path, then the sitemap `<lastmod>`.
  Always write it with a timezone offset (`2025-03-14T00:00:00Z` when only a day is known).
- **Author**: `article:author`, JSON-LD `author.name`, or a byline element. Keep the author's display
  name and whether the source visibly shows the byline (content-mapping.md § 4).
- **Categories**: `article:section`, links inside the article whose path has a `category`
  segment, or JSON-LD `articleSection`. **Tags**: `article:tag` metas, or links whose path has a
  `tag` segment. Use the link text as the term name.
- **Excerpt**: `meta name="description"`, else `og:description`, else the first paragraph,
  trimmed to about 160 characters. It becomes the post's SEO description.
- **Lead image**: `og:image`, else the first content image.

## 7. Platform hints

`meta name="generator"` (the page reader exposes it with the page's meta tags) and asset hosts
identify the platform. The hints narrow where to look; they never override § 5.

| Platform | Signals | Notes |
|---|---|---|
| WordPress | generator `WordPress`, `/wp-content/` asset paths, `/wp-json/` links | `post-sitemap.xml` / `page-sitemap.xml` children; posts often under `/YYYY/MM/slug/`; skip `?p=`/`?page_id=` shortlinks (they redirect) |
| Squarespace | generator mentioning `Squarespace`, `static1.squarespace.com` images | posts live under the blog collection path (often `/blog/<slug>`); images take a `?format=` size parameter: import the original by dropping it |
| Wix | generator `Wix.com Website Builder`, `static.wixstatic.com` images | posts under `/post/<slug>`; treat `post` as a post path segment on Wix only; content is often rendered by scripts, so use `format: "markdown"` and check the text is really there |
| Webflow | generator `Webflow`, `assets.website-files.com` / `cdn.prod.website-files.com` images | collection pages share a folder (`/blog/<slug>`, `/posts/<slug>`) |

If the readable text of a page is nearly empty while the HTML is large, the site renders its
content with scripts. Say so in the plan; such pages cannot be imported faithfully by a reader
that does not run scripts.
