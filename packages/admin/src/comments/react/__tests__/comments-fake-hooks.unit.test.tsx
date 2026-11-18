import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '../../../__tests__/fetch-query-support.js';
import type { AdminComment } from '../../../core/ports/comments.js';
import { QueueActionsCell } from '../components/QueueActionsCell.js';
import { QueueSection, QueueTable, QueueToolbar } from '../components/QueueSection.js';
import { SettingsSection } from '../components/SettingsSection.js';
import type { useCommentsPage } from '../hooks/CommentsPage.hooks.js';
import type { useQueueActionsCell } from '../hooks/QueueActionsCell.hooks.js';
import type { useQueueSection, useQueueTable, useQueueToolbar } from '../hooks/QueueSection.hooks.js';
import type { useSettingsSection } from '../hooks/SettingsSection.hooks.js';
import { CommentsPortsContext } from '../hooks/CommentsPorts.hooks.js';
import { CommentsPage } from '../pages/CommentsPage.js';

/**
 * @file One fake-hook output test per comments component that takes its hook as a prop (hook-injection
 * rule). The fake translator prefixes `FAKE:`, which the real `t` can never produce, so a rendered
 * `FAKE:` string proves the injected hook fed the markup; no comments ports provider is mounted
 * (except for `CommentsPage`'s real child, see there), so the real hooks, which read it, would throw if they ran. A fake returns only the fields its component
 * reads, hence the single `as` in `fake`. The `jini-` class-prefix loop applies when a component moves,
 * so it is not asserted here.
 */
afterEach(cleanup);

const fake = <H extends (...args: never[]) => unknown>(vm: Partial<ReturnType<H>>) => vi.fn((..._args: Parameters<H>) => vm as ReturnType<H>);
const t = ((key: string) => `FAKE:${key}`) as never;
const COMMENT = { id: 'c1', authorName: 'FAKE-AUTHOR', status: 'pending' } as unknown as AdminComment;

describe('comments components render from their injected hooks', () => {
  it('CommentsPage shows the title and the no-permission notice of the fake hook', () => {
    const hook = fake<typeof useCommentsPage>({ permissions: [], error: null, t, canRead: false, canConfigure: false });
    // The page always mounts its real child SettingsSection (it renders nothing without `canConfigure`), which needs a ports scope.
    const ports = { commentsApi: {} as never, commentsSession: {} as never };
    render(<CommentsPortsContext.Provider value={ports}><CommentsPage useCommentsPageHook={hook} /></CommentsPortsContext.Provider>);
    expect(screen.getByText('FAKE:Comments')).toBeTruthy();
    expect(screen.getByText('FAKE:You do not have permission to view the moderation queue.')).toBeTruthy();
  });

  it('QueueSection shows the empty state and purge-free dialog of the fake hook', () => {
    const hook = fake<typeof useQueueSection>({
      t, status: 'spam', setStatus: vi.fn(), items: [], nextCursor: null, error: null, loadingMore: false, loadMore: vi.fn(), stateFor: () => ({ busy: false, error: null }),
      onModerate: vi.fn(), pendingPurge: null, setPendingPurge: vi.fn(), onPurge: vi.fn(), onCancelPurge: vi.fn(), purgeBusy: false,
    });
    render(<QueueSection permissions={[]} useQueueSectionHook={hook} />);
    expect(screen.getByText('FAKE:No {status} comments.'.replace('{status}', 'spam'))).toBeTruthy();
    expect(screen.getByLabelText('FAKE:Status')).toBeTruthy();
  });

  it('QueueToolbar sends the status the fake hook decides on', () => {
    const onChange = vi.fn();
    const hook = fake<typeof useQueueToolbar>({ onChange });
    render(<QueueToolbar status="pending" onStatusChange={vi.fn()} t={t} useQueueToolbarHook={hook} />);
    fireEvent.change(screen.getByLabelText('FAKE:Status'), { target: { value: 'spam' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('QueueTable renders the rows of the columns the fake hook builds and the load-more pager', () => {
    const loadMore = vi.fn();
    const hook = fake<typeof useQueueTable>({ columns: [{ key: 'a', header: 'FAKE-HEAD', cell: (c: AdminComment) => `FAKE-CELL-${c.id}` }] });
    render(<QueueTable items={[COMMENT]} nextCursor="n" loadingMore={false} loadMore={loadMore} permissions={[]} status="pending" stateFor={() => ({ busy: false, error: null })}
      t={t} onModerate={vi.fn()} onRequestPurge={vi.fn()} useQueueTableHook={hook} />);
    expect(screen.getByText('FAKE-HEAD')).toBeTruthy();
    expect(screen.getByText('FAKE-CELL-c1')).toBeTruthy();
    fireEvent.click(screen.getByText('FAKE:Load more'));
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('QueueActionsCell shows the placeholder the fake hook leaves and the row error', () => {
    const hook = fake<typeof useQueueActionsCell>({ menuItems: [] });
    render(<QueueActionsCell comment={COMMENT} agentHandleBase="row-0" permissions={[]} status="pending" rowState={{ busy: false, error: 'FAKE-ROW-ERROR' }}
      t={t} onModerate={vi.fn()} onRequestPurge={vi.fn()} useQueueActionsCellHook={hook} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('FAKE-ROW-ERROR')).toBeTruthy();
  });

  it('SettingsSection shows the form of the fake hook and routes submit to its handler', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const hook = fake<typeof useSettingsSection>({
      settings: { enabled: true, requireModeration: false, maxDepth: 4, closeAfterDays: null, spamAutoRejectScore: 0.5, maxPerIpPerHour: 9 },
      error: null, saving: false, notice: 'FAKE-NOTICE', onSubmit, t,
    });
    const { container } = render(<SettingsSection canConfigure useSettingsSectionHook={hook} />);
    expect(screen.getByText('FAKE:Settings')).toBeTruthy();
    expect(screen.getByText('FAKE-NOTICE')).toBeTruthy();
    expect((container.querySelector('input[name="maxDepth"]') as HTMLInputElement).value).toBe('4');
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
