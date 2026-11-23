---
"@jini-ai/db": patch
---

Comment-only accuracy fix (B024): the snapshot retention note now says a failed migration writes the terminal `ROLLED_BACK` phase; its snapshot is kept for forensics, not boot recovery.
