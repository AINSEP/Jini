---
"@jini-ai/cms": patch
---

Move host-neutral image-transform code from the host: `@jini-ai/cms/media/site-transform/image-ops` (output-spec validation, resize/crop/rotate/flip/re-encode and ICO packing behind `image_transform`). `@cfworker/json-schema` becomes an optional peer of `@jini-ai/cms`, needed only by this entry.
