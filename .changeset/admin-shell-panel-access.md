---
"@jini-ai/admin": minor
---

Panel access rules and a `noAccess` shell slot. `@jini-ai/admin/core` exports `isPanelAccessible` and `withoutInaccessiblePanels`, and `AdminPanel` gains `anyOfPermissions` (at least one held; `permissions` stays all-of; both declared means both must pass). `resolveAdminShellModel` now separates route recognition (capabilities only) from visibility and returns `access: 'allowed' | 'denied'`; `AdminShell` renders the new optional `slots.noAccess` when the routed panel is denied. `resolvePanels` is unchanged.

Two declared shell behaviour changes (the shell has no consumer in this repository):

1. While the session's `effectivePermissions` is unknown (`undefined`), a panel declaring all-of `permissions` is now listed in the nav. Before, it was hidden. An empty list is a known empty grant and still hides it.
2. A denied direct URL no longer redirects to the default panel: it keeps its own route and page id and renders `slots.noAccess` (an empty `<main>` without one).

Client-side visibility only: the server stays the authority for every operation.
