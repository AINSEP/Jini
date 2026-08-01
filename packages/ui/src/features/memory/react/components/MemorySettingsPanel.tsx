// Assembled top-level Memory tab: the piece the feature was missing. Every
// other component here (`MemoryList`, `MemoryHowPanel`, `MemoryHooksPanel`)
// was already dumb/presentational and ready to mount — what never existed
// was the Card-1 header (title, description, the "Memories | How it works"
// segmented control, the add/advanced icon buttons, and the master enable
// switch) or the glue that swaps Card 2's body between the two views. This
// file is that glue, at the same "props in, JSX out" altitude as its
// siblings — no transport, no effects; a host owns `topTab`/`enabled`/hook
// flags the same way it already owns everything `MemoryList`/`MemoryHowPanel`
// read.
//
// `savedMemory`/`howItWorks` are typed off the two body components' own prop
// shapes (`ComponentProps<typeof X>`, `sectionRef` supplied internally since
// no host actually needs to scroll to it from outside this panel) rather than
// a hand-duplicated prop list, so this file can't drift out of sync with
// either component's real signature.
import { useRef, type CSSProperties } from 'react';
import type { ComponentProps } from 'react';
import { Icon } from '../../../../react/components/Icon.js';
import { useT } from '../../../i18n/index.js';
import { MemoryHowPanel } from './MemoryHowPanel.js';
import { MemoryList } from './MemoryList.js';
import type { MemoryTopTab } from '../hooks/useMemoryNavigation.hooks.js';

export interface MemorySettingsPanelProps {
  /** Master memory switch shown top-right of the header card. */
  enabled: boolean;
  onToggleEnabled: (next: boolean) => void;
  /** Which of the two segmented views is showing. */
  topTab: MemoryTopTab;
  onTopTabChange: (tab: MemoryTopTab) => void;
  /** Opens the add-memory flow. Omit to render the button disabled — same
   *  "no handler, no affordance" convention `MemoryConnectedPanel`'s
   *  `onOpenConnectors` already uses. */
  onAdd?: () => void;
  /** Opens the Advanced (raw index editor) modal. Same omit-to-disable rule. */
  onOpenAdvanced?: () => void;
  savedMemory: Omit<ComponentProps<typeof MemoryList>, 'sectionRef'>;
  howItWorks: ComponentProps<typeof MemoryHowPanel>;
}

export function MemorySettingsPanel({
  enabled,
  onToggleEnabled,
  topTab,
  onTopTabChange,
  onAdd,
  onOpenAdvanced,
  savedMemory,
  howItWorks,
}: MemorySettingsPanelProps) {
  const t = useT();
  // Scroll target for the saved-memory section; nothing outside this panel
  // needs to reach it, so it's owned here rather than threaded through props.
  const sectionRef = useRef<HTMLElement | null>(null);

  return (
    <div className="memory-settings-panel">
      <section className="memory-panel-head-card">
        <div className="memory-panel-head-copy">
          <h4>{t('Memory')}</h4>
          <p className="hint">
            {t('Control whether saved facts, preferences, and project context are reused in future chats.')}
          </p>
        </div>
        <div className="memory-panel-head-controls">
          <div
            className="jini-seg-control memory-panel-seg"
            role="tablist"
            aria-label={t('Memory view')}
            style={{ '--seg-cols': 2 } as CSSProperties}
          >
            <button
              type="button"
              role="tab"
              aria-selected={topTab === 'memories'}
              className={'jini-seg-btn' + (topTab === 'memories' ? ' active' : '')}
              onClick={() => onTopTabChange('memories')}
            >
              <span className="jini-seg-title">{t('Memories')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={topTab === 'how'}
              className={'jini-seg-btn' + (topTab === 'how' ? ' active' : '')}
              onClick={() => onTopTabChange('how')}
            >
              <span className="jini-seg-title">{t('How it works')}</span>
            </button>
          </div>
          <button
            type="button"
            className="memory-icon-btn"
            onClick={onAdd}
            disabled={!onAdd}
            aria-label={t('Add memory')}
            title={t('Add memory')}
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            type="button"
            className="memory-icon-btn"
            onClick={onOpenAdvanced}
            disabled={!onOpenAdvanced}
            aria-label={t('Advanced')}
            title={t('Advanced')}
          >
            <Icon name="settings" size={14} />
          </button>
          <label className="toggle-switch memory-panel-master-toggle" title={enabled ? t('On') : t('Off')}>
            <input
              type="checkbox"
              aria-label={t('Enable memory')}
              checked={enabled}
              onChange={(event) => onToggleEnabled(event.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </section>

      {topTab === 'memories' ? <MemoryList sectionRef={sectionRef} {...savedMemory} /> : <MemoryHowPanel {...howItWorks} />}
    </div>
  );
}
