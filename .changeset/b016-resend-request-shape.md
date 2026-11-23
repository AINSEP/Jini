---
"@jini-ai/agent-plugins": patch
"@jini-ai/plugin-catalog": patch
---

The Resend mail adapter sends through both HTTP client shapes, so mail goes out on Jini's `send({ request })` client too. Resend plugin 0.2.4, catalog re-pinned.
