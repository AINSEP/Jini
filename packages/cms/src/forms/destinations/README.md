# cms/forms/destinations

## Wiring

- `rewrite-actions.ts`: pure; the host passes its in-memory deploy files (any `{ file, data }` shape) and the receiver's submit URL (Tovu: `features/deployments/static-publish/adapter.ts`, `features/form-destinations/port.ts`).
- `pull.ts` / `select.ts`: the host supplies the destination kit and registry.
- `deliver.ts`: `createFormDestinationDeliverer` (one push attempt). The host injects `resolveRequestTarget` (its credential host check; Tovu passes `@jini-ai/integrations/credentialed-http`'s), `loadRegistry`, the `connections` port and the base kit (Tovu: `server/runtime/composition/form-delivery-deliverer.ts`).
