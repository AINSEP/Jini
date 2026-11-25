import type { SiteUpdateStatusReply } from '@jini-ai/core/contracts/site/devops-deploy';
import type { ComponentType, ReactNode } from 'react';

export interface SiteUpdateNoticeProps {
  kit: {
    components: {
      Notice: ComponentType<{ children: ReactNode; tone?: 'info' | 'success' | 'warning' | 'danger' }>;
    };
  };
  useSiteUpdateStatusHook: (required: Record<string, never>, optional?: Record<string, never>) => SiteUpdateStatusReply | null;
  copy: {
    updateAvailable: (required: { latest: string; runningVersion: string }, optional?: Record<string, never>) => string;
    releaseNotes: string;
  };
}

export function SiteUpdateNotice(required: SiteUpdateNoticeProps, _optional: Record<string, never> = {}): ReactNode {
  const status = required.useSiteUpdateStatusHook({});
  if (status === null || status.availability.kind !== 'available') return null;
  const { availability } = status;
  const Notice = required.kit.components.Notice;
  // The notice is informational because the chat card remains the only write path.
  return (
    <Notice tone="info">
      {required.copy.updateAvailable({ latest: availability.latest, runningVersion: availability.runningVersion })}
      {/* Notes are release content, not trusted markup. */}
      {availability.notes.trim() !== '' && (
        <details>
          <summary>{required.copy.releaseNotes}</summary>
          {availability.notes}
        </details>
      )}
    </Notice>
  );
}
