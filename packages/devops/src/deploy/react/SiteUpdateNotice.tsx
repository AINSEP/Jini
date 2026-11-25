import type {
  SiteUpdateAvailability, SiteUpdateLastAttempt, SiteUpdateStatusReply,
} from '@jini-ai/core/contracts/site/devops-deploy';
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

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
type SiteUpdateAvailable = Extract<SiteUpdateAvailability, { kind: 'available' }>;

// Only a verified update is a success: an accepted hand-off may still roll back after the restart.
const LAST_ATTEMPT_TONE: Record<SiteUpdateLastAttempt['status'], NoticeTone> = {
  updating: 'info',
  updated: 'success',
  'rolled-back': 'warning',
  failed: 'danger',
};

export function SiteUpdateNotice(required: SiteUpdateNoticeProps, _optional: Record<string, never> = {}): ReactNode {
  const status = required.useSiteUpdateStatusHook({});
  if (status === null) return null;
  const { availability, lastAttempt } = status;
  if (availability.kind !== 'available' && lastAttempt === undefined) return null;
  const Notice = required.kit.components.Notice;
  // The last attempt renders independently of availability, so a reconnecting owner sees how it settled.
  return (
    <>
      {lastAttempt !== undefined && <Notice tone={LAST_ATTEMPT_TONE[lastAttempt.status]}>{lastAttempt.summary}</Notice>}
      {availability.kind === 'available' && renderAvailable(required, availability)}
    </>
  );
}

function renderAvailable(required: SiteUpdateNoticeProps, availability: SiteUpdateAvailable): ReactNode {
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
