/**
 * @file The Google Workspace product catalog (`products.json`): which products the plugin ships and
 * which Google scopes each one needs. Turns the host's opaque scope-set ids (the products being
 * connected) into the exact scope list the sign-in requests.
 *
 * Exists because enabling a product and granting its scopes are separate steps: the catalog is the
 * one place that says what a product needs, so the sign-in never asks for more than the products
 * being connected. v1 ships Sheets only, on `drive.file` (files the person picked or the site created).
 *
 * Also the one on/off gate per product. The plugin's own settings (the host's plugin state, which the
 * Google Workspace panel writes and tools and form delivery may only read) hold
 * `products: { "<productId>": true }`. A product is OFF unless that value is exactly `true`
 * (fail closed: no settings, no reader, or any other value). Turning a product off blocks its
 * tools and refuses its form deliveries as retryable (the forms retry policy re-tries them for about
 * a day, then marks them failed); it never revokes the Google authorization.
 */
import catalog from '../products.json' with { type: 'json' };
import { GoogleWorkspaceError } from './request-policy.mjs';

const GOOGLE_SCOPE = /^https:\/\/www\.googleapis\.com\/auth\/[a-z.]+$/;

/** A catalog entry that is not well formed stops the plugin loading, instead of requesting odd scopes. @complexity O(s). */
function assertScopes(scopes, where) {
  if (!Array.isArray(scopes) || !scopes.every((scope) => GOOGLE_SCOPE.test(scope))) {
    throw new Error(`products.json ${where} must list Google OAuth scope URLs. Fix the plugin package.`);
  }
  return Object.freeze([...scopes]);
}

/**
 * The validated, frozen catalog. Exported so the load-time check can be pinned against malformed
 * catalogs (the shipped `products.json` always passes it).
 * @param {{ raw: { baseScopes: unknown, products: readonly { id: string, requiredScopes: unknown }[] } }} required
 * @throws {Error} When a scope list is not a list of Google OAuth scope URLs.
 * @complexity O(p * s).
 */
export function readCatalog(required, _optional = {}) {
  const { raw } = required;
  const products = raw.products.map((product) => Object.freeze({
    ...product,
    requiredScopes: assertScopes(product.requiredScopes, `products '${product.id}' requiredScopes`),
  }));
  return Object.freeze({ baseScopes: assertScopes(raw.baseScopes, 'baseScopes'), products: Object.freeze(products) });
}

export const PRODUCTS = readCatalog({ raw: catalog });

/**
 * The scopes to request for these products: the base scope plus each product's required scopes,
 * de-duplicated in catalog order. An id the catalog does not know is refused, never ignored, so a
 * typo cannot silently connect less than the person chose.
 * @param {{ productIds: readonly string[] }} required
 * @returns {readonly string[]}
 * @complexity O(p * s).
 */
export function scopesFor(required, _optional = {}) {
  const chosen = required.productIds.map((id) => {
    const product = PRODUCTS.products.find((entry) => entry.id === id);
    if (!product) throw new Error(`Google Workspace has no product '${id}'. Choose one of: ${PRODUCTS.products.map((entry) => entry.id).join(', ')}.`);
    return product;
  });
  return [...new Set([...PRODUCTS.baseScopes, ...chosen.flatMap((product) => product.requiredScopes)])];
}

/** The plugin-state key whose value says which products are on: `{ "<productId>": true }`. */
export const PRODUCT_STATE_KEY = 'products';

/**
 * Whether the product is on in the plugin's own settings. Off when there is no reader, nothing is
 * stored, or the stored value is anything but `true` for this product.
 * @param {{ state?: { get(input: { key: string }): Promise<unknown> }, productId: string }} required
 *   `state` is the host's read-only plugin-state reader (`capabilities.state` for tools).
 * @returns {Promise<boolean>}
 * @complexity O(1): one state read.
 */
export async function isProductEnabled(required, _optional = {}) {
  const { state, productId } = required;
  if (typeof state?.get !== 'function') return false;
  const value = await state.get({ key: PRODUCT_STATE_KEY });
  return value?.[productId] === true;
}

/**
 * Refuses unless the product is on, before anything is sent to Google.
 * @param {{ state?: { get(input: { key: string }): Promise<unknown> }, productId: string }} required
 * @throws {GoogleWorkspaceError} `product-disabled` (next action: turn the product on in the panel).
 * @complexity O(1): one state read.
 */
export async function assertProductEnabled(required, _optional = {}) {
  if (await isProductEnabled(required)) return;
  const label = PRODUCTS.products.find((product) => product.id === required.productId)?.label ?? required.productId;
  throw new GoogleWorkspaceError({ code: 'product-disabled' }, { detail: label });
}
