---
"@jini-ai/platform": minor
---

Add optional `ResolvedMailer.effectiveProviderId({ lane })`, the provider id the lane's policy-wrapped mailer is really built for (`"console"` on the local fallback), so hosts plan test-send approvals from the same resolution instead of a separate settings read.
