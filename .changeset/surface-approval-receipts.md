---
"@jini-ai/core": minor
"@jini-ai/daemon": minor
---

Surface exchanges accept an observe-only `onApprovalReceipt` callback on `open()` for run-bound (leased) confirmation cards. It reports `open`, then at most one `answered` (with `confirmed`) or `ended` (`expired`/`abandoned`), synchronously and never awaited; a throwing or rejecting observer cannot change the answer, the delivery or the effect. `answered confirmed:true` means the owner said yes, before host approver/grant rechecks, not that the effect ran.
