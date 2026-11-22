---
"@jini-ai/agent-plugins": patch
---

`createMailCatalog` passes the host SMTP transport through with the object-args `sendMail({ mail })` shape instead of a positional payload.
