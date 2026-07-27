# Plan: extract `@jini/agentic`

**Status:** Decided, ready to execute. Decisions here are settled — this is an execution plan, not
a proposal. Written 2026-07-26.

**Why:** the agent-facing surface is scattered across three packages, and the vocabulary + policy
half lives inside `@jini/chat-core` despite having nothing to do with chat. A consumer who wants a
non-chat surface to be agent-drivable must today depend on the chat package — which
`examples/minimal-host` exists to catch.

---

## 1. Shape

One package, two entry points. Deliberately not two packages: the sprawl count is already 23
against a locked set of 14.

```
packages/agentic/
├── src/
│   ├── index.ts            → "@jini/agentic"       universal, DOM-free
│   │   capability.ts         CapabilityDef, risk/surface, findCapabilityInputError
│   │   guards.ts             FieldDescriptor, refusals, normalizeAgentLabel
│   │   element-handles.ts    attribute constants, handle validation, selector resolution
│   │   page-driver.ts        the PageDriver port
│   │   page-executor.ts      policy enforcement — the gate
│   │   page-capabilities.ts  the page.* manifest
│   │   ag-ui.ts              CapabilityDef → AG-UI frontend tool
│   │   mcp-ui.ts             MCP Apps (SEP-1865) envelope
│   │   webmcp.ts             CapabilityDef → WebMCP tool
│   │   handle.ts             NEW: agentHandle('save') → attribute props
│   └── dom/
│       └── index.ts        → "@jini/agentic/dom"   browser
│           dom-page-driver.ts
```

## 2. What moves

| from | to |
|---|---|
| `chat-core/src/agentic/{capability,guards,element-handles,page-driver,page-executor,page-capabilities,ag-ui,mcp-ui,webmcp}.ts` | `agentic/src/` |
| `chat-react/src/agent-bridge/dom-page-driver.ts` (+ its tests) | `agentic/src/dom/` |
| `chat-core/src/__tests__/agentic/**` | `agentic/src/__tests__/` |

## 3. What deliberately does NOT move

- **`chat-core/src/agentic/chat-capabilities.ts`** stays. `chat.send_message`, `chat.set_draft`,
  `chat.select_agent` are a genuine chat product surface. chat-core keeps them and depends on
  `@jini/agentic` for the vocabulary. This is the proof the split is real rather than a wholesale
  relocation — if everything moved, the boundary would be fake.
- **`chat-react/src/agent-bridge/frontend-session-bridge.ts`** stays. Chat-pane transport.
- **`@jini/mcp`** stays its own package. It is a shipped MCP *server* (`bin: jini-mcp`, deps
  `@jini/cli` + `@modelcontextprotocol/sdk` + `undici`, `runtime: node`, OAuth/token/config).
  Folding a node server binary in would drag the CLI and MCP SDK into a package whose root must
  stay universal. A transport is not a vocabulary.
## 3a. REVISED 2026-07-26 — `@jini/agui` folds IN

This plan originally kept `@jini/agui` out, on the grounds that it was "a transport, and a
transport is not a vocabulary." **That was factually wrong** and the code says so.

`packages/agui/src/` is three files — `types.ts`, `encode.ts`, `index.ts` — with **zero I/O**: no
node builtins, no fetch, no http, no streams. `createAguiEncoder()` is a pure
`RunProtocolEvent → AguiEvent` transform, `runtime: universal`, depending only on `@jini/protocol`.
The actual SSE lives in `@jini/http`, per agui's own module doc: *"a composition root supplies
`createAguiEncoder()` to `@jini/http`'s encoder-driven SSE."* Seeing `daemon.ts` in its consumer
list and reading that as "server infrastructure" was the error — where a pure function is *called*
does not determine where it *belongs*.

So it is the same category as `ag-ui.ts`, and keeping them apart leaves two packages knowing AG-UI.

**Do:** fold `packages/agui/src/{types,encode,index}.ts` into `packages/agentic/src/` alongside the
projections, and delete the package. Consequences: `agentic` gains a dependency on
`@jini/protocol` (a dependency-free leaf — no cycle); agui is `incubating`, so folding it into an
admitted package promotes it, which must be recorded in `UNLOCKED.md`;
`examples/reference-web/src/daemon.ts` changes one import; net package count is unchanged
(`+agentic, −agui`).

