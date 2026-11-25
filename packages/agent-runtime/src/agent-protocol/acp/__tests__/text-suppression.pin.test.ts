import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDsmlArtifactTextSuppressor, createToolCallTextSuppressor } from '../text-suppression.js';

const ARTIFACT_SAMPLE = 'before <artifact id="1">SECRET-A <x> y</artifact> mid <|DSML artifact>SECRET-B<|/DSML|> after <art tail <';
const TOOL_SAMPLE = 'pre <tool_call name="t">SECRET-C</tool_call> x < y <edit>SECRET-D</edit> post <tool';

type Suppressor = ReturnType<typeof createDsmlArtifactTextSuppressor>;

function drive(make: () => Suppressor, chunks: string[]) {
  const s = make();
  let out = '';
  for (const text of chunks) out += s.strip(text);
  const midStats = s.stats();
  out += s.flush();
  return { out, stats: s.stats(), midStats };
}

const splits = (sample: string) => [
  ...Array.from({ length: sample.length + 1 }, (_, i) => [sample.slice(0, i), sample.slice(i)]),
  [...sample],
];

const BASELINE: Record<string, string> = { dsml: '31e10f939816aa1d4e70530da4adf97e0b669cc7330c90d6673fc182dd376811', 'tool-call': '50e12011b367f4c0de3ad9c1433daaec54e565f0e17b919981b067e54cd51680' };

describe.each([
  ['dsml', createDsmlArtifactTextSuppressor, ARTIFACT_SAMPLE, /SECRET-[AB]/],
  ['tool-call', createToolCallTextSuppressor, TOOL_SAMPLE, /SECRET-[CD]/],
] as const)('createTaggedTextSuppressor (acp) pin via %s', (name, make, sample, secret) => {
  it('suppressed text never leaks at any split point', () => {
    for (const chunks of splits(sample)) expect(drive(make, chunks).out).not.toMatch(secret);
  });

  it('visible output and counters are split-invariant', () => {
    const whole = drive(make, [sample]);
    for (const chunks of splits(sample)) {
      const r = drive(make, chunks);
      expect(r.out).toBe(whole.out);
      expect(r.stats.openedBlocks).toBe(whole.stats.openedBlocks);
      expect(r.stats.closedBlocks).toBe(whole.stats.closedBlocks);
    }
  });

  it('full per-split output and stats are byte-identical to the recorded baseline', () => {
    const all = splits(sample).map((chunks) => drive(make, chunks));
    expect(createHash('sha256').update(JSON.stringify(all)).digest('hex')).toBe(BASELINE[name]);
  });
});
