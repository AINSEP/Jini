---
"@jini-ai/cms": minor
---

`@jini-ai/cms/content-types/sql` exports `SqlContentTypeRepo`, the Kysely adapter for `ContentTypeRepoPort` and `ContentTypeListPort`: the host passes its storage kernel, the names of its content-type and revision tables, and the declared envelope owners of its code-registered types (data, not a callback).
