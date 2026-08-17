import { describe, expect, it } from 'vitest';
import * as barrel from '../index.js';
import * as registry from '../registry.js';
import * as renderers from '../renderers/index.js';
import * as urlLoadDecision from '../url-load-decision.js';
import * as srcdoc from '../srcdoc/index.js';
import * as i18n from '../react/i18n.js';
import * as srcDocSandbox from '../react/components/SrcDocSandbox.js';
import * as artifactView from '../react/components/ArtifactView.js';
import * as annotationCanvas from '../annotation-canvas/index.js';
import * as sandboxedDocument from '../sandboxed-document.js';
import * as sandboxBridge from '../sandbox-bridge.js';
import * as newTabPreview from '../new-tab-preview.js';

// Guards against a module being fully built and tested but never re-exported
// from the package's public barrel (see packages/ui/src/index.test.ts for
// the precedent this mirrors).
//
// `html-utils.js` is deliberately NOT tracked here: its
// `injectAfterHeadOpen`/`injectBeforeHeadEnd`/`injectBeforeBodyEnd` share a
// name with (different, independently-built) functions from
// `srcdoc/index.js` that ARE tracked below, so a plain `exportName in
// barrel` check would pass even if `html-utils.js`'s own re-export (under
// its `*StringOnly` alias — see `index.ts`'s doc comment) were missing
// entirely. It gets its own explicit describe block instead.
const modules: Record<string, object> = {
  registry,
  'renderers/index': renderers,
  'url-load-decision': urlLoadDecision,
  'srcdoc/index': srcdoc,
  'react/i18n': i18n,
  'react/components/SrcDocSandbox': srcDocSandbox,
  'react/components/ArtifactView': artifactView,
  'annotation-canvas/index': annotationCanvas,
  'sandboxed-document': sandboxedDocument,
  'sandbox-bridge': sandboxBridge,
  'new-tab-preview': newTabPreview,
};

describe('package barrel (src/index.ts)', () => {
  it('checks a non-empty set of tracked modules (sanity check on the map above)', () => {
    expect(Object.keys(modules).length).toBeGreaterThan(0);
  });

  it('re-exports every value export from every tracked module', () => {
    const missing: string[] = [];
    for (const [path, mod] of Object.entries(modules)) {
      for (const exportName of Object.keys(mod)) {
        if (!(exportName in barrel)) missing.push(`${exportName} (from ${path})`);
      }
    }
    expect(missing, 'exports present in a module but missing from the package barrel').toEqual([]);
  });

  /**
   * `html-utils.ts` independently ported the same generic string-splice
   * helpers as `srcdoc/build.ts` (tracked above) — real duplication, not a
   * naming accident; see `index.ts`'s doc comment for the full story. Its
   * versions are re-exported under a `StringOnly` suffix so neither
   * implementation silently shadows the other. Checked explicitly here
   * since the generic loop above can't distinguish two different functions
   * that happen to share a name.
   */
  it('re-exports html-utils.ts under its own names, aliasing the three that collide with srcdoc', () => {
    expect(typeof barrel.escapeHtmlAttribute).toBe('function');
    expect(typeof barrel.injectAfterHeadOpenStringOnly).toBe('function');
    expect(typeof barrel.injectBeforeHeadEndStringOnly).toBe('function');
    expect(typeof barrel.injectBeforeBodyEndStringOnly).toBe('function');
  });
});
