# W1 cms — coordinator progress

Coordinator branch: `cloud/w1-cms` (from origin/general-work 6bdca722). Cloud proof commit 4c88f932.
Setup: 128 s (install + `pnpm --no-bail -r build`; integrations tsc fails as expected, dist emitted). Baseline `tsc --noEmit -p packages/cms` = 0.
Baseline: 75 cyc/cog>10 violations across the 25 lot files.
Worktrees: /home/user/wt-<LOT>, branches `cloud/w1-cms-<LOT>`. Brief template: per-lot brief generated from coordinator brief.

| Lot | Files | Status | Subagent | Commits | before→after worst cyc/cog | Coverage | Verify |
|---|---|---|---|---|---|---|---|
| L010 | forms descriptor-rules, field-registry, html-render | merged | done (47 tool calls) | 36b96063, 5375e7b7, 9a8bc1ec | 53/52 → ≤10/≤10 | 100/100/100 | eslint 0, tsc 0, forms 490 ✓; 99 new tests also green on old code |
| L017 | forms/html authoring-adapter, html-authoring | merged | done (15 tool calls) | f59b2cd8, 2c038dab | 10/8 → 10/8 (already ≤10) | 100/100/100 | eslint 0, tsc 0, 86 tests ✓ |
| L073 | widgets config-validation, embed-service, gallery-resolver, resolver-service | running | | | 32/36 → | | |
| L108 | widgets/html gallery-render, html-embeds, legacy-widget-markers, server-fragment | merged | done (46 tool calls) | 2f92117a, 0ef5b201, c94e6ba3, 232e610d | 20/22 → ≤10/≤10 | 100/100/100 | eslint 0, tsc 0, widgets 379 ✓ |
| L109 | widgets/markers gallery, html-attributes | merged | done (23 tool calls) | bcd89622, fbd539cd | 26/20 → ≤10/≤10 | 100/100/100 (was 78.7/77.9) | eslint 0, tsc 0, widgets 336 ✓ |
| L123 | redirects host-config, redirects | merged | done (52 tool calls) | 8778aace, d15f1058 | 18/29 → 8/9 | 100/100/100 (was 93.3–96.5) | eslint 0, tsc 0, 322 ✓ |
| L151 | content-types index-provisioning, write-service | merged | done (22 tool calls) | e39b6c22, d07e78b9 | 19/20 → 8/8 | 100/100/100 (was 93.96/92.04) | eslint 0, tsc 0, 168 ✓ |
| L164 | entries field-validation, write-service | running | | | 17/16 → | | |
| L169 | taxonomy write-service | running | | | 16/20 → | | |
| L176 | forms forms, submission-attempts, submit-service | running | | | 18/16 → | | |

## Problems
- Baseline whole suite on unmodified tree (66 s): 2549/2550 pass; 1 pre-existing FAIL `src/media/__tests__/video-frames.ffmpeg.test.ts > reports temporary files that cannot be removed and still releases the lock` (out of scope; container runs as root).
- L109 bug pinned: gallery parseMediaContent drops mode/cssClass/htmlAttributes errors when items is not an array (reported, not fixed).
- L108 bug pinned: legacy-widget-markers corrupts markup when parse5 reconstructs a formatting element sharing source offsets (`<p><b data-embed-type=widget>1<p>2`) — edit applied twice (reported, not fixed; fix = dedupe edits by offset).
- L108 note (pinned, unchanged): gallery htmlAttributes can override wrapper role.
- L123 flagged: `checkRedirectFieldsWouldWrite` exported with no callers; doc cites a non-existent publish-content precheck. Unreachable "matcher does not match" safety net in host-config kept + pinned via fake matcher.
- Cross-package (http-kit): `checkSiteRelativeTarget` returns ok for raw backslash (`/a\b`) despite refusal wording; redirects.ts refuses it separately, so no behaviour impact.
- L010 bugs pinned: file field — filename with no dot passes when whole name is a safe extension (e.g. `png`); renderHtmlFormBody — hidden input still points aria-describedby at unrendered help/error ids. Quirk: `<select>` gets a placeholder attribute.
## Next
