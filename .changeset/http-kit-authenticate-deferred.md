---
"@jini-ai/http-kit": patch
---

`JsonRoutePorts.authenticate` may answer `undefined` when no principal is present yet; the handler then receives no `context` and the host's `authorize` port decides. A host can therefore keep its routes' historical order (body refusal before the missing-session failure). Runtime behaviour of the adapter is unchanged.
