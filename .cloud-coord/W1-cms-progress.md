# W1 cms — coordinator progress

Coordinator branch: `cloud/w1-cms` (from origin/general-work 6bdca722). Cloud proof commit 4c88f932.
Setup: 128 s (install + `pnpm --no-bail -r build`; integrations tsc fails as expected, dist emitted). Baseline `tsc --noEmit -p packages/cms` = 0.
Baseline: 75 cyc/cog>10 violations across the 25 lot files.
Worktrees: /home/user/wt-<LOT>, branches `cloud/w1-cms-<LOT>`. Brief template: per-lot brief generated from coordinator brief.

| Lot | Files | Status | Subagent | Commits | before→after worst cyc/cog | Coverage | Verify |
|---|---|---|---|---|---|---|---|
| L010 | forms descriptor-rules, field-registry, html-render | running | | | 53/52 → | | |
| L017 | forms/html authoring-adapter, html-authoring | running | | | (none) → | | |
| L073 | widgets config-validation, embed-service, gallery-resolver, resolver-service | running | | | 32/36 → | | |
| L108 | widgets/html gallery-render, html-embeds, legacy-widget-markers, server-fragment | running | | | 20/22 → | | |
| L109 | widgets/markers gallery, html-attributes | running | | | 26/20 → | | |
| L123 | redirects host-config, redirects | queued | | | 18/29 → | | |
| L151 | content-types index-provisioning, write-service | queued | | | 19/20 → | | |
| L164 | entries field-validation, write-service | queued | | | 17/16 → | | |
| L169 | taxonomy write-service | queued | | | 16/20 → | | |
| L176 | forms forms, submission-attempts, submit-service | queued | | | 18/16 → | | |

## Problems
- Baseline whole suite on unmodified tree (66 s): 2549/2550 pass; 1 pre-existing FAIL `src/media/__tests__/video-frames.ffmpeg.test.ts > reports temporary files that cannot be removed and still releases the lock` (out of scope; container runs as root).
## Next
