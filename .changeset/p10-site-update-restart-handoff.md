---
'@jini-ai/core': minor
'@jini-ai/devops': minor
---

Split a site update into `prepareSiteUpdate` and `finishPreparedSiteUpdate` so a host can verify (or roll back) the replacement after a restart without applying, backing up, or approving again. Readiness checks now receive the captured backup id and source version. Desktop and self-hosted adapters accept an optional managed `rollbackDeployment` that replaces the legacy rollback sequence. The site update status reply gains `lastAttempt`, and the notice renders it without ever showing an accepted hand-off as a finished update.
