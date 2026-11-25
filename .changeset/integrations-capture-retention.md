---
"@jini-ai/integrations": major
---

Breaking: `createCaptureFileWriter` from `@jini-ai/integrations/web-screenshot/capture-files` now requires a `lock` (`{ withLock({ key, run }) }`) next to `rootDir`. Each capture is staged as `<name>.partial` and linked to its final name under the lock keyed by the captures root, still never overwriting an existing capture. Hosts must pass their root-keyed lock.

Add `@jini-ai/integrations/web-screenshot/capture-retention`: `createCaptureRetention` for owner-confirmed "delete screenshots older than…" (preview, single-use token, apply with `confirm: true`; apply re-checks identity, containment and cutoff under the same lock, and never touches `.partial`, symlinked, unknown or replaced files) and `createCaptureFilePorts` for default `lstat`-based listing and removal over an injected fs.
