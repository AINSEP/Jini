/**
 * @file Server-side handlers of the Google Workspace connection panel (`ui/connection-panel.html`),
 * loaded by the host as this surface's `handlerModule` (never served to the frame).
 *
 * Exists so the account lifecycle has one honest screen: connect, reconnect (same account, same
 * connection), switch account (staged: the new account is shown and must be confirmed), turn a
 * product on or off (a settings write, never a change to what Google granted), grant a product's
 * permission (a separate sign-in), and revoke. Confirming a switch also moves the form destinations
 * the person ticked to the new account, each only after the new account opened its spreadsheet; the
 * rest stay frozen to the old account (a switch never silently changes where rows go). Revocation is reported exactly as the host reports it:
 * `confirmed` only when Google confirmed; `pending` means the site stopped using the sign-in but Google
 * has not confirmed, so the panel says so and offers a retry. No result carries a token, a
 * connection ref or a raw Google scope; scope sets are the plugin's own product ids.
 */
import { GOOGLE_ACCOUNT_ACCESS_PAGE } from '../lib/auth.mjs';
import { verifySpreadsheetAccess } from '../lib/picker-selection.mjs';
import { PRODUCTS, PRODUCT_STATE_KEY } from '../lib/product-state.mjs';
import { GoogleWorkspaceError } from '../lib/request-policy.mjs';
import { assertSpreadsheetId } from '../lib/sheets-client.mjs';
import { CONNECTION_ID, surfaceAccount, surfaceSheetsClient, withSurfaceFailures } from '../lib/surface-actions.mjs';
import { readFormDestinations, saveFormDestination } from '../lib/form-destination-settings.mjs';

/** The connection status the frame sees; empty labels are left out (the schemas have no null). @complexity O(1). */
function connectionView(status) {
  return {
    status: status.status,
    grantedProducts: [...status.grantedScopeSetIds],
    ...(status.accountLabel ? { accountLabel: status.accountLabel } : {}),
    ...(status.pendingSwitchAccountLabel ? { pendingSwitchAccountLabel: status.pendingSwitchAccountLabel } : {}),
  };
}

/** The stored product switches, as `{ <productId>: boolean }` for catalog products only. @complexity O(p). */
async function productSwitches(state) {
  const stored = await state.get({ key: PRODUCT_STATE_KEY });
  return Object.fromEntries(PRODUCTS.products.map((product) => [product.id, stored?.[product.id] === true]));
}

/**
 * Everything the panel shows: connection, products (on/off and whether Google granted their
 * permission), the form destinations (delivery bindings) a switch would affect, and the Google page where a
 * person can remove access themselves.
 * @complexity O(p + d): one status read, two state reads.
 */
async function panelView(capabilities) {
  const status = await capabilities.connections.status({ connectionId: CONNECTION_ID });
  const enabled = await productSwitches(capabilities.state);
  const destinations = await readFormDestinations({ deliveryBindings: capabilities.deliveryBindings });
  return {
    connection: connectionView(status),
    products: PRODUCTS.products.map((product) => ({ id: product.id, label: product.label, enabled: enabled[product.id], granted: status.grantedScopeSetIds.includes(product.id) })),
    destinations: Object.entries(destinations).map(([formSlug, saved]) => ({ formSlug, title: saved.title, tabTitle: saved.tabTitle })),
    accountAccessUrl: GOOGLE_ACCOUNT_ACCESS_PAGE,
  };
}

/**
 * The scope sets a sign-in asks for: what Google already granted plus every product that is on, in
 * catalog order. Desktop installed apps have no incremental consent, so even "grant a permission" is
 * a re-consent for the full intended set, never a smaller one that would drop a granted product.
 * @complexity O(p).
 */
async function intendedScopeSets(capabilities) {
  const status = await capabilities.connections.status({ connectionId: CONNECTION_ID });
  const enabled = await productSwitches(capabilities.state);
  return PRODUCTS.products.filter((product) => enabled[product.id] || status.grantedScopeSetIds.includes(product.id)).map((product) => product.id);
}

/** Fixed sentences for a destination that was not moved; plugin errors keep their own fixed message. */
const NOT_FOUND = { code: 'destination-not-found', message: 'This form destination is no longer saved. Reload the panel and check Form destinations.' };
const NOT_MOVED = { code: 'reassign-failed', message: 'This site could not check this spreadsheet with the new account. Choose its spreadsheet again in Form destinations.' };

/** Why one destination was not moved, as the frame may see it (never Google's text). @complexity O(1). */
function notMoved(formSlug, error) {
  return { formSlug, ...(error instanceof GoogleWorkspaceError ? { code: error.code, message: error.message } : NOT_MOVED) };
}

