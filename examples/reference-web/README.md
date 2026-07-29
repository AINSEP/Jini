# Jini Playground — web host

This Vite + React app is Jini's runnable browser reference host. It consumes
`@jini-ai/chat-react`, starts a real `@jini-ai/server` daemon, and adapts the daemon's durable
run/SSE protocol to the headless chat transport.

The visible runtime picker contains only agents returned by the daemon's live discovery
endpoint. It defaults to the first usable installed CLI and stays disabled when the daemon
reports none. A deterministic runner remains inside the example daemon as a transport-test
fixture, but it is not inserted into the user-facing agent list.

The right-hand chat is the self-contained `ChatPane` exported by
`@jini-ai/chat-react`. The package owns its `MessageList`, `Composer`,
`AgentRuntimePicker`, selection defaults, send/reset/cancel orchestration, and
activity derivation. This host supplies only environment data and adapters:
the daemon transport, live agent inventory, project run context, sample
prompts, and the outer-column positioning.

The daemon scans its PATH, reports unavailable agents, and returns each CLI's
discovered model and reasoning catalog. `POST /api/agents/rescan` explicitly
refreshes that daemon-owned cache. `ChatPane` forwards the selected agent,
model, and reasoning level into each daemon run.

From the repository root:

```sh
pnpm playground:web
```

To open the same renderer in Chrome and Electron together:

```sh
pnpm playground
```
