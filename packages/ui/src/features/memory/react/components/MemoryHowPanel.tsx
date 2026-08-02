// Dumb panel for the "How it works" tab: the automatic-capture flow diagram, a
// one-paragraph primer, and the pluggable-hooks toggles. Presentational only —
// state + the toggle transport live in a host's config hook.
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import type { MemoryConfigFlagKey } from '../../rules.js';
import { MemoryHooksPanel } from './MemoryHooksPanel.js';

export function MemoryHowPanel({
  enabled,
  hookFlags,
  onToggleHook,
}: {
  enabled: boolean;
  hookFlags: Record<MemoryConfigFlagKey, boolean>;
  onToggleHook: (key: MemoryConfigFlagKey, next: boolean) => void;
}) {
  const t = useT();
  return (
    <div className="memory-how-panel">
      <div className="memory-auto-flow">
        <span>{t('Onboarding')}</span>
        <Icon name="chevron-right" size={13} />
        <span>{t('Brand context')}</span>
        <Icon name="chevron-right" size={13} />
        <span>{t('Chat signals')}</span>
        <Icon name="chevron-right" size={13} />
        <strong>{t('Saved memory')}</strong>
      </div>
      <p className="memory-how-copy">
        {t(
          'Memory is gathered automatically from profile setup, project and brand extraction, connected apps, and useful facts learned during chats. The saved list below is the review surface; everything else stays quiet unless you open Add or Advanced.',
        )}
      </p>
      <MemoryHooksPanel enabled={enabled} flags={hookFlags} onToggle={onToggleHook} />
    </div>
  );
}
