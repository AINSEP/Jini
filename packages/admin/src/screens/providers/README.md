# screens/providers

Pieces of the admin's Integrations (providers) screen moved out of the host app.

## Wiring

- `api/providers-api.ts` (`createProvidersApi`): the host injects its authenticated admin
  `request` (owns base URL, auth, retries, error decoding, failure publishing) and the
  `workspaceId` every path is scoped under, and binds the result once as its `providersApi`
  singleton.
