# Settings screen pieces

The parts of the admin Settings screen that are product-neutral: the settings-shell, User Interface
and Memory dictionaries, the User Interface panel's translator binding, the `I18nProvider` locale
bridge, the External MCP saved-connection chooser, the External MCP tools-modal and remove-confirm
dialog behaviours, the phone tab-strip scroll hook, the User Interface row styles, the External MCP
dictionary, the External MCP row sign-in hook, the AI agent tab's dictionary, the settings-dialog
translator assembly, and the External MCP remove-confirm dialog. The Settings
screen itself (dialog, tabs, External MCP panel, product copy, settings rules) stays in the host,
which imports these by subpath.

## Wiring

**Needs injected:**

- `ExternalMcpSharedChoice` — required `useExternalMcpSharedChoiceHook: UseExternalMcpSharedChoice`
  (`ExternalMcpSharedChoice.hooks.ts`): the host binds its `ExternalMcpSharedChoicePort` (list / use
  saved / stop / use local on its `/mcp-servers/:id/oauth/shared` routes) into
  `useExternalMcpSharedChoice`. A port rejection must be an `AdminApiError`
  (`@jini-ai/core/admin-runtime`) for its message to show; anything else shows the action's fallback.
  Also required: `t: Translate` (the host's external-MCP dictionary), `serverId`, `busy`, `signIn`,
  `onChanged`. Feature class: `jini-external-mcp-shared-choice`.
- `useExternalMcpRemoveConfirm({ name, isOAuth, onCancel, t, buildCopy })` — `buildCopy:
  ExternalMcpRemoveConfirmCopyBuilder<TCopy>` is required: the host passes its own copy builder
  (title/body for the confirm dialog); the returned `copy` is exactly what it built.
- `useExternalMcpToolsModalEscape({ onClose })` and `useExternalMcpRemoveConfirm` trap Tab through the
  kit's `useFocusTrap`, so both need the host's `<AdminKitProvider>` above them.
- `useSettingsActiveTabScroll({ ready, tabId }, { isPhone })` — no injection; `isPhone` defaults to a
  `(max-width: 640px)` media query.
- `useSettingsLocaleSync({ locale }, { activeLocale, setLocale })` — the UI library's locale pair;
  the host's wired hook calls its own `useI18n()` and passes it in.
- `useExternalMcpOAuthConnect({ serverId, grant, onConnected, port, callbackMessageType }, { win, fallbackError })`
  (`hooks/use-external-mcp-oauth-connect.hooks.ts`) — `port: ExternalMcpOAuthConnectPort` is required
  (the host's `.../oauth/connect` and `.../oauth/device/poll` routes; a rejection must be an
  `AdminApiError` for its message to show). `callbackMessageType` is required product copy: the exact
  `type` the host's public OAuth callback page posts to its opener; a message of any other type is
  ignored. `win` defaults to the real browser window, `fallbackError` to English copy.
- `settings-execution-i18n.ts` — the AI agent tab's copy (stored-key asks, BYOK footer lines, Local
  CLI scope). The server-scope key names the product, so it carries `{productName}` in the key and all
  21 translations; the host fills it with `interpolate({ template, vars })` at each render site.
  `aiAgentPanelDictionaries({ dictionaries, locales })` — `locales` is required: the host's admin locale
  list (`{ code }[]`); each listed locale gets the "AI agent" overlay.
- `createSettingsUiTranslators({ settingsLocale, dialogDictionaries, translateApp, translateCapability })`
  (`SettingsUi.hooks.ts`) — all required: the UI library's settings-dialog dictionaries, the host's
  app-wide `{ locale, key }` dictionary (last tier before the raw key) and its capability-notes
  dictionary (behind `tCap`). `createSettingsTabChange({})` needs nothing; it navigates through the
  shell router.
- `ExternalMcpRemoveConfirmDialog` — required `ConfirmDialog: ComponentType<ExternalMcpRemoveConfirmFrameProps>`
  (the host's confirmation markup; it receives `dialogRef`, ids, copy, button text, handles and agent
  labels) and required `buildCopy` (the host's `{ title, body }` builder). `useExternalMcpRemoveConfirmHook`
  defaults to this package's own hook. Needs `<AdminKitProvider>` above it (focus trap).
- `external-mcp-i18n.ts` — the five keys that name the product carry a `{productName}` token in the
  key and in all 21 translations. The host fills it through the `vars` it already hands
  `interpolate()` at each render site (an admissions row's `messageVars`, a tool-row lock sentence);
  an unfilled token renders literally.

**Provides:** `settings-i18n.ts`, `settings-interface-i18n.ts`, `settings-memory-i18n.ts`
(`memoryPanelDictionaries`; 21 locales split across `.locales-a/-b` for the size limit), all falling
back to `ADMIN_COMMON_I18N`; `createUserInterfaceSettingsPanelTranslator`; `useSettingsLocaleSync`;
`ExternalMcpSharedChoice` + `useExternalMcpSharedChoice`; `useExternalMcpToolsModalEscape`
(`ExternalMcpToolsModal.hooks.ts`), `useExternalMcpRemoveConfirm`, `useSettingsActiveTabScroll`;
`external-mcp-i18n.ts` (`t`; 21 locales split across `.locales-a/-b/-c` for the size limit);
`useExternalMcpOAuthConnect`;
`settings-execution-i18n.ts` (`t`, `aiAgentPanelDictionaries`); `createSettingsUiTranslators`,
`createSettingsTabChange`; `ExternalMcpRemoveConfirmDialog`;
`user-interface-settings.css` (`jini-settings-interface-row/-text/-label/-hint`, styled from
`--jini-admin-space-3/-4`, `--jini-admin-fg`, `--jini-admin-muted`, `--jini-admin-text-sm`, each falling back to the
shared `--jini-*` token; a host with its own theme names maps them on the rows).

```tsx
const port: ExternalMcpSharedChoicePort = {
  listSharedMcpConnections: ({ serverId }) => api.listSharedMcpConnections({ serverId }).catch(toAdminApiError),
  useSharedMcpConnection: (input) => api.useSharedMcpConnection(input).catch(toAdminApiError),
  stopSharedMcpConnection: ({ serverId }) => api.stopSharedMcpConnection({ serverId }).catch(toAdminApiError),
  useLocalMcpConnection: ({ serverId }) => api.useLocalMcpConnection({ serverId }).catch(toAdminApiError),
};
const useHostSharedChoice: UseExternalMcpSharedChoice = (args) => useExternalMcpSharedChoice({ ...args, port });
const signIn = useExternalMcpOAuthConnect({ serverId: id, grant, onConnected: reload,
  port: { connectExternalMcpOAuth: (i, o) => api.connect(i, o).catch(toAdminApiError), pollExternalMcpOAuthDevice: (i) => api.poll(i).catch(toAdminApiError) },
  callbackMessageType: HOST_OAUTH_CALLBACK_TYPE });
const lock = interpolate({ template: t({ locale, key: "The server marks this tool as destructive. {productName} does not enable destructive external tools." }), vars: { productName: HOST_NAME } });
const { copy, dialogRef } = useExternalMcpRemoveConfirm({ name, isOAuth, onCancel, t, buildCopy: buildHostRemoveCopy });
<ExternalMcpSharedChoice serverId={id} busy={busy} signIn={signIn} onChanged={reload} t={t}
  useExternalMcpSharedChoiceHook={useHostSharedChoice} />
```

**Must never import:** the host's request/integrations client, its UI library's `useI18n`, its
dictionaries that name the product, or its styles. Boundary rationale:
[`DR-005-portable-package-boundaries`](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
