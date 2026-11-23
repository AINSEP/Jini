---
"@jini-ai/core": patch
---

`@jini-ai/core/tool-metadata` gains `deployments`, `domain-dns` and `source-control` maps, plus `deploy-ops` and `site-backup` as factories (`createDeployOpsToolMetadata({ siteKeyEnvName })`, `createSiteBackupToolMetadata({ archiveLabel })`) whose host-owned query words are passed in.
