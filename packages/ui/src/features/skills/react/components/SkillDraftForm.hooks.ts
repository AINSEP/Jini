import type { SkillDraft } from '../../types.js';
import type { SkillDraftFormProps } from './SkillDraftForm.js';

/** Apply the edited value to its draft field through the host's updater. */
export function createSkillDraftChangeHandler({ field, onDraftChange }: { field: keyof SkillDraft; onDraftChange: SkillDraftFormProps['onDraftChange'] }, _options = {}) {
  return (event: { target: { value: string } }) =>
    onDraftChange((current) => ({ ...current, [field]: event.target.value }));
}
