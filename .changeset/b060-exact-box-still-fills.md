---
"@jini-ai/cms": patch
---

The sharp image transformer still fills an exact-size box (both sides with a cover, contain or fill fit), so the `og` share card is 1200 × 630 even from a small source; single-side and `inside`/`outside` resizes still never enlarge.
