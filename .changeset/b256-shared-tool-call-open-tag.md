---
"@jini-ai/core": minor
"@jini-ai/artifacts": patch
"@jini-ai/agent-runtime": patch
---

Share one tool-call open/close tag pattern (`TOOL_CALL_OPEN_RE`, `TOOL_CALL_CLOSE_RE` from `@jini-ai/core/text`) between the agent-runtime ACP and artifacts tool-call text suppressors. The artifacts suppressor no longer hides comparison prose such as `x < tool_call.count && y > 0`.
