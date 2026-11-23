---
"@jini-ai/cms": patch
---

The admin fs-files custom-root `GET`/`PUT`/`DELETE` routes ship as server-neutral `defineJsonRoute` specs (`@jini-ai/cms/admin-http/routes/fs-files/custom-root`, exporting `fsCustomRootGetRoute`, `fsCustomRootPutRoute` and `fsCustomRootDeleteRoute`). Each spec reads only its own small deps type. The root lives in a host store that touches the filesystem, so the host injects the collaborators as narrow functions: a status read, a set-or-clear write, a matcher for its own invalid-path error, and the two permission names (read versus change). `PUT` keeps checking permission before it validates the body. Wire bodies and statuses are unchanged; the authorizer now also receives an `entityType` (`fs-files-custom-root`), which the host's authorizer always accepted. The folder-picker routes stay with the host: they set a `Cache-Control` response header and read the session credential kind.
