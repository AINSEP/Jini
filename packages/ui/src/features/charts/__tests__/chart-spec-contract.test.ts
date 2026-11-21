import { describe, expect, it } from 'vitest';
import type { z } from 'zod/v3';
import type { ChartSpec } from '@jini-ai/core/contracts/charts';
import { chartSpecSchema } from '../contract.js';

type Parsed = z.infer<typeof chartSpecSchema>;
// Compile-time proof that core's plain interface and the runtime schema describe the same shape.
const schemaFitsContract = (value: Parsed): ChartSpec => value;
const contractFitsSchema = (value: ChartSpec): Parsed => value;

describe('ChartSpec contract', () => {
  it('accepts a spec the core interface describes and keeps the kind open', () => {
    const spec: ChartSpec = { kind: 'heatmap', data: [{ a: 1 }], series: [{ key: 'a' }] };
    expect(schemaFitsContract(chartSpecSchema.parse(spec))).toEqual(spec);
    expect(contractFitsSchema(spec)).toBe(spec);
  });
});
