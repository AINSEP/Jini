---
"@jini-ai/admin": patch
---

Move the Media card hooks from the host (A-K2-media-1 slice): `@jini-ai/admin/screens/media/hooks/use-media-card-{metadata,details}.hooks`. Each declares the structural slice it reads (`MediaCardMetadataSource`, a generic item) instead of the host's media DTO.
