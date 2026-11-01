import type { AgentEvent } from '../../events.js';

/** Exact tool events extracted with sqlite3 -readonly from fake-test-site chat.db message
 * d8b333a5-02df-4d7a-acf9-c86210c88414, conversation 52f9659b-799c-4e13-99c1-e465fbcf398c.
 * Raw CLI frames and the intervening mcp-ui HTML resource are omitted; tool events are unchanged.
 */
export const DIRECT_MCP_EVENTS: AgentEvent[] = [
  {
    "kind": "tool_use",
    "id": "toolu_01Dp8NVYqsSWC4LGbL12yYtg",
    "name": "mcp__jini__assistant_ask_choice",
    "input": {
      "title": "Which page do you want to look at next?",
      "options": [
        {
          "label": "About us",
          "value": "about"
        },
        {
          "label": "Contact",
          "value": "contact"
        },
        {
          "label": "Privacy Policy",
          "value": "privacy"
        }
      ]
    }
  },
  {
    "kind": "tool_use",
    "id": "67fcf6dd-7237-4c6a-9ee3-f25130822bdf",
    "name": "assistant_ask_choice",
    "input": {
      "title": "Which page do you want to look at next?",
      "options": [
        {
          "label": "About us",
          "value": "about"
        },
        {
          "label": "Contact",
          "value": "contact"
        },
        {
          "label": "Privacy Policy",
          "value": "privacy"
        }
      ]
    }
  },
  {
    "kind": "tool_result",
    "toolUseId": "67fcf6dd-7237-4c6a-9ee3-f25130822bdf",
    "content": "{\"submitted\":true,\"choice\":\"about\",\"note\":\"Tell the administrator what you understood from their answer, in plain language, before proceeding.\",\"normalizationNotes\":[\"options→singleSelect.options\",\"label/title/question→singleSelect.label\"]}",
    "isError": false
  },
  {
    "kind": "tool_result",
    "toolUseId": "toolu_01Dp8NVYqsSWC4LGbL12yYtg",
    "content": "{\"executionId\":\"e9dc1135-151e-48d4-bf9e-9edf2fb1081a\",\"status\":\"completed\",\"output\":{\"submitted\":true,\"choice\":\"about\",\"note\":\"Tell the administrator what you understood from their answer, in plain language, before proceeding.\",\"normalizationNotes\":[\"options→singleSelect.options\",\"label/title/question→singleSelect.label\"]},\"truncated\":false,\"normalizationNotes\":[\"options→singleSelect.options\",\"label/title/question→singleSelect.label\"]}",
    "isError": false
  }
];
