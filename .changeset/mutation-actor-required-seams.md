---
"@jini-ai/cms": minor
"@jini-ai/db": minor
---

Typed mutation attribution is now required at two write seams: `BuildPublishContentImportHooksInput.actor` and `PublishContentApplyPort.applyReport`'s `actor` (merged into the run's `PublishContentDeps.mutationActor`, stamped on repo-handler and raw-row change sets), and `BuildRestoreHooksInput.actor` (recorded in the `restore.executed` ledger detail).
