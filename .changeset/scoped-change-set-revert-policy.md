---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

Change-set revert can now be authorized per item. An `EntityReverter` may declare an optional `policy` (`permission`, `authorizationEntityType`, `allowForce`), and `applyInverse` takes an optional `{ actorId }` naming who is reverting now. `revertChangeSet` accepts `actorId` and `authorizeItem` in its second argument: it checks every policy-bearing item before reading any version or writing any inverse, fails closed when no item authorizer is given, and refuses a forced revert of a kind with `allowForce: false` (`RevertForbiddenError`, reasons `ITEM_PERMISSION_DENIED` and `ITEM_CANNOT_FORCE`). The admin revert route answers both refusals with 403 `REVERT_FORBIDDEN`. The `change_sets_revert` tool returns `{ reverted: false, code: "REVERT_NOT_ALLOWED" }` for them, and when a non-forceable set has a conflict it tells the assistant to keep the newer version and edit it again. Reverters without a policy behave exactly as before.
