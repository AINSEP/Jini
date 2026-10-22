Spec ID: SPEC-JINI-PLUGINS-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:786f92d287356d3f19873517cbde4c9aa965156ac184fbf0b81ed495abdd3971
spec_mode: reverse_spec


# Behavior Rules: Plugin Glue

## Validation and dispatch

- WHEN validating a manifest, the package shall collect errors in key, id, version/range, capability, then attachment order without mutating the input.
- IF the root is null, an array, or a non-object, THEN validation shall return one `MANIFEST_MALFORMED` error.
- The validator shall accept only the five top-level keys; require an id matching `^[a-z0-9-]+$` with length 1–50; require string version and SDK range; and check each capability and attachment call site against the supplied vocabulary. It does not parse semantic versions or SDK ranges, reject duplicate declarations, or validate attachment payloads.
- WHEN dispatching an attachment, the package shall call the delegate exactly once only when the supplied wired-call-site list includes the call site. Validation vocabulary and wiring vocabulary are separate inputs.
- IF a delegate throws, THEN synchronous dispatch shall propagate that error. A returned promise is returned inside `result`, without awaiting.

## Capability guards

- WHEN building a capability gate, the package shall snapshot grants and delegate references, create a null-prototype handle, and freeze it.
- IF a vocabulary slot is undeclared, missing an own delegate property, or has a non-function delegate, THEN invocation shall throw `GlueCapabilityDeniedError`.
- WHEN invoking a granted slot, the handle shall forward the caller's arguments to the snapshotted delegate. No slot exists for capabilities outside the vocabulary.
- The consumer shall perform manifest validation separately; building a gate does not validate a manifest or authorize a principal.

## Registration ordering and containment

- WHEN merging modules, the package shall process them in input order, reserving core ids first and earlier successfully registered module ids next.
- IF building a module throws, its batch contains an internal duplicate id, or it collides with reserved ids, THEN the module shall be quarantined and later modules shall continue.
- IF the host registration call throws, THEN the module shall be quarantined without claiming its ids. The host shall ensure its failed registration produced no partial mount.
- WHEN forwarding content filters or event subscriptions, the package shall pass references through directly and propagate host errors.

## Defaults, limits, and scope

Optional records default to `{}`. There is no retry, timeout, scheduler, rate limit, cross-call deduplication, persistence, uninstall, subscription cleanup, execution sandbox, UI renderer, or built-in vocabulary. Repeating registration or subscription calls repeats host effects; the package supplies no idempotency key. A gate retains references for its lifetime, but the package has no store lifecycle requiring a state contract.

Evidence: `src/glue/manifest.ts`, `capability-gate.ts`, `dispatch.ts`, `attachment-points/*.ts`; inspected tests cover collect-all validation, snapshot ownership, denied slots, reference forwarding, duplicate quarantine, and host registration failures. Fixture vocabulary sizes in tests are host examples, not package limits.

Decision rationale: [Attachment vocabulary and failure containment are separate decisions](../decisions/DR-001-category-specific-glue-containment.md).
