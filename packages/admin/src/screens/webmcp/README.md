# webmcp (admin screens)

Admin-side pieces of the browser-agent (WebMCP) feature. Today this folder holds only the settings
copy: the opt-out toggle's label and hints, the approval prompt and its Confirm label, in every admin
locale. The toggle panel, its preference hook and the page-tool registration still live in the host
and are expected to follow once their host wiring is free to change.

## Wiring

Architecture: [DR-005 portable package boundaries](../../../../../docs/decisions/DR-005-portable-package-boundaries.md).

**Needs injected**: nothing — it is a plain dictionary. The host supplies the translator and the
common-word fallback (`LocaleDictionary` from `@jini-ai/core/text`).

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
