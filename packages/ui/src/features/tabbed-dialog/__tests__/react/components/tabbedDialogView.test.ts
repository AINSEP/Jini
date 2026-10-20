import { describe, expect, it, vi } from 'vitest';
import type { MouseEvent } from 'react';
import {
  buildTabbedDialogClassName,
  dialogRootRoleProps,
  resolveIsModal,
  resolveTabbedDialogLabels,
} from '../../../react/components/tabbedDialogView.js';

const t = (key: string) => `t:${key}`;

describe('resolveTabbedDialogLabels', () => {
  it('translates every default and leaves the kicker empty when no labels are given', () => {
    expect(resolveTabbedDialogLabels({ t })).toEqual({
      kicker: '',
      welcomeKicker: 't:Welcome',
      welcomeTitle: 't:Get started',
      welcomeSubtitle: 't:Set up your preferences before you begin.',
      closeLabel: 't:Close',
      fullscreenLabel: 't:Fullscreen',
      exitFullscreenLabel: 't:Exit fullscreen',
      collapseSidebarLabel: 't:Collapse sidebar',
      expandSidebarLabel: 't:Expand sidebar',
      sidebarAriaLabel: 't:Sections',
    });
  });

  it('keeps host-supplied labels, including an empty string, over the defaults', () => {
    const resolved = resolveTabbedDialogLabels({ t }, { labels: { kicker: 'Settings', closeLabel: '' } });
    expect(resolved.kicker).toBe('Settings');
    expect(resolved.closeLabel).toBe('');
    expect(resolved.fullscreenLabel).toBe('t:Fullscreen');
  });
});

describe('resolveIsModal', () => {
  it('is modal when a close handler exists and presentation is unset', () => {
    expect(resolveIsModal({ hasOnClose: true })).toBe(true);
  });

  it('is inline when there is no close handler and presentation is unset', () => {
    expect(resolveIsModal({ hasOnClose: false }, { presentation: undefined })).toBe(false);
  });

  it('honors an explicit inline presentation over a close handler', () => {
    expect(resolveIsModal({ hasOnClose: true }, { presentation: 'inline' })).toBe(false);
  });

  it('honors an explicit modal presentation without a close handler', () => {
    expect(resolveIsModal({ hasOnClose: false }, { presentation: 'modal' })).toBe(true);
  });
});

describe('buildTabbedDialogClassName', () => {
  it('is just the base class with no modifiers and no host class', () => {
    expect(buildTabbedDialogClassName({ sidebarCollapsed: false, fullscreen: false })).toBe('jini-tabbed-dialog');
  });

  it('appends both state modifiers and the host class in order', () => {
    expect(buildTabbedDialogClassName({ sidebarCollapsed: true, fullscreen: true }, { className: 'host' })).toBe(
      'jini-tabbed-dialog jini-tabbed-dialog-sidebar-collapsed jini-tabbed-dialog-fullscreen host',
    );
  });

  it('drops an empty host class rather than leaving a trailing space', () => {
    expect(buildTabbedDialogClassName({ sidebarCollapsed: false, fullscreen: true }, { className: '' })).toBe(
      'jini-tabbed-dialog jini-tabbed-dialog-fullscreen',
    );
  });
});

describe('dialogRootRoleProps', () => {
  it('is a plain region with no modality and no click handler when inline', () => {
    expect(dialogRootRoleProps({ isModal: false })).toEqual({ role: 'region', 'aria-modal': undefined, onClick: undefined });
  });

  it('is an aria-modal dialog when modal', () => {
    const props = dialogRootRoleProps({ isModal: true });
    expect(props.role).toBe('dialog');
    expect(props['aria-modal']).toBe(true);
  });

  it('stops a click inside the modal from propagating to the backdrop', () => {
    const stopPropagation = vi.fn();
    const event: Pick<MouseEvent, 'stopPropagation'> = { stopPropagation };
    dialogRootRoleProps({ isModal: true }).onClick?.(event);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});
