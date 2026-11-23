import { useState, type KeyboardEvent } from "react";
import { numberFromTypedDigit, stepperKeyTarget, type StepperBounds } from "./number-stepper.js";
import type { NumberSetting } from "./use-optimistic-number-setting.hooks.js";

/** What {@link useNumberStepper} hands the stepper: the field's draft and its handlers. */
export interface NumberStepperController {
  draft: string | null;
  setDraft: (draft: string | null) => void;
  value: number;
  save: NumberSetting["save"];
  onChange: (input: { text: string }) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/** Manage the editable value and spinbutton keys of a {@link NumberSetting} within `bounds`. */
export function useNumberStepper({ setting, bounds }: { setting: NumberSetting; bounds: StepperBounds }, _options = {}): NumberStepperController {
  // `null` shows the saved value; a string is the field mid-edit (cleared, or a non-digit typed).
  const [draft, setDraft] = useState<string | null>(null);
  const { value, save } = setting;
  const onChange = ({ text }: { text: string }, _options = {}) => {
    const next = numberFromTypedDigit({ text, bounds });
    if (next === null) { setDraft(""); return; }
    setDraft(null);
    save({ next });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const next = stepperKeyTarget({ key: event.key, value, bounds });
    if (next === null) return;
    // A surrounding menu's own Up/Down/Home/End would move focus to another row; here they change the number.
    event.preventDefault();
    event.stopPropagation();
    setDraft(null);
    save({ next });
  };
  return { draft, setDraft, value, save, onChange, onKeyDown };
}
