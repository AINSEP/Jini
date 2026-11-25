// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StandingDraftAutosaveSnapshot } from '../../react/kit.js';
import { PostAutosaveRecoveryBanner } from '../editor/notices/PostAutosaveRecoveryBanner.js';
import { PostAutosaveStaleBanner } from '../editor/notices/PostAutosaveStaleBanner.js';
import { PostVersionConflictBanner } from '../editor/notices/PostVersionConflictBanner.js';

/** `t` is injected; prefixing proves every visible label goes through it. */
const t = (text: string) => `~${text}`;

const draft: StandingDraftAutosaveSnapshot = {
  bodyFormat: 'html', bodyHtml: '<p>x</p>', title: 'T', slug: 't', baseVersion: 2,
  savedAt: '2026-11-01T10:00:00.000Z', savedByPrincipalId: 'p1',
};

describe('PostAutosaveRecoveryBanner', () => {
  it('renders the injected recovery message with the draft, t and server timestamp', () => {
    const standingDraftRecoveryMessage = vi.fn(() => 'parked draft found');
    render(
      <PostAutosaveRecoveryBanner recoverableDraft={draft} serverUpdatedAt="2026-11-02T00:00:00.000Z"
        onRestore={vi.fn()} onDiscard={vi.fn()} t={t} standingDraftRecoveryMessage={standingDraftRecoveryMessage} />,
    );
    expect(screen.getByText('parked draft found')).toBeTruthy();
    expect(standingDraftRecoveryMessage).toHaveBeenCalledWith({ draft, t, serverUpdatedAt: '2026-11-02T00:00:00.000Z' });
  });

  it('routes Restore and Discard to their own callbacks only', () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(
      <PostAutosaveRecoveryBanner recoverableDraft={draft} serverUpdatedAt="" onRestore={onRestore} onDiscard={onDiscard}
        t={t} standingDraftRecoveryMessage={() => 'm'} />,
    );
    fireEvent.click(screen.getByText('~Restore'));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('~Discard'));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});

describe('PostAutosaveStaleBanner', () => {
  it('renders the injected stale-basis message for the given basis', () => {
    const staleBasis = { baseVersion: 4 };
    const staleBasisMessage = vi.fn((basis: { baseVersion: number }) => `paused at ${basis.baseVersion}`);
    render(<PostAutosaveStaleBanner staleBasis={staleBasis} staleBasisMessage={staleBasisMessage} />);
    expect(screen.getByText('paused at 4')).toBeTruthy();
    expect(staleBasisMessage).toHaveBeenCalledWith(staleBasis);
  });
});

describe('PostVersionConflictBanner', () => {
  it('Load latest carries the post conflict agent element, role and label', () => {
    render(
      <PostVersionConflictBanner saveConflict={{ expectedVersion: 3, currentVersion: 4 }} versionConflictMessage={() => 'someone else saved'}
        onSaveAnyway={vi.fn()} onLoadLatest={vi.fn()} onDismiss={vi.fn()} t={t} />,
    );
    const button = screen.getByRole('button', { name: '~Load latest' });
    expect(button.getAttribute('data-agent-element')).toBe('post-version-conflict-load-latest');
    expect(button.getAttribute('data-agent-role')).toBe('button');
    expect(button.getAttribute('data-agent-label')).toBe('Load latest version, discarding my unsaved edits');
  });

  it('renders the injected conflict message and routes each button to its own callback', () => {
    const saveConflict = { expectedVersion: 3, currentVersion: 4 };
    const versionConflictMessage = vi.fn(() => 'someone else saved');
    const onSaveAnyway = vi.fn();
    const onLoadLatest = vi.fn();
    const onDismiss = vi.fn();
    render(
      <PostVersionConflictBanner saveConflict={saveConflict} versionConflictMessage={versionConflictMessage}
        onSaveAnyway={onSaveAnyway} onLoadLatest={onLoadLatest} onDismiss={onDismiss} t={t} />,
    );
    expect(screen.getByText('someone else saved')).toBeTruthy();
    expect(versionConflictMessage).toHaveBeenCalledWith(saveConflict);
    expect(screen.getByText('~Loading the latest version discards your unsaved edits.')).toBeTruthy();
    fireEvent.click(screen.getByText('~Load latest'));
    expect(onLoadLatest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('~Replace their version'));
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('~Keep editing'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
