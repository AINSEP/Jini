# security/host

Admin security-screen pieces moved out of the host app one unit at a time. They sit beside the
product-neutral `security` port/adapter module rather than inside it because they still follow
the host screen's own shapes (site key reveal, `/auth/me` permission read).

## Wiring

- `SiteKeyTab.hooks.tsx` (`useRevealedKeyCopy`): nothing injected; it reads `navigator.clipboard`
  directly. The host's site-key tab calls it with the revealed `hex`.
- `hooks/security-permissions-port.hooks.ts` (`SecurityPermissionsPort`): a type only. The host
  implements `me()` over its own `/auth/me` client and passes that port to its permissions hook.
