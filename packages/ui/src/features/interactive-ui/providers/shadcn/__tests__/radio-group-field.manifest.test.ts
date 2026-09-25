import { describe, expect, it } from 'vitest';
import { shadcnRadioGroupManifest, shadcnRadioGroupPropsSchema } from '../radio-group-field.manifest.js';

describe('shadcnRadioGroupManifest', () => {
  it('is registered under the shadcn provider with radio/radio-group/form-field capabilities', () => {
    expect(shadcnRadioGroupManifest.id).toBe('shadcn.radio-group');
    expect(shadcnRadioGroupManifest.provider).toBe('shadcn');
    expect(shadcnRadioGroupManifest.capabilities).toEqual(['radio', 'radio-group', 'form-field']);
  });

  it('accepts a well-formed options list', () => {
    const result = shadcnRadioGroupPropsSchema.safeParse({ options: [{ value: 'a', label: 'A' }] });
    expect(result.success).toBe(true);
  });

  it('rejects an empty options list', () => {
    expect(shadcnRadioGroupPropsSchema.safeParse({ options: [] }).success).toBe(false);
  });

  it('rejects a payload missing options', () => {
    expect(shadcnRadioGroupPropsSchema.safeParse({ value: 'a' }).success).toBe(false);
  });
});
