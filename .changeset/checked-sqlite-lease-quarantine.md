---
"@jini-ai/db": patch
---

Leased SQLite transactions release their lease before the next queued kernel transaction takes its turn, so it no longer fails with `transaction_busy`. Checked clients quarantine only uncertain outcomes: a failed COMMIT followed by a successful ROLLBACK, or a stray ROLLBACK with nothing open, leaves the handle usable.
