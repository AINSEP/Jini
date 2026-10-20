/**
 * @file Contract test for the `@jini-ai/agent-plugins/lifecycle/tools` barrel: it exposes exactly the
 * runtime facades the README documents, and none of the session internals (gate, state guards) that
 * the admin-surface module reaches by relative import.
 */
import { expect, test } from 'vitest';
import * as tools from '../index.js';

test('exposes the documented runtime facades and nothing else', () => {
  expect(Object.keys(tools).sort()).toEqual([
    'WITHHELD_OUTPUT_MESSAGE', 'createAgentPluginToolProjection', 'createIssuedTokenMemories',
    'defineAgentPluginToolContribution', 'parseAgentPluginToolsFile',
  ]);
  expect(tools.WITHHELD_OUTPUT_MESSAGE).toBe('The plugin tool result was withheld because it contained a connection credential.');
  expect(tools.parseAgentPluginToolsFile({ raw: '[]' })).toEqual({ ok: false, reason: 'schemaVersion must be 1' });
});
