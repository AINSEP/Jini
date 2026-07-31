import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeSkillsPort, EMPTY_SKILL_DRAFT } from '@jini-ai/ui-core';
import type { SkillDetail, SkillsPort } from '@jini-ai/ui-core';
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
