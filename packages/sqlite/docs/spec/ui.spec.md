Spec ID: SPEC-JINI-SQLITE-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:d4b52215ad3af9fa49b737a239710ed2f6bca519b91eee27511fefada6ecfeb6
spec_mode: reverse_spec

# UI contract: @jini-ai/sqlite

The compatibility facade is headless. It re-exports storage/log/catalog helpers without components, routes, themes or UI assets. Hosts own schema/status presentation, owner authorization and recovery flows; catalog discovery and database inspection do not confer execution authority.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
