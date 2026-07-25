# `@jini/composio` admission status

`@jini/composio` is an **incubating integration package** and is not yet part
of the locked package set in `foundry/docs/jini-port/extraction-plan.md`.

The package is isolated as a concrete vendor adapter because Composio-specific
OAuth, connected-account, catalog, and execution behavior does not belong in
the product-neutral capability-port abstractions. Incubating means the code is
real and testable, but its long-term package admission, publication policy,
host wiring, and live-credential E2E evidence still require architecture and
Coordinator sign-off.

Current admission evidence:

- product-neutral package boundaries and injected host dependencies;
- source provenance in `source-map.md`;
- fail-closed ownership, schema, safety, output, persistence, and rate-limit
  controls;
- 100% statement, branch, function, and line coverage enforced for all source
  modules; and
- an explicit live Composio OAuth/tool-execution gap documented in
  `source-map.md`.
