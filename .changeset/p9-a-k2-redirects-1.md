---
"@jini-ai/admin": patch
---

Move the host's Redirects admin screen mount and its dictionary: `./screens/redirects` (`Redirects`, which mounts the redirects list module page through an injected `useModulePanel` hook and loading view) and `./screens/redirects/redirects-i18n` (the Redirects screen dictionary and copy helpers over `ADMIN_COMMON_I18N`, with the ⓘ through the kit's `InfoTip`), with the dictionary tests.
