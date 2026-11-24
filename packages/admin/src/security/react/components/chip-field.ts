import type { ComponentType } from 'react';
/** One choice in the host's chip field. */
export interface SecurityChipFieldOption { value: string; label: string }
/** The props of the host's multiple-choice chip field, a feature-owned render slot (no kit name): the
 * host binds its own chip component (`security({ ui, ChipField })`). Selection state stays in the
 * credential controller; the field only reports the new id list. */
export interface SecurityChipFieldProps {
  readonly multiple: true; readonly label: string; readonly options: SecurityChipFieldOption[];
  readonly value: string[]; readonly onChange: (value: string[]) => void;
}
export type SecurityChipField = ComponentType<SecurityChipFieldProps>;
