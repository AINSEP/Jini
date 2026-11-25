---
"@jini-ai/core": minor
"@jini-ai/user-management": minor
"@jini-ai/admin": minor
---

Identity editors send the loaded row version. `AdminRole` and `AdminPolicy` now carry `version`
(consumer change: fixtures and fakes must supply it); `RolesPort.updateRole`/`updatePolicy` accept an
optional `expectedVersion`, which the roles API client sends in the PATCH body. The roles screen captures
the version when an edit starts, sends it on save, keeps the typed draft open on `409 VERSION_CONFLICT`,
shows the shared translated conflict copy (which tells the operator to reload) and never resubmits.
