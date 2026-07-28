---
"@jini-ai/chat-react": minor
"@jini-ai/daemon": minor
"@jini-ai/agent-runtime": minor
"@jini-ai/http": minor
"@jini-ai/node-host": minor
---

Add a neutral Composer footer slot for host-owned controls, forward an optional host-selected model through every AgentExecutor runtime transport, expose daemon-owned live agent/model discovery with an explicit rescan route, and recognize Claude Code's partial-stream `message_delta` turn boundary so successful stream-json runs close cleanly.
