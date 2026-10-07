import { describe, expect, it } from 'vitest';
import { AGENT_DEFS, getAgentDef } from '../../registry.js';
import * as definitions from '../index.js';

describe('retired Google CLI', () => {
  it('cannot be selected or imported from the registry while Antigravity remains', () => {
    expect(AGENT_DEFS.map((def) => def.id)).not.toContain('gemini');
    expect(getAgentDef({ id: 'gemini' })).toBeNull();
    expect(Object.keys(definitions)).not.toContain('geminiAgentDef');
    expect(getAgentDef({ id: 'antigravity' })?.bin).toBe('agy');
  });
});
