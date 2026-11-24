import type { AgentEvent } from "@jini-ai/core/contracts/site/chat-core";

/** Exact read-only capture of chat.db conversation fdfde658 position 9 (sqlite3 -readonly). */
const fixture: AgentEvent[] = [
  {
    "kind": "raw",
    "line": "Warning: 256-color support not detected. Using a terminal with at least 256-color support is recommended for a better visual experience.\n"
  },
  {
    "kind": "raw",
    "line": "Code discovery: prefer codebase-memory-mcp (search_graph, trace_path, get_code_snippet, query_graph, search_code) over grep/file-read; run index_repository first if the project is not indexed.\n"
  },
  {
    "kind": "raw",
    "line": "YOLO mode is enabled. All tool calls will be automatically approved.\n"
  },
  {
    "kind": "raw",
    "line": "Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google\n    at throwIneligibleOrProjectIdError (file:///Users/la/.npm-global/lib/node_modules/@google/gemini-cli/bundle/chunk-MFLFXOVQ.js:310176:11)\n    at _doSetupUser (file:///Users/la/.npm-global/lib/node_modules/@google/gemini-cli/bundle/chunk-MFLFXOVQ.js:310165:5)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {\n  ineligibleTiers: [\n    {\n      reasonCode: 'UNSUPPORTED_CLIENT',\n      reasonMessage: 'This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google',\n      tierId: 'free-tier',\n      tierName: 'Gemini Code Assist for individuals'\n    }\n  ]\n}\nYOLO mode is enabled. All tool calls will be automatically approved.\nRipgrep is not available. Falling back to GrepTool.\nHook system message: Code discovery: prefer codebase-memory-mcp (search_graph, trace_path, get_code_snippet, query_graph, search_code) over grep/file-read; run index_repository first if the project is not indexed.\n"
  },
  {
    "kind": "raw",
    "line": "An unexpected critical error occurred:"
  },
  {
    "kind": "raw",
    "line": "IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google\n    at throwIneligibleOrProjectIdError (file:///Users/la/.npm-global/lib/node_modules/@google/gemini-cli/bundle/chunk-MFLFXOVQ.js:310176:11)\n    at _doSetupUser (file:///Users/la/.npm-global/lib/node_modules/@google/gemini-cli/bundle/chunk-MFLFXOVQ.js:310165:5)\n    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)\n"
  },
  {
    "kind": "status",
    "label": "Run failed — the agent process exited without answering",
    "detail": "exit code 1, signal none, resumable no. The agent CLI's own stderr is shown above when it printed anything; otherwise check the server log for `[agent-daemon] run <id> ended`."
  },
  {
    "kind": "status",
    "label": "The assistant could not continue this answer. Saved work is above."
  }
];
export default fixture;
