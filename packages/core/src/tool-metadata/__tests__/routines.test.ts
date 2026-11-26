import { expect, it } from 'vitest';
import { toolMetadata, ROUTINE_TOOL_IDS } from '../routines.js';

it('preserves the descriptor approval and exchange classification', () => {
  expect([...ROUTINE_TOOL_IDS]).toEqual(['routine_list', 'routine_create', 'routine_set_enabled', 'routine_delete']);
  for (const row of [toolMetadata.routine_create, toolMetadata.routine_set_enabled, toolMetadata.routine_delete]) expect(row.mcpUi).toEqual({ redeemable: true, exchangeOnly: true });
});
