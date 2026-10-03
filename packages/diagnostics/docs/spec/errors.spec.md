Spec ID: SPEC-JINI-DIAGNOSTICS-ERRORS
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:8f55d505320c84bd4685dbabe198892f218131d91b0eaf6b06ae75b979048f7a
spec_mode: reverse_spec


# Diagnostics error contract

| Surface | Error or result | Trigger | Caller response |
|---|---|---|---|
| DNS validators/checks | `DomainDnsInputError({ message })`; name `DomainDnsInputError`, no code | Invalid public name, duplicate/unknown/empty record types, or expectedHost absent from saved candidates | Correct input/selection; do not retry unchanged |
| Observability config | `TypeError`, no code | Enabled telemetry with blank serviceName or tracerName | Fix host configuration |
| Log collection | `CollectedFile { content: null, bytes: 0, error: string }` | Read or redaction failure, including non-Error throws stringified | Display warning; retry after source becomes available |
| Log/crash discovery | Empty/partial sources | Unreadable directory, failed stat, non-Darwin crash search | Treat as omitted evidence, not clean logs |
| Browser adapter open | `{ available: false, reason }` | Module import or Chromium launch failure | Surface unavailable capability; host provisions runtime separately |
| Browser observe | `{ ok: false, reason }` | Navigation failure/no response or capture failure | Preserve the page failure and continue other pages |
| Browser lifecycle | Propagated port errors | Context creation, context/browser close, or throwing factory | Handle as operation failure; teardown errors can override an earlier result |
| Origin/policy | Propagated host errors | Missing verified origin, invalid base URL, policy failure | Correct host boundary; never guess an origin |
| Bundle generation | Propagated archive/system/clock errors | Archive creation/write/generate, invalid clock date, machine snapshot failure | Report export failure; no automatic retry |
| Custom redaction rules | Propagated replacement errors | Host callback throws | Repair redaction policy before exposing raw content |

`normalizeSitePath` returns a rejection rather than throwing for typed string input. `SitePathRejectionReason` exports: `empty`, `too-long`, `absolute-url`, `protocol-relative`, `backslash`, `not-absolute-path`, `forbidden-character`, `traversal`. `not-absolute-path` has no current producer because missing leading slashes are repaired. Wrong runtime input types can still throw.

Collection `SkippedPageReason` exports: `invalid-path`, `page-cap`, `deadline`, `browser-unavailable`, `off-origin-redirect`, `navigation-failed`. Interpret each as uncollected evidence; none establishes that the underlying page is safe or compliant. Port observe throws are converted to navigation-failed per page. Factory/origin errors and final browser close errors propagate. Some policy failures are caught by the per-page catch and converted through redactMessage; a failing redactMessage can escape that catch.

DNS status `not-found`/`no-data`, comparison `unknown`/`mismatch`, and TLS `invalid`/`unavailable` are returned data, not exceptions. Authorization/resolver/TLS errors propagate without a package error envelope. Observability setup and hook exceptions propagate; completion is already latched, so calling end again does not replay failed hooks.

No common numeric error code or HTTP response mapping is defined. Hosts must map errors at their own boundary and redact any upstream messages before display.
