# cms/forms/destinations

## Wiring

- `rewrite-actions.ts`: pure; the host passes its in-memory deploy files (any `{ file, data }` shape) and the receiver's submit URL from its static-publish adapter and form-destinations port.
- `key-store.ts`: the receiver-key lifecycle (`resolveReceiverKey`, `listReceiverKeys`) over an injected `ReceiverKeyVault`; the host injects the label prefix, key generation and duplicate classification and keeps the persisted label, site scope and category in its vault binding.
- `pull.ts` / `select.ts`: the host supplies the destination kit and registry.
- `deliver.ts`: `createFormDestinationDeliverer` (one push attempt). The host injects `resolveRequestTarget` (its credential host check; the host may pass `@jini-ai/integrations/credentialed-http`'s), `loadRegistry`, the `connections` port and the base kit in its form-delivery composition.
