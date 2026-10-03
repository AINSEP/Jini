# Webhooks

The approved subset is subscriptions, delivery, signing and their ports. There are no DB,
plugin, root-key custody or UI adapters. The host supplies HTTP, repositories, envelope store,
clock, IDs, URL policy and signer. Existing wire envelopes and retry scheduling are preserved.

```ts
const signer = createKeyringBackedSigner({ keyring, vocabulary: { timestampField, signatureField } });
await processDueDeliveries(
  { deps: { subscriptionRepo, deliveryRepo, envelopeStore, httpClient, signer, clock,
    headers: { signature: signatureHeaderName, deliveryId: deliveryHeaderName, eventId: eventHeaderName } } },
  { batchSize: 20, hooks, random },
);
```

`signPayload` requires `secret`, `rawBody`, `timestampSeconds` and `vocabulary` in one object.
`verifySignature` additionally requires `header`, `nowSeconds` and `toleranceSeconds`.
Wire field names and HTTP header names have no product defaults. Signers use the current
subscription secret generation, as the extracted implementation did; verification accepts
multiple signature values for externally supplied overlap headers. No new rotation behavior
is introduced. Sign the exact serialized body that is sent.

Delivery timestamps use the injected clock. Optional random controls equal-jitter backoff,
which starts at five minutes, doubles, and caps at six hours; default attempt limit is eight.
A throwing or vetoing hook fails closed before HTTP. Subscriptions are soft-disabled.
`createSubscription({ deps, input }, { createdByPluginId })` keeps optional attribution in
argument two. Target policy receives `{ url }`.

`WebhookDeliveryRepoPort.enqueue({ record }, { envelope })` must persist a unique
(workspace, subscription, event) delivery atomically. `claimPending` must claim atomically,
increment attempts, return snapshots and reclaim retry-eligible rows according to the host's
lease policy. The service's sequential duplicate check is retained for parity and is not a
concurrency guarantee. Durable adapters should co-persist the envelope; the separate envelope
save remains for adapters with separate storage. The envelope port keys by globally unique
delivery ID, retaining the original contract. List-based duplicate checks load all historical
rows for a subscription; a future optimized adapter/service API can replace that cost.

Local `RootKeyHandle`, `KeyringPort`, `SecretSealerPort` and `SealedSecret` structurally map to
`@jini-ai/platform/secrets` from the concurrent secrets extraction. In particular, seal requires
AAD in argument one; open takes `{ sealed }` plus optional `{ aad }`. The signer uses only
`Pick<KeyringPort, "deriveSigningSecret">`. There is no platform import and no sealing adapter
in this subpath. HKDF salt, info derivation and algorithm remain in the host/keyring adapter.

Runtime/type/build/package verification is pending by owner directive.

Transport contract: core `HttpClientPort.send({ request }, { redirect? })` receives signed body
bytes inside `request`; webhooks use core `Clock.nowMs()` and `IdGenerator.newId()`.
Repository `markFailed({ workspaceId, id, error, responseStatus, nextStatus, nextAttemptAt },
{ deadAtIso })` keeps the optional terminal timestamp and stored records unchanged.
Webhook validation/not-found/veto errors take `{ message }` plus optional `{ options }`.
