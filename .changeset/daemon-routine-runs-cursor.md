---
"@jini-ai/daemon": minor
---

`RoutineStore.listRuns` returns a `{ items, nextCursor }` page and takes an optional `cursor`; `GET /api/routines/:id/runs` answers `nextCursor` and accepts `?cursor=`.
