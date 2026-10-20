import { describe, expect, it } from 'vitest';
import {
  filterBoardItemsByQuery,
  groupItemsByStatus,
  isActionPending,
  pendingActionKey,
  pruneSelectedIds,
  sortBoardItems,
  statusToneFor,
  toggleSelectedId,
  withoutPendingAction,
  withPendingAction,
} from '../rules.js';
import { UNMATCHED_STATUS_BUCKET } from '../constants.js';
import type { ResourceBoardItem } from '../types.js';

function makeItem(overrides: Partial<ResourceBoardItem> = {}): ResourceBoardItem {
  return { id: 'i1', title: 'Item one', ...overrides };
}

describe('statusToneFor', () => {
  it('resolves a mapped status to its tone', () => {
    expect(statusToneFor('running', { running: 'active' })).toBe('active');
  });

  it('defaults to neutral for an unmapped status', () => {
    expect(statusToneFor('mystery', { running: 'active' })).toBe('neutral');
  });

  it('defaults to neutral when no map is supplied at all', () => {
    expect(statusToneFor('running', undefined)).toBe('neutral');
  });
});

describe('pendingActionKey / isActionPending / withPendingAction / withoutPendingAction', () => {
  it('builds a stable per-(id, kind) key', () => {
    expect(pendingActionKey('r1', 'run')).toBe('run:r1');
  });

  it('tracks and clears pending state independently per (id, kind)', () => {
    let pending: ReadonlySet<string> = new Set<string>();
    pending = withPendingAction(pending, 'r1', 'run');
    expect(isActionPending(pending, 'r1', 'run')).toBe(true);
    expect(isActionPending(pending, 'r1', 'delete')).toBe(false);
    expect(isActionPending(pending, 'r2', 'run')).toBe(false);

    pending = withoutPendingAction(pending, 'r1', 'run');
    expect(isActionPending(pending, 'r1', 'run')).toBe(false);
  });

  it('withoutPendingAction returns the same set instance when nothing was pending', () => {
    const pending = new Set<string>();
    expect(withoutPendingAction(pending, 'r1', 'run')).toBe(pending);
  });
});

describe('groupItemsByStatus', () => {
  const order = ['not_started', 'running', 'succeeded'] as const;

  it('builds one column per status in order, including empty columns', () => {
    const columns = groupItemsByStatus([], order);
    expect([...columns.keys()]).toEqual(['not_started', 'running', 'succeeded']);
    expect(columns.get('not_started')).toEqual([]);
  });

  it('places each item into its status column', () => {
    const items = [makeItem({ id: 'a', status: 'running' }), makeItem({ id: 'b', status: 'succeeded' }), makeItem({ id: 'c', status: 'running' })];
    const columns = groupItemsByStatus(items, order);
    expect(columns.get('running')?.map((i) => i.id)).toEqual(['a', 'c']);
    expect(columns.get('succeeded')?.map((i) => i.id)).toEqual(['b']);
  });

  it('applies defaultStatus for items with no status at all', () => {
    const items = [makeItem({ id: 'a' })];
    const columns = groupItemsByStatus(items, order, { defaultStatus: 'not_started' });
    expect(columns.get('not_started')?.map((i) => i.id)).toEqual(['a']);
  });

  it('leaves an item with no status and no defaultStatus unmatched', () => {
    const items = [makeItem({ id: 'a' })];
    const columns = groupItemsByStatus(items, order);
    expect(columns.get(UNMATCHED_STATUS_BUCKET)?.map((i) => i.id)).toEqual(['a']);
  });

  it('normalizes a status before matching (e.g. queued -> running)', () => {
    const items = [makeItem({ id: 'a', status: 'queued' })];
    const columns = groupItemsByStatus(items, order, {
      normalizeStatus: (status) => (status === 'queued' ? 'running' : status),
    });
    expect(columns.get('running')?.map((i) => i.id)).toEqual(['a']);
  });

  it('buckets an unrecognized status into UNMATCHED_STATUS_BUCKET rather than dropping it', () => {
    const items = [makeItem({ id: 'a', status: 'archived' })];
    const columns = groupItemsByStatus(items, order);
    expect(columns.has(UNMATCHED_STATUS_BUCKET)).toBe(true);
    expect(columns.get(UNMATCHED_STATUS_BUCKET)?.map((i) => i.id)).toEqual(['a']);
  });

  it('omits UNMATCHED_STATUS_BUCKET entirely when every item matched', () => {
    const items = [makeItem({ id: 'a', status: 'running' })];
    const columns = groupItemsByStatus(items, order);
    expect(columns.has(UNMATCHED_STATUS_BUCKET)).toBe(false);
  });

  it('runs defaultStatus through normalizeStatus too', () => {
    const items = [makeItem({ id: 'a' })];
    const columns = groupItemsByStatus(items, order, {
      defaultStatus: 'queued',
      normalizeStatus: (status) => (status === 'queued' ? 'running' : status),
    });
    expect(columns.get('running')?.map((i) => i.id)).toEqual(['a']);
  });

  it('never calls normalizeStatus for an item with no status and no defaultStatus', () => {
    const seen: string[] = [];
    groupItemsByStatus([makeItem({ id: 'a' })], order, {
      normalizeStatus: (status) => {
        seen.push(status);
        return status;
      },
    });
    expect(seen).toEqual([]);
  });

  it('buckets an item whose normalized status is outside statusOrder as unmatched', () => {
    const items = [makeItem({ id: 'a', status: 'running' })];
    const columns = groupItemsByStatus(items, order, { normalizeStatus: () => 'archived' });
    expect(columns.get('running')).toEqual([]);
    expect(columns.get(UNMATCHED_STATUS_BUCKET)?.map((i) => i.id)).toEqual(['a']);
  });
});

