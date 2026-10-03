Spec ID: SPEC-JINI-CORE-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:4d8a5c5c2eae3801d8b54c696ab0efcb1da6974fab9f4fc29460cb745d08bf69
spec_mode: reverse_spec

# State Contract: @jini-ai/core

## Composition and registries

Bindings, tool registrations, and contributions are instance-owned process memory. Nothing is serialized automatically. Binding methods mutate the same instance while widening its compile-time bound-ID union. Singleton entries cannot be overwritten; many entries append, and resolved arrays are not cloned.

`createDaemon` constructs services in pack order and retains them by pack name. The consumer owns resource cleanup, including partial construction failure. Tools are registered separately and remain for the registry lifetime; there is no unregister or clear on `ToolRegistry`. The private WeakMap associates registrations with factory-created registry objects; an arbitrary structural registry is not authorized by the internal helper.

Contribution registries support replacing values by key and clearing all values. `list` returns a new array whose elements remain shared. Replacing does not reorder a key. Caller mutation of contribution objects is visible to later lists.

No pack lifecycle state tracks whether tools were registered or resources disposed. Repeating lifecycle helpers repeats callbacks. Consumers must establish their own once-only startup/shutdown orchestration.

## Confirmation token lifecycle

```text
minted --successful atomic tryRedeem--> redeemed
minted --explicit expire-------------> expired
minted --clock passes expiresAt------> not redeemable (status can remain minted)
```

Redeemable means `status === 'minted'` and `Date.parse(now) <= Date.parse(expiresAt)`. Invalid dates fail this predicate. Expiry is inclusive at its boundary. `expire` leaves redeemed/expired records unchanged. There is no deletion, pruning, or background expiry task.

`InMemoryTokenStore` starts empty, copies records on save/read/redemption, rejects duplicate token keys, and reports its retained count. Its redemption check and state replacement execute without an intervening await, yielding one winner within the instance. This is not cross-process persistence.

A consumer-supplied store owns durability, isolation, and the atomic compare-and-transition in `tryRedeem`. The gateway reads and verifies a record, recomputes the plan, then performs the atomic transition; concurrent losers never execute the mutation. Redemption precedes mutation and is not undone after failure. A token cannot be reused to resume a partly completed mutation.

Plans are returned to the caller and are not stored by the kernel. Tokens bind only `planHash`, `scopeId`, and `confirmerPrincipalId`; `planId` and domain are not token fields. Hosts must include any additional required context in their hash/scope design.

Evidence: `src/gated-mutations/token.ts`, `gateway.ts`, `src/contribution-registry.ts`, `src/bindings.ts`, `src/tool-registry.ts`, and their tests. No persistence adapter or UI is supplied here.

## Shared primitive state

Primitive types, path containment and text helpers persist nothing. Default clocks sample wall time; generators request a new crypto UUID per call. Loggers retain the supplied prefix. Registration-kit handler branding is held in a module-local WeakSet, not in tool input or durable storage. Catalog indexes/risk maps belong to the caller; kernel types do not create tables or workers.
