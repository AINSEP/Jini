import { expect, test } from 'vitest';
import { opencodeAgentDef, opencodeAcpAgentDef, vibeAgentDef } from '../index.js';

test('the defs catalog exports both OpenCode variants and Vibe', () => {
  expect(opencodeAgentDef).toBeDefined();
  expect(opencodeAcpAgentDef).toBeDefined();
  expect(vibeAgentDef).toBeDefined();
  expect(opencodeAcpAgentDef.id).toBe('opencode-acp');
  expect(vibeAgentDef.id).toBe('vibe');
});
