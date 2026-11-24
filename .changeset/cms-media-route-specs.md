---
"@jini-ai/cms": patch
---

Add the admin media route specs (`./admin-http/routes/media/{update,trash,delete,get-providers,put-providers,shared}`) and the admin media DTO helper (`./admin-http/http/media`): server-neutral `defineJsonRoute` specs with their own deps types; the host injects its asset lookups, trash/purge collaborators and provider credential store.
