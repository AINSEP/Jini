import type { MouseEvent } from 'react';
import type { I18nContextValue } from '../../../i18n/index.js';
import type { TabbedDialogChromeLabels } from '../../types.js';

/** Every chrome label resolved to a concrete string. */
export type ResolvedTabbedDialogLabels = Required<TabbedDialogChromeLabels>;

/**
 * Fills each chrome label the host left unset (absent or `undefined`) with its
 * product-neutral default, translated through `t`.
 */
export function resolveTabbedDialogLabels(
  { t }: { t: I18nContextValue['t'] },
  { labels }: { labels?: TabbedDialogChromeLabels | undefined } = {},
): ResolvedTabbedDialogLabels {
  const defaults: ResolvedTabbedDialogLabels = {
    // No brand/product word defaults to a bare `''` here on purpose — this component has no
    // opinion about what it's a dialog FOR. A host that wants a kicker (as `SettingsDialogShell`
    // does, with `t('Settings')`) supplies one via `labels.kicker`.
    kicker: '',
    welcomeKicker: t('Welcome'),
    welcomeTitle: t('Get started'),
    welcomeSubtitle: t('Set up your preferences before you begin.'),
    closeLabel: t('Close'),
    fullscreenLabel: t('Fullscreen'),
    exitFullscreenLabel: t('Exit fullscreen'),
    collapseSidebarLabel: t('Collapse sidebar'),
    expandSidebarLabel: t('Expand sidebar'),
    sidebarAriaLabel: t('Sections'),
  };
  const resolved = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof ResolvedTabbedDialogLabels)[]) {
    resolved[key] = labels?.[key] ?? defaults[key];
  }
  return resolved;
}

/**
 * `presentation` wins when set; otherwise a dialog with a close handler is a
 * modal and one without is inline (see `TabbedDialogProps.presentation`).
 */
export function resolveIsModal(
  { hasOnClose }: { hasOnClose: boolean },
  { presentation }: { presentation?: 'modal' | 'inline' | undefined } = {},
): boolean {
  return (presentation ?? (hasOnClose ? 'modal' : 'inline')) === 'modal';
}

/** The dialog root's class list: base class plus state modifiers plus the host's own. */
export function buildTabbedDialogClassName(
  { sidebarCollapsed, fullscreen }: { sidebarCollapsed: boolean; fullscreen: boolean },
  { className }: { className?: string | undefined } = {},
): string {
  return [
    'jini-tabbed-dialog',
    sidebarCollapsed ? 'jini-tabbed-dialog-sidebar-collapsed' : '',
    fullscreen ? 'jini-tabbed-dialog-fullscreen' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

/** Keeps a click inside the modal dialog from reaching the backdrop's close handler. */
function stopPropagation(event: Pick<MouseEvent, 'stopPropagation'>): void {
  event.stopPropagation();
}

/**
 * The dialog root's role/modality props. A modal is a `dialog` with
 * `aria-modal` that swallows its own clicks (so only a backdrop click closes
 * it); inline is a plain `region` with neither.
 */
export function dialogRootRoleProps({ isModal }: { isModal: boolean }): {
  role: 'dialog' | 'region';
  'aria-modal': true | undefined;
  onClick: ((event: Pick<MouseEvent, 'stopPropagation'>) => void) | undefined;
} {
  if (!isModal) return { role: 'region', 'aria-modal': undefined, onClick: undefined };
  return { role: 'dialog', 'aria-modal': true, onClick: stopPropagation };
}
