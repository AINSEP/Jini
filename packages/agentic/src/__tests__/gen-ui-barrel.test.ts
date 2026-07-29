import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_VERSION } from '@jini-ai/protocol';
import * as agui from '../index.js';

// Exercises the public root barrel's re-export of src/gen-ui/encoder.ts (folded in from the
// standalone @jini-ai/agui package, plan §3a — see that module's doc).
describe('@jini-ai/agentic public barrel — createGenUiEncoder', () => {
  it('re-exports createGenUiEncoder', () => {
    expect(agui.createGenUiEncoder).toBeDefined();
    expect(typeof agui.createGenUiEncoder).toBe('function');
  });

  it('createGenUiEncoder produces a working encoder end to end', () => {
    const encoder = agui.createGenUiEncoder();
    const result = encoder.encode(
      {
        runId: 'run-1',
        eventId: 'e1',
        opaqueCursor: 'e1',
        protocolVersion: RUN_PROTOCOL_VERSION,
        ts: 0,
        kind: 'start',
        payload: { runId: 'run-1', contextRef: 'ctx-1' },
        durability: 'durable',
      },
      { runId: 'run-1', now: () => 1 },
    );
    expect(result).toEqual({ kind: 'run.lifecycle', status: 'started', runId: 'run-1', ts: 1 });
  });
});
