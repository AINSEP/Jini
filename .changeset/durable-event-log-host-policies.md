---
"@jini-ai/daemon": patch
---

Add opt-in host-managed SQLite event-log schema setup, a borrowed-kernel factory that joins host transactions (its replay reads one transaction snapshot), and append receipts for conflicting retries or retention-cap refusals. Existing append defaults and FIFO retention remain unchanged.
