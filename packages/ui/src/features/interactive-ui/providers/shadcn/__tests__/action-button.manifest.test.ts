import { describe, expect, it } from 'vitest';
import { shadcnButtonManifest, shadcnButtonPropsSchema } from '../action-button.manifest.js';

describe('shadcnButtonManifest', () => {
  it('is registered under the shadcn provider with button/action capabilities', () => {
    expect(shadcnButtonManifest.id).toBe('shadcn.button');
    expect(shadcnButtonManifest.provider).toBe('shadcn');
    expect(shadcnButtonManifest.capabilities).toEqual(['button', 'action']);
  });

  it('accepts a bare label', () => {
    expect(shadcnButtonPropsSchema.safeParse({ label: 'Submit' }).success).toBe(true);
  });

  it('accepts an optional variant/size/disabled', () => {
    const result = shadcnButtonPropsSchema.safeParse({ label: 'Submit', variant: 'destructive', size: 'sm', disabled: true });
    expect(result.success).toBe(true);
  });

  it('rejects a payload missing label', () => {
    expect(shadcnButtonPropsSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown variant', () => {
    expect(shadcnButtonPropsSchema.safeParse({ label: 'Submit', variant: 'rainbow' }).success).toBe(false);
  });
});
