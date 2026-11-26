---
"@jini-ai/core": patch
"@jini-ai/platform": patch
"@jini-ai/cms": patch
"@jini-ai/agent-plugins": patch
---

Stream guarded local videos through private staging and the selected object-store writer, then convert the staged original after publication. Providers without a staged writer retain the existing byte path. Hosts bind the guarded stream, owned temp scope, staged uploader, staged FFmpeg sealer and traced single-send S3 transport through existing subpaths.
