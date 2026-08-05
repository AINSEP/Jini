# Local CLI model dropdown has no effect on the spawned process — root cause found, argv evidence attached

**Date:** 2026-08-05
**Agent:** Programmer
**Repos:** Tovu (`apps/admin`, `src/assistant`, `src/server`) and Jini (`packages/daemon`,
`packages/agent-runtime`) — no code changed in either. Recon only.
**User's words:** "the dropdown to choose the model doesnt work in Tovu. i changed it to sonnet and
it just says its opus 5. did we ever wire that up?"

## Verdict, stated plainly

**No — it was never wired up.** The model dropdown updates a piece of `ChatPane`-internal React
state that dies at the component boundary. It never reaches Tovu's transport, never reaches the
daemon, never reaches `agent-executor.ts`, and the `claude` CLI is spawned with no `--model` flag
**on every Tovu admin Local CLI run, for every agent, regardless of what the dropdown shows.** This
is not a regression tied to picking Sonnet specifically, and it is not a CLI/config-precedence
issue — the flag simply never leaves the browser. Confirmed with a five-hop, file:line-cited source
trace plus direct argv evidence from the real production code (method below), not inferred from a
comment or from the model's own reply.

## Instruction followed: the model's self-report was not used as evidence in either direction

Not relied on at all. The trace below stands entirely on source code and one controlled call into
the real `buildArgs` function — never on what the CLI said about itself.

## The five-hop trace, each hop file:line-cited

**Hop 1 — the dropdown itself never leaves `ChatPane`.**
`packages/chat/src/react/features/chat-pane/components/ChatPane.tsx` wires the picker as
`<AgentRuntimePicker ... value={pane.selection} onChange={pane.setSelection} ... />`. `setSelection`
(`packages/chat/src/react/features/chat-pane/hooks/useChatPane.hooks.ts:212-217`) only calls
`setInternalSelection` — Tovu's `AssistantDock.tsx` passes neither `selection` nor
`onSelectionChange` to `<ChatPane>` (grepped the whole file for both prop names plus
`modelByAgentId`/`localCli`: zero matches), so this is uncontrolled, purely local React state. The
dropdown correctly *shows* "Sonnet" after the user picks it — that part isn't broken — but nothing
outside this one component ever learns about the change yet.

**Hop 2 — the value IS read at send time, then discarded by Tovu's own `runContext` callback.**
`useChatPane.hooks.ts:254-278` (`sendPrompt`) does read the live `selection` and calls
`options.runContext({ prompt, selection, workingDirectory })` — so the mechanism to forward it
exists and fires. But `AssistantDock.tsx`'s actual `runContext` prop is:
```
const runContext = useMemo(
  () => () => resolveRunContext({ bindToken: agentBridge?.bindToken() }),
  [agentBridge],
);
```
This function takes **zero parameters**. JavaScript happily calls it with the `{prompt, selection,
workingDirectory}` object anyway and it's silently ignored — no error, nothing. Even if it read its
argument, its return value (`resolveRunContext({bindToken})`) never includes `model` regardless.

**Hop 3 — the HTTP request Tovu actually sends has no field for it, independent of hop 2.**
`apps/admin/src/lib/assistant-transport.ts`, Local CLI branch of `startRun` (lines 479-522): builds
`contextRef` from only `prompt`, optionally `frontendBindToken`, optionally `attachmentIds`. The
POST body is `JSON.stringify({ contextRef: JSON.stringify(contextRef), agentId: input.agentId })` —
literally no `model` key anywhere. This is a second, independent break — even a fixed hop 2 would
still lose the value here, since nothing reads `input.context?.model` at all.

