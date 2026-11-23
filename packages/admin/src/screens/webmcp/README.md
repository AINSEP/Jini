# webmcp (admin screens)

Admin-side pieces of the browser-agent (WebMCP) feature: the settings copy (the opt-out toggle's
label and hints, the approval prompt and its Confirm label, in every admin locale), the origin-local
opt-out preference (`browser-agent-settings.hooks.ts`) and the human-only toggle panel
(`BrowserAgentSettingsPanel.tsx`). The page-tool registration still lives in the host: it depends on
`@jini-ai/agentic`, which this package may not import.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**: nothing — it is a plain dictionary. The host supplies the translator and the
common-word fallback (`LocaleDictionary` from `@jini-ai/core/text`).

**Needs injected** (preference + panel)
- `createBrowserAgentSettingsPort({ preferenceKey })` — the host's own localStorage key. The port
  keeps a session-only override when storage is blocked and follows other tabs' storage events.
- `useBrowserAgentSettings({ port })` — `port` is required (the host's bound port, or a test fake).
- `BrowserAgentSettingsPanel({ locale, useBrowserAgentSettingsHook })` — the hook is a REQUIRED prop:
  the host's `useBrowserAgentSettings` already bound to its port; `t` is also required — the host's
  translator over `WEBMCP_DICT` and its own common words.

**Host binding today**: the admin's webmcp preference module creates the one shared port with its
storage key and exports the bound hook and translator; its settings screen passes both to the panel, and its
assistant dock and app hooks read the same port (the page-tool registration's `isEnabled`).

**Provides**
- `WEBMCP_KEYS` — the English source keys, in dictionary row order.
- `WEBMCP_DICT: LocaleDictionary` — every key plus `Confirm`, per locale.

**Host wiring example**

```ts
import { createDictionaryTranslator } from "@jini-ai/core/text";
import { ADMIN_COMMON_I18N } from "@jini-ai/admin/core/i18n-common";
import { WEBMCP_DICT } from "@jini-ai/admin/screens/webmcp/webmcp-i18n";

/** Swap ADMIN_COMMON_I18N for the host's own composed common dictionary if it has one. */
export const t = createDictionaryTranslator({ featureDictionary: WEBMCP_DICT }, { commonDictionary: ADMIN_COMMON_I18N });
```

**Must never import**: host app code, a host common dictionary, or any cross-package implementation
(only the `@jini-ai/core/text` `LocaleDictionary` type).
