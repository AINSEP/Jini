# ServerRestartingBanner

A thin top-centre status pill while the host's API server is restarting or unreachable; hidden while it
answers. Logic: `hooks/use-server-connection-status.hooks.ts` (`useServerConnectionBanner`, a pure hook
over the injected store). Styles: `server-restarting-banner.css` (`jini-server-restarting-banner`,
plus a `--<status>` modifier).

## Wiring

- **Needs injected (required props):** `reconnect: ServerConnectionStatusPort` (`subscribe`,
  `getStatus` — the host's one reconnect store) and `text: ServerConnectionBannerText` (host copy per
  `ServerConnectionStatus`; `null` hides the banner, and the copy may name the product).
- **Needs mounted:** the host imports the stylesheet subpath. Theme tokens used: `--warning-bg`,
  `--warning`, `--jini-panel-shadow-banner`.
- **Provides:** `ServerRestartingBanner`, `useServerConnectionBanner`, `ServerConnectionStatus`,
  `ServerConnectionStatusPort`, `ServerConnectionBannerText`.
- **Never imports:** the host's reconnect store or request layer, product copy, or host theme CSS.

```tsx
import "@jini-ai/admin/shell/components/ServerRestartingBanner/server-restarting-banner.css";
import { ServerRestartingBanner } from "@jini-ai/admin/shell/components/ServerRestartingBanner/ServerRestartingBanner";
import { serverReconnect } from "./lib/server-reconnect";

const BANNER_TEXT = { online: null, reconnecting: "Server restarting… reconnecting.", unreachable: "Can't reach the server." };

export function HostRestartBanner() {
  return <ServerRestartingBanner reconnect={serverReconnect} text={BANNER_TEXT} />;
}
```

Why injected rather than imported: [DR-005 portable package boundaries](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
