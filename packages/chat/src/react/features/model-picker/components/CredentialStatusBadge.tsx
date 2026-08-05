/**
 * @module CredentialStatusBadge
 *
 * A provider's credential status as a small pill — ported from
 * `NewProjectPanel.tsx`'s inline `newproj-provider-badge` span
 * ("Configured"/"Integrated"/"Unsupported"), de-branded and relabeled to
 * this feature's generic `CredentialStatus` union.
 */
import { useT } from '../../../hooks/context.js';
import type { CredentialStatus } from '../types.js';

export interface CredentialStatusBadgeProps {
  status: CredentialStatus;
  className?: string;
}

const STATUS_LABEL: Record<CredentialStatus, string> = {
  configured: 'Configured',
  available: 'Available',
  unconfigured: 'Not configured',
};

export function CredentialStatusBadge({ status, className }: CredentialStatusBadgeProps) {
  const t = useT();
  return (
    <span
      className={`model-picker-status-badge model-picker-status-badge--${status}${className ? ` ${className}` : ''}`}
      data-status={status}
    >
      {t(STATUS_LABEL[status])}
    </span>
  );
}
