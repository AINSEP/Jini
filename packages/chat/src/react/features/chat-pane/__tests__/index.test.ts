import { describe, expect, it } from 'vitest';
import * as chatPane from '../index.js';

describe('features/chat-pane barrel', () => {
  it('re-exports the public rules, tool caller/uploader factories, hooks, and components', () => {
    // Type-only re-exports (types.js's interfaces) aren't observable through a runtime smoke test.
    expect(chatPane.defaultChatPaneSelection).toBeTypeOf('function');
    expect(chatPane.orderChatPaneAgents).toBeTypeOf('function');
    expect(chatPane.resolveChatPaneSelection).toBeTypeOf('function');
    expect(chatPane.CHAT_PANE_AGENT_TOOLS).toBeInstanceOf(Array);
    expect(chatPane.createDaemonAttachmentUploader).toBeTypeOf('function');
    expect(chatPane.createMcpUiToolCaller).toBeTypeOf('function');
    expect(chatPane.useChatPane).toBeTypeOf('function');
    expect(chatPane.useChatPaneAgentControl).toBeTypeOf('function');
    expect(chatPane.useChatPaneWorkingDirectory).toBeTypeOf('function');
    expect(chatPane.useChatPaneRuntimeInventory).toBeTypeOf('function');
    expect(chatPane.AgentRuntimePicker).toBeTypeOf('function');
    expect(chatPane.ChatPane).toBeTypeOf('function');
  });
});
