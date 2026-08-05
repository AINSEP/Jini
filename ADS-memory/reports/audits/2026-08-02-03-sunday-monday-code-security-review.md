# Jini Sunday-Monday Code and Security Review

**Review date:** 2026-08-05  
**Change window:** Sunday 2026-08-02 through Monday 2026-08-03  
**Method:** Reviewed the current final implementations, not historical commit snapshots.

## Findings

### Medium: Enter can submit an MCP-UI form repeatedly while its action is in flight

**Location:** `packages/ui/src/features/mcp-ui/surfaces/form.ts:159-195`

`runSubmit()` has no in-flight guard. It disables only the action buttons, but the Enter key handler remains active on enabled text and number controls and unconditionally invokes `runSubmit()`. Holding or repeatedly pressing Enter while a call is pending therefore produces multiple `tools/call` requests. A confirmation token may reject later calls, but ordinary state-mutating form tools can execute more than once.

Track a local pending flag before invoking `api.callTool`, return immediately when set, and make the keyboard path observe it. Add a generated-surface test that fires repeated Enter keydowns before the first promise settles and asserts one tool call.

### Medium: A failed undo, redo, or snapshot restore can leave partial writes with no recoverable history entry

**Location:** `packages/vibecoding/src/core/history.ts:227-254`

`undo()` pops the entry before replaying its writes, and `redo()` does the same from the redo stack. If a later `replacePart()` throws, earlier parts have already changed but the entry is now in neither stack. `restore()` similarly replays before creating and pushing its entry, so a failed multi-part restore leaves changed parts without an undo record. The caller receives an error but cannot reliably recover the artifact through the history API.

Keep the source-stack entry until replay succeeds, and make restore preserve a recoverable entry for any writes that reached the target. Add fault-injection tests for failure on the second write of undo, redo, and restore.

## Reviewed Areas

- CMS extraction into `@jini-ai/cms`, including identity, settings, taxonomy, workspace, entries, navigation, media, widgets, and presentation exports.
- Chat consolidation into `@jini-ai/chat`.
- MCP-UI bridge, host handshake, form and choice surfaces, human-only result splitting, and delegated execution.
- Gemini tool-loop continuations and `thoughtSignature` propagation.
- Vibecoding target, validation, HTML region parser, apply loop, snapshots, and history.

## Security Assessment

The MCP-UI host authenticates messages by iframe window identity, uses an opaque-origin sandbox with a restrictive CSP, and the daemon withholds non-text result blocks from model context. Gemini continuations preserve opaque thought signatures correctly. No new direct secret-disclosure, cross-principal authorization, or arbitrary-tool-execution issue was found in the reviewed final source.

## Verification

- `@jini-ai/cms`: 471 tests passed.
- Vibecoding focused suite: 38 tests passed.
- MCP-UI UI suite: 83 tests passed.
- Chat MCP-UI suite: 25 tests passed.
- Agent-runtime Gemini suite: 1,023 tests passed.
- Daemon MCP-UI/result-split suite: 825 tests passed.

Some package test roots recursively include nested workspace copies in this checkout, so the last two counts include duplicate executions of the same focused test files. All completed successfully.
