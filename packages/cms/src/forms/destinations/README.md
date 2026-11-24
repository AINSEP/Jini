# cms/forms/destinations

## Wiring

- `rewrite-actions.ts`: pure; the host passes its in-memory deploy files (any `{ file, data }` shape) and the receiver's submit URL (Tovu: `features/deployments/static-publish/adapter.ts`, `features/form-destinations/port.ts`).
- `pull.ts` / `select.ts`: the host supplies the destination kit and registry.
