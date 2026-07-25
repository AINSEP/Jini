import { describe, expect, it } from 'vitest';

import {
  defaultChatPaneSelection,
  orderChatPaneAgents,
  resolveChatPaneSelection,
} from '../rules.js';
import type { ChatPaneAgent } from '../types.js';

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
    expect(defaultChatPaneSelection(agents[0]!)).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(defaultChatPaneSelection(agents[1]!)).toEqual({
      agentId: 'claude',
      model: 'sonnet',
    });
    expect(defaultChatPaneSelection({
      id: 'reasoning-only',
      name: 'Reasoning only',
      reasoningOptions: [{ id: 'high', label: 'High' }],
    })).toEqual({
      agentId: 'reasoning-only',
      reasoning: 'high',
    });
  });

  it('resolves an absent or unavailable selection to the first available agent', () => {
    expect(resolveChatPaneSelection(agents, { agentId: '' })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection(agents, { agentId: 'missing' })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection([], { agentId: 'codex' })).toEqual({ agentId: '' });
  });

  it('preserves valid explicit model/reasoning choices for an available agent', () => {
    expect(resolveChatPaneSelection(agents, {
      agentId: 'codex',
      model: 'gpt-5.6-terra',
      reasoning: 'high',
    })).toEqual({
      agentId: 'codex',
      model: 'gpt-5.6-terra',
      reasoning: 'high',
    });
  });

  it('rejects stale catalog values unless custom models are explicitly supported', () => {
    expect(resolveChatPaneSelection(agents, {
      agentId: 'codex',
      model: 'forged-model',
      reasoning: 'forged-reasoning',
    })).toEqual({
      agentId: 'codex',
      model: 'default',
      reasoning: 'default',
    });
    expect(resolveChatPaneSelection([
      {
        id: 'custom',
        name: 'Custom runtime',
        supportsCustomModel: true,
        models: [{ id: 'default', label: 'Default' }],
      },
    ], {
      agentId: 'custom',
      model: 'host/custom-model',
      reasoning: 'forged',
    })).toEqual({
      agentId: 'custom',
      model: 'host/custom-model',
    });
  });

  it('orders available agents first and then sorts names', () => {
    expect(orderChatPaneAgents(agents).map((agent) => agent.id)).toEqual([
      'claude',
      'codex',
      'missing',
    ]);
  });
});
