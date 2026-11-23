---
"@jini-ai/cms": patch
---

Framework-neutral admin/public route specs and helpers moved from the host (RT-K1 / R lanes): `./admin-http/routes/{database,recovery,redirects,system,sites}/*` (`defineJsonRoute` specs with their own small deps types; db collaborators injected), `./admin-http/http/{redirects,entity-not-live}`, `./admin-http/routes/assistant/execution-request-fields`, `./admin-http/routes/settings/preview-feed-access`, `./admin-http/sea-runtime` (node), and `./public-http/{http/site/render/value-readers,http/site/render/media-playback-copy,routes/site/pages/listing/listing-state}`.