**Hop 4 — Tovu's daemon-side run handler doesn't expect a model either, and hardcodes the run call
without one.**
`src/assistant/agent-daemon-server.ts`'s `onStarted` handler (lines 434-565) decodes `contextRef`
with an explicit type: `JSON.parse(request.contextRef) as { prompt?: unknown; principalId?: unknown;
attachmentIds?: unknown }` (line 442) — `model` isn't in the type, isn't read. Its final call:
```js
await agentExecutor.run({
  runId: run.id,
  agentId: request.agentId ?? DEFAULT_AGENT_ID,
  prompt,
  cwd: process.env.TOVU_AGENT_CWD ?? process.cwd(),
  permissionMode: resolvePermissionMode(),
  ...attachmentRunFields,
});
```
(lines 549-556) — no `model` key, unconditionally, for every run this handler ever starts. Also
confirmed `executionConfig.localCli.modelByAgentId` (`apps/admin/src/lib/execution-settings.ts:284-306`,
a real *persisted* per-agent model ledger, separate from `ChatPane`'s own picker state) is never
read anywhere in `AssistantDock.tsx` or `assistant-transport.ts` either — grepped both files for
`selectedLocalCliModel`/`modelForAgent`/`modelByAgentId`/`localCli.model`: zero matches. So this
isn't "the wrong per-agent key is read" — the per-agent ledger isn't consulted by the run path at
all, under any key.

**Hop 5 — downstream of the daemon-server handler, the machinery is correct and unaffected.**
`packages/daemon/src/agent-executor.ts:2320`: `const selectedModel = input.model;` — always
`undefined` given hop 4. Line 2363-2368: `buildArgs`'s options object only gets a `model` key `if
(input.model !== undefined)` — never true here. `packages/agent-runtime/src/defs/claude.ts`'s
`buildArgs`: `if (options.model && options.model !== 'default') { args.push('--model',
options.model); }` — correct, and proven correct directly (next section). **None of this layer is
the defect.**

## Argv evidence — direct call into the real production `buildArgs`, not a live spawn

Chose not to trigger an actual `claude -p` run through the live admin app: Tovu's real
`permissionMode: resolvePermissionMode()` on this path typically resolves to a bypass-permissions
run, and spawning one for real would consume the user's actual API usage and could take real
actions just to observe one flag — disproportionate for what source evidence already nails down
with certainty. Instead, called the real, already-built `buildArgs` function
(`packages/agent-runtime/dist/defs/claude.js`, the exact file `agent-executor.ts` imports and
invokes) directly, with the exact input shape hop 5 proves Tovu passes today:

```
A) options={permissionMode:"restricted"}  (model key absent — the real shape for every Tovu run today)
   → ["-p","--input-format","stream-json","--output-format","stream-json","--verbose"]
   → --model present? false

B) options={model:"sonnet", permissionMode:"restricted"}  (what a fixed path would pass)
   → [...,"--model","sonnet"]
   → --model present? true → value: sonnet
```

Case A is what every Local CLI run in Tovu admin produces today, for every agent, regardless of
dropdown state. Case B proves `buildArgs`'s own translation is correct and would work immediately
once a real value reaches it — the fix is entirely upstream (hops 1-4), not here. If stronger
evidence is wanted — literal `ps` output from a live spawned process — say so explicitly; that
would require either triggering a real admin chat turn or adding temporary logging to
`agent-executor.ts`'s spawn call, and I did not do either without direction given the cost/risk of
the former.

## Every named failure mode, ruled in or out with evidence

| Hypothesis | Verdict |
|---|---|
| Selection never persists | Ruled out as the cause — it persists fine inside `ChatPane`'s own React state for the session; the dropdown correctly shows the picked model. |
| Persists but isn't read at spawn time | Partially right, more precise: it **is** read, inside `ChatPane.sendPrompt` (hop 2) — then discarded three independent times before reaching spawn (hops 2, 3, 4). |
| Read but not translated into `--model` | Ruled out at the translation layer itself — `claude.ts`'s `buildArgs` translates correctly (Case B). The value never arrives there to be translated. |
| Passed and the CLI ignores/overrides it (config pin beats the flag) | Ruled out — the flag is never passed in the first place, so there's nothing for a config pin to outrank. Not a config-precedence issue. |
| Passed correctly, model self-reports wrong | Ruled out, and moot — not tested via self-report per instruction, and moot since it's never passed. |
| Selection keyed per-agent, wrong key read | Ruled out — the per-agent ledger (`localCli.modelByAgentId`) exists and persists server-side, but is never read by the run-start path under any key. |

## Scope note

Bug 2's (a)/(b) decision (model-list discovery) is untouched, unrelated, and still open — did not
touch it. Nothing implemented for this new bug either; recon only, as directed. No code changed in
Tovu, Jini, or Open Design. The one file written was this report plus a throwaway probe script in
the session scratchpad (not committed, not part of either repo).

## Where a fix would need to land (not implemented — for scoping only)

At minimum, hops 2, 3, and 4 all need a `model` field threaded through, in order:
`AssistantDock.tsx`'s `runContext` needs to actually read its `selection` argument and put
`selection.model` into the returned context; `assistant-transport.ts`'s Local CLI `startRun` needs
to read `input.context?.model` into `contextRef`; and `agent-daemon-server.ts`'s `onStarted` needs
to decode `model` out of `contextRef` and pass it into `agentExecutor.run({..., model})`. All three
are genuine wiring gaps, not one bug with two symptoms — fixing only one would still leave the
dropdown inert.
