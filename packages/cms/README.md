# `@jini-ai/cms`

Content-model capability for Jini-hosted products.

> **Status: placeholder.** No implementation yet. The package builds, typechecks, and has a green
> suite so the first port commit lands on working infrastructure rather than discovering it is
> broken. Created 2026-08-02.

## Layers

| subpath | runtime | contents |
|---|---|---|
| `.` / `./core` | universal | Content contracts and types, ports, pure domain services, kernel registries. No Express, no `node:*`, no DOM. |
| `./server` | node | Concrete adapters for the ports in `/core`: SQLite/Postgres repositories, filesystem blob stores, image transformers. |

`/server` depends on `/core`. The reverse is a boundary violation — if a core module wants
something from `/server`, the dependency is backwards and the fix is a port (interface) in core,
not a widened export.

`./server` means *the Node-bound layer*, not *the HTTP server* — same convention as
`@jini-ai/admin`. HTTP transport is out of scope; Jini has `@jini-ai/http-kit` and
`@jini-ai/server`.

## Why the split exists before there is any code to split

The source of this port is an existing CMS runtime, and the boundary is drawn where a measured defect was.

There, the content model and its HTTP composition root share one `src/` tree with nothing
enforcing a boundary between them. Measured 2026-08-02:

- **53 import edges point into the composition root.** 22 of them are domain modules importing a
  454-line `RouteDeps` type whose first line is `import type { Express } from "express"`.
- **Git history shows the cost:** no content module could be changed without also changing the
  server. `features/theme` and `server` co-changed in 71% of commits touching the former;
  `identity` and `server` in 45%.
- **33 of 38 modules formed a single strongly-connected component** — none could be extracted
  without dragging the other 32.

The decomposition itself was sound (propagation cost 11%, a textbook Martin instability gradient,
domain modules that essentially never co-change with each other). What was missing was
*enforcement*. Full analysis: `ADS-memory/reports/refactors/2026-08-02-module-graph-analysis.md`
in the originating repo.

A package's `exports` map is precisely the enforcement a single `src/` tree cannot provide. A
consumer of `@jini-ai/cms/core` physically cannot reach a Node adapter, and `/core` physically
cannot import a transport type, because the module resolver refuses. Porting into this shape from
the first commit means that failure mode cannot recur here.

## Port inventory

Not yet moved. Order matters for the first item only.

**Kernel first** — the source repo's `src/core/{ports,commands,events,tools}` — because every domain module
depends on it.

**Then domain modules, in any order.** The source repo's git history shows domain modules essentially never
co-change with each other, so each can be ported independently without coordination: `post`,
`taxonomy`, `entries`, `content-types`, `media`, `seo`, `comments`, `forms`, `navigation`,
`redirects`, `widgets`, `newsletter`, `members`.

**Explicitly not ported:**

- `src/server/**` — Express composition root; superseded by `@jini-ai/http-kit` / `@jini-ai/server`.
- Admin UI — `@jini-ai/admin` already owns that surface.

When porting tests, `git mv` them rather than re-authoring: re-authoring costs a full pass and
still loses coverage.

## Scripts

```bash
pnpm --filter @jini-ai/cms build
pnpm --filter @jini-ai/cms typecheck
pnpm --filter @jini-ai/cms test
```

## Notes for the first real commit

- **Add coverage thresholds.** `vitest.config.ts` deliberately has none — on a placeholder they
  would be either vacuously true or an immediate blocker. Set them against what the first ported
  module actually measures. Siblings run 98–100%.
- **Delete the layer markers.** `CMS_CORE_LAYER` and `CMS_SERVER_LAYER` exist only to give the
  entry points something real to resolve. They have no purpose once real exports land.
- **Replace `src/core/__tests__/layers.test.ts`.** It proves the package wiring, not behavior.
