import { describe, expect, it } from 'vitest';
import * as versionManager from '../index.js';

/**
 * A barrel-only smoke test: every other test in this feature imports from
 * the concrete module (`./rules.js`, `./dependencies.js`, etc.) rather than
 * `./index.js`, so nothing else actually loads/exercises this file's
 * re-export statements. Importing the barrel here both closes that coverage
 * gap and catches a real class of bug — a typo'd or missing re-export name
 * that unit tests hitting the concrete modules directly would never notice.
 */
describe('version-manager barrel (index.ts)', () => {
  it('re-exports the constants', () => {
    expect(versionManager.SEARCH_VISIBLE_THRESHOLD).toBeGreaterThan(0);
    expect(versionManager.PROMPT_COPY_FEEDBACK_RESET_MS).toBeGreaterThan(0);
    expect(versionManager.PREVIEW_LOAD_FALLBACK_MS).toBeGreaterThan(0);
    expect(versionManager.DEFAULT_PREVIEW_CANVAS_PADDING).toBeGreaterThan(0);
  });

  it('re-exports the pure rule functions', () => {
    expect(versionManager.versionSourceLabel({ source: 'manual' })).toBe('Manual');
    expect(versionManager.versionSourceClassName({ source: 'restore' })).toBe('restore');
    expect(versionManager.sortVersionsDescending([])).toEqual([]);
    expect(versionManager.buildVersionIndex([]).size).toBe(0);
    expect(versionManager.shouldShowVersionSearch({ versionCount: 1, threshold: 3 })).toBe(false);
  });

  it('re-exports the dependencies factories and singleton', () => {
    expect(versionManager.createFakeVersionManagerPort()).toBeDefined();
    expect(versionManager.createBrowserVersionManagerClipboard()).toBeDefined();
    expect(versionManager.createDefaultVersionManagerDependencies()).toBeDefined();
    expect(versionManager.defaultVersionManagerDependencies).toBeDefined();
  });

  it('re-exports the hooks and components', () => {
    expect(typeof versionManager.usePreviewCanvasSize).toBe('function');
    expect(typeof versionManager.useVersionManager).toBe('function');
    expect(typeof versionManager.useWiredVersionManager).toBe('function');
    expect(typeof versionManager.VersionSidebar).toBe('function');
    expect(typeof versionManager.VersionPromptPopover).toBe('function');
    expect(typeof versionManager.VersionRestoreControl).toBe('function');
    expect(typeof versionManager.VersionPreviewFrame).toBe('function');
    expect(typeof versionManager.VersionManagerModal).toBe('function');
  });
});
