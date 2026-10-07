import { describe, expect, it, vi } from 'vitest';

// Isolated in its own file: registry.ts's dup-id guard is inline
// module-level code (not an exported function), so the only way to
// exercise its "duplicate found -> throw" branch is to make the defs
// barrel itself report two defs sharing an id, forcing a fresh import of
// registry.ts to hit the throw. Mocking `./defs/index.js` here doesn't
// affect the real defs files or any other test file (each test file gets
// its own module graph).
vi.mock('../defs/index.js', () => ({
  aiderAgentDef: { id: 'dup-id', name: 'A' },
  ampAgentDef: { id: 'dup-id', name: 'B' }, // same id as aiderAgentDef -> triggers the guard
  amrAgentDef: { id: 'amr', name: 'AMR' },
  antigravityAgentDef: { id: 'antigravity', name: 'Antigravity' },
  auggieAgentDef: { id: 'auggie', name: 'Auggie' },
  claudeAgentDef: { id: 'claude', name: 'Claude' },
  clineAgentDef: { id: 'cline', name: 'Cline' },
  codebuddyAgentDef: { id: 'codebuddy', name: 'CodeBuddy' },
  codexAgentDef: { id: 'codex', name: 'Codex' },
  copilotAgentDef: { id: 'copilot', name: 'Copilot' },
  crushAgentDef: { id: 'crush', name: 'Crush' },
  cursorAgentDef: { id: 'cursor-agent', name: 'Cursor' },
  deepseekAgentDef: { id: 'deepseek', name: 'DeepSeek' },
  devinAgentDef: { id: 'devin', name: 'Devin' },
  droidAgentDef: { id: 'droid', name: 'Droid' },
  gooseAgentDef: { id: 'goose', name: 'goose' },
  grokBuildAgentDef: { id: 'grok-build', name: 'Grok' },
  hermesAgentDef: { id: 'hermes', name: 'Hermes' },
  kiloAgentDef: { id: 'kilo', name: 'Kilo' },
  kimiAgentDef: { id: 'kimi', name: 'Kimi' },
  kiroAgentDef: { id: 'kiro', name: 'Kiro' },
  mimoAgentDef: { id: 'mimo', name: 'MiMo' },
  opencodeAgentDef: { id: 'opencode', name: 'OpenCode' },
  piAgentDef: { id: 'pi', name: 'Pi' },
  qoderAgentDef: { id: 'qoder', name: 'Qoder' },
  qwenAgentDef: { id: 'qwen', name: 'Qwen' },
  reasonixAgentDef: { id: 'reasonix', name: 'Reasonix' },
  traeCliAgentDef: { id: 'trae-cli', name: 'Trae' },
  vibeAgentDef: { id: 'vibe', name: 'Vibe' },
}));

describe('registry duplicate-id guard', () => {
  it('throws at module-eval time when two defs share the same id', async () => {
    await expect(import('../registry.js')).rejects.toThrow('Duplicate agent definition id: dup-id');
  });
});
