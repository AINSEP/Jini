Spec ID: SPEC-JINI-PLUGINS-STATE
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:ee5979a98e160eb79796cd04af1043f957e8b2e92c306e01b1ed5c5e0a351bb9
spec_mode: reverse_spec

# Plugin glue state and lifecycle contract

Manifest validation and call-site resolution allocate only returned data. Capability-gate construction captures the host module ID, declared capabilities and delegates in a frozen gate map. Dispatch is synchronous and owns no queue; a Promise returned by a delegate remains the result value.

Content filters/event handlers/nav/render/HTTP contributions are registered through host ports. Their lifetime, teardown, ordering, storage and authorization remain host owned; these attachment helpers return no disposer. Tool merging processes modules in order, quarantines a throwing or duplicate-ID module and requests atomic registration for accepted modules. Quarantine is a returned report, not a durable registry or retry queue.

No package-level singleton, persistent store, timer, automatic unsubscribe, module reload or shutdown supervisor is supplied. Host snapshot/restore/change-set effects retain the host lifecycle. [API](api.spec.md), [behavior](behavior.spec.md), [errors](errors.spec.md).
