import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeSkillsPort } from '../../../dependencies.js';
import type { SkillsPort } from '../../../ports.js';
import { EMPTY_SKILL_DRAFT } from '../../../rules.js';
import type { SkillDetail, SkillFileEntry, SkillSummary } from '../../../types.js';
import { useSkillsTab } from '../../../react/hooks/useSkillsTab.js';

const USER_SKILL: SkillDetail = {
  id: 'skill-custom',
  name: 'My Custom Skill',
  description: 'A user skill.',
  triggers: ['custom'],
  mode: 'assistant',
  source: 'user',
  body: '# Custom\n\nDo the other thing.',
};

const OTHER_USER_SKILL: SkillDetail = {
  id: 'skill-other',
  name: 'Other Skill',
  description: 'A second user skill.',
  triggers: ['other'],
  mode: 'assistant',
  source: 'user',
  body: '# Other\n\nDo the thing.',
};

const BUILT_IN_SKILL: SkillDetail = {
  id: 'skill-built-in',
  name: 'Built-in Skill',
  description: 'Ships with the host.',
  triggers: ['built-in'],
  mode: 'assistant',
  source: 'built-in',
  body: '# Built-in\n\nAlready here.',
};

const VALID_DRAFT = { name: 'New skill', description: '', triggers: '', body: '# Body' };

