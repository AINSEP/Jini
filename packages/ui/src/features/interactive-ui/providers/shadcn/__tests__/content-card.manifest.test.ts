import { describe, expect, it } from 'vitest';
import { shadcnCardManifest, shadcnCardPropsSchema } from '../content-card.manifest.js';

describe('shadcnCardManifest', () => {
  it('is registered under the shadcn provider with card/container capabilities', () => {
    expect(shadcnCardManifest.id).toBe('shadcn.card');
    expect(shadcnCardManifest.provider).toBe('shadcn');
    expect(shadcnCardManifest.capabilities).toEqual(['card', 'container']);
  });

  it('accepts an empty payload — every field is optional', () => {
    expect(shadcnCardPropsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts title/description/content', () => {
    const result = shadcnCardPropsSchema.safeParse({ title: 'Plan', description: 'Monthly', content: '$10/mo' });
    expect(result.success).toBe(true);
  });
});
