import assert from 'node:assert/strict';
import { test } from 'vitest';
import { navAvailability } from '../nav-availability.js';

const labels = { unavailable: 'Coming soon' };

test('inert destinations expose exact hover and accessible unavailable copy', () => {
  for (const label of ['Home', 'Marketplace', 'Media', 'Activity', 'Updates', 'Settings']) {
    assert.deepEqual(navAvailability({ label, disabled: true, labels }), {
      'data-tip': `${label} — Coming soon`, title: 'Coming soon', 'aria-description': 'Coming soon',
    });
  }
});
test('an available destination retains its existing tooltip attributes', () => {
  assert.deepEqual(navAvailability({ label: 'Websites', disabled: false, labels }), { 'data-tip': 'Websites' });
});
