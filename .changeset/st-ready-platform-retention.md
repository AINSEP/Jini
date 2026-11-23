---
"@jini-ai/platform": patch
---

New subpath `@jini-ai/platform/retention` (ST-4, ST-14): `createRetentionRunner` serializes host-supplied cache/derived/old-copy policies (dry runs only measure; a failing policy or a failing pass is reported through the injected `reportError` with fixed, safe outcome text; collaborators that request a pass synchronously join or queue behind the pass in flight), and `measureStorageTree` measures one folder tree read-only with symlinks never followed. Folders are enumerated through the `StorageTreeFs.openDirectory` port (`StorageTreeDirectory`, `StorageTreeIdentity`); the default `nodeStorageTreeFs` opens each folder without following a link, reads it through its descriptor on Linux, and reports a folder unknown when its identity changes mid-walk. Nothing in this entry deletes files.
