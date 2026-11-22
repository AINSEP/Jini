---
"@jini-ai/cms": minor
---

`@jini-ai/cms/entries` exports `TrashAwareInMemoryEntryRepo`, the in-memory twin of `SqlEntryRepo`: it wraps `InMemoryEntryRepo`, hides a trashed row from every read, exposes `findAnyById` / `findAnyBySlug` / `saveAny` / `hardDelete` as the Trash seam, and implements the display and exclude-types read ports. Its constructor takes a required `onWriteSettled({ repo })` hook, called after `save`, `transaction` (also on failure), `saveAny` and a `hardDelete` that removed a row.
