# @jini-ai/agentic

The framework-free half of agent control: everything an outside caller needs to drive a Jini
frontend, with no React, no DOM, and no transport baked in. Defines the capability vocabulary
(what a page may be asked to do), the `data-agent-*` markup convention a component uses to publish
itself, projections of that vocabulary onto WebMCP and genuine AG-UI, Jini's own six-event
run-stream protocol ("GenUI" — not AG-UI, despite the historical directory name), and a separate,
zero-DOM implementation of the real A2UI ("Agent-to-UI") wire protocol. A framework binding (this
repo's own `@jini-ai/chat-react`, or a future Vue/Svelte sibling) imports from here and adds only
the DOM/transport wiring its framework needs; a server-side host (an HTTP route table, an MCP
stdio server) imports the same manifests, so client and server can never drift apart.

## Install

```sh
npm install @jini-ai/agentic
```

No peer dependencies. `@jini-ai/protocol` and `zod` are regular dependencies. The `./dom` entry
point additionally needs a real DOM (browser or jsdom) at runtime — see Entry points below.

## What you get

- **Capability vocabulary** — `CapabilityDef`/`CapabilityInputSchema`/`CapabilityRisk`
  (`'read' | 'write'`)/`CapabilitySurface` (`'session' | 'server'`), `findCapability`,
  `findCapabilityInputError` (validates caller input against a capability's declared schema),
  `availableCapabilities`.
- **The generic page-capability manifest** — `PAGE_CAPABILITIES` (`page.find_elements`,
  `page.click`, and friends — every verb addresses a published `data-agent-element` handle, never
  a caller-supplied selector or script), `PageDriver`/`FindElementsFilter`, and
  `executePageCapability(driver, capabilityId, input)` to run one.
- **The `data-agent-*` markup convention** — `agentHandle('save', { role, label, page })` returns
  spreadable attribute props (pure data, works with React/Vue/Svelte/anything); plus the
  attribute-name constants, `AGENT_ELEMENT_ROLES`, `isValidElementHandle`, and
  `resolveHandleSelector` for a driver to resolve a handle back to a DOM node.
- **Field guards** — `findFieldFillRefusal`/`findFieldReadRefusal` and their `describe*Refusal`
  pair, the refusals that must hold everywhere a capability writes to or reads from a form field.
- **WebMCP projection** — `toWebMcpTool`/`toWebMcpTools`, `isValidWebMcpToolName`,
  `WebMcpConfirmationRequiredError`/`InvalidWebMcpToolNameError`.
- **Genuine AG-UI projection** — `toAgUiTool`/`toAgUiTools`, `createAgUiToolResult`,
  `AG_UI_TOOL_CALL_EVENTS`. Real conformance: emits AG-UI's own `parameters` field name and its
  canonical `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END` event names.
- **GenUI run-stream protocol** (`./gen-ui`, re-exported at root) — `createGenUiEncoder` and the
  six dotted-lowercase event kinds (`GenUiEvent`: `agent.message`, `tool_call`, `state_update`,
  `ui.surface_requested`, `ui.surface_responded`, `run.lifecycle`). **Not AG-UI** — it shares zero
  event names with the real protocol above; it's a de-branded port of one product's own run-event
  adapter, renamed from `Agui`/`AGUI` to `GenUi` on 2026-07-29 to stop the two reading as one.
- **MCP-UI apps wire helpers** — `MCP_UI_VIEW_METHODS`/`MCP_UI_HOST_NOTIFICATIONS`/
  `MCP_UI_HOST_REQUESTS`, `JINI_PAGE_ACTION_METHOD`, `isJsonRpcRequest`/`createJsonRpcRequest`/
  `createJsonRpcResult`/`createJsonRpcError`/`createPageActionRequest`.

## Usage

```ts
import { PAGE_CAPABILITIES, executePageCapability, agentHandle, type PageDriver } from '@jini-ai/agentic';

// A component publishes itself once, in whatever framework renders it:
// <button {...agentHandle('save', { role: 'button', label: 'Save changes' })}>Save</button>

declare const driver: PageDriver; // e.g. createDomPageDriver(...) from '@jini-ai/agentic/dom'

const elements = await executePageCapability(driver, 'page.find_elements', { role: 'button' });
console.log(PAGE_CAPABILITIES.map((c) => c.id)); // every verb an outside caller may invoke
```

## Entry points

| subpath | what's behind it | extra dep it pulls in |
|---|---|---|
| `.` | Capability vocabulary, `PAGE_CAPABILITIES`, `data-agent-*` markup helpers, WebMCP/AG-UI projections, GenUI protocol, MCP-UI wire helpers. Zero DOM, zero transport. | none beyond `@jini-ai/protocol`, `zod` |
| `./dom` | `createDomPageDriver`/`currentAgentPage` — the one `PageDriver` that reads and writes a real DOM subtree, compiled under its own DOM-lib `tsconfig`. Also WebMCP feature detection (`getAgentModelContext`). `@jini-ai/chat-react` is its one in-repo consumer. | a real DOM (browser or jsdom) |
| `./a2ui` | The real A2UI v1.0 wire types and a minimal client-side interpreter (`common-types`, `agent-to-renderer`, `renderer-to-agent`, `catalog`, `json-pointer`, `resolve`, `tree`, `interpreter`) — zero DOM dependency. | none |

## What's swappable

`PageDriver` is the seam: `executePageCapability` and every `page.*` verb work against whatever
implementation you hand them — `createDomPageDriver` from `./dom` is the shipped one, but a
non-DOM host (a native app, a canvas-based renderer) can implement `PageDriver` itself.
`toWebMcpTool`'s `execute` callback and `WebMcpRegisterToolOptions` (`signal`, `exposedTo`) are
likewise caller-supplied. Fixed: `PAGE_CAPABILITIES`' verb list and schemas, the `data-agent-*`
attribute names, and the wire shapes of both the GenUI and A2UI protocols.

## Runtime

`jini.runtime: "universal"` for `.` and `./a2ui`; `./dom` is `"browser"` (needs a real or jsdom
DOM at runtime — see Entry points above).
ESM only — ships `"type": "module"` with no CommonJS `require` build.

## Provenance

See [source-map.md](./source-map.md) for per-file provenance, the AG-UI/GenUI naming history, and
the A2UI spec-parity gap list. Apache-2.0, inherited from Open Design — see the repo `NOTICE`.
