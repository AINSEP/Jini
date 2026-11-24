# import-handoff

The receiving half of an "open Import in the desktop app" hand-off: each hand-off opens the Import
tab, typing in its address first when the host's validator accepts it and no import is running.

Entry: `@jini-ai/ui/import-handoff` — `useImportHandoff` (standalone hook the host calls),
`handoffAddress`, and the structural `ImportHandoffBridge` port. The main-process forwarding half is
`@jini-ai/desktop-host/electron/handoff`.

## Wiring

The host injects `getBridge` (its preload bridge lookup, a stable function; channel names stay
host-owned), `accept` (its Import page's own address validator), and the Import page's `busy`,
`prefill` and `open`. The host's import hand-off adapter supplies the bridge lookup and validator;
its app root calls that adapter with the Import page's state.
