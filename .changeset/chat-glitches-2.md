---
"@jini-ai/chat": patch
---

Chat transcript fixes: answered approval/option cards show "<title>: <option label>" instead of raw values; mid-run follow-ups read "Queued — read after the current step" until consumed, render as ordinary transcript rows at the point they were sent; standalone approval forms show "Waiting for your answer above"; text from separate assistant steps is joined with a paragraph break.
