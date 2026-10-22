/** Electron supplies spelling data in context-menu events but shows no browser-style native
 * menu itself. Register for both shell contents and editing webview guests; spellcheck is enabled
 * by Electron's default preferences, while this module supplies the missing popup behavior.
 * Keep decisions separate from registration and inject Menu/webContents so no native runtime is
 * needed to exercise them. The host already owns Menu, so a module-level import adds no capability. */
export interface MenuItemConstructorOptions {
  label?: string; enabled?: boolean; type?: "separator"; click?: () => void;
}
export interface SpellCheckLabels {
  noSuggestions: string; addToDictionary: string; cut: string; copy: string; paste: string; selectAll: string;
}

export interface SpellCheckContextMenuParams {
  isEditable: boolean;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: {
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

// Five matches the browser cap: further alternatives mostly add noise to a small context menu.
const MAX_SUGGESTIONS = 5;

/** Build spelling suggestions followed by enabled edit commands. */
export function buildSpellCheckMenuTemplate(
  { params, handlers, labels }: { params: SpellCheckContextMenuParams; handlers: SpellCheckMenuHandlers; labels: SpellCheckLabels },
  { maxSuggestions = MAX_SUGGESTIONS }: { maxSuggestions?: number } = {},
): MenuItemConstructorOptions[] {
  const spelling = spellingItems(params, handlers, labels, maxSuggestions);
  if (!params.isEditable) return spelling;
  const separator: MenuItemConstructorOptions[] = spelling.length > 0 ? [{ type: "separator" }] : [];
  return [...spelling, ...separator, ...editItems(params, handlers, labels)];
}

export interface SpellCheckMenuHandlers {
  replace: (args: { word: string }) => void;
  addToDictionary: (args: { word: string }) => void;
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
}

function spellingItems(params: SpellCheckContextMenuParams, handlers: SpellCheckMenuHandlers, labels: SpellCheckLabels, maxSuggestions: number): MenuItemConstructorOptions[] {
  if (params.misspelledWord.length === 0) return [];
  const suggestions = params.dictionarySuggestions.slice(0, maxSuggestions);
  const suggestionItems: MenuItemConstructorOptions[] =
    suggestions.length === 0
      ? [{ label: labels.noSuggestions, enabled: false }]
      : suggestions.map((suggestion) => ({ label: suggestion, click: () => handlers.replace({ word: suggestion }) }));
  return [
    ...suggestionItems,
    { type: "separator" },
    { label: labels.addToDictionary, click: () => handlers.addToDictionary({ word: params.misspelledWord }) },
  ];
}

function editItems(params: SpellCheckContextMenuParams, handlers: SpellCheckMenuHandlers, labels: SpellCheckLabels): MenuItemConstructorOptions[] {
  return [
    { label: labels.cut, enabled: params.editFlags.canCut, click: () => handlers.cut() },
    { label: labels.copy, enabled: params.editFlags.canCopy, click: () => handlers.copy() },
    { label: labels.paste, enabled: params.editFlags.canPaste, click: () => handlers.paste() },
    { type: "separator" },
    { label: labels.selectAll, enabled: params.editFlags.canSelectAll, click: () => handlers.selectAll() },
  ];
}

// Dictionary additions use this contents' session, so webview guests keep their partition's dictionary.
export interface SpellCheckWebContents {
  on(args: { event: "context-menu"; listener: (args: { params: SpellCheckContextMenuParams }) => void }): unknown;
  removeListener?(args: { event: "context-menu"; listener: (args: { params: SpellCheckContextMenuParams }) => void }): unknown;
  replaceMisspelling(args: { text: string }): void;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  session: { addWordToSpellCheckerDictionary(args: { word: string }): void };
}

export interface MenuBuilder {
  buildFromTemplate(args: { template: MenuItemConstructorOptions[] }): { popup(): void };
}

/** Register native spelling/edit actions on one content session. Returns a disposer. */
export function registerSpellCheckContextMenu({ webContents, menuBuilder, labels }: { webContents: SpellCheckWebContents; menuBuilder: MenuBuilder; labels: SpellCheckLabels }, options: { maxSuggestions?: number } = {}): () => void {
  const listener = ({ params }: { params: SpellCheckContextMenuParams }): void => {
    const template = buildSpellCheckMenuTemplate({ params, labels, handlers: {
      replace: ({ word }) => webContents.replaceMisspelling({ text: word }),
      addToDictionary: ({ word }) => webContents.session.addWordToSpellCheckerDictionary({ word }),
      cut: () => webContents.cut(),
      copy: () => webContents.copy(),
      paste: () => webContents.paste(),
      selectAll: () => webContents.selectAll(),
    } }, options);
    // A click with neither a misspelling nor editable commands should show no popup, not an empty menu.
    if (template.length === 0) return;
    menuBuilder.buildFromTemplate({ template }).popup();
  };
  webContents.on({ event: "context-menu", listener });
  return () => { webContents.removeListener?.({ event: "context-menu", listener }); };
}
