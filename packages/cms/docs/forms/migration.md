# Migrate to @jini-ai/cms/forms

Replace every root import from `@jini-ai/cms-forms` with `@jini-ai/cms/forms`. The existing root API keeps its export names and argument contracts.

| Import or implementation | Destination |
| --- | --- |
| `@jini-ai/cms-forms` (all root functions, types and errors) | `@jini-ai/cms/forms` |
| HTML authoring, extraction and submission adapters | `@jini-ai/cms/forms/html` |
| SQL repositories and submission-IP retention repository | `@jini-ai/cms/forms/sql` |
| Express submission handler | `@jini-ai/cms/forms/express` |

The old package exports only its root; the adapter rows identify the new public paths for implementations previously supplied by the host. Replace root specifiers in both value imports and type-only imports; keep imported symbol names unchanged.

`/html` requires the optional `parse5` peer. `/sql` requires the optional `kysely` and `@jini-ai/db` peers. `/express` requires the optional `express` and `@jini-ai/http-kit` peers. Bind the host ports required by each adapter; `@jini-ai/core` is a regular CMS dependency.

Keep the legacy package directory and workspace links until the consumer forms switch (B4). The package's `deprecated` metadata is retained; it does not issue an npm deprecation. The owner performs the registry deprecation in the coordinated publish, without a version bump.
