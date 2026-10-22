Spec ID: SPEC-JINI-HTTP-KIT-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1998bd27c8244adaedbeb828d0b11f3b3c834cc16643308d9b17a29ce450a562
spec_mode: reverse_spec


# HTTP-kit state and lifecycle

## Rate counters and route composition

`createMemoryCounterStore` owns one Map per instance; records are `{windowStartMs,count}` and `set` copies the input. Limiter state adds a promise tail and last-sweep timestamp. Checks consume in arrival order; failures reject that caller and clear the queue tail for later work. `size` waits for pending checks but does not sweep. Counters disappear at process exit unless an injected store persists them.

One store must serve one limiter. In-process serialization is not atomic across different limiter instances or processes. Distributed enforcement needs a host-selected atomic algorithm/store design; this factory does not add cross-process locking. Expiry is driven by checks, not a timer.

Route registration guard owns per-app inventory and a guarded-key set. Install before registration and exactly once. It records attempted literal paths in order, including duplicates that subsequently throw. Retrieval copies the array only; its entry objects remain shared. There is no uninstall or reset. Registrars retain the supplied dependency object; most mounting functions provide no disposer.

## SSE resources

Generic channel lifecycle: constructed/queued → open → closed. Enqueue before open supports replay. Backpressure pauses draining until response drain; queued events preserve FIFO. Overflow, terminal event, explicit end, write failure or response close marks closed. `open` is idempotent. Closure callbacks run once and run immediately when registered after closure. `abandon` marks closed without ending the response, allowing a pre-header JSON error; `end` also ends it. The channel does not own source subscriptions; consumers must unsubscribe in onClose.

The raw response opens headers and schedules keepalives on construction. It queues serialized frames and pings together; explicit close or request close clears queue/timer, invokes onClose and ends response. Closed sends are no-ops. No event-id replay/history is stored by either primitive. Throwing callbacks/formatters/sinks can escape; callbacks must not throw. Generic channel listeners remain attached to the response until it is collected.

## Verified origin and domain ports

`InMemoryOriginSettingRepo` validates/copies each seed, with later duplicate workspace seeds replacing earlier ones. Lists trim/lowercase hosts and are copied on read; origin records are also copied. It has no mutation, expiry or persistence API. `OriginRegistry` adds no cache: each decision reloads canonical evidence and, when necessary, its separate redirect or egress allowlist. The host owns registration and durable policy updates. Boot planning produces only a decision.

Evidence: rate-limit, route-registration-guard, generic/raw SSE and verified-origin repository source. No runtime checks were executed.
