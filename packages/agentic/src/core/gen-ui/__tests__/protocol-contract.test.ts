import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_VERSION, type RunProtocolEvent } from '@jini-ai/protocol';
import { createGenUiEncoder } from '../index.js';

describe('custom gen-ui protocol contract', () => {
  it('retains its custom kind envelope rather than projecting external AG-UI event names', () => {
    const encoder = createGenUiEncoder({ clock: { nowMs: () => 42 } });
    const event: RunProtocolEvent = {
      runId: 'run-1', eventId: 'event-1', opaqueCursor: 'cursor-1', protocolVersion: RUN_PROTOCOL_VERSION,
      ts: 0, durability: 'durable', kind: 'agent', payload: { type: 'text_delta', delta: 'hello' },
    };
    expect(encoder.encode({ event, runId: 'run-1' }, { seq: 7 })).toEqual({
      kind: 'agent.message', runId: 'run-1', seq: 7, ts: 42, text: 'hello',
    });
  });

  it('keeps package source independent of application paths and imports', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const forbidden = ['apps/' + 'website', '#' + 'src/', '@' + 'to' + 'vu'];
    const violations: string[] = [];
    let inspected = 0;
    function visit(directory: string): void {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
          inspected += 1;
          const source = readFileSync(path, 'utf8');
          if (forbidden.some((token) => source.includes(token))) violations.push(path);
        }
      }
    }
    visit(root);
    expect(inspected).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});
