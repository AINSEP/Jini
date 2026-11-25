---
"@jini-ai/desktop-host": minor
---

Add `runPartitionPass` and `removeAmbiguousPartition` to `@jini-ai/desktop-host/electron/partitions`. The next-start pass, under the writer lock and target fence, first restores every aside folder not committed as removed, then removes a partition whole only with a bound pending retirement proof plus no other instance, no tracked/catalog claim, a certainly absent site folder on its recorded parent device, and no holder or intent — rechecked after the rename-aside, with the ledger CAS as the only commit point. Ambiguous partitions lose only their `Cache` and `Code Cache` folders. Owner removal requires a typed `{ partition, confirmed: true, evidence: 'owner-dialog' }` confirmation and uses the same rename, recheck and CAS proof. Unknown claims skip the pass; nothing is swept by filename.
