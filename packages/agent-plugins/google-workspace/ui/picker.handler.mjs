/**
 * @file Server-side handlers of the "Choose spreadsheet" panel (`ui/picker.html`), loaded by the host
 * as this surface's `handlerModule` (never served to the frame).
 *
 * Exists so a person can grant the site one spreadsheet under `drive.file` the only way that grants it:
 * Google's Picker (hosted: the JS Picker in the panel; desktop: the native Picker in the system
 * browser). A selection is saved to the plugin's settings only after `lib/picker-flow.mjs` verified
 * it (session, account, spreadsheet type, real Sheets access); the frame and chat get metadata only.
 * A cancelled pick saves nothing.
 */
import { createPickerFlow, metadataOf, pollReply, readPickedSpreadsheets, rememberPickedSpreadsheet } from '../lib/picker-flow.mjs';
import { withSurfaceFailures } from '../lib/surface-actions.mjs';

/**
 * Builds the panel's handler module.
 * @param {object} [_required]
 * @param {{ now?: () => number, randomId?: () => string }} [optional] Passed to the Picker flow (tests).
 * @returns {{ bootstrap: Function, actions: Record<string, Function> }} The `handlerModule` default export shape.
 * @complexity O(1) to build; see each action.
 */
export function createPickerHandlers(_required = {}, optional = {}) {
  const flow = createPickerFlow({}, optional);
  const listed = async (capabilities) => ({ spreadsheets: (await readPickedSpreadsheets({ state: capabilities.state })).map(metadataOf) });

  return {
    bootstrap: (call) => flow.bootstrap(call),
    actions: {
      /** The spreadsheets picked so far (metadata), newest first. */
      'list-picked': ({ capabilities, fail }) => withSurfaceFailures({ fail, run: () => listed(capabilities) }),

      /** Hosted Picker result → verified → saved → metadata. */
      'verify-picked': (call) => withSurfaceFailures({
        fail: call.fail,
        run: async () => {
          const spreadsheet = await flow.verifyHosted(call);
          await rememberPickedSpreadsheet({ state: call.capabilities.state, spreadsheet });
          return { spreadsheet: metadataOf(spreadsheet) };
        },
      }),

      'start-system-picker': (call) => withSurfaceFailures({ fail: call.fail, run: () => flow.startSystemBrowser(call) }),

      /** Desktop poll; a verified selection is saved before it is reported. */
      'finish-system-picker': (call) => withSurfaceFailures({
        fail: call.fail,
        run: async () => {
          const outcome = await flow.finishSystemBrowser(call);
          if (outcome.status === 'selected') await rememberPickedSpreadsheet({ state: call.capabilities.state, spreadsheet: outcome.spreadsheet });
          return pollReply({ outcome });
        },
      }),
    },
  };
}

export default createPickerHandlers();
