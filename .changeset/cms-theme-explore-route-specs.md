---
"@jini-ai/cms": patch
---

New admin route specs `@jini-ai/cms/admin-http/routes/themes/explore-{detail,file-get,file-put,file-reset,save-original,file-copy,file-rename,file-delete,page-publish}` plus `explore-shared` (K1): the theme Explore screen's nine JSON routes; the host injects theme lookup, file IO, trash, original-source resolution and preview refresh as functions.
