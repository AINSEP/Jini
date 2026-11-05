# Theme Inventory

What a full premium theme contains. Four lists: pages, components, patterns, and
the details that get forgotten.

Fill in the **Have it?** column before adding anything — a theme that exercises
machinery the host already ships is worth more than one that reimplements it.

## 1. Pages (templates)

### Essential eight — a theme isn't complete without these

| Page | Notes | Have it? |
|---|---|---|
| Landing / Home | The marquee page — most design effort goes here | |
| About | Story, mission, timeline | |
| Team | Grid + optional person detail | |
| Contact | Wire to the host's forms feature | |
| Blog index | Wire to the host's entry-list component | |
| Blog post | Wire to the host's entry-content component; needs real long-form prose styling | |
| 404 | The most-skipped page in every theme, and very visible when hit | |
| Legal (privacy / terms) | Plain prose page — proves the generic page template works | |

### Premium differentiators — what separates a $0 theme from a $79 one

| Page | Notes | Have it? |
|---|---|---|
| Pricing | Needs the pricing-table component | |
| Services / Features | Alternating splits, steps, tabs | |
| Case-study index + detail | Detail template is the one that gets skipped | |
| FAQ | Needs the accordion component | |
| Careers | Index + prose detail | |
| Category / tag archive | Wire to the host's taxonomy | |
| Search results | Including the no-results state | |

## 2. Components

### Common baseline (12)

`nav` · `site-header` · `hero` · `section` · `feature-grid` · `cta` ·
`announcement` · `entry-list` · `entry-content` · `media-placeholder` · `footer` ·
`site-footer`

A reference premium-landing architecture already demands four components the
baseline does not have:

> announcement → nav → hero → **stats** → **showcase** → **testimonials** →
> **video carousel** → CTA → footer

### Missing for premium

| Component | Why | Have it? |
|---|---|---|
| stats-band | Every premium landing has one | |
| testimonial / quote | Social proof; single and trio are different layouts | |
| logo-cloud | "Trusted by" — the cheapest credibility element there is | |
| carousel / gallery | Media showcases, video carousels | |
| pricing-table | Can't do a Pricing page without it | |
| accordion / faq | Also powers mobile nav and long specs | |
| team-grid | Person cards | |
| contact-form | Binds the host's forms feature | |
| newsletter-signup | Binds the host's newsletter feature | |
| pagination + breadcrumbs | Blog index and archives are broken without them | |
| tabs, steps / process, timeline | About and Services pages | |
| bento-grid | The 2026 premium-landing signature layout | |

## 3. Patterns (preset compositions)

The layer most themes don't have. Each is just JSON — a named arrangement of the
components above.

- **Hero variants** — centered · split-with-media · full-bleed video · minimal-editorial
- **Feature layouts** — 3-up grid · alternating split · bento
- **Social proof** — logo strip · testimonial trio · stat band
- **Closers** — CTA band · boxed CTA · newsletter block
- **Page skeletons** — `about-page`, `contact-page`, `team-page`, `pricing-page`: a whole page pre-composed, so a user gets a real About page on install instead of a blank one

## 4. The things people forget (and premium themes don't)

- **Dark mode** — a `modes.json` overlay, not a second theme
- **Empty states** — blog with zero posts, search with no results, team with one member
- **Long-form prose styling** — headings, lists, blockquotes, code, tables, footnotes inside `entry-content`. This is where cheap themes visibly fall apart.
- **Mobile nav** — needs JS, which is exactly why a static tier-1 fallback needs to exist
- **All 9 interaction states** — default / hover / focus / active / disabled / loading / empty / error / success
- **Reduced-motion + visible focus rings** — non-negotiable at premium
- **OG / social share images** — per-template default plus a fallback
- **Widget regions** — declared in `theme.json` (`regions?: string[]` — sidebar, footer-cols)
- **RSS + favicon set**
