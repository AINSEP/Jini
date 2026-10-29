import { Icon, type IconName } from '../../../../react/components/Icon.js';

export interface SketchSaveStateBadgeProps {
  state: 'saving' | 'dirty' | 'saved';
  label: string;
}

const STATE_ICONS: Record<string, IconName> = { saving: 'spinner', dirty: 'alert-triangle' };

/** The small save-state indicator rendered in Excalidraw's own top-right UI slot. */
export function SketchSaveStateBadge({ state, label }: SketchSaveStateBadgeProps) {
  return (
    <div className="sketch-excalidraw-actions" data-testid="sketch-save-state">
      <span className={`sketch-save-state is-${state}`} role="status" aria-live="polite">
        <Icon
          name={STATE_ICONS[state] ?? 'check'}
          size={12}
          className={state === 'saving' ? 'icon-spin' : undefined}
        />
        <span>{label}</span>
      </span>
    </div>
  );
}
