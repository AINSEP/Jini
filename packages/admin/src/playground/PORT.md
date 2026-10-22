# Playground port — 2026-10-03

Active spec: owner admin-port-batch1 brief, version 1.0.0; continuation dispatch.

## Spec and pattern decision (before implementation)

Preserve the assistant whiteboard: no picker, no hardcoded output, no canvas children owned
by the page. The host's assistant renderer owns portals and falls back to inline chat when
the target is absent. Publish the canvas on attach and release it on detach. Stable refs
must not clear on an ordinary rerender. Scope the bus to each admin instance; lease-based
release prevents an older page from clearing a newer page's target. Read grants default
denied. No write grant is necessary to mount this passive canvas. Controllers and contracts
are framework-free; pages/tabs are lazy and ui-kit supplies notices/loading feedback.

Playground has NO server calls or HTTP routes in the source. The required HTTP entry records
that unsupported capability explicitly; it must not manufacture a server API for a DOM node.
Its test verifies that limitation. The real local adapter is the instance-local memory bus,
which is suitable for browser routing as well as tests. Cross-domain readers consume only
contracts/playground-render-target, never a playground implementation.

## Acceptance

Controller attach/detach/permission/disposal; bus subscriptions, idempotent writes, stale
release and isolated scopes; conformance against memory; explicit HTTP limitation; React
no-grants and read-only render, stable rerender, unmount, StrictMode and empty portal target.

## Source mapping and host swap

Playground.tsx → lazy page/tab and Canvas component; use-playground-canvas.hooks.ts →
controller and hook; lib/playground-render-target-bus.ts → shared contract and memory adapter.
Source rationale is retained in SOURCE-RATIONALE.md. CSS empty-sibling behavior remains.
Messages become English and the example prompt is product-neutral. Supply playgroundTargets
with playgroundRenderTargetToken; grant playground.read. The chat renderer subscribes to
the same host-owned port and portals into getSnapshot().target (a DOM node in browser hosts).
No singleton, chat implementation, HTTP transport or component registry is imported.

## Remaining / limitations

Host assistant routing, drawn-surface dismissal and styling are host-owned. The port accepts
opaque objects headlessly; a browser renderer must verify its target is a valid portal node.
No live assistant or real-browser validation. English only. No HTTP adapter is possible
without adding a new backend capability; HTTP support is explicitly false.

## Validation

Pending implementation and scoped commands. Exact results and inventory will be appended.

## Completed validation and file inventory

Commands from `/Users/la/Programming/Jini`:

- `pnpm --filter @jini-ai/admin exec tsc --noEmit` — exit 0.
- `env -u TOVU_ADMIN_PASSWORD pnpm --filter @jini-ai/admin exec vitest run src/playground` — exit 0, 3 files / 7 tests.

Initial CSS attribute selector exposed a jsdom/nwsapi selector parsing bug in a minimal probe;
class selectors preserve the original CSS-only behavior and pass visible/hidden assertions.
The React test generates fresh elements on rerender and exercises StrictMode. No browser
or live assistant checks. Baseline media test timed out (48/49 passed); it was not edited.

Brief SHA256: 75491ff8c01f3da8b680a791461028b0bc182fbcc5af597862d245553ae60469

Created:
- `packages/admin/src/playground/PORT.md`
- `packages/admin/src/playground/SOURCE-RATIONALE.md`
- `packages/admin/src/playground/__tests__/controllers.test.ts`
- `packages/admin/src/playground/__tests__/http.test.ts`
- `packages/admin/src/playground/adapters/http.ts`
- `packages/admin/src/playground/adapters/memory.ts`
- `packages/admin/src/playground/conformance/playground-api.conformance.ts`
- `packages/admin/src/playground/controllers/playground.controller.ts`
- `packages/admin/src/playground/index.ts`
- `packages/admin/src/playground/messages.en.ts`
- `packages/admin/src/playground/models.ts`
- `packages/admin/src/playground/playground.module.ts`
- `packages/admin/src/playground/ports.ts`
- `packages/admin/src/playground/react/__tests__/playground.test.tsx`
- `packages/admin/src/playground/react/components/Canvas.tsx`
- `packages/admin/src/playground/react/hooks/Canvas.hooks.ts`
- `packages/admin/src/playground/react/hooks/PlaygroundPage.hooks.ts`
- `packages/admin/src/playground/react/hooks/PlaygroundPorts.hooks.ts`
- `packages/admin/src/playground/react/index.ts`
- `packages/admin/src/playground/react/pages/PlaygroundPage.tsx`
- `packages/admin/src/playground/react/tabs/CanvasTab.tsx`
- `packages/admin/src/playground/rules.ts`
- `packages/admin/src/contracts/playground-render-target.ts`

Modified: `packages/admin/package.json` (five exports and matching jini.entries).
Suggested next assignee: host renderer integration owner.
