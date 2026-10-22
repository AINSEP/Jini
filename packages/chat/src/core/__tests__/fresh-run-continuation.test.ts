import { expect, it } from 'vitest';
import { recoveredRunEvents } from '../durable-projection.js';

it('does not introduce a Continued divider before the first answer', () => {
  expect(recoveredRunEvents({ saved: [] }, {})).toEqual([
    { kind: 'status', code: 'run_recovering', label: 'Continuing…' },
  ]);
});
it('separates an actual saved answer from its recovered continuation', () => {
  expect(recoveredRunEvents({ saved: [{ kind: 'text', text: 'Saved work.' }] }, {})).toEqual([
    { kind: 'text', text: 'Saved work.' },
    { kind: 'text', text: '\n\n---\n\nContinued\n\n' },
    { kind: 'status', code: 'run_recovering', label: 'Continuing…' },
  ]);
});
