---
"@jini-ai/core": minor
"@jini-ai/user-management": minor
---

Identity editors save against the version they opened. `UserRecord`, `RoleRecord` and `PolicyRecord` carry `version`; the user, role and policy repo ports take `save(record, { expectedVersion })`. The in-memory user/role/policy repos now take `{ assertVersionedWrite }` (bind `assertVersionedWrite` from `@jini-ai/core/optimistic-concurrency`) and refuse a stale basis with `RecordVersionConflictError`; every write to an existing row advances its version. `updateRole`, `updatePolicy` and `updateUser` accept an optional `expectedVersion`; callers without one keep working.
