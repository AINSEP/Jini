/**
 * @file The form destinations the destination panel saves: one host form-delivery binding per form
 * (by its short name), for this plugin's Sheets adapter over its own connection, through the host's
 * `deliveryBindings` capability. The binding config is what the Sheets destination reads
 * (`{ spreadsheetId, accountId, tabs: { <formSlug>: { sheetId } } }`, see
 * `form-destinations/README.md`) plus the spreadsheet and tab names the panels show.
 *
 * Exists so a saved choice IS the delivery binding: there is no second copy to keep in step, and the
 * connection panel's account-switch screen lists exactly what delivery uses. Values are metadata
 * only, never a token or a cell.
 */
import { CONNECTION_ID } from './surface-actions.mjs';

/** This plugin's form-destination adapter id (`tovu-form-destinations.json`). */
export const SHEETS_ADAPTER_ID = 'google-sheets';
export const MAX_FORM_DESTINATIONS = 50;

/** A form's short name: also a property name in the binding config, so no `__proto__`-style names. */
export const FORM_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The one form a binding saved here is for, or null for a binding this panel did not write. @complexity O(1). */
function formSlugOf(binding) {
  const slug = binding.formIds?.length === 1 ? binding.formIds[0] : null;
  return slug !== null && FORM_SLUG_PATTERN.test(slug) ? slug : null;
}

/** The saved destination a binding holds, or null when its config is not in the shape `saveFormDestination` writes. @complexity O(1). */
function destinationOf(binding, formSlug) {
  const { spreadsheetId, accountId, tabs, title, tabTitle } = binding.config;
  const sheetId = tabs?.[formSlug]?.sheetId;
  const validIdentity = typeof spreadsheetId === 'string' && typeof accountId === 'string';
  const valid = validIdentity && Number.isInteger(sheetId) && typeof title === 'string' && typeof tabTitle === 'string';
  return valid ? { bindingId: binding.bindingId, enabled: binding.enabled, spreadsheetId, title, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, sheetId, tabTitle, accountId } : null;
}

/**
 * The saved destinations, keyed by form slug: this plugin's Sheets bindings that name one form;
 * any other binding of the adapter is left out (and left alone).
 * @param {{ deliveryBindings: { list(): Promise<readonly { bindingId: string, enabled: boolean, adapterId: string, formIds?: readonly string[], config: Record<string, unknown> }[]> } }} required
 * @returns {Promise<Record<string, { bindingId: string, enabled: boolean, spreadsheetId: string, title: string, url: string, sheetId: number, tabTitle: string, accountId: string }>>}
 * @complexity O(b), one host read.
 */
export async function readFormDestinations(required, _optional = {}) {
  const entries = (await required.deliveryBindings.list()).flatMap((binding) => {
    const formSlug = binding.adapterId === SHEETS_ADAPTER_ID ? formSlugOf(binding) : null;
    const destination = formSlug === null ? null : destinationOf(binding, formSlug);
    return destination === null ? [] : [[formSlug, destination]];
  });
  return Object.fromEntries(entries);
}

/**
 * Saves one form's destination as its delivery binding (a new one, or the form's existing one).
 * `accountId` is the account the spreadsheet was verified with: the host freezes it into every
 * delivery job and refuses a job once the connection holds another account (an account switch never
 * silently moves where rows go).
 * @param {{ deliveryBindings: { save(draft: object): Promise<object> }, formSlug: string, destination: { spreadsheetId: string, title: string, sheetId: number, tabTitle: string, accountId: string } }} required
 * @param {{ bindingId?: string, enabled?: boolean }} [optional] The existing binding id and enabled
 *   state for reassignment; normal destination saves enable delivery by default.
 * @complexity O(1), one host write.
 */
export async function saveFormDestination(required, optional = {}) {
  const { formSlug, destination } = required;
  await required.deliveryBindings.save({
    ...(optional.bindingId === undefined ? {} : { bindingId: optional.bindingId }),
    adapterId: SHEETS_ADAPTER_ID, connectionId: CONNECTION_ID, enabled: optional.enabled ?? true, formIds: [formSlug],
    config: {
      spreadsheetId: destination.spreadsheetId, accountId: destination.accountId, tabs: { [formSlug]: { sheetId: destination.sheetId } },
      title: destination.title, tabTitle: destination.tabTitle,
    },
  });
}
