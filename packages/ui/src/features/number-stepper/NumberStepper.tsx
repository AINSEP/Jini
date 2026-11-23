import type { StepperBounds } from "./number-stepper.js";
import type { useNumberStepper } from "./use-number-stepper.hooks.js";
import type { NumberSetting } from "./use-optimistic-number-setting.hooks.js";

/** Every visible or spoken string the stepper shows; product copy comes from the host. */
export interface NumberStepperLabels {
  decrease: string;
  increase: string;
  field: string;
  tip: string;
}

/** Host classes added beside the stepper's own `jini-number-stepper*` classes. */
export interface NumberStepperClassNames {
  group?: string;
  step?: string;
  value?: string;
  tip?: string;
}

export interface NumberStepperProps {
  setting: NumberSetting;
  bounds: StepperBounds;
  labels: NumberStepperLabels;
  /** Id of the element that names the control (the row's visible label). */
  labelledBy: string;
  /** The host passes `useNumberStepper` (or a stand-in); the component never picks one itself. */
  /** REQUIRED host-supplied hooks (owner rule: hooks reach a Jini component as props). */
  hooks: { useNumberStepper: typeof useNumberStepper };
  classNames?: NumberStepperClassNames;
}

const join = (own: string, host: string | undefined) => (host ? `${own} ${host}` : own);

/**
 * − / number / +, saving every step and every typed digit at once. The field is the one tab stop (a
 * spinbutton); − and + are pointer and touch targets, as in the WAI spinbutton pattern. The tip hangs
 * on the whole control for hover and keyboard focus, and on the field itself because a tapped text
 * field is `:focus-visible`, which is what the `jini-tooltip` layer needs to show a tip after a touch
 * (a tapped button is not).
 */
export function NumberStepper({ setting, bounds, labels, labelledBy, hooks, classNames = {} }: NumberStepperProps) {
  const { draft, setDraft, value, save, onChange, onKeyDown } = hooks.useNumberStepper({ setting, bounds });
  const tipId = `${labelledBy}-tip`;
  const stepClass = join("jini-number-stepper__step", classNames.step);
  return (
    <div className={`${join("jini-number-stepper", classNames.group)} jini-tooltip`} role="group" aria-labelledby={labelledBy} data-tooltip={labels.tip} data-tooltip-placement="bottom">
      <button type="button" className={stepClass} tabIndex={-1} aria-label={labels.decrease} disabled={value <= bounds.min} onClick={() => save({ next: value - 1 })}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7" /></svg>
      </button>
      <input
        className={`${join("jini-number-stepper__value", classNames.value)} jini-tooltip`}
        data-tooltip={labels.tip}
        data-tooltip-placement="bottom"
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-label={labels.field}
        aria-describedby={tipId}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        aria-valuenow={value}
        value={draft ?? String(value)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => onChange({ text: event.currentTarget.value })}
        onBlur={() => setDraft(null)}
        onKeyDown={onKeyDown}
      />
      <button type="button" className={stepClass} tabIndex={-1} aria-label={labels.increase} disabled={value >= bounds.max} onClick={() => save({ next: value + 1 })}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" /></svg>
      </button>
      <span id={tipId} className={join("jini-number-stepper__tip", classNames.tip)}>{labels.tip}</span>
    </div>
  );
}
