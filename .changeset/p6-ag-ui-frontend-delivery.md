---
"@jini-ai/daemon": minor
"@jini-ai/chat": minor
---

Put a server claim in front of run-specific (AG-UI) browser execution. `@jini-ai/daemon`: `FrontendControl.bindRequest` takes an optional `deliverInvocation` that routes a run's invocations to that one binding instead of the session stream; such results are refused until the invocation is begun, and the bind refuses without a session owner hook. New `frontendSessionBeginRoute` (`POST <prefix>/:sessionId/begin`, bounded `{ runId, invocationId }`) is mounted only behind the frontend-session owner gate. `@jini-ai/chat`: the frontend session bridge gains opt-in `acceptRunInvocation({ runId, action })` with a required injected `runInvocations.begin`; a page action claims its invocation before the driver runs and acknowledges that same invocation.
