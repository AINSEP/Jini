---
"@jini-ai/user-management": minor
---

`useLocalizedUsers` now takes the users controller hook as a REQUIRED `useUsers` dependency (bind this package's `useUsers`) instead of importing it, and replaces the `navigate` seam with `onOwnPasswordResetClosed`: the host owns the route the deep-linked own-password-reset dialog returns to and its navigation options.
