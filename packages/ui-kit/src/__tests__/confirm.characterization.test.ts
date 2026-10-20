import { describe, expect, it } from 'vitest';
import { planConfirm, type ConfirmInput } from '../confirm.js';

const input: ConfirmInput = { open: true, title: 'Record', confirmLabel: 'Apply' };
describe('confirmation plan characterization', () => {
  it.each([
    { tone: undefined, consequence: undefined, expected: undefined, variant: 'primary' },
    { tone: 'default', consequence: '', expected: undefined, variant: 'primary' },
    { tone: 'warning', consequence: '  ', expected: 'changes access, but is reversible', variant: 'warning' },
    { tone: 'danger', consequence: undefined, expected: 'cannot be undone', variant: 'danger' },
    { tone: 'danger', consequence: '  removes this record  ', expected: 'removes this record', variant: 'danger' },
  ] satisfies { tone: ConfirmInput['tone']; consequence: string | undefined; expected: string | undefined; variant: string }[])
  ('keeps consequence and variant for $tone / $consequence', ({ tone, consequence, expected, variant }) => {
    const plan = planConfirm({ ...input, ...(tone === undefined ? {} : { tone }), ...(consequence === undefined ? {} : { consequence }) });
    expect(plan.consequence).toBe(expected);
    expect(plan.confirmVariant).toBe(variant);
    expect(plan.confirmLabel).toBe(`Apply — Record${expected ? `; ${expected}` : ''}`);
  });

  it.each([
    { open: false, pending: false, dismissible: false },
    { open: true, pending: false, dismissible: true },
    { open: true, pending: true, dismissible: false },
    { open: false, pending: true, dismissible: false },
  ])('keeps pending and dismissal policy for $open / $pending', ({ open, pending, dismissible }) => {
    expect(planConfirm({ ...input, open, pending })).toMatchObject({ pending, dismissible, cancelDisabled: pending, confirmDisabled: pending, initialFocus: 'cancel' });
  });

  it('keeps missing handles, empty handles, empty cancel labels and human-only policy distinct', () => {
    expect(planConfirm(input)).toMatchObject({ cancelLabel: 'Cancel', cancel: undefined, confirm: undefined, pending: false });
    const plan = planConfirm({ ...input, cancelLabel: '', agentHandle: '', agentMayConfirm: false });
    expect(plan.cancel).toEqual({ handle: '-cancel', role: 'button', label: ' — leaves "Record" unconfirmed; no action taken' });
    expect(plan.confirm).toBeUndefined();
    expect(Object.isFrozen(plan)).toBe(true);
    expect(planConfirm({ ...input, agentHandle: 'record' }).confirm).toEqual({ handle: 'record-confirm', role: 'button', label: 'Apply — Record' });
  });
});
