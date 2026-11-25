import { describe, expect, it } from 'vitest';
import { assistantHistoryToolMetadata } from '../history-tool-metadata.js';
import { toolMetadata } from '../assistant-tool-metadata.js';

describe('assistant tool metadata', () => {
  it('carries the generic history tools unchanged', () => {
    for (const [id, policy] of Object.entries(assistantHistoryToolMetadata)) expect(toolMetadata).toHaveProperty([id], policy);
  });

  it('declares every assistant tool the host registers', () => {
    expect(Object.keys(toolMetadata).sort()).toEqual([
      'assistant_admin_screen_link', 'assistant_ask_choice', 'assistant_chat_read', 'assistant_chats_list', 'assistant_demo_a2ui',
      'assistant_demo_choices', 'assistant_demo_image', 'assistant_render_ui', 'assistant_tool_failure_recovery',
      'describe_component', 'search_components', 'tool_gaps_list',
    ]);
  });

  it('gives every tool except failure recovery a direct read approval', () => {
    for (const [id, policy] of Object.entries(toolMetadata)) {
      if (id === 'assistant_tool_failure_recovery') continue;
      expect(policy).toMatchObject({ approval: { class: 'read', confirmation: 'direct' } });
    }
  });

  it('marks the held-open question and recovery cards redeemable', () => {
    expect(toolMetadata.assistant_ask_choice.mcpUi).toEqual({ redeemable: true });
    expect(toolMetadata.assistant_demo_choices.mcpUi).toEqual({ redeemable: true });
    expect(toolMetadata.assistant_tool_failure_recovery.mcpUi).toEqual({ redeemable: true });
  });
});
