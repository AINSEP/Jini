---
"@jini-ai/cms": patch
---

Add K1 route specs for three admin media routes moved from the host (RT-K1-adm-media-1/2/3 slice): `@jini-ai/cms/admin-http/routes/media/{get-providers,delete,trash}` (`mediaGetProvidersRoute`, `mediaDeleteRoute`, `mediaTrashRoute`), each with a small route-deps type the host fills at mount.
