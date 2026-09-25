---
"@jini-ai/http-kit": minor
---

Publish a route manifest so a reverse proxy stops hand-copying path strings.

A host proxying a Jini daemon in another process needs that daemon's route list to forward anything,
and with no published inventory the only way to build one was to copy path strings by hand. A
hand-copied list falls behind the moment a family gains a route — which has already happened in a real
consumer, whose proxy shipped without `GET /api/runs` and left the daemon's list endpoint 404-ing at
the host's own router.

`JINI_ROUTE_MANIFEST`, `routeFamilyManifest(family)`, and `manifestRoutesForFamilies(families)` expose
`{method, path}` per feature family as inert data, readable without mounting anything.

The manifest declares **no method or path literals** — every entry is derived from the same
`JsonRouteSpec` constant the family's `register*Routes` mounts, so a path change moves the manifest with
it. A paired test mounts each declared family's real registrar and asserts the manifest matches, so the
one remaining failure mode (a family gains a route nobody lists) fails a test instead of a consumer.

That test earned its keep immediately: it found that the `runs` family mounts a spec-less streaming
route, `/api/runs/:runId/events`, that a hand-copied proxy list could easily miss. `RUN_EVENTS_ROUTE_PATH`
is now exported so it never has to be restated as a literal.

Scope is honest: the manifest covers the families a sidecar consumer proxies, not all 19 the package can
mount. `routeFamilyManifest` returns `undefined` for an undeclared family rather than an empty array, so
"not described here" is never mistaken for "has no routes".
