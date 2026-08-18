import { describe, expect, it } from 'vitest';
import { shadcnSelectManifest, shadcnSelectPropsSchema } from '../select-field.manifest.js';

describe('shadcnSelectManifest', () => {
  it('is registered under the shadcn provider with select/dropdown/form-field capabilities', () => {
    expect(shadcnSelectManifest.id).toBe('shadcn.select');
    expect(shadcnSelectManifest.provider).toBe('shadcn');
    expect(shadcnSelectManifest.capabilities).toEqual(['select', 'dropdown', 'form-field']);
  });

  it('accepts a well-formed options list', () => {
    const result = shadcnSelectPropsSchema.safeParse({ options: [{ value: 'a', label: 'A' }] });
    expect(result.success).toBe(true);
  });

  it('rejects an empty options list', () => {
    expect(shadcnSelectPropsSchema.safeParse({ options: [] }).success).toBe(false);
  });

  it('rejects a payload missing options', () => {
    expect(shadcnSelectPropsSchema.safeParse({ placeholder: 'Pick one' }).success).toBe(false);
  });
});
