# trash/permanent

The permanent-delete agent tool catalog: one confirmation-gated tool per resource that can be erased for good (Trash rows, media, comments, users, External MCP servers and saved credentials).

## Wiring

- `agent-tools.ts` (`@jini-ai/cms/trash/permanent/agent-tools`, runtime `universal`): pure data.
  - **Needs injected**: `createPermanentDeleteSpecs({ customCredentialIdSource })` takes the host read tool (and field) the model reads a saved custom credential id from; it is quoted verbatim in the `custom_credential_delete` guidance. The host binds the specs once at its tool-registration module and derives the catalog with `createPermanentDeleteAgentToolCatalog({ specs })`.
  - **Provides**: the specs (ids, permissions, entity types, guidance), the `PermanentDeleteToolId` literal union, and the model-facing catalog (descriptions, input schemas, `mutates-durable-state` side effects).
  - **Must never**: name a host tool itself, or accept a confirmation flag / redemption token from the model; the host's handler runs the human confirmation card.
