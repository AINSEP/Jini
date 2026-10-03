# Ask-choice tool

Import from `@jini-ai/mcp/tools/ask-choice`. This additive subpath collects an answer;
the host remains responsible for actions taken afterward. No CMS or UI dependency is added.

The factory is `createAskChoiceTool({ toolId, description, permission, policy, presentation,
pendingQuestions, surfaceExchanges, messages })`. Its descriptor contains the model-input
schema and a `none` side-effect classification. Its handler accepts
`{ ctx: { principalId, input, signal, emitSurface? } }`. Every port operation takes an argument object.

The spec for this extraction is survey Part 1 candidate 21 and dispatch w4h. The pattern is
ports and adapters: the tool is the inbound port, the registry is the inbound adapter, and
authorization, question rendering, result encoding, pending storage, and exchange storage
are outbound ports. Composition belongs in the consuming application's tool registry.

Required behavior:

- Authorize before rendering or redeeming. Only content-shape errors receive the schema
  retry decoration supplied by the host policy; forged answers use its input-error factory.
- Validate a title and at least one select group. Each offered option has a value and label.
- Open a live exchange before rendering, embed its correlation ID, emit, then receive.
  Close on every exit, including abort and failed rendering or emission. The exchange
  adapter owns expiry, principal binding, and buffering answers that arrive during emission.
- A received dismissal wins over all answers. Nonblank typed text is trimmed and returned
  as `freeText` with no selection fields. Empty selections are an answer. Absent answers,
  cancellation, expiry, and abandoned runs have `submitted: false` and a reason.
- Without an emitter, mint a ticket and render it only into callback params. Return the
  pending copy and encoded surface, never a submitted answer. Callback acceptance requires
  an outstanding single-use ticket bound to the same principal and displayed option values.
- Preserve callback keys `__askChoiceAnswerTicket`, `__exchangeId`, `__dismissed`, and
  `__typedAnswer`. Fallback answer tickets and live exchange IDs remain separate carriers.

`createAskChoiceAnswerTicketStore({ now, newTicketId, ttlMs })` is an optional in-memory
adapter. `now({})` supplies milliseconds; `newTicketId({})` must produce unpredictable,
globally unique tokens. A host matching the source behavior supplies `ttlMs: 300_000`,
an adapter for `Date.now`, and an adapter for `randomUUID`. The adapter consumes before
checking binding, expiration, and options, snapshots question content, and lazily sweeps
expired entries. Tickets intentionally do not survive process restarts. Alternative pending
stores must preserve those constraints; stores and policy are trusted host dependencies.

The presentation adapter receives `{ toolName, principalId, question, baseParams }`,
then `{ cancelParams? }` as its optional second argument. It supplies the URI, app metadata, field presentation and labels, and frame
size, then adapts `buildFormSurface`. `buildResult({ modelText, ui })` adapts the host's tool
result encoder. The transport must withhold surface resource content from model context;
the model must not see a fallback answer ticket. Pending-result copy is host-supplied.

A host adopts this module with a thin composition adapter: pass its tool ID, catalog
description, permission and result copy, wrap storage methods in object-argument ports,
map its execution context to `{ ctx }`, and adapt the registration descriptor. The policy
receives `{ ctx, toolId }` before any display or redemption. Catalog and risk declarations
remain composition concerns, derived from the factory descriptor.

Generalized characterization tests are copied from `ask-choice-tool.test.ts`; typed-answer
core cases derive from `mcp-ui-tool-calls-route.ask-choice-typed-answer.integration.test.ts`.
HTTP routing/authentication/ambiguity tests remain in the host because this subpath opens no
server. Contract tests use fake render/exchange adapters and the real ticket adapter.
The new probes for replacing host identity, policy, presentation, copy and stores are
**unproven** until executed. Verification is deferred by the owner directive.

The package integration report records source provenance and the later host adoption ledger.
