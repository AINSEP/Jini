# `shell/` — framework-free desktop shell pieces

Small main-process (and a few universal) helpers a desktop host composes around its windows and
guests. Each module is its own subpath (`@jini-ai/desktop-host/shell/<name>`); none imports a
desktop framework at runtime — native objects arrive through structural ports.

## Wiring

- `supervised-site-url` (`isSupervisedSiteUrl({ raw, sites })`): the host passes its own live
  collection of supervised sites (anything shaped `{ server: { origin } }`). The host's main-process
  composition root wraps it as the `isSupervisedGuestUrl` port that `guest-navigation`'s
  `installWebviewGuestPolicy` and the navigation-policy guest checks require, and reuses it for any
  sender-origin check of its own (for example a speech IPC sender gate). Nothing else is injected:
  there is no copy and no environment read.
