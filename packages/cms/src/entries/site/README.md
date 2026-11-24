# cms/entries/site

## Wiring
- `unreadable-owner-entries-repair.ts`: the mismatched-owner predicate and the classify-then-remove loop (`removeMismatchedOwnerEntries`). The host injects the selected rows, the declared-owner map, `removalFor` (its Trash adapters) and the hide timestamp, and owns the transaction, lock, marker setting and log lines (Tovu: `apps/website/src/features/entries/unreadable-owner-entries-repair.ts`).
