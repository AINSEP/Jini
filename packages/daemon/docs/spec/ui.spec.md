Spec ID: SPEC-JINI-DAEMON-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d3573c85ecf23ba92f497381aa40733ad32988f0c2a44fe63e023b50d234dc9f
spec_mode: reverse_spec

# UI contract: @jini-ai/daemon

The daemon package is headless. Domain HTTP routes moved to its `/http` entry; exchange/frontend-session contracts send data to a host renderer. A surface exchange accepts explicit confirmation decisions and does not turn typed prose into consent. The host owns chat, confirmation UI, attachment selection, terminal presentation, routing, session authority and shutdown. No application stylesheet or visual shell is supplied.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.

Decision rationale: [DR-001-remote-tool-event-recording](../decisions/DR-001-remote-tool-event-recording.md), [DR-002-explicit-subprocess-environment](../decisions/DR-002-explicit-subprocess-environment.md).
