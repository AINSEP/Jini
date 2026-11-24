---
"@jini-ai/core": patch
"@jini-ai/cms": minor
---

The admin publish-content wire DTOs (the report `PublishContent*Dto` shapes, `PublishContentPeerView`, `PublishDestinationView`, and the peers list/peer envelopes) are declared once in `@jini-ai/core/contracts/site/cms-publish-content`, so an admin client reads the same shapes without depending on CMS. The publish-content peer and destination route specs are typed against them. **Breaking (cms):** the `@jini-ai/cms/publish/content/report-contract` subpath is removed (import the DTOs from Core); `routes/publish-content/{transport-shared,destination}` no longer export `PublishContentPeerView`/`PublishDestinationView`; `toPublishContentReportDto` takes an object argument — `toPublishContentReportDto({ report })`. Wire bodies are unchanged.
