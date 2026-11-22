/**
 * @file The right-click spelling-suggestions menu — Electron shows NO native context menu of its
 * own on any `webContents` (unlike a real browser tab), so without this, right-clicking a
 * misspelled word in an editing surface does nothing at all.
 *
 * Registered against two different `webContents`, both from `main.ts`'s `openSitesHomeWindow`: the
 * sites home window's own top-level page (its few text fields — site names, search), and every
 * project tab's `<webview>` guest (via `did-attach-webview`, which is where the real prose lives —
 * the embedded site admin's `FormEditor` and page content). `spellcheck` itself needs no separate
 * enable step: Electron's own `webPreferences` default (`spellcheck: true`) already covers both,
 * and nothing in `webview-guest-policy.ts` overrides it. This file only builds the menu Chromium's
 * `context-menu` event hands the ingredients for but never shows on its own.
 *
 * `buildSpellCheckMenuTemplate` is the whole decision, kept separate from
 * {@link registerSpellCheckContextMenu} for the same reason `find-menu.ts`'s `sendFindToggle` is
 * split from `findMenu`: a plain function is what `spellcheck-menu.test.ts` can call directly,
 * without a real Electron `Menu` or `webContents` to drive it.
 *
 * No runtime `electron` import at module scope — the real `Menu` is an explicit injected port,
 * so this stays testable under plain `node --test` the same way
 * `find-in-page-ipc.ts` keeps `BrowserWindow` at arm's length.
 */
// Spelling-menu rationale: Jini packages/desktop-host/src/electron/usability/spellcheck-menu.ts.
import {
  buildSpellCheckMenuTemplate as buildTemplate, registerSpellCheckContextMenu as registerMenu,
  type SpellCheckContextMenuParams, type SpellCheckLabels, type MenuItemConstructorOptions as SpellCheckMenuItem,
} from "../electron/usability/index.js";
export type { SpellCheckContextMenuParams } from "../electron/usability/index.js";
const labels: SpellCheckLabels = {
  noSuggestions: "No suggestions", addToDictionary: "Add to Dictionary",
  cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All",
};
export interface SpellCheckMenuHandlers {
  replace(required: { word: string }): void;
  addToDictionary(required: { word: string }): void;
  cut(): void; copy(): void; paste(): void; selectAll(): void;
}
/**
 * Build spelling suggestions followed by enabled edit commands with the host's wording. Five matches
 * Chrome's cap: further alternatives add noise. An empty result means no popup, not an empty menu.
 * @complexity O(k) in suggestions, capped at five.
 */
export function buildSpellCheckMenuTemplate({ params, handlers }: {
  params: SpellCheckContextMenuParams; handlers: SpellCheckMenuHandlers;
}): SpellCheckMenuItem[] {
  return buildTemplate({ params, labels, handlers: {
    replace: ({ word }) => handlers.replace({ word }),
    addToDictionary: ({ word }) => handlers.addToDictionary({ word }),
    cut: () => handlers.cut(), copy: () => handlers.copy(),
    paste: () => handlers.paste(), selectAll: () => handlers.selectAll(),
  } }, { maxSuggestions: 5 });
}
/** The slice of a `webContents` {@link registerSpellCheckContextMenu} drives — real or faked in
 *  tests. `replaceMisspelling`/`cut`/`copy`/`paste`/`selectAll` are Electron's own `WebContents`
 *  methods; `session.addWordToSpellCheckerDictionary` is scoped to THIS contents' own session, which
 *  is what makes a guest's dictionary additions follow that project's own partition. */
export interface SpellCheckWebContents {
  on(event: "context-menu", listener: (event: unknown, params: SpellCheckContextMenuParams) => void): unknown;
  removeListener?(event: "context-menu", listener: (event: unknown, params: SpellCheckContextMenuParams) => void): unknown;
  replaceMisspelling(text: string): void;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  session: { addWordToSpellCheckerDictionary(word: string): void };
}

/** Native Menu builder supplied by the host composition or its test double. */
export interface MenuBuilder {
  buildFromTemplate(template: SpellCheckMenuItem[]): { popup(): void };
}

/**
 * Register spelling for one native session; return a matching listener disposer. Menu is required
 * because main already owns Electron's Menu: a module-level default adds no capability and would
 * load a native runtime in plain Node tests. A click with no spelling/edit actions shows no popup.
 * @complexity O(1) to register; each popup is capped at five suggestions.
 */
export function registerSpellCheckContextMenu({ webContents, menuBuilder }: {
  webContents: SpellCheckWebContents; menuBuilder: MenuBuilder;
}): () => void {
  let nativeListener: ((event: unknown, params: SpellCheckContextMenuParams) => void) | undefined;
  return registerMenu({ labels, menuBuilder: { buildFromTemplate: ({ template }) => menuBuilder.buildFromTemplate(template) }, webContents: {
    on: ({ event, listener }) => {
      nativeListener = (_event, params) => listener({ params });
      webContents.on(event, nativeListener);
    },
    removeListener: ({ event }) => { if (nativeListener) webContents.removeListener?.(event, nativeListener); },
    replaceMisspelling: ({ text }) => webContents.replaceMisspelling(text),
    session: { addWordToSpellCheckerDictionary: ({ word }) => webContents.session.addWordToSpellCheckerDictionary(word) },
    cut: () => webContents.cut(), copy: () => webContents.copy(),
    paste: () => webContents.paste(), selectAll: () => webContents.selectAll(),
  } }, { maxSuggestions: 5 });
}
