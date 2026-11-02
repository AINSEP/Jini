/**
 * @file Pins the load-time check on `products.json` (`readCatalog` in lib/product-state.mjs): a
 * catalog whose scopes are not Google OAuth scope URLs stops the plugin loading instead of asking
 * Google for odd scopes. The shipped catalog always passes, so the check is pinned with malformed
 * catalogs passed straight to the validator.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PRODUCTS, readCatalog } from '../lib/product-state.mjs';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const BASE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

test('catalog: the shipped catalog asks only for drive.file as the base scope', () => {
  assert.deepEqual(PRODUCTS.baseScopes, [BASE_SCOPE]);
});

test('catalog: a well-formed catalog is returned frozen, scopes included', () => {
  const catalog = readCatalog({ raw: { baseScopes: [BASE_SCOPE], products: [{ id: 'sheets', label: 'Google Sheets', requiredScopes: [SHEETS_SCOPE] }] } });
  assert.deepEqual(catalog.products[0].requiredScopes, [SHEETS_SCOPE]);
  assert.equal(Object.isFrozen(catalog.products[0].requiredScopes) && Object.isFrozen(catalog.products) && Object.isFrozen(catalog.baseScopes), true);
});

test('catalog: a product scope that is not a Google scope URL is refused, naming the product', () => {
  assert.throws(() => readCatalog({ raw: { baseScopes: [BASE_SCOPE], products: [{ id: 'sheets', requiredScopes: ['https://evil.example/auth/all'] }] } }), { message: "products.json products 'sheets' requiredScopes must list Google OAuth scope URLs. Fix the plugin package." });
});

test('catalog: a Google scope with a path beyond auth/<name> is refused', () => {
  assert.throws(() => readCatalog({ raw: { baseScopes: ['https://www.googleapis.com/auth/drive/../all'], products: [] } }), { message: /baseScopes must list Google OAuth scope URLs/ });
});

test('catalog: base scopes that are not a list are refused', () => {
  assert.throws(() => readCatalog({ raw: { baseScopes: BASE_SCOPE, products: [] } }), { message: 'products.json baseScopes must list Google OAuth scope URLs. Fix the plugin package.' });
});
