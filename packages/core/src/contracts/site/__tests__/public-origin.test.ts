import assert from 'node:assert/strict';
import { test } from 'vitest';
import { resolvePublicOrigin } from '../public-origin.js';

test('public origin preserves configured precedence and plugin fallback versus strict MCP refusal', () => {
  const invalidConfiguredOrigin = () => undefined;
  assert.equal(resolvePublicOrigin({ configured: ' https://configured.example/path ', derivedPublicOrigin: 'https://derived.example', invalidConfiguredOrigin }), 'https://configured.example');
  for (const configured of ['broken', 'file:///private/file']) {
    assert.equal(resolvePublicOrigin({ configured, derivedPublicOrigin: 'https://derived.example', invalidConfiguredOrigin }), 'https://derived.example');
    assert.throws(() => resolvePublicOrigin({ configured, derivedPublicOrigin: 'https://derived.example', invalidConfiguredOrigin: () => { throw new Error('configured origin refused'); } }), /configured origin refused/);
  }
  assert.equal(resolvePublicOrigin({ configured: undefined, derivedPublicOrigin: undefined, invalidConfiguredOrigin }), undefined);
});