describe('filterBoardItemsByQuery', () => {
  const items = [makeItem({ id: 'a', title: 'Marketing site', subtitle: 'Freeform' }), makeItem({ id: 'b', title: 'Landing page', subtitle: 'Marketing collateral' })];

  it('returns every item for an empty/whitespace-only query', () => {
    expect(filterBoardItemsByQuery(items, '   ')).toHaveLength(2);
  });

  it('matches case-insensitively against title', () => {
    expect(filterBoardItemsByQuery(items, 'landing').map((i) => i.id)).toEqual(['b']);
  });

  it('matches against subtitle too', () => {
    expect(filterBoardItemsByQuery(items, 'collateral').map((i) => i.id)).toEqual(['b']);
  });

  it('matches an item with no subtitle without throwing', () => {
    const bare = [makeItem({ id: 'c', title: 'Bare item' })];
    expect(filterBoardItemsByQuery(bare, 'bare').map((i) => i.id)).toEqual(['c']);
  });

  it('returns no items when nothing matches', () => {
    expect(filterBoardItemsByQuery(items, 'zzz')).toEqual([]);
  });
});

describe('sortBoardItems', () => {
  const items = [
    makeItem({ id: 'a', sortValues: { recent: 10 } }),
    makeItem({ id: 'b', sortValues: { recent: 30 } }),
    makeItem({ id: 'c', sortValues: { recent: 20 } }),
  ];

  it('returns items unchanged (by reference contents) when no sort option is given', () => {
    expect(sortBoardItems(items, undefined).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts descending by the given sort option value', () => {
    expect(sortBoardItems(items, 'recent').map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('is a no-op (preserves original order) for a sort option no item has a value for', () => {
    expect(sortBoardItems(items, 'unknown-option').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts items with a value before items missing one, preserving original order among ties and among missing values', () => {
    const mixed = [makeItem({ id: 'x' }), makeItem({ id: 'y', sortValues: { recent: 5 } }), makeItem({ id: 'z' })];
    expect(sortBoardItems(mixed, 'recent').map((i) => i.id)).toEqual(['y', 'x', 'z']);
  });

  it('preserves original relative order for exactly equal values', () => {
    const tied = [makeItem({ id: 'x', sortValues: { recent: 5 } }), makeItem({ id: 'y', sortValues: { recent: 5 } })];
    expect(sortBoardItems(tied, 'recent').map((i) => i.id)).toEqual(['x', 'y']);
  });
});

describe('toggleSelectedId', () => {
  it('adds an id not yet selected', () => {
    expect([...toggleSelectedId(new Set(), 'a')]).toEqual(['a']);
  });

  it('removes an id already selected', () => {
    expect([...toggleSelectedId(new Set(['a']), 'a')]).toEqual([]);
  });
});

describe('pruneSelectedIds', () => {
  it('returns the same set instance when nothing needed pruning', () => {
    const selected = new Set(['a']);
    expect(pruneSelectedIds(selected, new Set(['a', 'b']))).toBe(selected);
  });

  it('drops ids no longer present in validIds', () => {
    const pruned = pruneSelectedIds(new Set(['a', 'b']), new Set(['a']));
    expect([...pruned]).toEqual(['a']);
  });
});
