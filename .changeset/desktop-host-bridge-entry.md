---
"@jini-ai/desktop-host": minor
---

Adds the `./bridge` entry: the `window.__jini__` bridge alone, with no `node:` built-in and no relative import, so renderer bundles can import it without the sidecar and registry modules the root entry re-exports. The root entry is unchanged.
