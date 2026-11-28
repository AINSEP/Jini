import { describe, expect, it } from 'vitest';
import * as entry from '../index.js';
import * as rules from '../number-stepper.js';
import * as view from '../NumberStepper.js';
import * as stepperHook from '../use-number-stepper.hooks.js';
import * as optimistic from '../use-optimistic-number-setting.hooks.js';

/** `index.ts` is the published `./number-stepper` subpath. */
describe('number-stepper public entry', () => {
  it('exposes exactly its runtime surface, each bound to the implementing module', () => {
    const expected = {
      NumberStepper: view.NumberStepper,
      useNumberStepper: stepperHook.useNumberStepper,
      useOptimisticNumberSetting: optimistic.useOptimisticNumberSetting,
      acceptedSavedValue: rules.acceptedSavedValue,
      clampToBounds: rules.clampToBounds,
      numberFromTypedDigit: rules.numberFromTypedDigit,
      stepperKeyTarget: rules.stepperKeyTarget,
    };
    expect(Object.keys(entry).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, value] of Object.entries(expected)) {
      expect(typeof value, name).toBe('function');
      expect(entry[name as keyof typeof entry], name).toBe(value);
    }
  });
});
