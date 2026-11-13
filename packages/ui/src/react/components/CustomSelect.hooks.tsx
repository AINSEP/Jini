import { agentHandleSegment } from '@jini-ai/agentic';
import type { CustomSelectOption, CustomSelectOptionButton } from './CustomSelect.js';

/** Render listbox choices with their current selection and activation state. */
export function useCustomSelectOptionRenderer({ base, value, activeValue, optionIdByValue, onChoose, onActive, OptionButton }: {
  base: string | undefined; value: string; activeValue: string; optionIdByValue: Map<string, string>;
  onChoose: (value: string) => void; onActive: (value: string) => void; OptionButton: typeof CustomSelectOptionButton;
}, _options = {}) {
  return (option: CustomSelectOption) => (
    <OptionButton
      key={option.value}
      option={option}
      agentHandle={base ? `${base}-option-${agentHandleSegment({ value: option.value })}` : false}
      selected={option.value === value}
      active={option.value === activeValue}
      id={optionIdByValue.get(option.value)}
      onChoose={onChoose}
      onActive={onActive}
    />
  );
}
