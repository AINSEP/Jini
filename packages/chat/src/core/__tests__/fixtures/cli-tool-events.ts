import type { ToolUseEvent } from '../../events.js';

// Copied via sqlite3 -readonly from fake-test-site/data.nosync/chat.db (2026-11-01).

// Message 109d05be-9b82-404b-b4d0-f1f37180939e; antigravity.
export const AGY_DIRECT: ToolUseEvent = {
  "kind": "tool_use",
  "id": "b9e2c18a-4728-4a9d-a693-f39a1b17e24e:17",
  "name": "call_mcp_tool",
  "input": {
    "Arguments": {
      "path": "render/pages/index.html",
      "themeId": "tovu-starter"
    },
    "ServerName": "jini",
    "ToolName": "theme_read_file"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_GATEWAY: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:20",
  "name": "call_mcp_tool",
  "input": {
    "Arguments": {
      "input": {
        "bodyJson": {
          "content": [
            {
              "content": [
                {
                  "text": "This is a short quality assurance check post for the site.",
                  "type": "text"
                }
              ],
              "type": "paragraph"
            }
          ],
          "type": "doc"
        },
        "kind": "post",
        "status": "draft",
        "title": "qa check gemini"
      },
      "toolId": "content_post_create"
    },
    "ServerName": "jini",
    "ToolName": "execute_delegated_tool"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_READ: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:3",
  "name": "read_file",
  "input": {
    "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/search_tools.json"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_OUTPUT_READ: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:11",
  "name": "read_file",
  "input": {
    "Path": "/Users/owner/.gemini/antigravity-cli/brain/d8e6d95d-b865-4c31-a8f2-86ab2c485a6f/.system_generated/steps/9/output.txt"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_SEARCH: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:9",
  "name": "call_mcp_tool",
  "input": {
    "Arguments": {
      "query": "create a new blog post or draft post and update or rename an existing post title"
    },
    "ServerName": "jini",
    "ToolName": "search_tools"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_DESCRIBE: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:13",
  "name": "call_mcp_tool",
  "input": {
    "Arguments": {
      "id": "content_post_create"
    },
    "ServerName": "jini",
    "ToolName": "describe_tool"
  }
};

// Message 3a080c0e-d795-438e-a037-adcedccb3cf4; antigravity.
export const AGY_CHECK: ToolUseEvent = {
  "kind": "tool_use",
  "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:15",
  "name": "call_mcp_tool",
  "input": {
    "Arguments": {},
    "ServerName": "jini",
    "ToolName": "check_messages"
  }
};

// Message d475593a-ae14-4bce-ac47-48921db3bc9e; codex.
export const CODEX_BATCH: ToolUseEvent = {
  "kind": "tool_use",
  "id": "92907836-4159-425b-8101-48e9d7384d13",
  "name": "theme_read_file",
  "input": {
    "items": [
      {
        "themeId": "tovu-starter",
        "path": "render/pages/index.html"
      }
    ]
  }
};

// Message 379bfc51-d0e7-45fe-9c71-6b182e2bc255; claude.
export const CLAUDE_DIRECT: ToolUseEvent = {
  "kind": "tool_use",
  "id": "toolu_01E8qeKHszR6cuu48M1XkcmZ",
  "name": "mcp__jini__theme_list_files",
  "input": {}
};
