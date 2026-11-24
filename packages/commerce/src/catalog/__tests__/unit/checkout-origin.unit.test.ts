// Moved from the host composition tests with the code under test; assertions unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commerceCheckoutOrigin } from '../../checkout-origin.js';

test('checkout accepts and normalizes an explicitly configured clean deployed HTTPS origin', () => {
  for (const publicOrigin of ['https://shop.example', 'https://shop.example/', 'https://shop.example:443/']) {
    assert.equal(commerceCheckoutOrigin({ publicOrigin }), 'https://shop.example');
  }
});

test('desktop/local/private and URL-controlled callback destinations cannot be checkout origins', () => {
  const refused = ['http://shop.example', 'https://localhost', 'https://localhost.', 'https://shop.localhost', 'https://shop.local',
    'https://127.0.0.1', 'https://10.0.0.1', 'https://192.168.0.1', 'https://169.254.169.254', 'https://100.64.0.1',
    'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://user:secret@shop.example', 'https://shop.example/path',
    'https://shop.example/?return=https://evil.example', 'https://shop.example/#return', 'invalid'];
  for (const publicOrigin of refused) assert.equal(commerceCheckoutOrigin({ publicOrigin }), null, publicOrigin);
});
