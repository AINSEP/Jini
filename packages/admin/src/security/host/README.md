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
- `hooks/other-credentials-port.hooks.ts` (`OtherCredentialsPort`) and `hooks/site-key-port.hooks.ts`
  (`SiteKeyPort`): types only. The host implements them over its own API client and hands them to
  its other-credentials and site-key hooks.
- `copy-keys-dialog.css`: layout for the host's "use a saved key" dialog, under `jini-copy-keys-*`
  classes. The host imports `@jini-ai/admin/security/host/copy-keys-dialog.css` from the dialog.
