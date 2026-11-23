# screens/collections

## Wiring

- `api/collections-api.ts` — the collections admin API client. The host injects its authenticated admin
  `request` (it owns the base URL, auth, retries and error decoding) and builds the client once at its
  composition root.
