---
"@jini-ai/plugins": minor
---

Publish the declarative content-type rules on `@jini-ai/plugins/host`:
`createDeclarativeContentTypes({ cms, reservedKeys }, {})` returns `validateManifest`, `parse`,
`plan` and `apply` (usable as `DeclarativeContentTypesPort`), with the `DeclaredContentTypeCms`
vocabulary contract, `DeclaredContentTypeWritePorts`, the concrete `DeclaredContentTypeDefinition`
/ `DeclaredContentTypeDefinitionPlan` shapes and the `MAX_DECLARED_*` bounds. Hosts supply their
field kinds, kind checks, identifier grammar, already-exists classifier and reserved keys; the
package imports no content-type implementation.
