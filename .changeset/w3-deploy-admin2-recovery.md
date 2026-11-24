---
"@jini-ai/admin": patch
---

Recovery: add the screen rules, the recovery dictionary (split per locale group), and the `useRecovery` / `useRestoreFlow` hooks. The host injects its locale hook, API-error wording, router `navigate`, content-refresh subscription and error reporter through a `host` object; `discardCountLine` takes the host's class names and `restoreButtonAccessibleName` the viewer's time zone.
