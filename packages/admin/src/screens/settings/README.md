# Settings screen pieces

The parts of the admin Settings screen that are product-neutral: the settings-shell, User Interface
and Memory dictionaries, the User Interface panel's translator binding, the `I18nProvider` locale
bridge, and the External MCP saved-connection chooser. The Settings screen itself (dialog, tabs,
External MCP panel, product copy) stays in the host, which imports these by subpath.

## Wiring

**Needs injected:**

- `ExternalMcpSharedChoice` — required `useExternalMcpSharedChoiceHook: UseExternalMcpSharedChoice`
  (`ExternalMcpSharedChoice.hooks.ts`): the host binds its `ExternalMcpSharedChoicePort` (list / use
  saved / stop / use local on its `/mcp-servers/:id/oauth/shared` routes) into
  `useExternalMcpSharedChoice`. A port rejection must be an `AdminApiError`
  (`@jini-ai/core/admin-runtime`) for its message to show; anything else shows the action's fallback.
  Also required: `t: Translate` (the host's external-MCP dictionary), `serverId`, `busy`, `signIn`,
  `onChanged`. Feature class: `jini-external-mcp-shared-choice`.
- `useSettingsLocaleSync({ locale }, { activeLocale, setLocale })` — the UI library's locale pair;
  the host's wired hook calls its own `useI18n()` and passes it in.

**Provides:** `settings-i18n.ts`, `settings-interface-i18n.ts`, `settings-memory-i18n.ts`
(`memoryPanelDictionaries`; 21 locales split across `.locales-a/-b` for the size limit), all falling
back to `ADMIN_COMMON_I18N`; `createUserInterfaceSettingsPanelTranslator`; `useSettingsLocaleSync`;
`ExternalMcpSharedChoice` + `useExternalMcpSharedChoice`.

```tsx
const port: ExternalMcpSharedChoicePort = {
  listSharedMcpConnections: ({ serverId }) => api.listSharedMcpConnections({ serverId }).catch(toAdminApiError),
  useSharedMcpConnection: (input) => api.useSharedMcpConnection(input).catch(toAdminApiError),
  stopSharedMcpConnection: ({ serverId }) => api.stopSharedMcpConnection({ serverId }).catch(toAdminApiError),
  useLocalMcpConnection: ({ serverId }) => api.useLocalMcpConnection({ serverId }).catch(toAdminApiError),
};
const useHostSharedChoice: UseExternalMcpSharedChoice = (args) => useExternalMcpSharedChoice({ ...args, port });
<ExternalMcpSharedChoice serverId={id} busy={busy} signIn={signIn} onChanged={reload} t={t}
  useExternalMcpSharedChoiceHook={useHostSharedChoice} />
```

**Must never import:** the host's request/integrations client, its UI library's `useI18n`, its
dictionaries that name the product, or its styles. Boundary rationale:
[`DR-005-portable-package-boundaries`](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
