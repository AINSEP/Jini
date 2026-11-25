import { describe, expect, it } from 'vitest';
import type { RuntimeAgentDef } from '@jini-ai/core/contracts/agents';
import { aiderAgentDef } from '../aider/index.js';
import { antigravityAgentDef } from '../antigravity/index.js';
import { deepseekAgentDef } from '../deepseek/index.js';
import { BASE_AGENT_DEFS } from '../../registry.js';

const ARGV_BOUND_DEFS: readonly RuntimeAgentDef[] = [aiderAgentDef, antigravityAgentDef, deepseekAgentDef];

describe('argvPromptPosition declaration', () => {
  it.each(ARGV_BOUND_DEFS.map((def) => [def.id, def] as const))('the three argv-bound defs declare the prompt as last argv (%s)', async (_id, def) => {
    expect(def.argvPromptPosition).toBe('last');
    const prompt = 'probe prompt — with spaces, "quotes" and unicode ✓';
    for (const permissionMode of ['restricted', 'bypass'] as const) {
      const args = await def.buildArgs({ prompt, imagePaths: [] }, { options: { permissionMode, model: 'probe-model' } });
      expect(args.at(-1)).toBe(prompt);
    }
  });

  it('argvPromptPosition is only declared on argv-bound defs', () => {
    const declared = BASE_AGENT_DEFS.filter((def) => def.argvPromptPosition !== undefined);
    for (const def of declared) {
      expect(def.promptViaStdin, def.id).not.toBe(true);
      expect(def.promptViaFile, def.id).not.toBe(true);
      expect(typeof def.maxPromptArgBytes, def.id).toBe('number');
    }
    expect(declared.map((def) => def.id).sort()).toEqual(['aider', 'antigravity', 'deepseek']);
  });
});