/**
 * Moves one destination to `accountId`, only after that account opened its spreadsheet through
 * Drive and the Sheets API; the tab (numeric sheet id) and enabled state stay as chosen.
 * @complexity O(1): two requests, one binding write.
 */
async function moveDestination(capabilities, accountId, formSlug, destination) {
  const fileId = assertSpreadsheetId({ id: destination.spreadsheetId }, { code: 'invalid-selection' });
  const verified = await verifySpreadsheetAccess({ client: surfaceSheetsClient({ capabilities }), connectionRef: CONNECTION_ID, fileId });
  const moved = { spreadsheetId: fileId, title: verified.title, sheetId: destination.sheetId, tabTitle: destination.tabTitle, accountId };
  await saveFormDestination({ deliveryBindings: capabilities.deliveryBindings, formSlug, destination: moved }, { bindingId: destination.bindingId, enabled: destination.enabled });
}

/** Tries each ticked destination in turn; a failure leaves that binding exactly as it was. @complexity O(t) moves. */
async function moveEach(capabilities, accountId, formSlugs) {
  const destinations = await readFormDestinations({ deliveryBindings: capabilities.deliveryBindings });
  const outcome = { moved: [], failed: [] };
  for (const formSlug of formSlugs) {
    if (!Object.hasOwn(destinations, formSlug)) { outcome.failed.push({ formSlug, ...NOT_FOUND }); continue; }
    try {
      await moveDestination(capabilities, accountId, formSlug, destinations[formSlug]);
      outcome.moved.push(formSlug);
    } catch (error) {
      outcome.failed.push(notMoved(formSlug, error));
    }
  }
  return outcome;
}

/**
 * After a confirmed switch: the ticked destinations (form slugs) move to the new account; unticked
 * ones keep the old account, so their deliveries are refused until the person re-picks them.
 * @complexity O(t): one account read, then two requests and one write per ticked destination.
 */
async function reassignDestinations(capabilities, formSlugs) {
  if (formSlugs.length === 0) return { moved: [], failed: [] };
  let account;
  try {
    account = await surfaceAccount({ capabilities });
  } catch (error) {
    return { moved: [], failed: formSlugs.map((formSlug) => notMoved(formSlug, error)) };
  }
  return moveEach(capabilities, account.accountId, formSlugs);
}

/**
 * Builds the panel's handler module.
 * @returns {{ actions: Record<string, Function> }} The `handlerModule` default export shape.
 * @complexity O(1) to build; each action is a bounded number of host calls.
 */
export function createConnectionPanelHandlers(_required = {}, _optional = {}) {
  const act = (fail, run) => withSurfaceFailures({ fail, run });
  return {
    actions: {
      status: ({ capabilities, fail }) => act(fail, () => panelView(capabilities)),

      /** Starts a sign-in; the HOST page offers it (the frame cannot open links). The URL is never returned. */
      'sign-in': ({ capabilities, input, fail }) => act(fail, async () => {
        const started = await capabilities.connections.begin({ connectionId: CONNECTION_ID, action: input.action }, { scopeSetIds: await intendedScopeSets(capabilities) });
        return { expiresAt: started.expiresAt };
      }),

      /** `reassign`: the form slugs whose destinations move to the new account (none by default). */
      'confirm-switch': ({ capabilities, input, fail }) => act(fail, async () => {
        await capabilities.connections.confirmSwitch({ connectionId: CONNECTION_ID });
        const reassignment = await reassignDestinations(capabilities, [...new Set(input.reassign)]);
        return { ...(await panelView(capabilities)), reassignment };
      }),

      'cancel-switch': ({ capabilities, fail }) => act(fail, async () => {
        await capabilities.connections.cancelSwitch({ connectionId: CONNECTION_ID });
        return panelView(capabilities);
      }),

      /** Revoke (and retry a pending revocation): the host's outcome passes through unchanged. */
      disconnect: ({ capabilities, fail }) => act(fail, async () => {
        const outcome = await capabilities.connections.disconnect({ connectionId: CONNECTION_ID });
        return { ...(await panelView(capabilities)), revocation: outcome.revocation };
      }),

      /** Turns a product on or off. Only the settings change: Google's grant stays as it is. */
      'set-product': ({ capabilities, input, fail }) => act(fail, async () => {
        const switches = await productSwitches(capabilities.state);
        await capabilities.state.set({ key: PRODUCT_STATE_KEY, value: { ...switches, [input.productId]: input.enabled } });
        return panelView(capabilities);
      }),
    },
  };
}

export default createConnectionPanelHandlers();
