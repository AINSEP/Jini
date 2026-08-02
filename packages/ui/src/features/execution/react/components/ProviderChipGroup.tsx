import type { ProviderPreset } from '../../types.js';

export interface ProviderChipGroupProps {
  label: string;
  presets: readonly ProviderPreset[];
  selectedPresetId: string | null;
  /** Ids whose credentials are complete — renders the filled status dot. */
  configuredPresetIds: ReadonlySet<string>;
  onSelect: (preset: ProviderPreset) => void;
  configuredLabel: string;
  unsetLabel: string;
}

/**
 * One labelled row of endpoint chips. Origin: the `protocol-chips` strip in
 * `SettingsDialog.tsx`'s execution tab, which drew a status dot per provider
 * to show at a glance which endpoints already hold credentials.
 *
 * Renders nothing when the row is empty, so a host supplying only protocol
 * presets doesn't get a stray "Gateways" label over an empty row.
 */
export function ProviderChipGroup({
  label,
  presets,
  selectedPresetId,
  configuredPresetIds,
  onSelect,
  configuredLabel,
  unsetLabel,
}: ProviderChipGroupProps) {
  if (presets.length === 0) return null;

  return (
    <div className="jini-provider-chip-row" role="tablist" aria-label={label}>
      <span className="jini-provider-chip-row-label">{label}</span>
      <div className="jini-provider-chip-options">
        {presets.map((preset) => {
          const active = selectedPresetId === preset.id;
          const configured = configuredPresetIds.has(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={'jini-provider-chip' + (active ? ' active' : '')}
              title={`${preset.title} — ${configured ? configuredLabel : unsetLabel}`}
              onClick={() => {
                if (!active) onSelect(preset);
              }}
            >
              <span
                className={`jini-provider-chip-status${configured ? ' is-configured' : ' is-unset'}`}
                aria-hidden="true"
              />
              <span>{preset.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
