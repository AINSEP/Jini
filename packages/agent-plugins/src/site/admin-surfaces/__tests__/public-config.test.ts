/** @file Unit tests for `public-config.ts`: only host-allowed public names are read, a secret word always refuses. */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { createAdminSurfacePublicConfig, PUBLIC_CONFIG_REFUSED_MESSAGE } from '../public-config.js';

const publicNamePattern = /^HOST_[A-Z0-9_]{1,48}_(APP_ID|BROWSER_KEY)$/;

test('reads an allowed public name, trimmed, and an unset or blank one as null', async () => {
  const config = createAdminSurfacePublicConfig({ env: { HOST_PICKER_APP_ID: '  app-1 ', HOST_BLANK_APP_ID: '  ' }, publicNamePattern });
  assert.equal(await config.get({ name: 'HOST_PICKER_APP_ID' }), 'app-1');
  assert.equal(await config.get({ name: 'HOST_BLANK_APP_ID' }), null);
  assert.equal(await config.get({ name: 'HOST_MISSING_APP_ID' }), null);
});

test('refuses names outside the host pattern and allowed shapes carrying a secret word', async () => {
  const config = createAdminSurfacePublicConfig({ env: { SITE_KEY: 'k', HOST_SECRET_APP_ID: 's', HOST_SESSION_BROWSER_KEY: 's' }, publicNamePattern });
  for (const name of ['SITE_KEY', 'HOST_SECRET_APP_ID', 'HOST_SESSION_BROWSER_KEY']) {
    await assert.rejects(config.get({ name }), { message: PUBLIC_CONFIG_REFUSED_MESSAGE }, `must refuse ${name}`);
  }
});
