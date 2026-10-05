import { describe, expect, it } from 'vitest';

import type { AgentEvent, ChatMessage } from '../../../../core/index.js';
import {
  defaultChatPaneSelection,
  describeTypedAnswerNotice,
  findChatPaneSendBlocker,
  isAwaitingTypedAnswer,
  isTypedAnswerTurn,
  isChatPaneApiModeConfigured,
  isChatPaneQueueableBlocker,
  orderChatPaneAgents,
  resolveChatPaneSelection,
} from '../rules.js';
import type { ChatPaneSendability, ChatPaneSendBlocker } from '../rules.js';
import type { ByokRuntimeSummary, ChatPaneAgent } from '../types.js';

const agents: ChatPaneAgent[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    available: true,
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    ],
    reasoningOptions: [
      { id: 'default', label: 'Default' },
      { id: 'high', label: 'High' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    available: true,
    models: [{ id: 'sonnet', label: 'Sonnet' }],
  },
  {
    id: 'missing',
    name: 'Missing Agent',
    available: false,
  },
];

describe('chat-pane selection rules', () => {
  it('uses explicit default options before first-listed fallbacks', () => {
    expect(defaultChatPaneSelection({ agent: agents[0]! })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(defaultChatPaneSelection({ agent: agents[1]! })).toEqual({
      agentId: 'claude',
      model: 'sonnet',
    });
    expect(defaultChatPaneSelection({ agent: {
      id: 'reasoning-only',
      name: 'Reasoning only',
      reasoningOptions: [{ id: 'high', label: 'High' }],
    } })).toEqual({
      agentId: 'reasoning-only',
      reasoning: 'high',
    });
  });

  it('resolves an absent or unavailable selection to the first available agent', () => {
    expect(resolveChatPaneSelection({ agents: agents, requested: { agentId: '' } })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection({ agents: agents, requested: { agentId: 'missing' } })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection({ agents: [], requested: { agentId: 'codex' } })).toEqual({ agentId: '' });
  });

  it('preserves valid explicit model/reasoning choices for an available agent', () => {
    expect(resolveChatPaneSelection({ agents: agents, requested: {
      agentId: 'codex',
      model: 'gpt-5.6-terra',
      reasoning: 'high',
    } })).toEqual({
      agentId: 'codex',
      model: 'gpt-5.6-terra',
      reasoning: 'high',
    });
  });

  it('rejects stale catalog values unless custom models are explicitly supported', () => {
    expect(resolveChatPaneSelection({ agents: agents, requested: {
      agentId: 'codex',
      model: 'forged-model',
      reasoning: 'forged-reasoning',
    } })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection({ agents: [
      {
        id: 'custom',
        name: 'Custom runtime',
        supportsCustomModel: true,
        models: [{ id: 'default', label: 'Default' }],
      },
    ], requested: {
      agentId: 'custom',
      model: 'host/custom-model',
      reasoning: 'forged',
    } })).toEqual({
      agentId: 'custom',
      model: 'host/custom-model',
    });
  });

  it('orders available agents first and then sorts names', () => {
    expect(orderChatPaneAgents({ agents: agents }).map((agent) => agent.id)).toEqual([
      'claude',
      'codex',
      'missing',
    ]);
  });

  it('allows sending once every readiness input clears', () => {
    const ready: ChatPaneSendability = {
      selectedAgent: { available: true },
      isStreaming: false,
      activeUploadCount: 0,
      workingDirectoryPending: false,
      workingDirectoryInvalid: false,
      workingDirectoryError: null,
    };
    expect(findChatPaneSendBlocker(ready)).toBeNull();
  });

  it('blocks a send to a selected agent that has gone unavailable, distinct from none selected', () => {
    const ready: ChatPaneSendability = {
      selectedAgent: { available: true },
      isStreaming: false,
      activeUploadCount: 0,
      workingDirectoryPending: false,
      workingDirectoryInvalid: false,
      workingDirectoryError: null,
    };
    expect(findChatPaneSendBlocker({ ...ready, selectedAgent: undefined }))
      .toBe('no-agent-selected');
    expect(findChatPaneSendBlocker({ ...ready, selectedAgent: { available: false } }))
      .toBe('agent-unavailable');
  });

  it('reports the first applicable blocker in priority order when several inputs are unready', () => {
    const ready: ChatPaneSendability = {
      selectedAgent: { available: true },
      isStreaming: false,
      activeUploadCount: 0,
      workingDirectoryPending: false,
      workingDirectoryInvalid: false,
      workingDirectoryError: null,
    };
    expect(findChatPaneSendBlocker({
      ...ready,
      isStreaming: true,
      activeUploadCount: 1,
      workingDirectoryInvalid: true,
    })).toBe('streaming');
    expect(findChatPaneSendBlocker({ ...ready, activeUploadCount: 2, workingDirectoryInvalid: true }))
      .toBe('uploads-pending');
    expect(findChatPaneSendBlocker({ ...ready, workingDirectoryPending: true, workingDirectoryInvalid: true }))
      .toBe('working-directory-pending');
    expect(findChatPaneSendBlocker({ ...ready, workingDirectoryInvalid: true }))
      .toBe('working-directory-invalid');
    expect(findChatPaneSendBlocker({ ...ready, workingDirectoryError: new Error('disk unavailable') }))
      .toBe('working-directory-error');
  });

  describe('isChatPaneApiModeConfigured', () => {
    const byokRuntime: ByokRuntimeSummary = { providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' };

    it('is true only once mode, availability, and a chosen model all line up', () => {
      expect(isChatPaneApiModeConfigured({
        executionMode: 'api',
        apiModeAvailable: true,
        byokRuntime,
      })).toBe(true);
    });

    it('is false while a CLI is the active mode, even with a configured BYOK credential', () => {
      expect(isChatPaneApiModeConfigured({
        executionMode: 'local',
        apiModeAvailable: true,
        byokRuntime,
      })).toBe(false);
    });

    it('is false when API mode is not selectable at all', () => {
      expect(isChatPaneApiModeConfigured({
        executionMode: 'api',
        apiModeAvailable: false,
        byokRuntime,
      })).toBe(false);
    });

    it('is false without a chosen model — matching or blank both mean nothing to send to', () => {
      expect(isChatPaneApiModeConfigured({
        executionMode: 'api',
        apiModeAvailable: true,
        byokRuntime: undefined,
      })).toBe(false);
      expect(isChatPaneApiModeConfigured({
        executionMode: 'api',
        apiModeAvailable: true,
        byokRuntime: { providerLabel: 'Google Gemini', model: '   ' },
      })).toBe(false);
    });
  });

  describe('findChatPaneSendBlocker: BYOK/API bypass of the CLI-selection blocker', () => {
    const ready: ChatPaneSendability = {
      selectedAgent: undefined,
      isStreaming: false,
      activeUploadCount: 0,
      workingDirectoryPending: false,
      workingDirectoryInvalid: false,
      workingDirectoryError: null,
    };

    it('lets a configured BYOK turn send with zero agents on PATH', () => {
      // Reproduces the owner-reported bug: a Docker host with no agent CLIs installed could never
      // use a genuinely working BYOK setup, because the pane gated purely on CLI selection.
      expect(findChatPaneSendBlocker({ ...ready, apiModeConfigured: true })).toBeNull();
    });

    it('still blocks local-CLI mode with zero agents on PATH — no regression', () => {
      expect(findChatPaneSendBlocker({ ...ready, apiModeConfigured: false }))
        .toBe('no-agent-selected');
      // `apiModeConfigured` omitted entirely (the pre-existing shape every other test in this file
      // uses) must behave identically to explicit `false`.
      expect(findChatPaneSendBlocker(ready)).toBe('no-agent-selected');
    });
  });

  describe('isChatPaneQueueableBlocker', () => {
    it('is true only for the streaming blocker', () => {
      expect(isChatPaneQueueableBlocker({ blocker: 'streaming' })).toBe(true);
    });

    it('is false for null (nothing to queue behind) and every other named blocker', () => {
      const otherBlockers: readonly ChatPaneSendBlocker[] = [
        'no-agent-selected',
        'agent-unavailable',
        'uploads-pending',
        'working-directory-pending',
        'working-directory-invalid',
        'working-directory-error',
      ];
      expect(isChatPaneQueueableBlocker({ blocker: null })).toBe(false);
      for (const blocker of otherBlockers) {
        expect(isChatPaneQueueableBlocker({ blocker: blocker })).toBe(false);
      }
    });
  });
});

describe('isAwaitingTypedAnswer', () => {
  const toolName = 'assistant_ask_choice';
  const surface: AgentEvent = { kind: 'ext', name: 'mcp-ui', data: { uri: 'ui://ask/1' } };
  const askCall: AgentEvent = { kind: 'tool_use', id: 'call-1', name: toolName, input: {} };
  const confirmCall: AgentEvent = { kind: 'tool_use', id: 'call-2', name: 'content_post_delete', input: {} };
  const assistant = (events: AgentEvent[]): ChatMessage => ({ id: 'a1', role: 'assistant', content: '', events });
  const user: ChatMessage = { id: 'u1', role: 'user', content: 'hi' };

  it('is true while a surface raised inside a tool call is still waiting on that call', () => {
    expect(isAwaitingTypedAnswer({ messages: [user, assistant([askCall, surface])], toolName })).toBe(true);
  });

  it('is false once the call that raised the surface has returned (answered or expired)', () => {
    const result: AgentEvent = { kind: 'tool_result', toolUseId: 'call-1', content: 'expired', isError: false };
    expect(isAwaitingTypedAnswer({ messages: [user, assistant([askCall, surface, result])], toolName })).toBe(false);
  });

  it('attributes the surface to the NEWEST open call, so an older call returning does not settle it', () => {
    const older: AgentEvent = { kind: 'tool_use', id: 'call-0', name: 'content_post_search', input: {} };
    const olderResult: AgentEvent = { kind: 'tool_result', toolUseId: 'call-0', content: '[]', isError: false };
    expect(isAwaitingTypedAnswer({ messages: [assistant([older, askCall, surface, olderResult])], toolName })).toBe(true);
  });

  it('ignores a surface that arrived outside any tool call, and a call that raised no surface', () => {
    expect(isAwaitingTypedAnswer({ messages: [assistant([surface])], toolName })).toBe(false);
    expect(isAwaitingTypedAnswer({ messages: [assistant([askCall])], toolName })).toBe(false);
  });

  it('reads only the newest message, and only when the assistant wrote it', () => {
    expect(isAwaitingTypedAnswer({ messages: [assistant([askCall, surface]), user], toolName })).toBe(false);
    expect(isAwaitingTypedAnswer({ messages: [{ id: 'a2', role: 'assistant', content: 'no events' }], toolName })).toBe(false);
    expect(isAwaitingTypedAnswer({ messages: [], toolName })).toBe(false);
  });

  it('is false for a card raised by any OTHER tool — a delete confirm, an approval — so typing there is a next turn', () => {
    expect(isAwaitingTypedAnswer({ messages: [assistant([confirmCall, surface])], toolName })).toBe(false);
    const a2ui: AgentEvent = { kind: 'ext', name: 'a2ui', data: {} };
    expect(isAwaitingTypedAnswer({ messages: [assistant([confirmCall, a2ui])], toolName })).toBe(false);
  });

  it('is false when the newest open call owning the surface is another tool, even with the question tool still open', () => {
    expect(isAwaitingTypedAnswer({ messages: [assistant([askCall, confirmCall, surface])], toolName })).toBe(false);
  });

  it('counts a call as the question tool when ANY tool_use for its id names it (vendor wrapper plus canonical row, either order)', () => {
    const wrapper: AgentEvent = { kind: 'tool_use', id: 'call-1', name: 'mcp__jini__execute_delegated_tool', input: { toolId: toolName } };
    expect(isAwaitingTypedAnswer({ messages: [assistant([wrapper, askCall, surface])], toolName })).toBe(true);
    expect(isAwaitingTypedAnswer({ messages: [assistant([askCall, wrapper, surface])], toolName })).toBe(true);
  });
});

describe('isTypedAnswerTurn', () => {
  const toolName = 'assistant_ask_choice';
  const waiting: ChatMessage[] = [{
    id: 'a1',
    role: 'assistant',
    content: '',
    events: [
      { kind: 'tool_use', id: 'call-1', name: toolName, input: {} },
      { kind: 'ext', name: 'mcp-ui', data: {} },
    ],
  }];

  it('is an answer only while streaming, with no attachments, and a question waiting', () => {
    expect(isTypedAnswerTurn({ blocker: 'streaming', attachmentCount: 0, messages: waiting, toolName })).toBe(true);
    expect(isTypedAnswerTurn({ blocker: null, attachmentCount: 0, messages: waiting, toolName })).toBe(false);
    expect(isTypedAnswerTurn({ blocker: 'uploads-pending', attachmentCount: 0, messages: waiting, toolName })).toBe(false);
    expect(isTypedAnswerTurn({ blocker: 'streaming', attachmentCount: 1, messages: waiting, toolName })).toBe(false);
    expect(isTypedAnswerTurn({ blocker: 'streaming', attachmentCount: 0, messages: [], toolName })).toBe(false);
  });

  it('is not an answer when the waiting card belongs to a different tool than the configured one', () => {
    expect(isTypedAnswerTurn({ blocker: 'streaming', attachmentCount: 0, messages: waiting, toolName: 'other_question' })).toBe(false);
  });
});

describe('describeTypedAnswerNotice', () => {
  it('names why a typed answer was not sent, distinctly for each outcome', () => {
    expect(describeTypedAnswerNotice({ notice: 'not-pending' })).toBe(
      'That question is no longer waiting for an answer, so your message was not sent.',
    );
    expect(describeTypedAnswerNotice({ notice: 'failed' })).toBe(
      'Your answer could not be delivered. Try sending it again.',
    );
  });
});
