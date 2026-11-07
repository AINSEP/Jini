import { describe, expect, it } from 'vitest';
import { toolRowTarget } from '../ToolCard.rules.js';

describe('toolRowTarget', () => {
  it('names a plugin call by its plugin id, not by the plugin family', () => {
    expect(toolRowTarget({ input: { family: 'agent-plugin', pluginId: 'composio', enabled: true } })).toBe('composio');
  });
});
