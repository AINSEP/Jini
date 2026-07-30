# Self-Validation: Reference Web Chat

- Date: 2026-07-23 20:44 PDT
- Persona: Programmer (Direct)
- Result: PASS with one package-boundary limitation
- Validation attempts: 1 final attempt after a focused TDD cycle

## Scope

Validated the `examples/reference-web` chat path that selects daemon-detected
local agents/models and sends conversations through a durable Jini run and SSE
stream. No paid model invocation was performed.

## Preflight and architecture evidence

- Read the repository, AI Dev Shop, Jini port, and extraction-plan instructions.
- Used the Codebase Memory graph first for symbol discovery, snippets, and call
  paths.
- Queried fresh Graphify package and ADS-memory graphs before focused source
  reads.
- Reused `@jini/chat-core` transcript composition, `@jini/chat-react` chat
  primitives, `@jini/node-host` daemon assembly, `@jini/daemon` agent execution,
  and `@jini/http` run/SSE/agent routes.
- Kept all implementation changes in the example host. No `packages/*` file was
  changed.

## TDD evidence

Failure mode: the transport sent only the newest user message, so later turns
lost prior conversation context.

Adversarial case: after a prior assistant turn from one agent, switching agents
must retain the newest user request while excluding the other agent's earlier
context.

Signal: focused unit tests in
`examples/reference-web/src/daemon-transport.test.ts`.

1. RED:
   `pnpm --filter @jini-app/reference-web exec vitest run src/daemon-transport.test.ts`
   failed two new tests with `composeRunPrompt is not a function`.
2. GREEN:
   the same command passed 6/6 tests after adding the pure host adapter.

The tests cover:

- ordered multi-turn inclusion;
- synthetic `welcome` exclusion;
- prior assistant form sanitization through `buildTranscript`;
- newest-user preservation and prior-agent exclusion on agent switches.

## Verification

| Check | Result |
| --- | --- |
| `pnpm --filter @jini-app/reference-web test` | PASS, 2 files and 8 tests |
| `pnpm --filter @jini-app/reference-web typecheck` | PASS |
| `pnpm --filter @jini-app/reference-web build` | PASS, 76 modules |
| `git diff --check -- examples/reference-web/src/daemon-transport.ts examples/reference-web/src/daemon-transport.test.ts` | PASS |
| Focused V8 coverage | PASS; target file 23.19% statements/lines, 39.28% branches, 42.85% functions |

The target-file coverage percentage includes the transport's network and SSE
branches, which the focused unit suite does not exercise. The changed pure
`composeRunPrompt` function is directly exercised by both new tests. Generated
coverage artifacts were removed after recording the result.

## Runtime probes

The real example daemon and Vite proxy were started locally:

- `/health`, `/ready`, `/api/daemon/status`, and `/api/agents` returned 200;
- detection returned 24 agent definitions and four locally available binaries
  in this environment (Claude, Codex, OpenCode, and Antigravity);
- a deterministic `playground-demo` run sent through Vite's `/api/runs` proxy
  streamed `start`, parsed agent events, and a successful `end`;
- a cross-origin `/api/agents/rescan` request returned 403.

The deterministic fixture verified the run/SSE path without spending money. It
does not claim a paid CLI model response. Browser automation capability was
reported as unverified by the environment probe, so there is no browser-render
claim.

## Function quality assessment

### `composeRunPrompt`: 100/100

- One purpose: adapt host-visible history to the package transcript contract.
- Typed object input and explicit string output.
- Pure, deterministic, no I/O or hidden state.
- Time O(n) and space O(n) in total history size.
- Uses the package sanitizer/scoping rules rather than duplicating a formatter.
- Focused fixtures need no mocks, network, clock, or global state.

Skepticism pass: rechecked requirements, empty/synthetic history, multi-message
ordering, agent-switch scoping, hidden dependencies, errors, scale, security,
and direct test evidence. No remaining finding applies to this function.

## Architecture audit

The changed dependency edge is:

`examples/reference-web` -> `@jini/chat-core.buildTranscript`

This is an allowed host-to-package dependency and preserves package neutrality.
No package imports the example. Host-only details remain local:

- `PlaygroundChatPane` composes the sample project and chat surface;
- `AgentRuntimePicker` combines daemon availability/auth/version/rescan with
  model and reasoning selection in the `Composer` footer slot;
- `ProjectPreview` renders the sample workspace preview;
- `daemon-transport.ts` and `daemon.ts` adapt browser chat state to the local
  daemon composition root.

## Residual package-boundary limitation

`/api/agents` may report Antigravity as available, while
`packages/daemon/src/agent-executor.ts` deliberately rejects Antigravity before
spawn. The current picker therefore can expose one installed CLI that this
daemon executor cannot run. Hard-coding that private executor policy in the
example would duplicate package behavior and drift; the daemon/agent metadata
contract needs an executor-support capability before the host can filter this
generically.
