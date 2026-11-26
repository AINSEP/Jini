---
"@jini-ai/core": minor
"@jini-ai/cms": minor
---

Blob GC journal provenance (J1a/J1c, dark by default): core `contracts/blob-gc` adds `BlobJournalRole`, `BlobJournalIdentity` and the optional writer port `BlobJournalEligibility.clearForKeys`. CMS media records each rendition's own `sha256`, journals renditions with their own digests and an explicit `reason` only, reports unverified rendition keys instead of journaling them, and clears journal eligibility whenever a writer claims a key (upload, dedup, resurrection, rendition, import, file replacement). `planRenditionJournal` and `classifyJournalEntry` keep every entry by default; trash-TTL eligibility is off unless the host opts in.
