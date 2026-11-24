---
"@jini-ai/admin": patch
---

Move the host's SEO admin screen mount and its dictionary: `./screens/seo` (`Seo`, which mounts the SEO settings module page through an injected `useModulePanel` hook and loading view) and `./screens/seo/seo-i18n` (the SEO screen dictionary over `ADMIN_COMMON_I18N`), with the dictionary parity test.
