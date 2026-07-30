# @jini-ai/agentic

## 0.3.0

### Patch Changes

- 28c6d3d: Close seven correctness/safety findings in `@jini-ai/agentic`, each reproduced by a failing test
  before it was fixed. Two of them change a public shape: `FieldDescriptor.accessibleLabel`
  (`string`) becomes `FieldDescriptor.accessibleLabels` (`readonly string[]`), and
  `RenderNodeStatus` gains a `'truncated'` member.

  **A page could hide a sensitive field from the read guard, three different ways.** The DOM driver
  resolved a field's visible naming from `aria-label`, `placeholder` and any associated `<label>` —
  and handed the guard only whichever resolved _first_. So the page, not the guard, chose which of
  its own labels was judged: `<label for=f>Card number</label><input id=f name=field_47
placeholder="Enter value">` reached `findFieldReadRefusal` as the single label "Enter value", and
  `page.find_elements({withState:true})` reported the card number in full. `accessibleLabels` now
  carries every source (de-duplicated), and the guard matches each one separately rather than
  concatenating them — a join would let two innocuous labels form a trigger word across their
  boundary ("Address" + "Snapshot" squashes to "addresssnapshot", which contains "ssn"). Two related
  holes closed with it: `describeState` builds a `<select>`'s descriptor by hand and was passing no
  labels at all, so a `<select aria-label="Card number">` was never judged either; and a
  `contenteditable` region's text — which _is_ the field's value, not page chrome — was reported
  verbatim through both channels that carry element text, so `<div contenteditable
name="password">hunter2</div>` returned `label: "hunter2"` from `find_elements` and
  `state.text: "hunter2"` from the state projection. A driver now reports `textIsValue` for such a
  region and `projectElementState` gates that text with the same refusal it applies to `value`
  (reporting `textWithheld`, so a caller reads "withheld" rather than "blank"); the label fallback no
  longer uses an editable region's live content at all.

  **A disabled dropdown was still writable.** `selectOption` filtered out disabled `<option>`s and
  never checked the control itself, so a `<select disabled>` — and a `<select>` inside a `<fieldset
disabled>`, which `:disabled` covers and the `.disabled` IDL property does not — was written to
  happily, with the executor then reporting `targetChanged: true` because the value really had
  changed. It now refuses before even looking up the option, so the refusal cannot depend on the
  caller naming a real one (and cannot enumerate a disabled control's options back at it).

  **Two A2UI schema fields the spec marks required were optional in practice.**
  `updateDataModel.value` and `functionResponse.value` were declared `z.unknown()`, and in Zod 3 a
  key whose schema accepts `undefined` is satisfied by the key being absent entirely
  (`z.unknown().isOptional() === true`). `{updateDataModel: {surfaceId: "s1"}}` therefore parsed
  clean and replaced that surface's _entire data model_ with `undefined` — silently, with no error
  message and no way for the agent to learn it had happened. Presence is now asserted on the object
  (`'value' in body`, so `null`/`false`/`0`/`""` remain legal content), and the interpreter encodes a
  `void` function's return as `null` rather than omitting it, since JSON has no `undefined` and the
  omitted form was a message this package's own parser correctly refuses.

  **`resolve.ts`'s documented "never throws" invariant was false on two paths.** `isDataBinding`
  checked only that a `path` key existed, not that it was a string — and `FunctionCall.args` accepts
  a plain object, so an agent could send `{path: 7}`, pass wire validation, get classified as a
  binding, and throw `path.startsWith is not a function` straight out of `applyAgentMessage`. And a
  catalog function's `impl` is host code handed agent-authored arguments with no schema between them,
  so an entirely ordinary implementation (`args.name.toUpperCase()`) threw the moment an agent sent a
  number. Both are now resolution failures like any other; the second is tagged `FUNCTION_THREW`.

  **JSON Pointer traversed and could reshape prototypes.** `token in record` answered `true` for
  everything `Object.prototype` contributes, so `getAtPointer({}, "/constructor")` resolved the
  `Object` constructor as if the data model contained it; and `record[token] = value` fires the
  inherited `__proto__` accessor-setter rather than defining a key, so `{"path": "/__proto__"}`
  reshaped the object being built instead of writing to it. (Narrower than classic prototype
  pollution — the shallow-copy discipline meant only that one object was affected, never the global
  `Object.prototype` — but a pointer must address the document.) Reads now use
  `hasOwnProperty`; writes use `Object.defineProperty`, so the key RFC 6901 named is the key created.

  **Untrusted A2UI trees could exhaust the renderer.** `flattenRenderTree` was plain recursion with
  no depth bound: a straight component chain — legal, acyclic, and small on the wire — died with
  `RangeError: Maximum call stack size exceeded` somewhere past 6,000 links. The walk is now
  iterative, with the ancestor set maintained by push/pop along the current path instead of copied
  per node (which also removes its quadratic set-copying cost). Separately, the cycle check bounds
  repetition along one path but never bounded the tree's _size_: 24 components each naming the next
  one twice expanded to 16,777,215 render nodes in ~15 seconds. A `MAX_RENDER_NODES` (50,000) ceiling
  now cuts that off with a `'truncated'` marker node, reported the same way `missing` and `cycle`
  already make their degradations visible rather than silent.

  **The attacker-facing JSON-RPC guard accepted malformed messages.** `isJsonRpcMessage` returned
  `true` for any object with a string `method`, without reading `params` at all
  (`{method:'tools/call', params:'nope'}` reached dispatch) and without keeping JSON-RPC 2.0's four
  mutually exclusive shapes apart — a message carrying both `method` and `result` passed as a
  request, and one carrying both `result` and `error` passed as a response, which §5 forbids in as
  many words. `error` was accepted as any value at all, `error: "boom"` included. All three are now
  checked, arrays (batches, which this transport does not do) are rejected, and a non-string `method`
  is refused outright rather than falling through to be reinterpreted as a response.

  Two smaller fixes alongside: `createAgUiToolResult` no longer violates its own `content: string`
  contract — `JSON.stringify` throws for a BigInt or circular output and returns `undefined` for a
  function or symbol, so both now become a result the agent can actually read. And
  `DomPageDriver.navigate` looks its page up with `hasOwnProperty` instead of a bare index, which had
  made `navigate("constructor")` call a function the host never published and report a navigation
  that never happened.

  - @jini-ai/protocol@0.3.0

## 0.1.2

### Patch Changes

- Add top-level `main`/`types` fields alongside the existing `exports` map. A consumer on
  TypeScript's classic `moduleResolution: "node"` (node10) — which ignores `package.json#exports`
  entirely — could not resolve this package's types at all (`TS2307: Cannot find module`) even
  after the previous exports-map fix restored `require()` at runtime; type resolution and runtime
  resolution are separate algorithms. Verified against a real external consumer (Tovu, whose
  tsconfig uses this legacy resolution mode): adding these two fields, with its tsconfig completely
  unchanged, made the error disappear. Also fixes absolute-path `require()` (distinct from a bare
  specifier, which already worked) for the same reason — `main` was previously absent.

  Purely additive: every modern resolver (Node's own runtime `exports` resolution, TypeScript's
  `bundler`/`node16`/`nodenext`) prefers `exports` over `main`/`types` when both are present, so
  this changes nothing for a consumer already on a modern resolver.

- Updated dependencies
  - @jini-ai/protocol@0.1.2

## 0.1.1

### Patch Changes

- Add a `"default"` export condition to every published package's `exports` map — every one of
  them lacked it, which meant `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED` for any
  CommonJS consumer (found via a real external integration attempt; Node needs `require(esm)`
  support, i.e. Node >=22.12, for this to resolve).

  `@jini-ai/agent-runtime`:

  - **New**: `RuntimeBuildOptions.permissionMode` (`'bypass' | 'restricted'`) lets a caller opt a
    run OUT of the auto-approve-every-permission-prompt flag every def with one
    (`bypassPermissions` / `--yolo` / `--dangerously-skip-permissions`) previously pushed
    unconditionally, with no way to turn it off. Omitting it keeps today's default (bypass)
    behavior unchanged.
  - **New**: `ClaudeStreamEvent`, `CopilotStreamEvent`, and `QoderEvent` are now real exported
    discriminated unions instead of `Record<string, unknown>` — a real external consumer guessed a
    nonexistent field name (`event.text` instead of the actual `event.delta`) against the old
    untyped sink and silently lost every streamed token with no compile or runtime error.
  - Fixed a doc/implementation mismatch in `claude-stream.ts`: the module doc claimed `tool_result`
    events carry `{ tool_use_id, content, is_error }`; the actual emitted shape is
    `{ toolUseId, content, isError }`.

  `@jini-ai/daemon`: `AgentExecutorRunInput.permissionMode` forwards the new
  `RuntimeBuildOptions.permissionMode` through to `buildArgs`, so a host can actually reach the new
  opt-out from the daemon's real run-input surface, not just from `@jini-ai/agent-runtime` in
  isolation.

  `@jini-ai/agentic`: `setAtPointer` no longer throws on a malformed (e.g. missing leading `/`)
  `updateDataModel` path — degrades to a no-op like its sibling `getAtPointer`, matching this
  package's own "a bad binding must not crash the renderer" contract. That path is agent-authored
  wire data with no error boundary above it in any host, so the uncaught throw could unmount an
  entire chat UI from ~40 bytes of malformed input.

  `@jini-ai/chat-react`: a local (client-resolved) A2UI button action is no longer a silent no-op —
  `A2uiSurfaceCard` now surfaces the resolved value. New `ExtEventErrorBoundary` confines a
  `kind: 'ext'` event group's renderer to its own card instead of letting a render/effect-phase
  throw from agent-controlled content unmount the whole chat root (there was no error boundary
  anywhere in this package or its hosts before this).

- Updated dependencies
  - @jini-ai/protocol@0.1.1
