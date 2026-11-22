---
"@jini-ai/admin": patch
---

Move host-neutral admin common i18n code from the host: new `@jini-ai/admin/core/i18n-common` subpath exporting `ADMIN_COMMON_I18N`, the shared UI-chrome dictionary (21 locales) that feature dictionaries pass to `createDictionaryTranslator` as `commonDictionary`. Product-branded entries stay with the host, which composes its own entries over this one per locale.
