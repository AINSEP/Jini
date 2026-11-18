import { useOverlayHost } from './OverlayHost.hooks.js';
import type { OverlayHostProps } from './OverlayHost.hooks.js';
export function OverlayHost({ useOverlayHostHook = useOverlayHost, ...props }: OverlayHostProps & { useOverlayHostHook?: typeof useOverlayHost }, _optional: Record<string, never> = {}) {
  const entries = useOverlayHostHook(props);
  return (
    <div data-jini-part="admin.overlays">
      {entries.map((entry) => (
        <div key={entry.id}>{entry.content}</div>
      ))}
    </div>
  );
}