/** A promise plus its resolve/reject, for tests that need to control exactly
 *  when a port call settles relative to an unmount. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSkillsTab — cancelDraft', () => {
  it('clears an in-progress create draft back to idle', async () => {
    const port = createFakeSkillsPort({ skills: [] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    await waitFor(() => expect(result.current.creating).toBe(true));

    result.current.cancelDraft();
    await waitFor(() => expect(result.current.creating).toBe(false));
    expect(result.current.editingId).toBeNull();
    expect(result.current.draft).toEqual(EMPTY_SKILL_DRAFT);
  });

  it('clears an in-progress edit draft back to idle', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.requestEdit(result.current.skills[0]!);
    await waitFor(() => expect(result.current.editingId).toBe('skill-custom'));

    result.current.cancelDraft();
    await waitFor(() => expect(result.current.editingId).toBeNull());
    expect(result.current.creating).toBe(false);
    expect(result.current.draft).toEqual(EMPTY_SKILL_DRAFT);
  });
});

describe('useSkillsTab — commitDelete', () => {
  it('deleting the skill currently being edited clears editingId and resets the draft', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.requestEdit(result.current.skills[0]!);
    await waitFor(() => expect(result.current.editingId).toBe('skill-custom'));

    result.current.commitDelete('skill-custom');
    await waitFor(() => expect(result.current.editingId).toBeNull());
    expect(result.current.draft).toEqual(EMPTY_SKILL_DRAFT);
  });

  it('deleting a DIFFERENT skill than the one being edited leaves the edit in progress', async () => {
    const OTHER: SkillDetail = { ...USER_SKILL, id: 'skill-other', name: 'Other' };
    const port = createFakeSkillsPort({ skills: [USER_SKILL, OTHER] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.requestEdit(USER_SKILL);
    await waitFor(() => expect(result.current.editingId).toBe('skill-custom'));

    result.current.commitDelete('skill-other');
    await waitFor(() => expect(result.current.skills.map((s) => s.id)).toEqual(['skill-custom']));
    // The edit in progress for the OTHER (still-existing) skill is untouched.
    expect(result.current.editingId).toBe('skill-custom');
  });

  it('a rejected deleteSkill reports a submit-failed draft error instead of silently dropping the request', async () => {
    const port: SkillsPort = {
      listSkills: () => Promise.resolve([USER_SKILL]),
      fetchSkillDetail: () => Promise.resolve(USER_SKILL),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('registry locked')),
    };
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.commitDelete('skill-custom');
    await waitFor(() => expect(result.current.draftError).toEqual({ kind: 'submit-failed', message: 'registry locked' }));
    // The rejected delete must not have landed.
    expect(result.current.skills.map((s) => s.id)).toEqual(['skill-custom']);
  });
});

describe('useSkillsTab — initial load', () => {
  it('does not act on the initial listSkills rejection once unmounted before it settles', async () => {
    const list = deferred<readonly SkillSummary[]>();
    const port: SkillsPort = {
      listSkills: () => list.promise,
      fetchSkillDetail: () => Promise.reject(new Error('n/a')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    const beforeUnmount = result.current;

    unmount();
    list.reject(new Error('registry unreachable'));
    await list.promise.catch(() => undefined);

    // Nothing further happens: the hook never re-rendered with a load error.
    expect(result.current).toBe(beforeUnmount);
  });

  it('records a load error message when the initial list rejects with a non-Error value', async () => {
    const port: SkillsPort = {
      listSkills: () => Promise.reject('registry offline'),
      fetchSkillDetail: () => Promise.reject(new Error('n/a')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe('registry offline');
  });
});

describe('useSkillsTab — ensureBody / ensureFiles caching', () => {
  it('reuses the cached body and file tree on a second expand instead of re-fetching', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const detailSpy = vi.spyOn(port, 'fetchSkillDetail');
    const filesSpy = vi.spyOn(port, 'fetchSkillFiles');
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.toggleExpanded('skill-custom');
    await waitFor(() => expect(result.current.expandedId).toBe('skill-custom'));
    await waitFor(() => expect(result.current.bodyLoadingId).toBeNull());
    expect(detailSpy).toHaveBeenCalledTimes(1);
    expect(filesSpy).toHaveBeenCalledTimes(1);

    result.current.toggleExpanded('skill-custom'); // collapse
    await waitFor(() => expect(result.current.expandedId).toBeNull());
    result.current.toggleExpanded('skill-custom'); // expand again — cache hit
    await waitFor(() => expect(result.current.expandedId).toBe('skill-custom'));

    expect(detailSpy).toHaveBeenCalledTimes(1);
    expect(filesSpy).toHaveBeenCalledTimes(1);
  });

  it('leaves an already-settling rows loading flag alone when a DIFFERENT row is expanded meanwhile', async () => {
    const bodyDeferreds: Record<string, ReturnType<typeof deferred<SkillDetail>>> = {};
    const filesDeferreds: Record<string, ReturnType<typeof deferred<readonly SkillFileEntry[]>>> = {};
    const port: SkillsPort = {
      listSkills: () => Promise.resolve([USER_SKILL, OTHER_USER_SKILL]),
      fetchSkillDetail: (id: string) => (bodyDeferreds[id] = deferred<SkillDetail>()).promise,
      fetchSkillFiles: (id: string) => (filesDeferreds[id] = deferred<readonly SkillFileEntry[]>()).promise,
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.toggleExpanded('skill-custom');
    await waitFor(() => expect(result.current.bodyLoadingId).toBe('skill-custom'));

    result.current.toggleExpanded('skill-other');
    await waitFor(() => expect(result.current.bodyLoadingId).toBe('skill-other'));
    await waitFor(() => expect(result.current.filesLoadingId).toBe('skill-other'));

    // The FIRST row's fetches settle after the loading flags have moved on.
    bodyDeferreds['skill-custom']!.resolve({ ...USER_SKILL });
    filesDeferreds['skill-custom']!.resolve([]);
    await waitFor(() => expect(result.current.bodyById['skill-custom']).toBe(USER_SKILL.body));

    // The stale finally callbacks must NOT clobber the loading id that has since moved to skill-other.
    expect(result.current.bodyLoadingId).toBe('skill-other');
    expect(result.current.filesLoadingId).toBe('skill-other');

    bodyDeferreds['skill-other']!.resolve({ ...OTHER_USER_SKILL });
    filesDeferreds['skill-other']!.resolve([]);
    await waitFor(() => expect(result.current.bodyLoadingId).toBeNull());
    expect(result.current.filesLoadingId).toBeNull();
  });
});

describe('useSkillsTab — toggleExpanded', () => {
  it('collapses a row that is already expanded', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.toggleExpanded('skill-custom');
    await waitFor(() => expect(result.current.expandedId).toBe('skill-custom'));

    result.current.toggleExpanded('skill-custom');
    await waitFor(() => expect(result.current.expandedId).toBeNull());
  });

  it('leaves an in-progress edit alone when toggling the SAME row it belongs to', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.requestEdit(result.current.skills[0]!);
    await waitFor(() => expect(result.current.editingId).toBe('skill-custom'));
    await waitFor(() => expect(result.current.expandedId).toBe('skill-custom'));

    result.current.toggleExpanded('skill-custom');
    await waitFor(() => expect(result.current.expandedId).toBeNull());
    // The edit form is a separate concern from the expand/collapse view.
    expect(result.current.editingId).toBe('skill-custom');
  });
});

describe('useSkillsTab — startEdit', () => {
  it('does not start editing once unmounted before the body fetch resolves', async () => {
    const body = deferred<SkillDetail>();
    const port: SkillsPort = {
      listSkills: () => Promise.resolve([USER_SKILL]),
      fetchSkillDetail: () => body.promise,
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.requestEdit(result.current.skills[0]!);
    const beforeUnmount = result.current;
    unmount();
    body.resolve({ ...USER_SKILL });
    await body.promise;

    expect(result.current).toBe(beforeUnmount);
  });
});

describe('useSkillsTab — confirmBuiltInEdit', () => {
  it('is a no-op when there is no pending built-in-edit confirmation', async () => {
    const port = createFakeSkillsPort({ skills: [BUILT_IN_SKILL] });
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.confirmBuiltInEditId).toBeNull();
    result.current.confirmBuiltInEdit();

    // Nothing to confirm — no edit was started.
    expect(result.current.editingId).toBeNull();
    expect(result.current.creating).toBe(false);
  });
});

describe('useSkillsTab — submitDraft', () => {
  it('ignores a second submit while the first one is still saving', async () => {
    const create = deferred<SkillDetail>();
    const port = createFakeSkillsPort({ skills: [] });
    const createSpy = vi.spyOn(port, 'createSkill').mockReturnValue(create.promise);
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    result.current.setDraft(() => VALID_DRAFT);
    await waitFor(() => expect(result.current.draft).toEqual(VALID_DRAFT));
    result.current.submitDraft();
    await waitFor(() => expect(result.current.draftSaving).toBe(true));

    result.current.submitDraft(); // ignored: a save is already in flight
    expect(createSpy).toHaveBeenCalledTimes(1);

    create.resolve({ ...VALID_DRAFT, id: 'fake-1', source: 'user', mode: 'assistant', triggers: [] });
    await waitFor(() => expect(result.current.draftSaving).toBe(false));
  });

  it('does not finish the submit once unmounted before the create call resolves', async () => {
    const create = deferred<SkillDetail>();
    const port = createFakeSkillsPort({ skills: [] });
    vi.spyOn(port, 'createSkill').mockReturnValue(create.promise);
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    result.current.setDraft(() => VALID_DRAFT);
    await waitFor(() => expect(result.current.draft).toEqual(VALID_DRAFT));
    result.current.submitDraft();
    const beforeUnmount = result.current;

    unmount();
    create.resolve({ ...VALID_DRAFT, id: 'fake-1', source: 'user', mode: 'assistant', triggers: [] });
    await create.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('does not finish the submit once unmounted between the write resolving and the follow-up refresh resolving', async () => {
    const refresh = deferred<readonly SkillSummary[]>();
    let listCalls = 0;
    const port: SkillsPort = {
      listSkills: () => (listCalls++ === 0 ? Promise.resolve([]) : refresh.promise),
      fetchSkillDetail: () => Promise.reject(new Error('n/a')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.resolve({ ...VALID_DRAFT, id: 'fake-1', source: 'user', mode: 'assistant', triggers: [] }),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.reject(new Error('n/a')),
    };
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    result.current.setDraft(() => VALID_DRAFT);
    await waitFor(() => expect(result.current.draft).toEqual(VALID_DRAFT));
    result.current.submitDraft();
    // draftSaving flips back to false right after the create resolves, BEFORE
    // the follow-up refresh() (2nd listSkills call) has settled.
    await waitFor(() => expect(result.current.draftSaving).toBe(false));
    const beforeUnmount = result.current;

    unmount();
    refresh.resolve([{ ...VALID_DRAFT, id: 'fake-1', source: 'user', mode: 'assistant', triggers: [] }]);
    await refresh.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('reports a submit-failed draft error with a non-Error rejection', async () => {
    const port = createFakeSkillsPort({ skills: [] });
    // A lazy implementation, not an eagerly-created rejected promise — the
    // latter fires before submitDraft's `.then(..., onRejected)` is attached
    // and trips Node's unhandled-rejection detector.
    vi.spyOn(port, 'createSkill').mockImplementation(() => Promise.reject('server exploded'));
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    result.current.setDraft(() => VALID_DRAFT);
    await waitFor(() => expect(result.current.draft).toEqual(VALID_DRAFT));
    result.current.submitDraft();

    await waitFor(() =>
      expect(result.current.draftError).toEqual({ kind: 'submit-failed', message: 'server exploded' }),
    );
  });

  it('does not report a draft error once unmounted before a failing create call rejects', async () => {
    const create = deferred<SkillDetail>();
    const port = createFakeSkillsPort({ skills: [] });
    vi.spyOn(port, 'createSkill').mockReturnValue(create.promise);
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.startCreate();
    result.current.setDraft(() => VALID_DRAFT);
    await waitFor(() => expect(result.current.draft).toEqual(VALID_DRAFT));
    result.current.submitDraft();
    const beforeUnmount = result.current;

    unmount();
    create.reject(new Error('disk full'));
    await create.promise.catch(() => undefined);

    expect(result.current).toBe(beforeUnmount);
  });
});

describe('useSkillsTab — commitDelete (unmount safety)', () => {
  it('does not finish the delete once unmounted before it resolves', async () => {
    const del = deferred<void>();
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    vi.spyOn(port, 'deleteSkill').mockReturnValue(del.promise);
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.commitDelete('skill-custom');
    const beforeUnmount = result.current;

    unmount();
    del.resolve(undefined);
    await del.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('does not finish the delete once unmounted between it resolving and the follow-up refresh resolving', async () => {
    const refresh = deferred<readonly SkillSummary[]>();
    let listCalls = 0;
    const port: SkillsPort = {
      listSkills: () => (listCalls++ === 0 ? Promise.resolve([USER_SKILL]) : refresh.promise),
      fetchSkillDetail: () => Promise.reject(new Error('n/a')),
      fetchSkillFiles: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('n/a')),
      updateSkill: () => Promise.reject(new Error('n/a')),
      deleteSkill: () => Promise.resolve(undefined),
    };
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.commitDelete('skill-custom');
    // The delete itself resolves synchronously; give the follow-up refresh()
    // call (2nd listSkills call, still pending) a chance to be issued.
    await waitFor(() => expect(listCalls).toBe(2));
    const beforeUnmount = result.current;

    unmount();
    refresh.resolve([]);
    await refresh.promise;

    expect(result.current).toBe(beforeUnmount);
  });

  it('reports a submit-failed draft error with a non-Error deleteSkill rejection', async () => {
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    vi.spyOn(port, 'deleteSkill').mockImplementation(() => Promise.reject('registry locked'));
    const { result } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.commitDelete('skill-custom');
    await waitFor(() =>
      expect(result.current.draftError).toEqual({ kind: 'submit-failed', message: 'registry locked' }),
    );
  });

  it('does not report a draft error once unmounted before a failing delete rejects', async () => {
    const del = deferred<void>();
    const port = createFakeSkillsPort({ skills: [USER_SKILL] });
    vi.spyOn(port, 'deleteSkill').mockReturnValue(del.promise);
    const { result, unmount } = renderHook(() => useSkillsTab({ port }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    result.current.commitDelete('skill-custom');
    const beforeUnmount = result.current;

    unmount();
    del.reject(new Error('registry locked'));
    await del.promise.catch(() => undefined);

    expect(result.current).toBe(beforeUnmount);
  });
});
