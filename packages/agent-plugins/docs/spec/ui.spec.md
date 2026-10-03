Spec ID: SPEC-JINI-AGENT-PLUGINS-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:98a6d6bfbe98f7d4546d22129e4c64a5e7eacfce8f1d76aeaec0c31da31e1f03
spec_mode: reverse_spec

# UI contract: @jini-ai/agent-plugins

The package exposes plugin metadata, lifecycle operations and a portable UI/design asset bundle. Static bundled client examples are assets; importing them does not mount an application. Hosts present install/activation/uninstall progress and confirmation from lifecycle outcomes, and own routing, localization, styling, keyboard access and focus. The package supplies no React component or admin shell.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
