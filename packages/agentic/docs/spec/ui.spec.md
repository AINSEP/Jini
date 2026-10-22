Spec ID: SPEC-JINI-AGENTIC-UI
Version: 2.0.0
Last Edited: 2026-10-03T04:10:53Z
Hash: sha256:b1332a4760cb8f6e5279e6d3267db8f2ce24d5e319beb530e46742f54ec9245b
spec_mode: reverse_spec

# UI contract: @jini-ai/agentic

The package exports page/tool capability contracts, a DOM page driver, A2UI schemas/catalog/interpreter and skill-install helpers. It ships no React renderer, stylesheet or application shell. Hosts bind page navigation and DOM roots, render interpreter snapshots and route explicit action messages through authorization. Interpreter clocks use core Clock.nowMs(); sequence IDs retain their dedicated next({}) port. Agent handles annotate host DOM and do not confer permission.

Public data and wiring: [API](api.spec.md). Outcomes: [errors](errors.spec.md). Lifecycle: [state](state.spec.md). Runtime behavior: [behavior](behavior.spec.md). No UI/runtime checks were executed.
