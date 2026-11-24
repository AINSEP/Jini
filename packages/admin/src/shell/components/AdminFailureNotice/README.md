# AdminFailureNotice

The page-wide failure card: the one retained incident from the host's failure channel, shown through the
kit's `ErrorNotice` with a Dismiss button inside the card. Floats top-right so a failure never moves the
layout (`admin-failure-notice.css`, `jini-admin-failure-notice*` classes).

## Wiring

- **Needs injected (required props):** `channel: AdminFailureNoticeChannel` (`subscribe`, `getSnapshot`,
  `reset` — `@jini-ai/ui/panel-kit`'s `createFailureChannel` satisfies it) and `dismissLabel: string`
  (the host resolves the locale; this notice mounts before sign-in). Remaining props pass through to the
  kit `ErrorNotice` (`t`, `className`); clipboard ports belong in the host's kit `ErrorNotice` binding.
- **Needs mounted:** `<AdminKitProvider>` above it (the `ErrorNotice` slot), and the host imports the
  stylesheet subpath. Theme tokens used: `--r-md`.
- **Provides:** `AdminFailureNotice`, `AdminFailureNoticeChannel`, `AdminFailureNoticeProps`.
- **Never imports:** host code (failure-channel instances, dictionaries, `document` locale reads), a UI
  library implementation (the kit injects it), or host theme CSS.

```tsx
import "@jini-ai/admin/shell/components/AdminFailureNotice/admin-failure-notice.css";
import { AdminFailureNotice } from "@jini-ai/admin/shell/components/AdminFailureNotice/AdminFailureNotice";
import { hostFailureChannel } from "./lib/failure-channel";

export function HostFailureNotice() {
  const locale = document.documentElement.lang || "en";
  return <AdminFailureNotice channel={hostFailureChannel} dismissLabel={t({ locale, key: "Dismiss error" })} />;
}
```

Why injected rather than imported: [DR-005 portable package boundaries](../../../../../../docs/decisions/DR-005-portable-package-boundaries.md).
