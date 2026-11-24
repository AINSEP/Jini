
import { DEVICE_PREVIEW_ICONS } from "../device-preview-icons.js";
import {
  DEVICE_PREVIEW_OPTIONS,
  DEVICE_PREVIEW_WIDTHS,
  devicePreviewButtonHandleProps,
  type DevicePreviewDevice,
} from "./DevicePreview.hooks.js";

import { type Translate } from '@jini-ai/core/text';
import { agentHandle } from "@jini-ai/core/agent-handles";
/**
 * The Desktop/Tablet/Mobile segmented control plus its "1280px" readout — the one copy
 * `PageEditor.tsx`, `ThemeExplore.tsx` and `PostEditor.tsx` all render (see `DevicePreview.hooks.ts`).
 * Icon-only buttons; the translated word rides on `aria-label`/`title`.
 *
 * @complexity O(1) — iterates the fixed three-entry `DEVICE_PREVIEW_OPTIONS`.
 */
export function DevicePreviewToggle({
  device,
  setDevice,
  t,
  handlePrefix,
}: {
  device: DevicePreviewDevice;
  setDevice: (value: DevicePreviewDevice) => void;
  t: Translate;
  /** When set, each button gets an `agentHandle` named `${handlePrefix}-${key}`. */
  handlePrefix?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={t("Preview width")}>
      {DEVICE_PREVIEW_OPTIONS.map((entry) => {
        const DeviceIcon = DEVICE_PREVIEW_ICONS[entry.key];
        return (
          <button
            key={entry.key}
            type="button"
            aria-pressed={device === entry.key}
            aria-label={t(entry.label)}
            title={t(entry.label)}
            className={device === entry.key ? "is-active" : undefined}
            onClick={() => setDevice(entry.key)}
            {...devicePreviewButtonHandleProps({ handlePrefix, entry, agentHandle })}
          >
            <DeviceIcon />
          </button>
        );
      })}
      <span className="page-editor-width">{DEVICE_PREVIEW_WIDTHS[device]}px</span>
    </div>
  );
}
