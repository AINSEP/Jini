# security/host

Admin security-screen pieces moved out of the host app one unit at a time. They sit beside the
product-neutral `security` port/adapter module rather than inside it because they still follow
the host screen's own shapes (site key reveal, `/auth/me` permission read).

## Wiring

- `SiteKeyTab.hooks.tsx` (`useRevealedKeyCopy`): nothing injected; it reads `navigator.clipboard`
  directly. The host's site-key tab calls it with the revealed `hex`.
- `hooks/security-permissions-port.hooks.ts` (`SecurityPermissionsPort`): a type only. The host
  implements `me()` over its own `/auth/me` client and passes that port to its permissions hook.
- `Security.hooks.ts` (`navigateSecurityTab`): nothing injected; it keeps the selected tab in the
  access-tokens route's `?tab=` deep link through the shell router, replacing the history entry.
- `hooks/other-credentials-port.hooks.ts` (`OtherCredentialsPort`): a type only. The host implements
  it over its own API client and hands it to its other-credentials hook. The site-key port has one
  owner, `SiteKeyPort` in `@jini-ai/core/contracts/site/site-key`; this package does not redeclare it.
- `copy-keys-dialog.css`: layout for `CopyKeysDialog`'s `jini-copy-keys-*` classes (pinned by
  `__tests__/copy-keys-dialog-css.test.tsx`). The host loads
  `@jini-ai/admin/security/host/copy-keys-dialog.css` where it mounts the dialog.
