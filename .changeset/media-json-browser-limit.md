---
"@jini-ai/admin": patch
---

Refuse files above the injected JSON upload limit before browser encoding. Media bindings must supply `deps.maxJsonUploadBytes`; size refusals stay in the upload dialog and report the bound limit.
