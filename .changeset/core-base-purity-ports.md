---
"@jini-ai/core": minor
"@jini-ai/ui": patch
"@jini-ai/diagnostics": minor
"@jini-ai/cms": minor
---

Core no longer reaches for ambient effects or module state in four places. `createApprovalProposalStore` takes required `ids` and `scheduler` ports. `FetchQueryCache` takes a required `{ clock, scheduler }` (the browser defaults now live in `@jini-ai/ui`'s fetch-query provider). `registerLoggableErrors` is replaced by the pure `createErrorDescriber` factory. `registerCoercer` is removed; `getEffective` accepts an optional `{ coercers }` map. `canonicalArgumentDigest` takes a required `crypto` port (type `DigestCryptoPort`), threaded through cms form schema digests (`SubmitFormDeps`, `ContactFormResolverDeps`, `CoreResolverDeps`, `assertCurrentFormSchema`, `captureSubmissionEvidence`). Diagnostics' `errorType` and `describeReportedError` accept an optional `describer`.
