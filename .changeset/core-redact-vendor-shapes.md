---
"@jini-ai/core": minor
---

The shared engine now masks three vendor key shapes it let through: a payment provider's `whsec_` webhook signing secret (24+ characters), a GitHub token with 30 to 35 characters after its prefix, and a temporary AWS access key id (`ASIA` + 16).
