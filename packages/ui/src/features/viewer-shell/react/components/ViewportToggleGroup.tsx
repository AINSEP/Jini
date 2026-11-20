import { SegmentedToggle } from './SegmentedToggle.js';
import type { ViewportPreset } from '../../types.js';

export interface ViewportToggleGroupProps {
  presets: ViewportPreset[];
  viewport: string;
  onViewport: (viewport: string) => void;
  ariaLabel: string;
}

/**
 * Compact, always-visible viewport-preset toggle row — generalizes the
 * source component's `FileVersionViewportControls` (used in its file-version
 * manager's tighter toolbar, where a dropdown menu didn't fit). See
 * `ViewportSwitcher` for the dropdown-menu variant used by the main preview
 * toolbar (`PreviewViewportControls`), and `archived UI source map` for
 * why both ship rather than just one.
 */
export function ViewportToggleGroup({ presets, viewport, onViewport, ariaLabel }: ViewportToggleGroupProps) {
  return (
    <SegmentedToggle
      className="jini-viewer-viewport-toggle-group"
      ariaLabel={ariaLabel}
      value={viewport}
      onChange={onViewport}
      options={presets.map((preset) => ({
        value: preset.id,
        label: preset.label,
        title: preset.title,
        icon: preset.icon,
      }))}
    />
  );
}
