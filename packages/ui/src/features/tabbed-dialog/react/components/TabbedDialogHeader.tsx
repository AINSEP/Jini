import type { TabbedDialogTabMeta } from '../../types.js';
import type { ResolvedTabbedDialogLabels } from './tabbedDialogView.js';

export interface TabbedDialogHeaderProps {
  /** Element id the dialog root's `aria-labelledby` points at. */
  id: string;
  welcome: boolean;
  activeTab: TabbedDialogTabMeta | undefined;
  labels: ResolvedTabbedDialogLabels;
}

/** Either the welcome hero (kicker/title/subtitle) or the active tab's own header. */
export function TabbedDialogHeader({ id, welcome, activeTab, labels }: TabbedDialogHeaderProps) {
  return (
    <header className="jini-tabbed-dialog-head" id={id}>
      {welcome ? (
        <>
          <span className="jini-tabbed-dialog-kicker">{labels.welcomeKicker}</span>
          <h2>{labels.welcomeTitle}</h2>
          <p className="jini-tabbed-dialog-subtitle">{labels.welcomeSubtitle}</p>
        </>
      ) : (
        <>
          <span className="jini-tabbed-dialog-kicker">{labels.kicker}</span>
          <div className="jini-tabbed-dialog-head-line">
            <h2>{activeTab?.title ?? activeTab?.label ?? ''}</h2>
            {activeTab?.subtitle ? <p className="jini-tabbed-dialog-subtitle">{activeTab.subtitle}</p> : null}
          </div>
        </>
      )}
    </header>
  );
}
