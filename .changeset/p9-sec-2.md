---
"@jini-ai/admin": minor
---

SEC-2 (P9-SEC plan v2): the security module's Provider takes an optional `ownerControls` node (the
host's owner account settings, for example authenticator, recovery and passkey controls). The page
renders it once above the TabBar, only while the page is visible, and it stays mounted across tab
changes. New export `useSecurityOwnerControls` (`./security/react`).
