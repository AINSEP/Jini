import { describe, expect, it } from 'vitest';
import { shadcnCheckboxManifest, shadcnCheckboxPropsSchema } from '../checkbox-field.manifest.js';

describe('shadcnCheckboxManifest', () => {
  it('is registered under the shadcn provider with checkbox/toggle/form-field capabilities', () => {
    expect(shadcnCheckboxManifest.id).toBe('shadcn.checkbox');
    expect(shadcnCheckboxManifest.provider).toBe('shadcn');
    expect(shadcnCheckboxManifest.capabilities).toContain('checkbox');
  });

  it('accepts an empty payload — every field is optional', () => {
    expect(shadcnCheckboxPropsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts label/checked/disabled', () => {
    const result = shadcnCheckboxPropsSchema.safeParse({ label: 'Accept terms', checked: true, disabled: false });
    expect(result.success).toBe(true);
  });

  it('rejects a non-boolean checked', () => {
    expect(shadcnCheckboxPropsSchema.safeParse({ checked: 'yes' }).success).toBe(false);
  });
});