**The organizing principle this settles:** `@jini/agentic` houses every agent-protocol projection
and encoder — AG-UI, WebMCP, MCP-UI, and whatever comes next — so protocol knowledge lives in one
place. What stays out is infrastructure that *serves* a protocol (`@jini/mcp`'s server binary,
`@jini/http`'s SSE), never the encoding of it.

This is step 4a in §8, to be done in the follow-up dispatch.

## 4. What dies

`packages/ui/src/features/agent-tools/types.ts`'s rival attribute vocabulary —
`data-agent-target`, `data-agent-field`, `data-agent-form`, `data-agent-action`. It declares a
second convention for the same job with no driver, no guards, and no consumer:
`useDeclarativeAgentTargets`, the hook its own module doc says scans for these, exists nowhere but
that comment, and `react/hooks/` is empty.

Two conventions is how a second ungated execution path gets built. chat-core's
(`data-agent-element/-role/-page/-label`) wins — it has the driver, the guards, and 615 tests.

`model-context.ts` (WebMCP feature detection) folds into `agentic/src/webmcp.ts`.

## 5. Dependency arrows

```
@jini/ui         ─┐
@jini/daemon     ─┼──▶ @jini/agentic ──▶ (nothing today; chat-core is a dependency-free leaf)
@jini/chat-core  ─┘
@jini/chat-react ─────▶ @jini/agentic/dom
```

No cycles. `chat-core` currently has **zero** `@jini` dependencies, so this is a clean lift with
nothing to untangle.

Unrelated but adjacent: `chat-react` (browser) → `agent-runtime` (node) exists today, `import type`
only, in `features/model-picker/types.ts`. Erased at compile time, so it is inert. The real fix is
to move the five shared types (`AgentDefinition`, `AgentDiagnostic`, `CredentialStatus`,
`ModelCatalogOption`, `ModelProvider`) into `@jini/protocol`. **Out of scope for this plan** —
noted so it is not rediscovered as a surprise.

## 6. Package metadata — and the one real exception needed

```json
{ "jini": { "domain": "agent", "kind": "capability-surface",
            "runtime": "universal", "admission": "incubating" } }
```

`admission: incubating` per `packages/README.md`, with an entry in `UNLOCKED.md` recording its
promotion requirements. **Note the consequence:** incubating packages "cannot be imported by
locked/admitted packages," and `chat-core`/`chat-react` are `locked`. So either this lands as
`incubating` and the guard blocks the very imports the extraction needs, or it is admitted at
creation on the grounds that it is a relocation of already-locked code rather than new surface.
**Decision: admit at creation** — the code is already locked inside `chat-core`; moving it must not
downgrade its standing. Record the reasoning in `UNLOCKED.md` regardless.

**The genuine exception:** `jini.runtime` is a single value per package and `pnpm guard` validates
it. A package with a `universal` root and a `browser` `/dom` entry cannot be described by one
value. Needs either a per-entry runtime field (e.g. `jini.entries: {".": "universal", "./dom":
"browser"}`) or a documented exception. Prefer the metadata extension — it is the honest model and
other packages will want it.

## 7. Keep the DOM-free guarantee structural

`chat-core/agentic`'s module doc leans on *"this package compiles with `lib: ES2023` and holds no
browser globals, so the DOM cannot appear in it"* — that is what proves policy cannot quietly reach
into a node. With `src/dom/` in the same package, that is no longer free.

Replace it with a guard rule: **nothing outside `packages/agentic/src/dom/**` may reference a DOM
global.** House style already — `scripts/check-protocol-purity.ts` and `check-engine-boundaries.ts`
do exactly this, each with a self-test against a known-bad fixture. Write the self-test; a doc
comment claiming enforcement is precisely the `@jini/core/internal` mistake.

## 8. Execution order

Each step ends green. Do not batch.

1. Scaffold `packages/agentic` — `package.json` (two exports, two tsconfigs), `tsconfig.json`,
   `vitest.config.ts`, `source-map.md`, `UNLOCKED.md` entry.
2. Move the nine universal files + their tests. `git mv`, so history follows.
3. Move `dom-page-driver.ts` + tests into `src/dom/`.
4. Re-point `chat-core` (keeps `chat-capabilities.ts`, now imports `@jini/agentic`), `chat-react`,
   `daemon`, and any example.
5. Add `handle.ts` (`agentHandle`) and have `@jini/ui` depend on `@jini/agentic` for it.
6. Delete `ui/src/features/agent-tools/`, folding `model-context.ts` into `webmcp.ts`.
7. Add the DOM-purity guard rule + its self-test.
8. Extend the metadata model for per-entry runtime, or record the exception.

## 9. Definition of done

- `pnpm typecheck` and `pnpm guard` clean from the repo root.
- Package suites green and **at their current counts or higher**: chat-react 615, chat-core 393,
  ui 4274. A move must not lose a test — report the number for the new package too.
- `rg "@jini/chat-core/agentic"` returns nothing.
- `examples/minimal-host` still builds — it is the neutrality gate this whole extraction serves.
