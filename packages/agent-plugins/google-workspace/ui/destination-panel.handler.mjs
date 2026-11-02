/**
 * @file Server-side handlers of the form-destination panel (`ui/destination-panel.html`), loaded by
 * the host as this surface's `handlerModule` (never served to the frame).
 *
 * Exists so a person can say "submissions of this form go to this tab of this spreadsheet": the
 * spreadsheet comes from the Picker flow (the same verified actions as the Picker panel), the tab is
 * chosen by its numeric sheet id (renaming a tab never moves deliveries), and every save re-checks
 * the spreadsheet and tab through Google before anything is stored, so a pasted id grants nothing.
 * Saving asks the person to confirm that removing the destination later leaves the rows already
 * written in the spreadsheet (local delete never purges external rows). A saved destination is the
 * form's delivery binding itself, written through the host's `deliveryBindings` capability.
 */
import { metadataOf, readPickedSpreadsheets } from '../lib/picker-flow.mjs';
import { verifySpreadsheetAccess } from '../lib/picker-selection.mjs';
import { assertSpreadsheetId, getSpreadsheet } from '../lib/sheets-client.mjs';
import { CONNECTION_ID, sheetsUnavailableReason, surfaceAccount, surfaceRefusal, surfaceSheetsClient, withSurfaceFailures } from '../lib/surface-actions.mjs';
import { FORM_SLUG_PATTERN, MAX_FORM_DESTINATIONS, readFormDestinations, saveFormDestination } from '../lib/form-destination-settings.mjs';
import { createPickerHandlers } from './picker.handler.mjs';

const TAB_FIELDS = 'sheets.properties(sheetId,title,sheetType)';
const MAX_TABS = 200;

/** The verified spreadsheet and its grid tabs (`{ sheetId, title }`, at most 200). @complexity O(t): three requests. */
async function spreadsheetTabs(capabilities, spreadsheetId) {
  const fileId = assertSpreadsheetId({ id: spreadsheetId }, { code: 'invalid-selection' });
  const client = surfaceSheetsClient({ capabilities });
  const spreadsheet = await verifySpreadsheetAccess({ client, connectionRef: CONNECTION_ID, fileId });
  const body = await getSpreadsheet({ client, connectionRef: CONNECTION_ID, spreadsheetId: fileId, fields: TAB_FIELDS });
  const grids = (Array.isArray(body?.sheets) ? body.sheets : []).map((sheet) => sheet?.properties).filter((tab) => Number.isInteger(tab?.sheetId) && (tab.sheetType ?? 'GRID') === 'GRID');
  return { spreadsheet, tabs: grids.slice(0, MAX_TABS).map((tab) => ({ sheetId: tab.sheetId, title: String(tab.title ?? '') })) };
}

/** The current account id when Sheets is usable, else null (the list still shows, unchecked). @complexity O(1). */
async function currentAccountId(capabilities) {
  return (await sheetsUnavailableReason({ capabilities })) === null ? (await surfaceAccount({ capabilities })).accountId : null;
}

/** The panel's list: saved destinations, picked spreadsheets and, when supported, site forms.
 * Absence preserves older hosts' typed fallback; denied access must fail, never enable typing.
 * @complexity O(d + p + f), with forms bounded by the host capability session. */
async function listView({ capabilities }, _options = {}) {
  const accountId = await currentAccountId(capabilities);
  const saved = await readFormDestinations({ deliveryBindings: capabilities.deliveryBindings });
  const destinations = Object.entries(saved).map(([formSlug, destination]) => ({
    formSlug, ...metadataOf(destination), sheetId: destination.sheetId, tabTitle: destination.tabTitle,
    ...(accountId === null ? {} : { sameAccount: destination.accountId === accountId }),
  }));
  return {
    destinations, picked: (await readPickedSpreadsheets({ state: capabilities.state })).map(metadataOf),
    ...(capabilities.forms === undefined ? {} : { forms: await capabilities.forms.list({}) }),
  };
}

/** Refuses a save the person has not fully confirmed or that names no valid form. @complexity O(1). */
function assertSaveInput(input, fail) {
  if (!FORM_SLUG_PATTERN.test(input.formSlug)) throw surfaceRefusal({ fail, code: 'invalid-destination' });
  if (input.confirmExternalRows !== true) throw surfaceRefusal({ fail, code: 'confirm-external-rows' });
}

/** Verifies and stores one form's destination as its binding. @complexity O(t + d): four requests, one binding write. */
async function saveDestination({ capabilities, input, fail }) {
  assertSaveInput(input, fail);
  const account = await surfaceAccount({ capabilities });
  const { spreadsheet, tabs } = await spreadsheetTabs(capabilities, input.spreadsheetId);
  const tab = tabs.find((candidate) => candidate.sheetId === input.sheetId);
  if (tab === undefined) throw surfaceRefusal({ fail, code: 'tab-not-found' });
  const destinations = await readFormDestinations({ deliveryBindings: capabilities.deliveryBindings });
  const existing = Object.hasOwn(destinations, input.formSlug) ? destinations[input.formSlug] : undefined;
  if (existing === undefined && Object.keys(destinations).length >= MAX_FORM_DESTINATIONS) throw surfaceRefusal({ fail, code: 'too-many-destinations' });
  const destination = { spreadsheetId: spreadsheet.spreadsheetId, title: spreadsheet.title, sheetId: tab.sheetId, tabTitle: tab.title, accountId: account.accountId };
  await saveFormDestination({ deliveryBindings: capabilities.deliveryBindings, formSlug: input.formSlug, destination }, existing === undefined ? {} : { bindingId: existing.bindingId });
  return listView({ capabilities });
}

/**
 * Builds the panel's handler module: the Picker panel's bootstrap and selection actions, plus the
 * destination actions.
 * @param {object} [_required]
 * @param {{ now?: () => number, randomId?: () => string }} [optional] Passed to the Picker flow (tests).
 * @returns {{ bootstrap: Function, actions: Record<string, Function> }}
 * @complexity O(1) to build.
 */
export function createDestinationPanelHandlers(_required = {}, optional = {}) {
  const picker = createPickerHandlers({}, optional);
  const act = (fail, run) => withSurfaceFailures({ fail, run });
  return {
    bootstrap: picker.bootstrap,
    actions: {
      ...picker.actions,
      'list-destinations': ({ capabilities, fail }) => act(fail, () => listView({ capabilities })),
      'list-tabs': ({ capabilities, input, fail }) => act(fail, async () => {
        const { spreadsheet, tabs } = await spreadsheetTabs(capabilities, input.spreadsheetId);
        return { spreadsheet: metadataOf(spreadsheet), tabs };
      }),
      'save-destination': (call) => act(call.fail, () => saveDestination(call)),
      /** Removes one form's binding; rows already in the spreadsheet stay where they are. */
      'remove-destination': ({ capabilities, input, fail }) => act(fail, async () => {
        const destinations = await readFormDestinations({ deliveryBindings: capabilities.deliveryBindings });
        if (Object.hasOwn(destinations, input.formSlug)) await capabilities.deliveryBindings.remove({ bindingId: destinations[input.formSlug].bindingId });
        return listView({ capabilities });
      }),
    },
  };
}

export default createDestinationPanelHandlers();
