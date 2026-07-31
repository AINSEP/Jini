import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import * as i18n from '../features/i18n/index.js';
import * as observability from '../features/observability/index.js';
import * as connectors from '../features/connectors/index.js';
import * as browserChrome from '../features/browser-chrome/index.js';
import * as assetGrid from '../features/asset-grid/index.js';
import * as viewerShell from '../features/viewer-shell/index.js';
import * as versionManager from '../features/version-manager/index.js';
import * as htmlViewer from '../features/html-viewer/index.js';
import * as settingsDialog from '../features/settings/dialog/index.js';
import * as settingsAppearance from '../features/appearance/index.js';
import * as settingsNotifications from '../features/notifications/index.js';
import * as settingsLanguage from '../features/language/index.js';
import * as settingsInstructions from '../features/instructions/index.js';
import * as settingsPrivacy from '../features/privacy/index.js';
import * as settingsIntegrations from '../features/integrations/index.js';
import * as settingsExecution from '../features/execution/index.js';
import * as settingsSkills from '../features/skills/index.js';
import * as settingsProjectLocations from '../features/project-locations/index.js';
import * as settingsAbout from '../features/about/index.js';
import * as settingsMediaProviders from '../features/media-providers/index.js';
import * as memory from '../features/memory/index.js';
import * as resourceDashboard from '../features/resource-dashboard/index.js';
import * as sketchEditor from '../features/sketch-editor/index.js';
import * as lexicalRichTextEditor from '../features/lexical-rich-text-editor/index.js';

// Guards against the exact bug found while merging browser-chrome and
// viewer-shell: both features were fully built, individually tested, and
// 100%-coverage-verified, but their own `export * from './features/<x>/
// index.js'` line was never added to this package's public barrel — every
// internal test imported the feature directly, so nothing ever noticed the
// outside world couldn't reach it. New feature ships → add its index module
// to this map too, or this test can't check it.
const featureModules: Record<string, object> = {
  'features/i18n': i18n,
  'features/observability': observability,
  'features/connectors': connectors,
  'features/browser-chrome': browserChrome,
  'features/asset-grid': assetGrid,
  'features/viewer-shell': viewerShell,
  'features/version-manager': versionManager,
  'features/html-viewer': htmlViewer,
  'features/settings/dialog': settingsDialog,
  'features/appearance': settingsAppearance,
  'features/notifications': settingsNotifications,
  'features/language': settingsLanguage,
  'features/instructions': settingsInstructions,
  'features/privacy': settingsPrivacy,
  'features/integrations': settingsIntegrations,
  'features/execution': settingsExecution,
  'features/skills': settingsSkills,
  'features/project-locations': settingsProjectLocations,
  'features/about': settingsAbout,
  'features/media-providers': settingsMediaProviders,
  'features/memory': memory,
  'features/resource-dashboard': resourceDashboard,
};

describe('package barrel (src/index.ts)', () => {
  it('checks a non-empty set of feature modules (sanity check on the map above)', () => {
    expect(Object.keys(featureModules).length).toBeGreaterThan(0);
  });

  it('re-exports every value export from every tracked features/**/index.ts', () => {
    const missing: string[] = [];
    for (const [path, mod] of Object.entries(featureModules)) {
      for (const exportName of Object.keys(mod)) {
        if (!(exportName in barrel)) {
          missing.push(`${exportName} (from ${path})`);
        }
      }
    }
    expect(missing, 'exports present in a feature module but missing from the package barrel').toEqual([]);
  });

  it('does NOT re-export sketch-editor or lexical-rich-text-editor — those carry a heavy npm dependency (@excalidraw/excalidraw, lexical) and live at their own subpaths', () => {
    // Inverse of the guard above: these two feature modules are deliberately EXCLUDED from the
    // barrel (2026-07-29) so importing anything else from `@jini-ai/ui` never drags in Excalidraw
    // or Lexical. Checks every export from each module by REFERENCE, not just name presence —
    // `buildMentionToken` is a coincidental same-name-different-function collision between
    // `mention-autocomplete` (legitimately on the barrel) and `lexical-rich-text-editor` (not); a
    // name-only check would wrongly flag that as a leak instead of catching only a real one (the
    // literal `lexical-rich-text-editor` value becoming reachable through the root barrel).
    const leaked: string[] = [];
    for (const [path, mod] of Object.entries({
      'features/sketch-editor': sketchEditor,
      'features/lexical-rich-text-editor': lexicalRichTextEditor,
    })) {
      for (const [exportName, value] of Object.entries(mod)) {
        if ((barrel as Record<string, unknown>)[exportName] === value) leaked.push(`${exportName} (from ${path})`);
      }
    }
    expect(leaked, 'exports that should only be reachable via their own subpath, not the root barrel').toEqual([]);
  });
});
