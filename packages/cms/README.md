# `@jini-ai/cms`

Content-model capability for Jini-hosted products.

> **Status: implemented, port in progress.** Created 2026-08-02 as an empty shell; the port has
> been landing since. Measured 2026-09-05 at `v0.3.4`: 131 non-test source files / 21,718 lines
> under `src/` (34,938 including tests), 11 domain trees, and 14 public subpath exports wired in
> `package.json`. Some domain modules named under [Port inventory](#port-inventory) have not moved
> yet — check `src/` and the `exports` map for what is actually reachable today rather than
> trusting this paragraph's counts.

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

The kernel went first — the source repo's `src/core/{ports,commands,events,tools}` — because every
domain module depends on it. Domain modules followed in no particular order: the source repo's git
history shows they essentially never co-change with each other, so each ports independently without
coordination.

**Landed** (directories under `src/`, each with its own subpath export):
`core`, `content-types`, `entries`, `identity`, `media`, `navigation`, `presentation`, `settings`,
`taxonomy`, `workspace`, and the `server` adapter layer.

**Still to move:** `post`, `seo`, `comments`, `forms`, `redirects`, `widgets`, `newsletter`,
`members`. (`widgets` has an `exports` entry but no `src/widgets/` tree yet.)

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

## Open cleanup

- **Add coverage thresholds.** `vitest.config.ts` still has none. That was a deliberate omission
  while the package was a placeholder; it no longer is, so the reason has expired. Set them against
  what the ported modules actually measure — siblings run 98–100%.
- **Delete `CMS_SERVER_LAYER`** (`src/server/index.ts`). It existed only to give the `/server`
  entry point something real to resolve, and real exports have since landed. Its `/core`
  counterpart `CMS_CORE_LAYER` is already gone.
