# Job consent-declare (owner-approved 11-05)
Build declared-script consent and remove the old page-rewriting engine. Plan: cloud/plans/CD-consent-plan.md on this plans branch. This job file overrides the plan.

Base: origin/cloud/combine in both repos, at its current tip. Branch cloud/consent-declare from it. Do not push to cloud/combine.

Owner decisions, final:
- The field is `consent`, not `requires`: { "scripts": [ { "src": "/scripts/menu.js" }, { "src": "/scripts/stats.js", "consent": ["analytics"] }, { "src": "https://example.com/pixel.js", "consent": ["analytics", "marketing"] } ] }. No `consent` means it runs automatically. Several values mean all must be allowed. Use `consent` everywhere the plan says `requires`, including the `allows` API.
- An external script with no `consent` runs, with no warning. Do not add a warning for it.
- Existing sites move once reviewed. Unmanaged trackers and themes with no loading slot are shown as gaps in admin. No automatic conversion and no rewriting stored pages.
- No browser security header (CSP) work in this job.
- No code parses or rewrites a page's HTML for consent when serving or saving. Sites with consent off pay nothing.

Trim, overriding the plan:
- Readiness keeps only declaration validation and separately labelled warnings about unmanaged content. No allowance simulation.
- Comments: change only what its optional scripts need.
- The per-page context request reads only the published consent settings, not drafts. Include a test that proves it.

Do steps 1 to 5 in order. Name the exact files in your report. Step 5 deletes only after replacement consumers pass, and keeps parse5.

Failing test first for bugs. Tests only for what you change; full suites run later. Include a test that a site with consent off makes no consent requests or reads, and a test that page bytes are unchanged by consent. No skipping or weakening tests or rules. Check memory and read cost on each hot path as the plan lists. No publish, tag or main. Report at cloud/reports/consent-declare.md and in your final message: shas, exact files changed, removed line counts, tests with commands, anything open, and what the owner must look at. General wording in commits and notes.
