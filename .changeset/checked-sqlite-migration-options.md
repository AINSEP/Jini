---
"@jini-ai/db": patch
---

Add opt-in checked SQLite clients and leased transaction sessions, plus batch migration atomicity,
ordered-prefix history checks, injected clocks and explicit legacy ledger mappings. Existing raw
clients, transaction signatures and default per-step migration behavior are unchanged.
