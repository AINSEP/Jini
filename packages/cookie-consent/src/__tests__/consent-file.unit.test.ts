import { describe, expect, it } from 'vitest';
import { consentBridgeContribution, declaredScriptsContribution, parseConsentContributions } from '../plugins.js';

const file = (contributions: unknown[]) => JSON.stringify({ schemaVersion: 2, contributions });

describe('consent contribution file', () => {
  it('keeps known kinds and skips unknown or malformed entries', () => {
    const parsed = parseConsentContributions({ raw: file([
      { kind: 'region-resolver', id: 'a', header: 'x-a' }, { kind: 'tracker-signature', id: 'b' }, null, 'x',
      { kind: 'consent-bridge', id: 'ui', src: '/consent.mjs' }, { kind: 'consent-bridge', id: 'bad', src: 'javascript:alert(1)' },
      { kind: 'declared-scripts', id: 'tags', scripts: [] },
    ]) });
    expect(parsed).toEqual({ ok: true, descriptors: [
      { kind: 'region-resolver', id: 'a', header: 'x-a' }, { kind: 'consent-bridge', id: 'ui', src: '/consent.mjs' },
      { kind: 'declared-scripts', id: 'tags', scripts: [] },
    ] });
  });

  it('refuses a file that is not schema 2', () => {
    expect(parseConsentContributions({ raw: '{' })).toEqual({ ok: false, reason: 'not JSON' });
    expect(parseConsentContributions({ raw: JSON.stringify({ schemaVersion: 1, contributions: [] }) }).ok).toBe(false);
  });

  it('bridges accept only served URLs, and keep only their data fields', () => {
    expect(consentBridgeContribution({ entry: { kind: 'consent-bridge', id: 'ui', src: 'https://cdn.example/ui.mjs', code: 'x' } }))
      .toEqual({ kind: 'consent-bridge', id: 'ui', src: 'https://cdn.example/ui.mjs' });
    for (const src of ['//cdn.example/ui.mjs', 'data:text/javascript,1', 'https://u:p@cdn.example/ui.mjs', '/a b.mjs']) {
      expect(consentBridgeContribution({ entry: { kind: 'consent-bridge', id: 'ui', src } })).toBeUndefined();
    }
  });

  it('declared scripts name the plugin in every refusal', () => {
    expect(declaredScriptsContribution({ pluginId: 'p', entry: { kind: 'declared-scripts', id: 'Bad Id' } }))
      .toBe("Script declarations from 'p' have an invalid contribution id.");
    expect(declaredScriptsContribution({ pluginId: 'p', entry: { kind: 'declared-scripts', id: 'tags' } }))
      .toBe("Script declarations 'tags' from 'p' need a scripts array.");
    expect(declaredScriptsContribution({ pluginId: 'p', entry: { kind: 'declared-scripts', id: 'tags', scripts: [{ src: '/t.js' }] } }))
      .toEqual({ pluginId: 'p', entry: { id: 'tags', kind: 'declared-scripts', scripts: [{ src: '/t.js' }] } });
  });
});
