import { useMediaPickerBridge } from '../hooks/MediaPickerBridge.hooks.js';
import type { SeoMediaPickerSlotProps } from '../options.js';
/** The shared picker service owns its UI; this consumer never renders a second picker. */
export function MediaPickerBridge(props: SeoMediaPickerSlotProps, _optional: Record<string, never> = {}) {
  const { error, cancel } = useMediaPickerBridge(props);
  return <>{error && <div role="alert">{error}<button type="button" onClick={cancel}>Cancel</button></div>}</>;
}
