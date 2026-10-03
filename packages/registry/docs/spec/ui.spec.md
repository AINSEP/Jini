Spec ID: SPEC-JINI-REGISTRY-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:a5f3adc72a2746a549138d26345d6489968ddc0a8015f686f9684adeeb3b1ed6
spec_mode: reverse_spec

# UI contract: @jini-ai/registry

The registry is headless. Backends and catalog/builder entries expose discovery, trust and search results without a catalog browser, install screen or stylesheet. The host renders verification status, applies admission policy and resolves discovered IDs against a current authorized executor. Search descriptions are authored text; enrichment is indexing material.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
