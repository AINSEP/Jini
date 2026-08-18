import { describe, expect, it } from 'vitest';
import { shadcnTextInputManifest, shadcnTextInputPropsSchema } from '../text-input-field.manifest.js';

describe('shadcnTextInputManifest', () => {
  it('is registered under the shadcn provider with input/text-input/form-field capabilities', () => {
    expect(shadcnTextInputManifest.id).toBe('shadcn.text-input');
    expect(shadcnTextInputManifest.provider).toBe('shadcn');
    expect(shadcnTextInputManifest.capabilities).toContain('text-input');
  });

  it('accepts an empty payload — every field is optional', () => {
    expect(shadcnTextInputPropsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts value/placeholder/disabled/type', () => {
    const result = shadcnTextInputPropsSchema.safeParse({ value: 'ada', placeholder: 'Name', disabled: false, type: 'email' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(shadcnTextInputPropsSchema.safeParse({ type: 'color' }).success).toBe(false);
  });
});
