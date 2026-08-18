---
"@jini-ai/http-kit": minor
---

Removed the `agui-stream` run-stream route: `RUN_STREAM_ROUTE_PATH`, `registerRunStreamRoute`, and
`handleRunStreamRequest` are no longer exported, and the route no longer mounts.

The route was named `agui-stream` from when Jini's own run-event protocol was mistakenly branded as
AG-UI; the TypeScript symbols were renamed to `GenUi` on 2026-07-27, but the URL was deliberately left
un-renamed on the assumption it was a wire contract an already-deployed client might be calling. A
2026-08-18 audit found zero callers anywhere — no client in this repo or in `Tovu` ever requested it,
`examples/reference-web`'s daemon only registered the route without anything ever calling it, and
`@jini-ai/http-kit` has never been published to npm, so no external integrator could depend on it either.
Rather than carry a dead, confusingly-named route indefinitely, it was removed outright.

`@jini-ai/agentic`'s `gen-ui` module (`createGenUiEncoder` and the six `GenUi*` event types) is
unaffected — it remains part of that package's public surface independent of this route.
