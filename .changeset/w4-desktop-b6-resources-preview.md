---
"@jini-ai/ui": patch
---

Add `./resource-monitor` (`useResourceReadings` visibility-aware sampler polling over injected bridge/visibility/timer ports, `createResourceStop`) and `useSitePreview` (+ `previewFetchPlan`, `nextPreviewUrl`, `SitePreviewBridge`) on `./site-card`. The host injects its preload bridge lookup; channels and wire snapshot types stay host-owned.
