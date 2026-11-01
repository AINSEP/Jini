import type { AgentEvent } from '../../events.js';

/** Exact tool-event subsequence from fake-test-site/data.nosync/chat.db message
 * 3a080c0e-d795-438e-a037-adcedccb3cf4, copied via sqlite3 -readonly on 2026-11-01.
 * Bridge calls/results precede all buffered CLI receipts; unrelated tool events retain their order.
 */
export const ANTIGRAVITY_BUFFERED_EVENTS: AgentEvent[] = [
  {
    "kind": "tool_use",
    "id": "90bb33de-9693-41c2-bf80-b551abccd86c",
    "name": "content_post_create",
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
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "90bb33de-9693-41c2-bf80-b551abccd86c",
    "content": "{\"post\":{\"id\":\"eebb3210-fd13-46e4-b2bb-3206cfaf1bef\",\"kind\":\"post\",\"title\":\"qa check gemini\",\"slug\":\"qa-check-gemini\",\"bodyJson\":{\"content\":[{\"content\":[{\"text\":\"This is a short quality assurance check post for the site.\",\"type\":\"text\"}],\"type\":\"paragraph\"}],\"type\":\"doc\"},\"status\":\"draft\",\"updatedAt\":\"2026-11-01T12:28:56.294Z\",\"version\":1,\"author\":\"admin\",\"showAuthor\":false,\"publicUrl\":null,\"adminUrl\":\"/admin/posts/eebb3210-fd13-46e4-b2bb-3206cfaf1bef\"}}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "fd312c11-7aaa-4d6a-ac84-38f22c77619d",
    "name": "assistant_ask_choice",
    "input": {
      "options": [
        {
          "description": "Focuses on our Tuesday and Friday roasting schedule.",
          "label": "Fresh Roasts Every Week",
          "value": "Fresh Roasts Every Week"
        },
        {
          "description": "Highlights our barista-led espresso and pour-over classes.",
          "label": "Morning Espresso & Workshops",
          "value": "Morning Espresso & Workshops"
        }
      ],
      "question": "Which title would you like to rename the draft post 'qa check gemini' to?",
      "title": "Choose a New Post Title"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "fd312c11-7aaa-4d6a-ac84-38f22c77619d",
    "content": "{\"submitted\":true,\"choice\":\"Fresh Roasts Every Week\",\"note\":\"Tell the administrator what you understood from their answer, in plain language, before proceeding.\",\"normalizationNotes\":[\"options: options normalized\",\"options\u2192singleSelect.options\",\"label/title/question\u2192singleSelect.label\"]}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "9cae914d-fcf2-46b3-984c-59d204e55ca9",
    "name": "content_post_update",
    "input": {
      "expectedVersion": 1,
      "id": "eebb3210-fd13-46e4-b2bb-3206cfaf1bef",
      "kind": "post",
      "title": "Fresh Roasts Every Week"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "9cae914d-fcf2-46b3-984c-59d204e55ca9",
    "content": "{\"post\":{\"id\":\"eebb3210-fd13-46e4-b2bb-3206cfaf1bef\",\"kind\":\"post\",\"title\":\"Fresh Roasts Every Week\",\"slug\":\"qa-check-gemini\",\"bodyJson\":{\"content\":[{\"content\":[{\"text\":\"This is a short quality assurance check post for the site.\",\"type\":\"text\"}],\"type\":\"paragraph\"}],\"type\":\"doc\"},\"status\":\"draft\",\"updatedAt\":\"2026-11-01T12:29:29.650Z\",\"version\":2,\"author\":\"admin\",\"showAuthor\":false,\"template\":null,\"publicUrl\":null,\"adminUrl\":\"/admin/posts/eebb3210-fd13-46e4-b2bb-3206cfaf1bef\"}}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:2",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/instructions.md"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:2",
    "content": "1 lines, 1503 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:3",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/search_tools.json"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:3",
    "content": "1 lines, 1576 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:4",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/assistant_ask_choice.json"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:4",
    "content": "1 lines, 4034 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:5",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/check_messages.json"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:5",
    "content": "1 lines, 912 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:7",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/describe_tool.json"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:7",
    "content": "1 lines, 991 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:8",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/mcp/jini/execute_delegated_tool.json"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:8",
    "content": "1 lines, 1490 bytes",
    "isError": false
  },
  {
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
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:9",
    "content": "",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:11",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/brain/d8e6d95d-b865-4c31-a8f2-86ab2c485a6f/.system_generated/steps/9/output.txt"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:11",
    "content": "1 lines, 18524 bytes",
    "isError": false
  },
  {
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
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:13",
    "content": "",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:14",
    "name": "call_mcp_tool",
    "input": {
      "Arguments": {
        "id": "content_post_update"
      },
      "ServerName": "jini",
      "ToolName": "describe_tool"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:14",
    "content": "",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:15",
    "name": "call_mcp_tool",
    "input": {
      "Arguments": {},
      "ServerName": "jini",
      "ToolName": "check_messages"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:15",
    "content": "none",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:17",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/brain/d8e6d95d-b865-4c31-a8f2-86ab2c485a6f/.system_generated/steps/13/output.txt"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:17",
    "content": "1 lines, 23827 bytes",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:18",
    "name": "read_file",
    "input": {
      "Path": "/Users/owner/.gemini/antigravity-cli/brain/d8e6d95d-b865-4c31-a8f2-86ab2c485a6f/.system_generated/steps/14/output.txt"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:18",
    "content": "1 lines, 26535 bytes",
    "isError": false
  },
  {
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
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:20",
    "content": "{\"executionId\":\"7df2b7da-f6bd-4fc9-b1bc-99985519f499\",\"status\":\"completed\",\"output\":{\"post\":{\"id\":\"eebb3210-fd13-46e4-b2bb-3206cfaf1bef\",\"kind\":\"post\",\"title\":\"qa check gemini\",\"slug\":\"qa-check-gemini\",\"bodyJson\":{\"content\":[{\"content\":[{\"text\":\"This is a short quality assurance check post for the site.\",\"type\":\"text\"}],\"type\":\"paragraph\"}],\"type\":\"doc\"},\"status\":\"draft\",\"updatedAt\":\"2026-11-01T12:28:56.294Z\",\"version\":1,\"author\":\"admin\",\"showAuthor\":false,\"publicUrl\":null,\"adminUrl\":\"/admin/posts/eebb3210-fd13-46e4-b2bb-3206cfaf1bef\"}},\"truncated\":false}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:22",
    "name": "call_mcp_tool",
    "input": {
      "Arguments": {
        "options": [
          {
            "description": "Focuses on our Tuesday and Friday roasting schedule.",
            "label": "Fresh Roasts Every Week",
            "value": "Fresh Roasts Every Week"
          },
          {
            "description": "Highlights our barista-led espresso and pour-over classes.",
            "label": "Morning Espresso & Workshops",
            "value": "Morning Espresso & Workshops"
          }
        ],
        "question": "Which title would you like to rename the draft post 'qa check gemini' to?",
        "title": "Choose a New Post Title"
      },
      "ServerName": "jini",
      "ToolName": "assistant_ask_choice"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:22",
    "content": "{\"executionId\":\"5b33835f-ae2b-4a84-a265-281430bf15ae\",\"status\":\"completed\",\"output\":{\"submitted\":true,\"choice\":\"Fresh Roasts Every Week\",\"note\":\"Tell the administrator what you understood from their answer, in plain language, before proceeding.\",\"normalizationNotes\":[\"options: options normalized\",\"options\u2192singleSelect.options\",\"label/title/question\u2192singleSelect.label\"]},\"truncated\":false,\"normalizationNotes\":[\"options: options normalized\",\"options\u2192singleSelect.options\",\"label/title/question\u2192singleSelect.label\"]}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:24",
    "name": "call_mcp_tool",
    "input": {
      "Arguments": {
        "input": {
          "expectedVersion": 1,
          "id": "eebb3210-fd13-46e4-b2bb-3206cfaf1bef",
          "kind": "post",
          "title": "Fresh Roasts Every Week"
        },
        "toolId": "content_post_update"
      },
      "ServerName": "jini",
      "ToolName": "execute_delegated_tool"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:24",
    "content": "{\"executionId\":\"b7232f61-1d7d-4d33-b9f2-d245877c1fec\",\"status\":\"completed\",\"output\":{\"post\":{\"id\":\"eebb3210-fd13-46e4-b2bb-3206cfaf1bef\",\"kind\":\"post\",\"title\":\"Fresh Roasts Every Week\",\"slug\":\"qa-check-gemini\",\"bodyJson\":{\"content\":[{\"content\":[{\"text\":\"This is a short quality assurance check post for the site.\",\"type\":\"text\"}],\"type\":\"paragraph\"}],\"type\":\"doc\"},\"status\":\"draft\",\"updatedAt\":\"2026-11-01T12:29:29.650Z\",\"version\":2,\"author\":\"admin\",\"showAuthor\":false,\"template\":null,\"publicUrl\":null,\"adminUrl\":\"/admin/posts/eebb3210-fd13-46e4-b2bb-3206cfaf1bef\"}},\"truncated\":false}",
    "isError": false
  },
  {
    "kind": "tool_use",
    "id": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:25",
    "name": "call_mcp_tool",
    "input": {
      "Arguments": {},
      "ServerName": "jini",
      "ToolName": "check_messages"
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "d8e6d95d-b865-4c31-a8f2-86ab2c485a6f:25",
    "content": "none",
    "isError": false
  }
];
