Spec ID: SPEC-JINI-SERVER-BEHAVIOR
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:1af81e5fccbc5dd9d3e22aebc307c83e054ddefac80e00bd896b619c90b7a3b0
spec_mode: reverse_spec


# Behavior contract: @jini-ai/server

## Activation and ordering

- The activation resolver shall validate duplicate feature IDs, unknown feature/capability overrides, explicit enable under denied capabilities, and unmet active-feature dependencies before a kernel is opened.
- Capability grants shall form a ceiling. Explicit feature enable shall not bypass a denial. Under core-only, features providing only core capabilities (or none) shall default on; raising another capability ceiling alone shall not enable its feature. Under all-permitted, permitted features shall default on unless explicitly disabled.
- The actual CORE_CAPABILITIES shall be run:transport, agent:discovery and tool:delegated. agent-core-v1 grants those three; local-daemon-v1 also grants tool:catalog, host:read, host:exec, db:admin, net:egress and daemon:control. Neither shipped profile grants run:inject, memory:store, routines:schedule, media:generate or ui:session.
- WHEN selected features compose, the kernel shall register feature tools, host registrations and caller-pack tools before afterTools hooks and any HTTP route mounts. Duplicate tool IDs shall fail rather than shadow earlier handlers.
- Routes shall mount in this order: probe routes, strict bearer gate when selected, optional JSON parser, selected origin/local bearer gates, API features in catalog order, onAfterApiRoutes, status features. Disabled features shall contribute neither routes nor tools.
- Feature dependencies shall be validated as a set, not topologically sorted; actual composition remains in catalog order. Caller pack HTTP mounting shall remain the host hook's responsibility.

## Security and defaults

- Embedded composition shall default to security mode host and install no global bearer/origin middleware. The host shall supply authentication/origin policy; individual route guards retain their own checks. Malformed allowed-origin configuration shall still fail at composition start in every security mode.
- The standalone preset shall default to loopback, ephemeral port, local-daemon-v1 and the local bearer/origin gate. The local gate trusts loopback; it is not strict same-user process isolation.
- WHERE sidecar-strict is selected, `/api` bearer checking shall occur before body parsing, require a configured host-named token, and return an unavailable response when no token is configured. Exact exempt paths are host-authored gate exceptions; probes mounted earlier do not require API authentication.
- The anonymous delegated Principal shall have no roles. Its identity alone shall not prevent execution of a permissive tool lacking an internal permission check. Hosts shall supply a resolver/policy for the intended authority.
- Resource working-directory lookup shall default to denial. Prompt/context/credential composition shall remain host-supplied. When neither onRunStarted nor resolveRunInput is present, starting a run shall not automatically spawn an agent.

## Resource lifecycle and limits

- SQLite base storage shall acquire events.db, journal.db and a separate feature connection to events.db; memory storage shall acquire no database files. Byte journaling shall use a different EventLog instance from public run events.
- The base shall await lifecycle rehydration before it is returned. Storage acquisition/rehydration failure shall attempt cleanup of every acquired handle and preserve the boot failure.
- Listener URL shall report the actual bound port. Wildcard hosts shall report 127.0.0.1; IPv6 literals shall be bracketed. Discovery write/remove shall be best-effort and never be the cause of boot/stop failure; removal shall only target the current process record.
- stop shall share one promise across repeated/concurrent calls. It shall mark shutting down, close HTTP, dispose features and caller packs, remove discovery, run onShutdown and close the base, including base cleanup after a host hook rejection.
- closeHttpServer shall return immediately for a non-listening server. Defaults are 1000 ms idle grace and 5000 ms hard ceiling. At the hard deadline it shall force-close connections when supported and resolve even if the normal close callback has not fired.
- installGracefulShutdown shall be opt-in and handle SIGTERM/SIGINT by default. Repeated signals shall not call stop twice. A resolved stop exits 0; rejection or the 10000 ms deadline exits 1. uninstall removes signal handlers; it does not cancel a shutdown already running.

## Legacy storage behavior

- Backend resolution shall normalize the backend kind and use parseInt(port) || 5432; it shall not validate TCP port bounds or supply a PostgreSQL connection.
- Legacy openDatabase shall require an opener, cache one file path, and close the old singleton before opening a different path. Explicit migrate shall bootstrap tables without a versioned migration ledger.
- Project lists shall order updatedAt descending. Status projections shall normalize status spellings; awaiting-input queries shall find the latest form-bearing assistant turn without a later user reply. They do not require that turn to be the latest assistant turn overall.
- Legacy project adapters shall perform no authentication, owner filtering, request throttling or cross-table migration. Host schema supplies cascades.

## Native host semantics

Bind hosts preserve trimmed stringification, including nonstrings. HTTP close resolves on callback success or hard timeout, whichever arrives first. Core grants include transport, discovery and delegated tools. Anonymous identity remains role-less; host tool policies and internal authorizers supply its authority ceiling. Awaiting-input selects the latest form-bearing assistant without a later user reply; a newer plain assistant does not consume that form. The corresponding comments now describe these semantics.

No endpoint-wide rate-limit or idempotency layer is supplied by the host assembly itself. Each mounted concern owns its own route contract. Evidence: source plus composition, activation, shutdown, kernel and storage tests, read only.

Decision rationale: [Boot failure closes every resource already acquired](../decisions/DR-001-partial-boot-rollback.md).
