import { expect, it, vi } from 'vitest';
import { getPresentationSettings, setActiveTheme, PresentationSettingsValidationError } from '../presentation.js';
import { InMemoryPresentationSettingsRepo } from '../repo.memory.js';

it('treats selecting the current theme as a no-op, preserving its stored revision time', async () => {
  const settings = { workspaceId: 'w', activeThemeId: 'paper', updatedAt: 'original' };
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [settings] });
  const save = vi.spyOn(repo, 'save');
  const nowMs = vi.fn(() => 5000);
  const result = await setActiveTheme({ deps: { repo, clock: { nowMs } }, input: { workspaceId: 'w', activeThemeId: 'paper' } });
  expect(result).toEqual({ settings, availableThemeIds: ['paper', 'atlas', 'glassmorphic'] });
  expect(await repo.findByWorkspaceId({ workspaceId: 'w' })).toEqual(settings);
  expect(save).not.toHaveBeenCalled();
  expect(nowMs).not.toHaveBeenCalled();
});

it('uses an injected discovery allowlist on reads and writes without exposing the caller array', async () => {
  const settings = { workspaceId: 'w', activeThemeId: 'custom-one', updatedAt: 'original' };
  const repo = new InMemoryPresentationSettingsRepo({}, { initialRows: [settings] });
  const availableThemeIds = ['custom-one', 'custom-two'];
  const clock = { nowMs: () => 5000 };
  const read = await getPresentationSettings({ deps: { repo, availableThemeIds }, input: { workspaceId: 'w' } });
  expect(read).toEqual({ settings, availableThemeIds: ['custom-one', 'custom-two'] });
  read.availableThemeIds.push('injected');
  await expect(setActiveTheme({ deps: { repo, clock, availableThemeIds }, input: { workspaceId: 'w', activeThemeId: 'paper' } }))
    .rejects.toBeInstanceOf(PresentationSettingsValidationError);
  const result = await setActiveTheme({ deps: { repo, clock, availableThemeIds }, input: { workspaceId: 'w', activeThemeId: 'custom-two' } });
  expect(result).toEqual({ settings: { ...settings, activeThemeId: 'custom-two', updatedAt: '1970-01-01T00:00:05.000Z' },
    availableThemeIds: ['custom-one', 'custom-two'] });
  expect(await repo.findByWorkspaceId({ workspaceId: 'w' })).toEqual(result.settings);
  expect(availableThemeIds).toEqual(['custom-one', 'custom-two']);
});
