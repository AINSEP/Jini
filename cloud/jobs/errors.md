# Job errors


## Build S3: no generic admin errors, at the shared helper
Plan: cloud/plans/S2-errors-replan-result.md. Trim, which OVERRIDES the plan:
- Do steps 1, 2, 3, 4, 5 (analytics, forms pull, uncaught admin exceptions, hand wording table), 6.
- CUT from step 5: dev-auth.ts (sibling job), plain-text preview details, raw download adapters. No one-click controls in previews.
- Do not change existing inline notices.
- The shared display is UI: keep it to mounting ErrorNotice beside ServerRestartingBanner; the look gets checked in Chrome afterwards.
- Anonymous routes get no details beyond safe wording and incident id. Test with a secret canary.
